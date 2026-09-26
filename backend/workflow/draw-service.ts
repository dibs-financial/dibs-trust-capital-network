/**
 * DIBS Track A — persisted DrawRequest workflow.
 *
 * Drives the existing machine (draw-request.ts: ALLOWED_TRANSITIONS,
 * approvalFailures, transitionDraw) against Postgres. Every operation:
 *   - runs in one tenant transaction, tenant taken from the session;
 *   - refuses request input that names a tenant;
 *   - requires an idempotency key and replays instead of repeating;
 *   - writes the audit event first, then changes the rows.
 *
 * Money: BIGINT in Postgres, bigint here, decimal strings at the edge.
 * DIBS approves and records. Nothing here moves funds.
 * No template literals — GitHub web editor corrupts dollar-brace.
 */

import { createHash, randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { assertNoClientTenant, DomainError, parseMinor, requireRole, Session, withTenantTx } from '../api/db';
import { canonicalJson, EventType } from '../audit/event-store';
import { ChainVerification, PgEventStore } from '../audit/pg-event-store';
import { ApprovalContext, approvalFailures, DrawRequest, DrawRequestState, transitionDraw } from './draw-request';
import { getPolicyPack } from './policy';

const sha256 = function (data: string | Buffer): string {
  return 'sha256:' + createHash('sha256').update(data).digest('hex');
};

const iso = function (v: unknown): string | null {
  return v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
};

function rowToDraw(row: Record<string, unknown>): DrawRequest {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    dealId: String(row.deal_id),
    spvId: String(row.spv_id),
    seriesId: row.series_id === null ? null : String(row.series_id),
    requestNumber: String(row.request_number),
    status: row.status as DrawRequestState,
    requestedByUserId: String(row.requested_by_subject),
    payeeCounterpartyId: String(row.payee_counterparty_id),
    payeeBankAccountId: String(row.payee_bank_account_id),
    amountRequestedMinor: BigInt(row.amount_requested_minor as string),
    amountApprovedMinor: row.amount_approved_minor === null ? null : BigInt(row.amount_approved_minor as string),
    currency: String(row.currency).trim(),
    budgetLineIds: (row.budget_line_ids as string[]) || [],
    requestedAt: iso(row.requested_at)!,
    submittedAt: iso(row.submitted_at),
    lockedPolicyVersion: (row.locked_policy_version as string) ?? null,
    lockedEvidenceManifestHash: (row.locked_evidence_manifest_hash as string) ?? null,
    approvalBindingHash: (row.approval_binding_hash as string) ?? null,
    policyEvaluationId: (row.policy_evaluation_id as string) ?? null,
    idempotencyKey: String(row.idempotency_key),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

/** HTTP shape: money as strings. */
export function drawToJson(d: DrawRequest): Record<string, unknown> {
  return {
    ...d,
    amountRequestedMinor: d.amountRequestedMinor.toString(),
    amountApprovedMinor: d.amountApprovedMinor === null ? null : d.amountApprovedMinor.toString(),
  };
}

/** Columns the workflow may set besides the aggregate fields. */
type DrawExtras = Partial<{
  evidence_status: string;
  approval_status: string;
  settlement_status: string;
  reconciliation_status: string;
  policy_evaluation_status: string;
  hold_reason_code: string | null;
  hold_reason_text: string | null;
}>;

async function loadDraw(tx: PoolClient, id: string): Promise<DrawRequest> {
  const r = await tx.query('SELECT * FROM draw_request WHERE id = $1 FOR UPDATE', [id]);
  if (r.rows.length === 0) throw new DomainError('NOT_FOUND', 'draw ' + id);
  return rowToDraw(r.rows[0]);
}

async function saveDraw(tx: PoolClient, before: DrawRequest, next: DrawRequest, extras: DrawExtras = {}): Promise<void> {
  const cols = [
    'status', 'amount_approved_minor', 'submitted_at', 'locked_policy_version',
    'locked_evidence_manifest_hash', 'approval_binding_hash', 'policy_evaluation_id',
  ];
  const vals: unknown[] = [
    next.status,
    next.amountApprovedMinor === null ? null : next.amountApprovedMinor.toString(),
    next.submittedAt,
    next.lockedPolicyVersion,
    next.lockedEvidenceManifestHash,
    next.approvalBindingHash,
    next.policyEvaluationId,
  ];
  for (const [k, v] of Object.entries(extras)) {
    cols.push(k);
    vals.push(v);
  }
  const sets = cols.map(function (c, i) { return c + ' = $' + (i + 3); }).join(', ');
  const r = await tx.query('UPDATE draw_request SET ' + sets + ' WHERE id = $1 AND status = $2', ([before.id, before.status] as unknown[]).concat(vals));
  if (r.rowCount !== 1) throw new DomainError('CONCURRENT_CHANGE', 'draw ' + before.id);
}

async function isReplay(tx: PoolClient, idempotencyKey: string): Promise<boolean> {
  if (!idempotencyKey) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
  const r = await tx.query('SELECT 1 FROM audit_event WHERE idempotency_key = $1 LIMIT 1', [idempotencyKey]);
  return r.rows.length > 0;
}

function actor(session: Session, role: string) {
  return { id: session.subject, type: 'USER' as const, role: role };
}

async function openHoldOn(tx: PoolClient, d: DrawRequest): Promise<boolean> {
  const r = await tx.query(
    "SELECT 1 FROM hold WHERE released_at IS NULL AND (scope_type = 'TENANT' " +
      "OR (scope_type = 'DRAW' AND scope_id = $1) OR (scope_type = 'DEAL' AND scope_id = $2) " +
      "OR (scope_type = 'SPV' AND scope_id = $3) OR (scope_type = 'COUNTERPARTY' AND scope_id = $4)) LIMIT 1",
    [d.id, d.dealId, d.spvId, d.payeeCounterpartyId]
  );
  return r.rows.length > 0;
}

async function manifestDocs(tx: PoolClient, drawId: string): Promise<Array<{ type: string; verified: boolean }>> {
  const r = await tx.query(
    'SELECT d.document_type, d.verification_status FROM evidence_manifest m ' +
      'JOIN evidence_document d ON d.id = ANY (m.document_ids) WHERE m.draw_request_id = $1',
    [drawId]
  );
  return r.rows.map(function (row) { return { type: String(row.document_type), verified: row.verification_status === 'VERIFIED' }; });
}

/**
 * Inputs approvalFailures() needs that have no table yet (budget lines,
 * retainage, covenants arrive in Sprint 3). The approver supplies them and they
 * are recorded in the approval event, so every approval shows what it relied on.
 */
export interface ApprovalControls {
  remainingBudgetMinor: string;
  eligibleThisDrawMinor: string;
  retainageApplied: boolean;
  covenantStatus: ApprovalContext['covenantStatus'];
  waiverCoversBreach: boolean;
  loanInBalancePasses: boolean;
  deficiencyDepositConfirmed: boolean;
}

export interface CsvReconciliationResult {
  line: number;
  externalPartnerId: string;
  settlementReference: string;
  drawId: string | null;
  outcome: 'MATCHED' | 'EXCEPTION';
  mismatchCodes: string[];
}

const CSV_HEADER = 'external_partner_id,settlement_reference,amount_minor,currency,payee_account_ref,settlement_date';
const CSV_ENTRY_ROLES = ['TreasuryOwner', 'OperationsOwner', 'FundAdministrator', 'RiskOwner'];

interface CsvRow {
  external_partner_id: string;
  settlement_reference: string;
  amount_minor: string;
  currency: string;
  payee_account_ref: string;
  settlement_date: string;
}

export function parseConfirmationCsv(csv: string): CsvRow[] {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').filter(function (l) { return l.trim().length > 0; });
  if (lines.length === 0 || lines[0].trim() !== CSV_HEADER) {
    throw new DomainError('CSV_INVALID', 'header must be ' + CSV_HEADER);
  }
  return lines.slice(1).map(function (line, i) {
    const f = line.split(',').map(function (x) { return x.trim(); });
    const at = 'line ' + (i + 2);
    if (f.length !== 6) throw new DomainError('CSV_INVALID', at + ': expected 6 fields');
    if (!f[0] || !f[1] || !f[4]) throw new DomainError('CSV_INVALID', at + ': empty identifier');
    if (!/^[0-9]{1,18}$/.test(f[2])) throw new DomainError('CSV_INVALID', at + ': amount_minor must be integer minor units');
    if (!/^[A-Z]{3}$/.test(f[3])) throw new DomainError('CSV_INVALID', at + ': currency');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f[5])) throw new DomainError('CSV_INVALID', at + ': settlement_date');
    return { external_partner_id: f[0], settlement_reference: f[1], amount_minor: f[2], currency: f[3], payee_account_ref: f[4], settlement_date: f[5] };
  });
}

export class DrawService {
  constructor(private readonly pool: Pool) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getDraw(session: Session, drawId: string): Promise<DrawRequest> {
    return withTenantTx(this.pool, session, async function (tx) {
      const r = await tx.query('SELECT * FROM draw_request WHERE id = $1', [drawId]);
      if (r.rows.length === 0) throw new DomainError('NOT_FOUND', 'draw ' + drawId);
      return rowToDraw(r.rows[0]);
    });
  }

  async listDraws(session: Session): Promise<DrawRequest[]> {
    return withTenantTx(this.pool, session, async function (tx) {
      const r = await tx.query('SELECT * FROM draw_request ORDER BY created_at, id');
      return r.rows.map(rowToDraw);
    });
  }

  async verifyAuditChain(session: Session): Promise<ChainVerification> {
    return withTenantTx(this.pool, session, function (tx) {
      return new PgEventStore(tx, session).verifyChain();
    });
  }

  // -------------------------------------------------------------------------
  // DRAFT
  // -------------------------------------------------------------------------

  async createDraft(
    session: Session,
    input: {
      dealId: string;
      requestNumber: string;
      payeeCounterpartyId: string;
      payeeBankAccountId: string;
      amountRequestedMinor: string;
      currency: string;
      budgetLineIds?: string[];
      idempotencyKey: string;
    }
  ): Promise<DrawRequest> {
    assertNoClientTenant(input);
    const amount = parseMinor(input.amountRequestedMinor, 'amountRequestedMinor');
    return withTenantTx(this.pool, session, async function (tx) {
      if (!input.idempotencyKey) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
      const existing = await tx.query('SELECT * FROM draw_request WHERE idempotency_key = $1', [input.idempotencyKey]);
      if (existing.rows.length > 0) return rowToDraw(existing.rows[0]);

      const role = await requireRole(tx, session, ['BorrowerSponsor', 'OperationsOwner'], [input.dealId]);
      const deal = await tx.query('SELECT spv_id, currency FROM deal WHERE id = $1', [input.dealId]);
      if (deal.rows.length === 0) throw new DomainError('NOT_FOUND', 'deal ' + input.dealId);
      if (String(deal.rows[0].currency).trim() !== input.currency) throw new DomainError('CURRENCY_MISMATCH');

      const id = randomUUID();
      await new PgEventStore(tx, session).append({
        tenantId: session.tenantId,
        eventType: EventType.DRAW_CREATED,
        aggregateType: 'DRAW_REQUEST',
        aggregateId: id,
        actorId: session.subject,
        actorRole: role,
        stateBefore: null,
        stateAfter: 'DRAFT',
        idempotencyKey: input.idempotencyKey,
        payload: {
          deal_id: input.dealId,
          request_number: input.requestNumber,
          amount_requested_minor: amount.toString(),
          currency: input.currency,
          payee_bank_account_id: input.payeeBankAccountId,
        },
      });
      const r = await tx.query(
        'INSERT INTO draw_request (id, tenant_id, deal_id, spv_id, request_number, requested_by_subject, ' +
          'payee_counterparty_id, payee_bank_account_id, amount_requested_minor, currency, budget_line_ids, idempotency_key) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
        [
          id, session.tenantId, input.dealId, deal.rows[0].spv_id, input.requestNumber, session.subject,
          input.payeeCounterpartyId, input.payeeBankAccountId, amount.toString(), input.currency,
          input.budgetLineIds || [], input.idempotencyKey,
        ]
      );
      return rowToDraw(r.rows[0]);
    });
  }

  // -------------------------------------------------------------------------
  // Evidence: ingest, hash, verify
  // -------------------------------------------------------------------------

  async uploadEvidence(
    session: Session,
    input: { drawId: string; documentType: string; content: Buffer; storageUri: string; sourceSystem: string; idempotencyKey: string }
  ): Promise<{ documentId: string; contentHash: string; version: number }> {
    assertNoClientTenant(input);
    if (!Buffer.isBuffer(input.content) || input.content.length === 0) throw new DomainError('EVIDENCE_EMPTY');
    return withTenantTx(this.pool, session, async function (tx) {
      if (await isReplay(tx, input.idempotencyKey)) {
        const r = await tx.query(
          'SELECT id, content_hash, version FROM evidence_document WHERE draw_request_id = $1 AND content_hash = $2 ORDER BY version DESC LIMIT 1',
          [input.drawId, sha256(input.content)]
        );
        return { documentId: String(r.rows[0].id), contentHash: String(r.rows[0].content_hash), version: Number(r.rows[0].version) };
      }
      const draw = await loadDraw(tx, input.drawId);
      const role = await requireRole(tx, session, ['BorrowerSponsor', 'Inspector', 'OperationsOwner'], [draw.dealId]);
      if (draw.status !== 'DRAFT') throw new DomainError('MANIFEST_FROZEN', 'evidence is added before SUBMITTED');

      // Hash the bytes we received. A client-supplied hash is never trusted.
      const contentHash = sha256(input.content);
      const prior = await tx.query(
        'SELECT id, version FROM evidence_document WHERE draw_request_id = $1 AND document_type = $2 ORDER BY version DESC LIMIT 1',
        [draw.id, input.documentType]
      );
      const version = prior.rows.length ? Number(prior.rows[0].version) + 1 : 1;
      const supersedes = prior.rows.length ? String(prior.rows[0].id) : null;
      const id = randomUUID();

      await new PgEventStore(tx, session).append({
        tenantId: session.tenantId,
        eventType: supersedes ? EventType.EVIDENCE_SUPERSEDED : EventType.EVIDENCE_UPLOADED,
        aggregateType: 'DRAW_REQUEST',
        aggregateId: draw.id,
        actorId: session.subject,
        actorRole: role,
        idempotencyKey: input.idempotencyKey,
        payload: { document_id: id, document_type: input.documentType, content_hash: contentHash, version: version, supersedes_id: supersedes },
      });
      await tx.query(
        'INSERT INTO evidence_document (id, tenant_id, deal_id, spv_id, draw_request_id, document_type, storage_uri, ' +
          'content_hash, version, supersedes_id, uploaded_by_subject, source_system, retention_classification) ' +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'DRAW_EVIDENCE')",
        [id, session.tenantId, draw.dealId, draw.spvId, draw.id, input.documentType, input.storageUri, contentHash, version, supersedes, session.subject, input.sourceSystem]
      );
      return { documentId: id, contentHash: contentHash, version: version };
    });
  }

  async verifyEvidence(session: Session, input: { documentId: string; idempotencyKey: string }): Promise<void> {
    assertNoClientTenant(input);
    await withTenantTx(this.pool, session, async function (tx) {
      if (await isReplay(tx, input.idempotencyKey)) return;
      const doc = await tx.query('SELECT * FROM evidence_document WHERE id = $1 FOR UPDATE', [input.documentId]);
      if (doc.rows.length === 0) throw new DomainError('NOT_FOUND', 'document ' + input.documentId);
      const d = doc.rows[0];
      const role = await requireRole(tx, session, ['OperationsOwner', 'Inspector', 'Underwriter', 'RiskOwner'], [String(d.deal_id)]);
      if (d.uploaded_by_subject === session.subject) throw new DomainError('SOD_UPLOADER_CANNOT_VERIFY');
      await new PgEventStore(tx, session).append({
        tenantId: session.tenantId,
        eventType: EventType.EVIDENCE_VERIFIED,
        aggregateType: 'DRAW_REQUEST',
        aggregateId: String(d.draw_request_id),
        actorId: session.subject,
        actorRole: role,
        idempotencyKey: input.idempotencyKey,
        payload: { document_id: input.documentId, content_hash: d.content_hash },
      });
      await tx.query("UPDATE evidence_document SET verification_status = 'VERIFIED', verified_at = now() WHERE id = $1", [input.documentId]);
    });
  }

  // -------------------------------------------------------------------------
  // DRAFT → SUBMITTED: freeze policy version and evidence manifest
  // -------------------------------------------------------------------------

  async submit(session: Session, input: { drawId: string; idempotencyKey: string }): Promise<DrawRequest> {
    assertNoClientTenant(input);
    return withTenantTx(this.pool, session, async function (tx) {
      if (await isReplay(tx, input.idempotencyKey)) return loadDraw(tx, input.drawId);
      const draw = await loadDraw(tx, input.drawId);
      if (draw.requestedByUserId !== session.subject) throw new DomainError('ONLY_REQUESTER_SUBMITS');

      // Latest version of each document on the draw.
      const docs = await tx.query(
        'SELECT d.id, d.document_type, d.content_hash, d.version FROM evidence_document d ' +
          'WHERE d.draw_request_id = $1 AND NOT EXISTS (SELECT 1 FROM evidence_document n WHERE n.supersedes_id = d.id) ORDER BY d.id',
        [draw.id]
      );
      if (docs.rows.length === 0) throw new DomainError('EVIDENCE_REQUIRED');
      const items = docs.rows.map(function (r) {
        return { document_id: String(r.id), document_type: String(r.document_type), content_hash: String(r.content_hash), version: Number(r.version) };
      });
      const manifestHash = sha256(canonicalJson(items));
      const deal = await tx.query('SELECT effective_policy_version FROM deal WHERE id = $1', [draw.dealId]);
      const policyVersion = String(deal.rows[0].effective_policy_version);
      getPolicyPack(policyVersion); // must be a known, immutable pack

      const locked: DrawRequest = { ...draw, lockedPolicyVersion: policyVersion, lockedEvidenceManifestHash: manifestHash };
      const next = await transitionDraw(locked, 'SUBMITTED', new PgEventStore(tx, session), actor(session, 'Requester'), {
        idempotencyKey: input.idempotencyKey,
        payload: { manifest_hash: manifestHash, policy_version: policyVersion, documents: items },
      });
      await tx.query(
        'INSERT INTO evidence_manifest (tenant_id, draw_request_id, document_ids, manifest_hash, frozen_by_subject) VALUES ($1,$2,$3,$4,$5)',
        [session.tenantId, draw.id, items.map(function (i) { return i.document_id; }), manifestHash, session.subject]
      );
      await saveDraw(tx, draw, next, { evidence_status: 'FROZEN' });
      return loadDraw(tx, draw.id);
    });
  }

  // -------------------------------------------------------------------------
  // SUBMITTED → UNDER_REVIEW: policy evaluation against the locked pack
  // -------------------------------------------------------------------------

  async evaluate(session: Session, input: { drawId: string; idempotencyKey: string }): Promise<DrawRequest> {
    assertNoClientTenant(input);
    return withTenantTx(this.pool, session, async function (tx) {
      if (await isReplay(tx, input.idempotencyKey)) return loadDraw(tx, input.drawId);
      const draw = await loadDraw(tx, input.drawId);
      const role = await requireRole(tx, session, ['OperationsOwner', 'RiskOwner', 'Underwriter', 'LenderAdmin'], [draw.dealId]);
      const pack = getPolicyPack(draw.lockedPolicyVersion);
      const docs = await manifestDocs(tx, draw.id);
      const ruleResults = pack.requiredEvidence.map(function (type) {
        const present = docs.some(function (d) { return d.type === type; });
        return present
          ? { rule: 'REQUIRED_EVIDENCE', subject: type, result: 'PASS' }
          : { rule: 'REQUIRED_EVIDENCE', subject: type, result: 'FAIL', reason_code: 'EVIDENCE_MISSING', reason_text: type + ' is not in the frozen manifest' };
      });
      const result = ruleResults.every(function (r) { return r.result === 'PASS'; }) ? 'PASS' : 'HOLD';
      const evaluationId = randomUUID();

      const next = await transitionDraw(draw, 'UNDER_REVIEW', new PgEventStore(tx, session), actor(session, role), {
        idempotencyKey: input.idempotencyKey,
        payload: { policy_evaluation_id: evaluationId, result: result, rule_results: ruleResults },
      });
      await tx.query(
        'INSERT INTO policy_evaluation (id, tenant_id, draw_request_id, locked_policy_version, evidence_manifest_hash, result, rule_results, evaluated_by) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [evaluationId, session.tenantId, draw.id, draw.lockedPolicyVersion, draw.lockedEvidenceManifestHash, result, JSON.stringify(ruleResults), 'policy-engine/1']
      );
      await saveDraw(tx, draw, { ...next, policyEvaluationId: evaluationId }, { policy_evaluation_status: result, approval_status: 'PENDING' });
      return loadDraw(tx, draw.id);
    });
  }

  // -------------------------------------------------------------------------
  // UNDER_REVIEW → APPROVED: only when approvalFailures() is empty
  // -------------------------------------------------------------------------

  async approve(
    session: Session,
    input: { drawId: string; amountApprovedMinor: string; controls: ApprovalControls; idempotencyKey: string }
  ): Promise<DrawRequest> {
    assertNoClientTenant(input);
    const amountApproved = parseMinor(input.amountApprovedMinor, 'amountApprovedMinor');
    const remaining = parseMinor(input.controls.remainingBudgetMinor, 'remainingBudgetMinor');
    const eligible = parseMinor(input.controls.eligibleThisDrawMinor, 'eligibleThisDrawMinor');
    return withTenantTx(this.pool, session, async function (tx) {
      if (await isReplay(tx, input.idempotencyKey)) return loadDraw(tx, input.drawId);
      const draw = await loadDraw(tx, input.drawId);
      if (draw.status !== 'UNDER_REVIEW') throw new DomainError('INVALID_STATE', draw.status);
      const pack = getPolicyPack(draw.lockedPolicyVersion);
      const role = await requireRole(tx, session, pack.approverRoles, [draw.dealId, draw.spvId]);

      const bindingHash = sha256(canonicalJson({
        amount_approved_minor: amountApproved.toString(),
        currency: draw.currency,
        payee_bank_account_id: draw.payeeBankAccountId,
        evidence_manifest_hash: draw.lockedEvidenceManifestHash,
        policy_version: draw.lockedPolicyVersion,
        budget_line_ids: [...draw.budgetLineIds].sort(),
      }));
      const candidate: DrawRequest = { ...draw, amountApprovedMinor: amountApproved, approvalBindingHash: bindingHash };

      // Everything the store knows is read from the store, not from the caller.
      const docs = await manifestDocs(tx, draw.id);
      const manifest = await tx.query('SELECT manifest_hash FROM evidence_manifest WHERE draw_request_id = $1', [draw.id]);
      const evaluation = await tx.query(
        'SELECT locked_policy_version FROM policy_evaluation WHERE id = $1', [draw.policyEvaluationId]
      );
      const prior = await tx.query(
        "SELECT approver_subject FROM approval_decision WHERE draw_request_id = $1 AND approval_binding_hash = $2 AND decision = 'APPROVE'",
        [draw.id, bindingHash]
      );
      const approvers = new Set<string>(prior.rows.map(function (r) { return String(r.approver_subject); }));
      approvers.add(session.subject);
      const payee = await tx.query(
        'SELECT verification_status, cooling_period_ends_at, currency, (cooling_period_ends_at IS NULL OR cooling_period_ends_at <= now()) AS cooled ' +
          'FROM payee_bank_account WHERE id = $1',
        [draw.payeeBankAccountId]
      );
      const cp = await tx.query(
        "SELECT sanctions_status = 'CLEAR' AND sanctions_screened_at > now() - make_interval(days => $2) AS fresh FROM counterparty WHERE id = $1",
        [draw.payeeCounterpartyId, pack.sanctionsMaxAgeDays]
      );

      const ctx: ApprovalContext = {
        manifestComplete: pack.requiredEvidence.every(function (t) { return docs.some(function (d) { return d.type === t; }); }),
        manifestItemExpiredOrUnverified: docs.some(function (d) { return !d.verified; }),
        remainingBudgetMinor: remaining,
        eligibleThisDrawMinor: eligible,
        retainageApplied: input.controls.retainageApplied,
        covenantStatus: input.controls.covenantStatus,
        waiverCoversBreach: input.controls.waiverCoversBreach,
        loanInBalancePasses: input.controls.loanInBalancePasses,
        deficiencyDepositConfirmed: input.controls.deficiencyDepositConfirmed,
        requiredApprovalsRecorded: approvers.size >= pack.requiredApprovals,
        approversDistinctFromRequester: !approvers.has(draw.requestedByUserId),
        // The instructor is not known yet; settlement instruction enforces approver ≠ instructor.
        noApproverIsInstructor: true,
        openHold: await openHoldOn(tx, draw),
        payeeVerified: payee.rows.length === 1 && payee.rows[0].verification_status === 'VERIFIED' && payee.rows[0].cooled === true,
        sanctionsFresh: cp.rows.length === 1 && cp.rows[0].fresh === true,
        settlementRouteValid: payee.rows.length === 1 && String(payee.rows[0].currency).trim() === draw.currency,
        policyVersionMatchesLock: evaluation.rows.length === 1 && evaluation.rows[0].locked_policy_version === draw.lockedPolicyVersion,
        manifestHashMatchesLock: manifest.rows.length === 1 && manifest.rows[0].manifest_hash === draw.lockedEvidenceManifestHash,
      };
      const failures = approvalFailures(candidate, ctx);
      const blocking = failures.filter(function (f) { return f !== 'APPROVALS_INCOMPLETE'; });
      if (blocking.length > 0) throw new DomainError('APPROVAL_BLOCKED', blocking.join(','), blocking);

      const events = new PgEventStore(tx, session);
      const decisionPayload = {
        approval_binding_hash: bindingHash,
        amount_approved_minor: amountApproved.toString(),
        controls: input.controls,
      };
      const insertDecision = function () {
        return tx.query(
          'INSERT INTO approval_decision (tenant_id, draw_request_id, approver_subject, approver_role, decision, ' +
            'locked_policy_version, evidence_manifest_hash, approval_binding_hash, idempotency_key) ' +
            "VALUES ($1,$2,$3,$4,'APPROVE',$5,$6,$7,$8)",
          [session.tenantId, draw.id, session.subject, role, draw.lockedPolicyVersion, draw.lockedEvidenceManifestHash, bindingHash, input.idempotencyKey]
        );
      };

      if (failures.length > 0) {
        // Only more approvers are missing: record this decision, stay UNDER_REVIEW.
        await events.append({
          tenantId: session.tenantId,
          eventType: EventType.APPROVAL_RECORDED,
          aggregateType: 'DRAW_REQUEST',
          aggregateId: draw.id,
          actorId: session.subject,
          actorRole: role,
          policyVersion: draw.lockedPolicyVersion || '',
          evidenceManifestHash: draw.lockedEvidenceManifestHash || '',
          idempotencyKey: input.idempotencyKey,
          payload: decisionPayload,
        });
        await insertDecision();
        return loadDraw(tx, draw.id);
      }

      const next = await transitionDraw(candidate, 'APPROVED', events, actor(session, role), {
        approvalContext: ctx,
        idempotencyKey: input.idempotencyKey,
        payload: decisionPayload,
      });
      await insertDecision();
      await saveDraw(tx, draw, next, { approval_status: 'APPROVED' });
      return loadDraw(tx, draw.id);
    });
  }

  // -------------------------------------------------------------------------
  // APPROVED → SETTLEMENT_INSTRUCTED: TreasuryOwner, not requester, not approver
  // -------------------------------------------------------------------------

  async instruct(
    session: Session,
    input: { drawId: string; externalPartnerId: string; settlementReference: string; idempotencyKey: string }
  ): Promise<DrawRequest> {
    assertNoClientTenant(input);
    return withTenantTx(this.pool, session, async function (tx) {
      if (await isReplay(tx, input.idempotencyKey)) return loadDraw(tx, input.drawId);
      const draw = await loadDraw(tx, input.drawId);
      const role = await requireRole(tx, session, ['TreasuryOwner'], [draw.dealId, draw.spvId]);
      if (session.subject === draw.requestedByUserId) throw new DomainError('SOD_REQUESTER_CANNOT_INSTRUCT');
      const approver = await tx.query('SELECT 1 FROM approval_decision WHERE draw_request_id = $1 AND approver_subject = $2', [draw.id, session.subject]);
      if (approver.rows.length > 0) throw new DomainError('SOD_APPROVER_CANNOT_INSTRUCT');

      const next = await transitionDraw(draw, 'SETTLEMENT_INSTRUCTED', new PgEventStore(tx, session), actor(session, role), {
        idempotencyKey: input.idempotencyKey,
        payload: {
          external_partner_id: input.externalPartnerId,
          settlement_reference: input.settlementReference,
          amount_minor: draw.amountApprovedMinor === null ? null : draw.amountApprovedMinor.toString(),
          currency: draw.currency,
          payee_bank_account_id: draw.payeeBankAccountId,
          approval_binding_hash: draw.approvalBindingHash,
        },
      });
      // The database re-checks role, SoD, binding, payee and holds on insert.
      await tx.query(
        'INSERT INTO settlement_instruction (tenant_id, draw_request_id, instructed_by_subject, external_partner_id, amount_minor, currency, ' +
          'payee_bank_account_id, locked_policy_version, locked_evidence_manifest_hash, approval_binding_hash, settlement_reference, idempotency_key) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          session.tenantId, draw.id, session.subject, input.externalPartnerId, draw.amountApprovedMinor!.toString(), draw.currency,
          draw.payeeBankAccountId, draw.lockedPolicyVersion, draw.lockedEvidenceManifestHash, draw.approvalBindingHash,
          input.settlementReference, input.idempotencyKey,
        ]
      );
      await saveDraw(tx, draw, next, { settlement_status: 'INSTRUCTED' });
      return loadDraw(tx, draw.id);
    });
  }

  // -------------------------------------------------------------------------
  // CSV confirmation (dual entry) → exact match → RECONCILED, else RECONCILIATION_EXCEPTION
  // -------------------------------------------------------------------------

  /**
   * Dual entry over HTTP, step 1: the first person stages the CSV. Nothing is
   * confirmed or reconciled until a different person submits a matching copy.
   */
  async stageCsvFirstEntry(session: Session, input: { batchKey: string; csv: string }): Promise<{ batchKey: string; rows: number }> {
    assertNoClientTenant(input);
    const rows = parseConfirmationCsv(input.csv);
    const csvHash = sha256(input.csv);
    return withTenantTx(this.pool, session, async function (tx) {
      if (!input.batchKey) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
      const staged = await tx.query('SELECT first_entry_subject, first_entry_hash FROM csv_import_batch WHERE batch_key = $1', [input.batchKey]);
      if (staged.rows.length > 0) {
        // Same person, same file: a replay. Anything else reuses a key.
        if (staged.rows[0].first_entry_subject === session.subject && staged.rows[0].first_entry_hash === csvHash) {
          return { batchKey: input.batchKey, rows: rows.length };
        }
        throw new DomainError('BATCH_ALREADY_STAGED', input.batchKey);
      }
      const role = await requireRole(tx, session, CSV_ENTRY_ROLES);
      await new PgEventStore(tx, session).append({
        tenantId: session.tenantId,
        eventType: 'CSV_BATCH_STAGED',
        aggregateType: 'SETTLEMENT_CONFIRMATION',
        aggregateId: input.batchKey,
        actorId: session.subject,
        actorRole: role,
        idempotencyKey: input.batchKey + ':staged',
        payload: { first_entry_hash: csvHash, rows: rows.length },
      });
      await tx.query(
        'INSERT INTO csv_import_batch (tenant_id, batch_key, first_entry_csv, first_entry_hash, first_entry_subject) VALUES ($1,$2,$3,$4,$5)',
        [session.tenantId, input.batchKey, input.csv, csvHash, session.subject]
      );
      return { batchKey: input.batchKey, rows: rows.length };
    });
  }

  /** Dual entry over HTTP, step 2: a different person's copy must match the staged one. */
  async confirmCsvSecondEntry(session: Session, input: { batchKey: string; csv: string }): Promise<CsvReconciliationResult[]> {
    assertNoClientTenant(input);
    const staged = await withTenantTx(this.pool, session, async function (tx) {
      const r = await tx.query('SELECT first_entry_csv, first_entry_subject FROM csv_import_batch WHERE batch_key = $1', [input.batchKey]);
      if (r.rows.length === 0) throw new DomainError('NOT_FOUND', 'batch ' + input.batchKey);
      return { csv: String(r.rows[0].first_entry_csv), subject: String(r.rows[0].first_entry_subject) };
    });
    // The first entrant is taken from the staged row, never from this request.
    const entrant: Session = { tenantId: session.tenantId, subject: staged.subject };
    return this.importCsvConfirmations(entrant, session, { firstEntryCsv: staged.csv, secondEntryCsv: input.csv, batchKey: input.batchKey });
  }

  async importCsvConfirmations(
    entrant: Session,
    confirmer: Session,
    input: { firstEntryCsv: string; secondEntryCsv: string; batchKey: string }
  ): Promise<CsvReconciliationResult[]> {
    assertNoClientTenant(input);
    if (entrant.tenantId !== confirmer.tenantId) throw new DomainError('TENANT_MISMATCH');
    if (entrant.subject === confirmer.subject) throw new DomainError('SOD_DUAL_ENTRY_SAME_PERSON');
    const rows = parseConfirmationCsv(input.firstEntryCsv);
    if (canonicalJson(rows) !== canonicalJson(parseConfirmationCsv(input.secondEntryCsv))) {
      throw new DomainError('DUAL_ENTRY_MISMATCH', 'the two entries of the CSV differ');
    }

    return withTenantTx(this.pool, entrant, async function (tx) {
      if (!input.batchKey) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED');
      if (await isReplay(tx, input.batchKey)) throw new DomainError('BATCH_ALREADY_IMPORTED', input.batchKey);
      const role = await requireRole(tx, entrant, CSV_ENTRY_ROLES);
      await requireRole(tx, confirmer, CSV_ENTRY_ROLES);
      const events = new PgEventStore(tx, entrant);
      await events.append({
        tenantId: entrant.tenantId,
        eventType: EventType.CSV_BATCH_IMPORTED,
        aggregateType: 'SETTLEMENT_CONFIRMATION',
        aggregateId: input.batchKey,
        actorId: entrant.subject,
        actorRole: role,
        idempotencyKey: input.batchKey,
        payload: { rows: rows, second_entry_subject: confirmer.subject },
      });

      const results: CsvReconciliationResult[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const key = input.batchKey + ':' + (i + 1);
        const rawHash = sha256(canonicalJson(row));
        const instr = await tx.query(
          'SELECT * FROM settlement_instruction WHERE external_partner_id = $1 AND settlement_reference = $2 FOR UPDATE',
          [row.external_partner_id, row.settlement_reference]
        );
        const duplicate = await tx.query(
          'SELECT 1 FROM settlement_confirmation WHERE external_partner_id = $1 AND settlement_reference = $2',
          [row.external_partner_id, row.settlement_reference]
        );
        const base = { line: i + 2, externalPartnerId: row.external_partner_id, settlementReference: row.settlement_reference };

        const recordException = async function (
          drawId: string | null,
          instrId: string | null,
          confId: string | null,
          codes: string[],
          beforeRecord?: () => Promise<unknown>
        ) {
          // Event first, then the rows it describes.
          await events.append({
            tenantId: entrant.tenantId,
            eventType: EventType.DRAW_RECONCILIATION_BREAK,
            aggregateType: drawId ? 'DRAW_REQUEST' : 'RECONCILIATION_RECORD',
            aggregateId: drawId || (row.external_partner_id + ':' + row.settlement_reference),
            actorId: entrant.subject,
            actorRole: role,
            idempotencyKey: key + ':break',
            payload: { mismatch_codes: codes, row: row },
          });
          if (beforeRecord) await beforeRecord();
          await tx.query(
            'INSERT INTO reconciliation_record (tenant_id, draw_request_id, settlement_instruction_id, settlement_confirmation_id, status, mismatch_codes, reconciled_by_subject) ' +
              "VALUES ($1,$2,$3,$4,'EXCEPTION',$5,$6)",
            [entrant.tenantId, drawId, instrId, confId, codes, entrant.subject]
          );
        };

        if (duplicate.rows.length > 0) {
          await recordException(instr.rows.length ? String(instr.rows[0].draw_request_id) : null, instr.rows.length ? String(instr.rows[0].id) : null, null, ['DUPLICATE_REFERENCE']);
          results.push({ ...base, drawId: instr.rows.length ? String(instr.rows[0].draw_request_id) : null, outcome: 'EXCEPTION', mismatchCodes: ['DUPLICATE_REFERENCE'] });
          continue;
        }

        const confirmationId = randomUUID();
        const insertConfirmation = function (instructionId: string | null) {
          return tx.query(
            'INSERT INTO settlement_confirmation (id, tenant_id, settlement_instruction_id, source, external_partner_id, settlement_reference, ' +
              'confirmed_amount_minor, currency, payee_account_ref, settlement_date, raw_payload_hash, entered_by_subject, second_entry_by_subject) ' +
              "VALUES ($1,$2,$3,'CSV',$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            [
              confirmationId, entrant.tenantId, instructionId, row.external_partner_id, row.settlement_reference, row.amount_minor,
              row.currency, row.payee_account_ref, row.settlement_date, rawHash, entrant.subject, confirmer.subject,
            ]
          );
        };

        if (instr.rows.length === 0) {
          // The partner reports a settlement DIBS never instructed.
          await recordException(null, null, confirmationId, ['UNAPPROVED_SETTLEMENT'], function () { return insertConfirmation(null); });
          results.push({ ...base, drawId: null, outcome: 'EXCEPTION', mismatchCodes: ['UNAPPROVED_SETTLEMENT'] });
          continue;
        }

        const instruction = instr.rows[0];
        const draw = await loadDraw(tx, String(instruction.draw_request_id));
        if (draw.status !== 'SETTLEMENT_INSTRUCTED') {
          await recordException(draw.id, String(instruction.id), null, ['DUPLICATE_REFERENCE']);
          results.push({ ...base, drawId: draw.id, outcome: 'EXCEPTION', mismatchCodes: ['DUPLICATE_REFERENCE'] });
          continue;
        }

        // SETTLEMENT_INSTRUCTED → SETTLEMENT_CONFIRMED: record what the partner says.
        const confirmed = await transitionDraw(draw, 'SETTLEMENT_CONFIRMED', events, actor(entrant, role), {
          idempotencyKey: key + ':confirmed',
          payload: { settlement_confirmation_id: confirmationId, row: row },
        });
        await insertConfirmation(String(instruction.id));
        await tx.query("UPDATE settlement_instruction SET status = 'CONFIRMED' WHERE id = $1", [instruction.id]);
        await saveDraw(tx, draw, confirmed, { settlement_status: 'CONFIRMED' });

        // Exact match on amount, currency, payee, partner, reference and date.
        const acct = await tx.query('SELECT account_ref FROM payee_bank_account WHERE id = $1', [instruction.payee_bank_account_id]);
        const codes: string[] = [];
        if (BigInt(row.amount_minor) !== BigInt(instruction.amount_minor)) codes.push('AMOUNT');
        if (row.currency !== String(instruction.currency).trim()) codes.push('CURRENCY');
        if (row.payee_account_ref !== acct.rows[0].account_ref) codes.push('PAYEE');
        if (row.settlement_date < (instruction.instructed_at as Date).toISOString().slice(0, 10)) codes.push('DATE');

        if (codes.length === 0) {
          const next = await transitionDraw(confirmed, 'RECONCILED', events, actor(entrant, role), {
            idempotencyKey: key + ':reconciled',
            payload: { settlement_confirmation_id: confirmationId, settlement_instruction_id: String(instruction.id) },
          });
          await tx.query(
            'INSERT INTO reconciliation_record (tenant_id, draw_request_id, settlement_instruction_id, settlement_confirmation_id, status, reconciled_by_subject) ' +
              "VALUES ($1,$2,$3,$4,'MATCHED',$5)",
            [entrant.tenantId, draw.id, instruction.id, confirmationId, entrant.subject]
          );
          await saveDraw(tx, confirmed, next, { reconciliation_status: 'MATCHED' });
          results.push({ ...base, drawId: draw.id, outcome: 'MATCHED', mismatchCodes: [] });
        } else {
          const next = await transitionDraw(confirmed, 'RECONCILIATION_EXCEPTION', events, actor(entrant, role), {
            idempotencyKey: key + ':exception',
            payload: { settlement_confirmation_id: confirmationId, mismatch_codes: codes },
          });
          await tx.query(
            'INSERT INTO reconciliation_record (tenant_id, draw_request_id, settlement_instruction_id, settlement_confirmation_id, status, mismatch_codes, reconciled_by_subject) ' +
              "VALUES ($1,$2,$3,$4,'EXCEPTION',$5,$6)",
            [entrant.tenantId, draw.id, instruction.id, confirmationId, codes, entrant.subject]
          );
          await saveDraw(tx, confirmed, next, { reconciliation_status: 'EXCEPTION' });
          results.push({ ...base, drawId: draw.id, outcome: 'EXCEPTION', mismatchCodes: codes });
        }
      }
      return results;
    });
  }
}
