/**
 * DIBS Track A — Postgres audit ledger.
 *
 * Append-only audit_event rows with one hash chain per tenant. Bound to a
 * tenant transaction (backend/api/db.ts withTenantTx), so the event commits or
 * rolls back together with the row change it describes. Callers write the event
 * first, then change the row.
 *
 * No template literals — GitHub web editor corrupts dollar-brace.
 */

import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DomainError, Session } from '../api/db';
import {
  ActorType,
  AppendInput,
  AuditEvent,
  AuditLog,
  canonicalJson,
  GENESIS_HASH,
  hashEventEnvelope,
  hashPayload,
} from './event-store';

function inferActorType(role: string): ActorType {
  if (role === 'system') return 'SYSTEM';
  if (role === 'EscrowPartner' || role === 'partner') return 'PARTNER';
  if (role === 'SuperAgent') return 'SUPER_AGENT';
  return 'USER';
}

function toEvent(row: Record<string, unknown>): AuditEvent {
  const iso = function (v: unknown): string { return v instanceof Date ? v.toISOString() : String(v); };
  return {
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    eventVersion: Number(row.event_version),
    occurredAt: iso(row.occurred_at),
    recordedAt: iso(row.recorded_at),
    tenantId: String(row.tenant_id),
    actorType: row.actor_type as ActorType,
    actorId: String(row.actor_id),
    actorRole: String(row.actor_role),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    stateBefore: row.state_before === null ? null : String(row.state_before),
    stateAfter: row.state_after === null ? null : String(row.state_after),
    policyVersion: String(row.policy_version),
    evidenceManifestHash: String(row.evidence_manifest_hash),
    payload: row.payload as Record<string, unknown>,
    payloadHash: String(row.payload_hash),
    previousEventHash: String(row.previous_event_hash),
    eventHash: String(row.event_hash),
    idempotencyKey: String(row.idempotency_key),
    correlationId: String(row.correlation_id),
  };
}

export interface ChainVerification {
  ok: boolean;
  count: number;
  brokenAtSeq?: number;
  reason?: string;
}

export class PgEventStore implements AuditLog {
  constructor(private readonly tx: PoolClient, private readonly session: Session) {}

  async append(input: AppendInput): Promise<AuditEvent> {
    // The tenant is the session's. An event naming any other tenant is refused.
    if (input.tenantId !== this.session.tenantId) {
      throw new DomainError('TENANT_MISMATCH', 'event tenant must be the session tenant');
    }
    const payload = input.payload || input.metadata || {};
    // Round-trip through JSON so what we hash is exactly what jsonb stores.
    const stored = JSON.parse(canonicalJson(payload)) as Record<string, unknown>;
    const payloadHash = hashPayload(stored);
    if (input.payloadHash && input.payloadHash !== payloadHash) {
      throw new DomainError('PAYLOAD_HASH_MISMATCH');
    }

    const idempotencyKey = input.idempotencyKey || '';
    const eventType = String(input.eventType);
    if (idempotencyKey) {
      const existing = await this.tx.query(
        'SELECT * FROM audit_event WHERE idempotency_key = $1 AND event_type = $2',
        [idempotencyKey, eventType]
      );
      if (existing.rows.length > 0) return toEvent(existing.rows[0]);
    }

    // Serialize appends per tenant on the chain head.
    await this.tx.query(
      'INSERT INTO audit_chain_head (tenant_id, last_seq, last_event_hash) VALUES ($1, 0, $2) ON CONFLICT (tenant_id) DO NOTHING',
      [this.session.tenantId, GENESIS_HASH]
    );
    const head = await this.tx.query(
      'SELECT last_seq, last_event_hash FROM audit_chain_head WHERE tenant_id = $1 FOR UPDATE',
      [this.session.tenantId]
    );
    const seq = BigInt(head.rows[0].last_seq) + 1n;
    const previousEventHash = String(head.rows[0].last_event_hash);

    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const actorRole = input.actorRole;
    const envelope = {
      eventId: eventId,
      eventType: eventType,
      eventVersion: 1,
      occurredAt: occurredAt,
      tenantId: this.session.tenantId,
      actorType: input.actorType || inferActorType(actorRole),
      actorId: input.actorId,
      actorRole: actorRole,
      aggregateType: String(input.aggregateType || 'DRAW_REQUEST'),
      aggregateId: input.aggregateId || '',
      stateBefore: input.stateBefore == null ? null : input.stateBefore,
      stateAfter: input.stateAfter == null ? null : input.stateAfter,
      payloadHash: payloadHash,
      evidenceManifestHash: input.evidenceManifestHash || '',
      policyVersion: input.policyVersion || '',
      previousEventHash: previousEventHash,
      idempotencyKey: idempotencyKey,
    };
    const eventHash = hashEventEnvelope(envelope);
    const correlationId = input.correlationId || input.aggregateId || eventId;

    const inserted = await this.tx.query(
      'INSERT INTO audit_event (tenant_id, chain_seq, event_id, event_type, event_version, occurred_at, ' +
        'actor_type, actor_id, actor_role, aggregate_type, aggregate_id, state_before, state_after, ' +
        'policy_version, evidence_manifest_hash, payload, payload_hash, previous_event_hash, event_hash, ' +
        'idempotency_key, correlation_id) VALUES ' +
        '($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *',
      [
        envelope.tenantId, seq.toString(), eventId, eventType, 1, occurredAt,
        envelope.actorType, envelope.actorId, actorRole, envelope.aggregateType, envelope.aggregateId,
        envelope.stateBefore, envelope.stateAfter, envelope.policyVersion, envelope.evidenceManifestHash,
        JSON.stringify(stored), payloadHash, previousEventHash, eventHash, idempotencyKey, correlationId,
      ]
    );
    await this.tx.query(
      'UPDATE audit_chain_head SET last_seq = $2, last_event_hash = $3 WHERE tenant_id = $1',
      [this.session.tenantId, seq.toString(), eventHash]
    );
    return toEvent(inserted.rows[0]);
  }

  async list(): Promise<AuditEvent[]> {
    const r = await this.tx.query('SELECT * FROM audit_event ORDER BY chain_seq');
    return r.rows.map(toEvent);
  }

  async listForAggregate(aggregateType: string, aggregateId: string): Promise<AuditEvent[]> {
    const r = await this.tx.query(
      'SELECT * FROM audit_event WHERE aggregate_type = $1 AND aggregate_id = $2 ORDER BY chain_seq',
      [aggregateType, aggregateId]
    );
    return r.rows.map(toEvent);
  }

  /**
   * Re-verifies the tenant's whole chain from genesis: contiguous sequence,
   * each link to the previous hash, every payload hash and event hash
   * recomputed, and the head pointing at the last event.
   */
  async verifyChain(): Promise<ChainVerification> {
    const r = await this.tx.query('SELECT * FROM audit_event ORDER BY chain_seq');
    let prev = GENESIS_HASH;
    let expectedSeq = 1n;
    for (const row of r.rows) {
      const seq = BigInt(row.chain_seq);
      const e = toEvent(row);
      const fail = function (reason: string): ChainVerification {
        return { ok: false, count: r.rows.length, brokenAtSeq: Number(seq), reason: reason };
      };
      if (seq !== expectedSeq) return fail('SEQUENCE_GAP');
      if (e.previousEventHash !== prev) return fail('LINK_BROKEN');
      if (hashPayload(e.payload) !== e.payloadHash) return fail('PAYLOAD_HASH_MISMATCH');
      const recomputed = hashEventEnvelope({
        eventId: e.eventId,
        eventType: String(e.eventType),
        eventVersion: e.eventVersion,
        occurredAt: e.occurredAt,
        tenantId: e.tenantId,
        actorType: e.actorType,
        actorId: e.actorId,
        actorRole: e.actorRole,
        aggregateType: String(e.aggregateType),
        aggregateId: e.aggregateId,
        stateBefore: e.stateBefore,
        stateAfter: e.stateAfter,
        payloadHash: e.payloadHash,
        evidenceManifestHash: e.evidenceManifestHash,
        policyVersion: e.policyVersion,
        previousEventHash: e.previousEventHash,
        idempotencyKey: e.idempotencyKey,
      });
      if (recomputed !== e.eventHash) return fail('EVENT_HASH_MISMATCH');
      prev = e.eventHash;
      expectedSeq += 1n;
    }
    const head = await this.tx.query('SELECT last_seq, last_event_hash FROM audit_chain_head');
    if (r.rows.length > 0) {
      if (head.rows.length !== 1 || BigInt(head.rows[0].last_seq) !== expectedSeq - 1n || head.rows[0].last_event_hash !== prev) {
        return { ok: false, count: r.rows.length, reason: 'HEAD_MISMATCH' };
      }
    }
    return { ok: true, count: r.rows.length };
  }
}
