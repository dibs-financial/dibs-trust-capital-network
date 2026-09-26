/**
 * DIBS Track A — HTTP for the persisted DrawRequest workflow.
 *
 * Thin layer over DrawService: the session is req.auth (verified token), roles
 * are re-read from user_role inside each transaction, every write needs an
 * Idempotency-Key header, and money crosses the wire as decimal strings.
 *
 * No template literals — GitHub web editor corrupts dollar-brace.
 */

import express, { Request, Response, Router } from 'express';
import { Pool } from 'pg';
import { PgEventStore } from '../audit/pg-event-store';
import { DrawService, drawToJson } from '../workflow/draw-service';
import { AuthenticatedSession } from './auth';
import { DomainError, Session, withTenantTx } from './db';

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  ROLE_REQUIRED: 403,
  ONLY_REQUESTER_SUBMITS: 403,
  SOD_REQUESTER_CANNOT_INSTRUCT: 403,
  SOD_APPROVER_CANNOT_INSTRUCT: 403,
  SOD_UPLOADER_CANNOT_VERIFY: 403,
  SOD_DUAL_ENTRY_SAME_PERSON: 403,
  APPROVAL_BLOCKED: 422,
  POLICY_VERSION_UNKNOWN: 422,
  EVIDENCE_REQUIRED: 422,
  INVALID_STATE: 409,
  MANIFEST_FROZEN: 409,
  CONCURRENT_CHANGE: 409,
  BATCH_ALREADY_IMPORTED: 409,
  BATCH_ALREADY_STAGED: 409,
  DUAL_ENTRY_MISMATCH: 409,
  SESSION_REQUIRED: 401,
};

function sessionFrom(req: Request): Session {
  const auth = req.auth as AuthenticatedSession | undefined;
  if (!auth) throw new DomainError('SESSION_REQUIRED');
  // Roles on the token are ignored here; DrawService reads user_role.
  return { tenantId: auth.tenantId, subject: auth.subject };
}

function idempotencyKey(req: Request): string {
  const key = req.header('Idempotency-Key');
  if (!key || key.length > 200) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'send an Idempotency-Key header');
  return key;
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof DomainError) {
    res.status(STATUS_BY_CODE[err.code] || 400).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  const e = err as { code?: string; message?: string };
  // The machine refusing a transition.
  if (e && typeof e.message === 'string' && e.message.indexOf('Invalid transition') === 0) {
    res.status(409).json({ error: 'INVALID_TRANSITION', message: e.message });
    return;
  }
  // Database invariants (SoD triggers, check constraints, RLS). The rule held; say which.
  if (e && typeof e.code === 'string' && (e.code.indexOf('23') === 0 || e.code === '42501')) {
    res.status(409).json({ error: 'CONSTRAINT_VIOLATION', message: e.message });
    return;
  }
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

type Handler = (req: Request, res: Response) => Promise<void>;
function route(fn: Handler) {
  return function (req: Request, res: Response): void {
    fn(req, res).catch(function (err) { sendError(res, err); });
  };
}

/** Without a database the persisted routes refuse rather than fall back to memory. */
function unavailable(_req: Request, res: Response): void {
  res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
}

export function createDrawsRouter(pool: Pool | null): Router {
  const router = express.Router();
  if (!pool) {
    router.use(unavailable);
    return router;
  }
  const svc = new DrawService(pool);

  router.get('/', route(async function (req, res) {
    res.json((await svc.listDraws(sessionFrom(req))).map(drawToJson));
  }));

  router.post('/', route(async function (req, res) {
    const b = req.body || {};
    const draw = await svc.createDraft(sessionFrom(req), {
      dealId: b.dealId,
      requestNumber: b.requestNumber,
      payeeCounterpartyId: b.payeeCounterpartyId,
      payeeBankAccountId: b.payeeBankAccountId,
      amountRequestedMinor: b.amountRequestedMinor,
      currency: b.currency,
      budgetLineIds: b.budgetLineIds,
      idempotencyKey: idempotencyKey(req),
    });
    res.status(201).json(drawToJson(draw));
  }));

  router.get('/:drawId', route(async function (req, res) {
    res.json(drawToJson(await svc.getDraw(sessionFrom(req), req.params.drawId)));
  }));

  /** Body: { documentType, contentBase64, storageUri, sourceSystem }. The server hashes the bytes. */
  router.post('/:drawId/evidence', route(async function (req, res) {
    const b = req.body || {};
    if (typeof b.contentBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.contentBase64)) {
      throw new DomainError('EVIDENCE_EMPTY', 'contentBase64 must be base64');
    }
    const result = await svc.uploadEvidence(sessionFrom(req), {
      drawId: req.params.drawId,
      documentType: b.documentType,
      content: Buffer.from(b.contentBase64, 'base64'),
      storageUri: b.storageUri,
      sourceSystem: b.sourceSystem,
      idempotencyKey: idempotencyKey(req),
    });
    res.status(201).json(result);
  }));

  router.post('/:drawId/evidence/:documentId/verify', route(async function (req, res) {
    await svc.verifyEvidence(sessionFrom(req), { documentId: req.params.documentId, idempotencyKey: idempotencyKey(req) });
    res.status(204).end();
  }));

  router.post('/:drawId/submit', route(async function (req, res) {
    res.json(drawToJson(await svc.submit(sessionFrom(req), { drawId: req.params.drawId, idempotencyKey: idempotencyKey(req) })));
  }));

  router.post('/:drawId/evaluate', route(async function (req, res) {
    res.json(drawToJson(await svc.evaluate(sessionFrom(req), { drawId: req.params.drawId, idempotencyKey: idempotencyKey(req) })));
  }));

  /** Body: { amountApprovedMinor, controls }. Everything else approvalFailures() needs is read from the database. */
  router.post('/:drawId/approve', route(async function (req, res) {
    const b = req.body || {};
    const draw = await svc.approve(sessionFrom(req), {
      drawId: req.params.drawId,
      amountApprovedMinor: b.amountApprovedMinor,
      controls: b.controls || {},
      idempotencyKey: idempotencyKey(req),
    });
    res.json(drawToJson(draw));
  }));

  /** Body: { externalPartnerId, settlementReference }. Amount, payee and binding come from the approval. */
  router.post('/:drawId/instruct', route(async function (req, res) {
    const b = req.body || {};
    const draw = await svc.instruct(sessionFrom(req), {
      drawId: req.params.drawId,
      externalPartnerId: b.externalPartnerId,
      settlementReference: b.settlementReference,
      idempotencyKey: idempotencyKey(req),
    });
    res.json(drawToJson(draw));
  }));

  return router;
}

/** Dual-entry CSV confirmations: stage (person 1), then confirm (person 2). */
export function createConfirmationsRouter(pool: Pool | null): Router {
  const router = express.Router();
  if (!pool) {
    router.use(unavailable);
    return router;
  }
  const svc = new DrawService(pool);
  const csvBody = express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' });

  router.put('/csv-batches/:batchKey', csvBody, route(async function (req, res) {
    if (typeof req.body !== 'string') throw new DomainError('CSV_INVALID', 'send the file as text/csv');
    res.status(201).json(await svc.stageCsvFirstEntry(sessionFrom(req), { batchKey: req.params.batchKey, csv: req.body }));
  }));

  router.post('/csv-batches/:batchKey/confirm', csvBody, route(async function (req, res) {
    if (typeof req.body !== 'string') throw new DomainError('CSV_INVALID', 'send the file as text/csv');
    res.json({ results: await svc.confirmCsvSecondEntry(sessionFrom(req), { batchKey: req.params.batchKey, csv: req.body }) });
  }));

  return router;
}

/** The tenant's Postgres ledger: events and a full chain verification. */
export function createLedgerRouter(pool: Pool | null): Router {
  const router = express.Router();
  if (!pool) {
    router.use(unavailable);
    return router;
  }
  router.get('/events', route(async function (req, res) {
    const session = sessionFrom(req);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 100, 1), 500);
    const after = Math.max(parseInt(String(req.query.afterSeq), 10) || 0, 0);
    const events = await withTenantTx(pool, session, function (tx) {
      return new PgEventStore(tx, session).listPage(after, limit);
    });
    res.json({ events: events });
  }));

  router.get('/verify', route(async function (req, res) {
    res.json(await new DrawService(pool).verifyAuditChain(sessionFrom(req)));
  }));

  return router;
}
