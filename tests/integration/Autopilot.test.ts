/**
 * Track A — tests that prove it is Autopilot, against a real Postgres.
 *
 * Persistence + SoD + freeze + CSV recon:
 *   - week-one fixture: one deal, one user triangle, one inspection PDF hashed
 *     into a manifest, one CSV confirmation, one recon row, one verifiable chain
 *   - two tenants cannot see each other's draws
 *   - missing inspection cannot APPROVE
 *   - requester cannot approve (and approver cannot instruct)
 *   - unmatched CSV cannot RECONCILE
 *   - audit chain verifies; mutating an event row is impossible
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { DomainError, withTenantTx } from '../../backend/api/db';
import { canonicalJson } from '../../backend/audit/event-store';
import { PgEventStore } from '../../backend/audit/pg-event-store';
import { ApprovalControls, DrawService } from '../../backend/workflow/draw-service';
import { Fixture, seedTenant } from './helpers/fixture';
import { createTestDatabase, describeDb, TestDatabase } from './helpers/pg';

jest.setTimeout(60_000);

const INSPECTION_PDF = readFileSync(join(__dirname, '..', 'fixtures', 'inspection-report.pdf'));
const INVOICE_PDF = readFileSync(join(__dirname, '..', 'fixtures', 'invoice-0001.pdf'));
const sha256 = (b: Buffer | string) => 'sha256:' + createHash('sha256').update(b).digest('hex');

const CONTROLS: ApprovalControls = {
  remainingBudgetMinor: '100000000',
  eligibleThisDrawMinor: '30000000',
  retainageApplied: true,
  covenantStatus: 'CURRENT',
  waiverCoversBreach: false,
  loanInBalancePasses: true,
  deficiencyDepositConfirmed: false,
};

const CSV_HEADER = 'external_partner_id,settlement_reference,amount_minor,currency,payee_account_ref,settlement_date';
const today = () => new Date().toISOString().slice(0, 10);

async function expectCode(p: Promise<unknown>, code: string): Promise<DomainError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return err as DomainError;
  }
  throw new Error('expected ' + code);
}

describeDb('Track A — persisted Autopilot', () => {
  let db: TestDatabase;
  let svc: DrawService;
  let seq = 0;
  const key = (label: string) => label + '-' + ++seq;

  beforeAll(async () => {
    db = await createTestDatabase();
    svc = new DrawService(db.pool);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  /** DRAFT → SUBMITTED → UNDER_REVIEW with an invoice and (optionally) the inspection report. */
  async function toUnderReview(f: Fixture, opts: { withInspection: boolean; amount?: string }) {
    const draft = await svc.createDraft(f.sponsor, {
      dealId: f.dealId,
      requestNumber: key('DR'),
      payeeCounterpartyId: f.counterpartyId,
      payeeBankAccountId: f.payeeBankAccountId,
      amountRequestedMinor: opts.amount || '25000000',
      currency: 'USD',
      idempotencyKey: key('create'),
    });
    const docs = [{ type: 'INVOICE', content: INVOICE_PDF, uri: 's3://fixtures/invoice-0001.pdf' }];
    if (opts.withInspection) docs.push({ type: 'INSPECTION_REPORT', content: INSPECTION_PDF, uri: 's3://fixtures/inspection-report.pdf' });
    for (const d of docs) {
      const up = await svc.uploadEvidence(f.sponsor, {
        drawId: draft.id, documentType: d.type, content: d.content, storageUri: d.uri, sourceSystem: 'fixture', idempotencyKey: key('upload'),
      });
      await svc.verifyEvidence(f.approver, { documentId: up.documentId, idempotencyKey: key('verify') });
    }
    await svc.submit(f.sponsor, { drawId: draft.id, idempotencyKey: key('submit') });
    return svc.evaluate(f.approver, { drawId: draft.id, idempotencyKey: key('evaluate') });
  }

  async function toInstructed(f: Fixture, reference: string) {
    const d = await toUnderReview(f, { withInspection: true });
    await svc.approve(f.approver, { drawId: d.id, amountApprovedMinor: '25000000', controls: CONTROLS, idempotencyKey: key('approve') });
    return svc.instruct(f.treasury, { drawId: d.id, externalPartnerId: 'escrow-factory', settlementReference: reference, idempotencyKey: key('instruct') });
  }

  // -------------------------------------------------------------------------

  it('week-one fixture: DRAFT → RECONCILED with the inspection PDF hashed into the manifest and a verifiable chain', async () => {
    const f = await seedTenant(db.pool, 'alpha');
    const review = await toUnderReview(f, { withInspection: true });

    // SUBMITTED froze the policy version and the manifest.
    expect(review.status).toBe('UNDER_REVIEW');
    expect(review.lockedPolicyVersion).toBe('policy-2026.09.19');
    const manifest = await withTenantTx(db.pool, f.sponsor, async (tx) => {
      const m = await tx.query('SELECT manifest_hash, document_ids FROM evidence_manifest WHERE draw_request_id = $1', [review.id]);
      const docs = await tx.query(
        'SELECT id, document_type, content_hash, version FROM evidence_document WHERE id = ANY($1::uuid[]) ORDER BY id', [m.rows[0].document_ids]
      );
      return { hash: m.rows[0].manifest_hash as string, docs: docs.rows };
    });
    expect(manifest.docs.find((d) => d.document_type === 'INSPECTION_REPORT')!.content_hash).toBe(sha256(INSPECTION_PDF));
    const items = manifest.docs.map((d) => ({ document_id: d.id, document_type: d.document_type, content_hash: d.content_hash, version: d.version }));
    expect(manifest.hash).toBe(sha256(canonicalJson(items)));
    expect(review.lockedEvidenceManifestHash).toBe(manifest.hash);

    // The freeze is enforced by the database too.
    await expect(
      withTenantTx(db.pool, f.sponsor, (tx) => tx.query("UPDATE draw_request SET locked_policy_version = 'policy-other' WHERE id = $1", [review.id]))
    ).rejects.toThrow('LOCKED_POLICY_VERSION_IMMUTABLE');
    await expectCode(
      svc.uploadEvidence(f.sponsor, { drawId: review.id, documentType: 'INVOICE', content: Buffer.from('late'), storageUri: 's3://x', sourceSystem: 'fixture', idempotencyKey: key('late') }),
      'MANIFEST_FROZEN'
    );

    const approved = await svc.approve(f.approver, { drawId: review.id, amountApprovedMinor: '25000000', controls: CONTROLS, idempotencyKey: key('approve') });
    expect(approved.status).toBe('APPROVED');
    expect(approved.amountApprovedMinor).toBe(25000000n);

    const instructed = await svc.instruct(f.treasury, {
      drawId: review.id, externalPartnerId: 'escrow-factory', settlementReference: 'EF-ALPHA-0001', idempotencyKey: key('instruct'),
    });
    expect(instructed.status).toBe('SETTLEMENT_INSTRUCTED');

    const csv = CSV_HEADER + '\nescrow-factory,EF-ALPHA-0001,25000000,USD,' + f.payeeAccountRef + ',' + today() + '\n';
    const results = await svc.importCsvConfirmations(f.treasury, f.approver, { firstEntryCsv: csv, secondEntryCsv: csv, batchKey: key('csv') });
    expect(results).toEqual([expect.objectContaining({ drawId: review.id, outcome: 'MATCHED', mismatchCodes: [] })]);

    const done = await svc.getDraw(f.sponsor, review.id);
    expect(done.status).toBe('RECONCILED');
    const recon = await withTenantTx(db.pool, f.sponsor, (tx) => tx.query('SELECT status FROM reconciliation_record WHERE draw_request_id = $1', [review.id]));
    expect(recon.rows).toEqual([{ status: 'MATCHED' }]);

    // One verifiable chain, and every transition is on it in order.
    const chain = await svc.verifyAuditChain(f.sponsor);
    expect(chain.ok).toBe(true);
    const events = await withTenantTx(db.pool, f.sponsor, (tx) => new PgEventStore(tx, f.sponsor).listForAggregate('DRAW_REQUEST', review.id));
    expect(events.filter((e) => e.stateAfter).map((e) => e.stateAfter)).toEqual([
      'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SETTLEMENT_INSTRUCTED', 'SETTLEMENT_CONFIRMED', 'RECONCILED',
    ]);
    // Money never crossed as a float.
    expect(events.find((e) => e.stateAfter === 'SETTLEMENT_INSTRUCTED')!.payload.amount_minor).toBe('25000000');
  });

  it('two tenants cannot see each other’s draws', async () => {
    const a = await seedTenant(db.pool, 'tenant-a');
    const b = await seedTenant(db.pool, 'tenant-b');
    const drawA = await toUnderReview(a, { withInspection: true });

    expect((await svc.listDraws(b.sponsor)).map((d) => d.id)).not.toContain(drawA.id);
    await expectCode(svc.getDraw(b.sponsor, drawA.id), 'NOT_FOUND');
    await expectCode(svc.approve(b.approver, { drawId: drawA.id, amountApprovedMinor: '1', controls: CONTROLS, idempotencyKey: key('x') }), 'NOT_FOUND');

    // Raw SQL in B's session sees nothing of A, and cannot write into A.
    const seen = await withTenantTx(db.pool, b.sponsor, (tx) =>
      tx.query('SELECT (SELECT count(*) FROM draw_request WHERE id = $1) AS draws, (SELECT count(*) FROM audit_event WHERE tenant_id = $2) AS events', [drawA.id, a.tenantId])
    );
    expect(seen.rows[0]).toEqual({ draws: '0', events: '0' });
    await expect(
      withTenantTx(db.pool, b.sponsor, (tx) =>
        tx.query("INSERT INTO hold (tenant_id, scope_type, hold_type, reason_code, reason_text, placed_by_subject) VALUES ($1,'TENANT','OPERATIONAL','X','x','b')", [a.tenantId])
      )
    ).rejects.toThrow(/row-level security/);

    // The client cannot pick a tenant.
    await expectCode(
      svc.createDraft(b.sponsor, {
        tenantId: a.tenantId, dealId: b.dealId, requestNumber: 'X', payeeCounterpartyId: b.counterpartyId, payeeBankAccountId: b.payeeBankAccountId,
        amountRequestedMinor: '1', currency: 'USD', idempotencyKey: key('x'),
      } as unknown as Parameters<DrawService['createDraft']>[1]),
      'CLIENT_SUPPLIED_TENANT'
    );
    // No session, no access.
    await expectCode(svc.listDraws({ tenantId: '', subject: 'anon' }), 'SESSION_REQUIRED');

    // Each tenant has its own intact chain.
    expect((await svc.verifyAuditChain(a.sponsor)).ok).toBe(true);
    expect((await svc.verifyAuditChain(b.sponsor)).ok).toBe(true);
  });

  it('missing inspection cannot APPROVE', async () => {
    const f = await seedTenant(db.pool, 'no-inspection');
    const review = await toUnderReview(f, { withInspection: false });
    expect(review.status).toBe('UNDER_REVIEW');

    const before = (await svc.verifyAuditChain(f.sponsor)).count;
    const err = await expectCode(
      svc.approve(f.approver, { drawId: review.id, amountApprovedMinor: '25000000', controls: CONTROLS, idempotencyKey: key('approve') }),
      'APPROVAL_BLOCKED'
    );
    expect(err.details).toContain('MANIFEST_INCOMPLETE');

    // Nothing moved: same state, no decision, no event.
    expect((await svc.getDraw(f.sponsor, review.id)).status).toBe('UNDER_REVIEW');
    expect((await svc.verifyAuditChain(f.sponsor)).count).toBe(before);
    const decisions = await withTenantTx(db.pool, f.sponsor, (tx) => tx.query('SELECT count(*) FROM approval_decision WHERE draw_request_id = $1', [review.id]));
    expect(decisions.rows[0].count).toBe('0');
    const evaluation = await withTenantTx(db.pool, f.sponsor, (tx) => tx.query('SELECT result FROM policy_evaluation WHERE draw_request_id = $1', [review.id]));
    expect(evaluation.rows[0].result).toBe('HOLD');
  });

  it('requester cannot approve, and an approver cannot instruct', async () => {
    // Dual-hat users: the sponsor also holds RiskOwner, the approver also holds TreasuryOwner.
    const f = await seedTenant(db.pool, 'dual-hat', [
      { subject: 'sponsor@dual-hat', role: 'RiskOwner' },
      { subject: 'approver@dual-hat', role: 'TreasuryOwner' },
    ]);
    const review = await toUnderReview(f, { withInspection: true });

    const err = await expectCode(
      svc.approve(f.sponsor, { drawId: review.id, amountApprovedMinor: '25000000', controls: CONTROLS, idempotencyKey: key('self') }),
      'APPROVAL_BLOCKED'
    );
    expect(err.details).toContain('SELF_APPROVAL');
    expect((await svc.getDraw(f.sponsor, review.id)).status).toBe('UNDER_REVIEW');

    // The database refuses it as well, even bypassing the service.
    await expect(
      withTenantTx(db.pool, f.sponsor, async (tx) => {
        const d = await tx.query('SELECT locked_policy_version, locked_evidence_manifest_hash FROM draw_request WHERE id = $1', [review.id]);
        await tx.query(
          "INSERT INTO approval_decision (tenant_id, draw_request_id, approver_subject, approver_role, decision, locked_policy_version, evidence_manifest_hash, approval_binding_hash, idempotency_key) " +
            "VALUES ($1,$2,$3,'RiskOwner','APPROVE',$4,$5,'sha256:x','raw-self')",
          [f.tenantId, review.id, f.sponsor.subject, d.rows[0].locked_policy_version, d.rows[0].locked_evidence_manifest_hash]
        );
      })
    ).rejects.toThrow('SOD_REQUESTER_CANNOT_APPROVE');

    await svc.approve(f.approver, { drawId: review.id, amountApprovedMinor: '25000000', controls: CONTROLS, idempotencyKey: key('approve') });
    await expectCode(
      svc.instruct(f.approver, { drawId: review.id, externalPartnerId: 'escrow-factory', settlementReference: 'EF-DH-1', idempotencyKey: key('i') }),
      'SOD_APPROVER_CANNOT_INSTRUCT'
    );
    await expectCode(
      svc.instruct(f.sponsor, { drawId: review.id, externalPartnerId: 'escrow-factory', settlementReference: 'EF-DH-1', idempotencyKey: key('i') }),
      'ROLE_REQUIRED'
    );
    expect((await svc.instruct(f.treasury, { drawId: review.id, externalPartnerId: 'escrow-factory', settlementReference: 'EF-DH-1', idempotencyKey: key('i') })).status)
      .toBe('SETTLEMENT_INSTRUCTED');
  });

  it('unmatched CSV cannot RECONCILE', async () => {
    const f = await seedTenant(db.pool, 'recon');
    const d = await toInstructed(f, 'EF-RECON-0001');

    // Dual entry must agree before anything is recorded.
    const good = CSV_HEADER + '\nescrow-factory,EF-RECON-0001,25000000,USD,' + f.payeeAccountRef + ',' + today();
    const off = CSV_HEADER + '\nescrow-factory,EF-RECON-0001,24999999,USD,' + f.payeeAccountRef + ',' + today();
    await expectCode(svc.importCsvConfirmations(f.treasury, f.approver, { firstEntryCsv: good, secondEntryCsv: off, batchKey: key('csv') }), 'DUAL_ENTRY_MISMATCH');
    await expectCode(svc.importCsvConfirmations(f.treasury, f.treasury, { firstEntryCsv: off, secondEntryCsv: off, batchKey: key('csv') }), 'SOD_DUAL_ENTRY_SAME_PERSON');
    await expectCode(svc.importCsvConfirmations(f.treasury, f.approver, {
      firstEntryCsv: CSV_HEADER + '\nescrow-factory,EF-RECON-0001,250000.00,USD,x,' + today(),
      secondEntryCsv: CSV_HEADER + '\nescrow-factory,EF-RECON-0001,250000.00,USD,x,' + today(), batchKey: key('csv'),
    }), 'CSV_INVALID');

    // One cent short, plus a settlement DIBS never instructed.
    const csv = off + '\nescrow-factory,EF-UNKNOWN-9,100,USD,tok_elsewhere,' + today();
    const results = await svc.importCsvConfirmations(f.treasury, f.approver, { firstEntryCsv: csv, secondEntryCsv: csv, batchKey: key('csv') });
    expect(results.map((r) => [r.settlementReference, r.outcome, r.mismatchCodes])).toEqual([
      ['EF-RECON-0001', 'EXCEPTION', ['AMOUNT']],
      ['EF-UNKNOWN-9', 'EXCEPTION', ['UNAPPROVED_SETTLEMENT']],
    ]);
    const after = await svc.getDraw(f.sponsor, d.id);
    expect(after.status).toBe('RECONCILIATION_EXCEPTION');

    // No way around it at the database either.
    await expect(
      withTenantTx(db.pool, f.treasury, (tx) => tx.query("UPDATE draw_request SET status = 'RECONCILED' WHERE id = $1", [d.id]))
    ).rejects.toThrow(/check constraint/);
    await expect(
      withTenantTx(db.pool, f.treasury, async (tx) => {
        const ids = await tx.query('SELECT settlement_instruction_id, settlement_confirmation_id FROM reconciliation_record WHERE draw_request_id = $1', [d.id]);
        await tx.query(
          "INSERT INTO reconciliation_record (tenant_id, draw_request_id, settlement_instruction_id, settlement_confirmation_id, status, reconciled_by_subject) VALUES ($1,$2,$3,$4,'MATCHED','treasury')",
          [f.tenantId, d.id, ids.rows[0].settlement_instruction_id, ids.rows[0].settlement_confirmation_id]
        );
      })
    ).rejects.toThrow('RECONCILIATION_NOT_EXACT_MATCH');
    expect((await svc.verifyAuditChain(f.sponsor)).ok).toBe(true);
  });

  it('audit chain verifies; mutating an event row is impossible', async () => {
    const f = await seedTenant(db.pool, 'ledger');
    await toInstructed(f, 'EF-LEDGER-0001');
    const chain = await svc.verifyAuditChain(f.sponsor);
    expect(chain).toMatchObject({ ok: true });
    expect(chain.count).toBeGreaterThan(5);

    // The application role has no UPDATE / DELETE on the ledger at all.
    for (const sql of ["UPDATE audit_event SET actor_id = 'x'", 'DELETE FROM audit_event', 'TRUNCATE audit_event']) {
      await expect(withTenantTx(db.pool, f.sponsor, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    }

    // Even the table owner is stopped by the append-only triggers.
    const owner = new Client({ connectionString: db.ownerUrl });
    await owner.connect();
    try {
      for (const sql of ["UPDATE audit_event SET actor_id = 'x'", 'DELETE FROM audit_event', 'TRUNCATE audit_event']) {
        await expect(owner.query(sql)).rejects.toThrow('APPEND_ONLY');
      }
      // A superuser who disables the trigger and edits a row is caught by the chain.
      await owner.query('ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only');
      await owner.query(
        "UPDATE audit_event SET payload = jsonb_set(payload, '{amount_minor}', '\"1\"') WHERE tenant_id = $1 AND state_after = 'SETTLEMENT_INSTRUCTED'",
        [f.tenantId]
      );
      await owner.query('ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only');
    } finally {
      await owner.end();
    }
    const tampered = await svc.verifyAuditChain(f.sponsor);
    expect(tampered).toMatchObject({ ok: false, reason: 'PAYLOAD_HASH_MISMATCH' });
  });
});
