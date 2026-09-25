/**
 * DIBS Track A — AuditEvent store
 *
 * Replaces JSON.stringify(event).length hash.
 * Spec: docs/architecture/DIBS-Domain-State-Event-Model.md section 3
 *
 * Append-only. Corrections are new events. No UPDATE/DELETE.
 * No template literals — GitHub web editor corrupts dollar-brace.
 */

import { createHash, randomUUID } from 'crypto';

export type ActorType = 'USER' | 'SYSTEM' | 'PARTNER' | 'SUPER_AGENT';

export type AggregateType =
  | 'DRAW_REQUEST'
  | 'DEAL'
  | 'SPV'
  | 'COVENANT'
  | 'PAYEE_BANK_ACCOUNT'
  | 'HOLD'
  | 'WAIVER'
  | 'SETTLEMENT_INSTRUCTION'
  | 'SETTLEMENT_CONFIRMATION'
  | 'RECONCILIATION_RECORD'
  | 'POLICY_VERSION'
  | 'ROLE_ASSIGNMENT';

export enum EventType {
  DRAW_CREATED = 'DRAW_CREATED',
  DRAW_SUBMITTED = 'DRAW_SUBMITTED',
  DRAW_MANIFEST_FROZEN = 'DRAW_MANIFEST_FROZEN',
  DRAW_POLICY_EVALUATED = 'DRAW_POLICY_EVALUATED',
  DRAW_REQUIRES_INFORMATION = 'DRAW_REQUIRES_INFORMATION',
  DRAW_HELD = 'DRAW_HELD',
  DRAW_HOLD_RELEASED = 'DRAW_HOLD_RELEASED',
  DRAW_ESCALATED = 'DRAW_ESCALATED',
  DRAW_APPROVED = 'DRAW_APPROVED',
  DRAW_PARTIAL_APPROVED = 'DRAW_PARTIAL_APPROVED',
  DRAW_BINDING_BROKEN = 'DRAW_BINDING_BROKEN',
  DRAW_REJECTED = 'DRAW_REJECTED',
  DRAW_CANCELLED = 'DRAW_CANCELLED',
  DRAW_EXPIRED = 'DRAW_EXPIRED',
  DRAW_SETTLEMENT_INSTRUCTED = 'DRAW_SETTLEMENT_INSTRUCTED',
  DRAW_SETTLEMENT_CONFIRMED = 'DRAW_SETTLEMENT_CONFIRMED',
  DRAW_SETTLEMENT_FAILED = 'DRAW_SETTLEMENT_FAILED',
  DRAW_RECONCILIATION_MATCHED = 'DRAW_RECONCILIATION_MATCHED',
  DRAW_RECONCILIATION_BREAK = 'DRAW_RECONCILIATION_BREAK',
  DRAW_RECONCILED = 'DRAW_RECONCILED',
  DRAW_CLOSED = 'DRAW_CLOSED',

  EVIDENCE_UPLOADED = 'EVIDENCE_UPLOADED',
  EVIDENCE_SUPERSEDED = 'EVIDENCE_SUPERSEDED',
  EVIDENCE_VERIFIED = 'EVIDENCE_VERIFIED',

  PAYEE_ACCOUNT_VERIFIED = 'PAYEE_ACCOUNT_VERIFIED',
  PAYEE_ACCOUNT_CHANGED = 'PAYEE_ACCOUNT_CHANGED',

  HOLD_PLACED = 'HOLD_PLACED',
  HOLD_RELEASED = 'HOLD_RELEASED',

  WAIVER_REQUESTED = 'WAIVER_REQUESTED',
  WAIVER_APPROVED = 'WAIVER_APPROVED',
  WAIVER_EXPIRED = 'WAIVER_EXPIRED',
  WAIVER_REVOKED = 'WAIVER_REVOKED',

  COVENANT_MEASURED = 'COVENANT_MEASURED',
  COVENANT_WATCH = 'COVENANT_WATCH',
  COVENANT_BREACHED = 'COVENANT_BREACHED',
  COVENANT_CURED = 'COVENANT_CURED',

  APPROVAL_RECORDED = 'APPROVAL_RECORDED',
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  ROLE_REVOKED = 'ROLE_REVOKED',

  WEBHOOK_RECEIVED = 'WEBHOOK_RECEIVED',
  WEBHOOK_REJECTED = 'WEBHOOK_REJECTED',
  CSV_BATCH_IMPORTED = 'CSV_BATCH_IMPORTED',

  SETTLEMENT_INSTRUCTION_SENT = 'DRAW_SETTLEMENT_INSTRUCTED',
  SETTLEMENT_CONFIRMED = 'DRAW_SETTLEMENT_CONFIRMED',
  SETTLEMENT_EXCEPTION = 'DRAW_SETTLEMENT_FAILED',

  CAPITAL_REQUEST_CREATED = 'DRAW_CREATED',
  CAPITAL_REQUEST_APPROVED = 'DRAW_APPROVED',
  CAPITAL_REQUEST_HELD = 'DRAW_HELD',
  CAPITAL_REQUEST_REJECTED = 'DRAW_REJECTED',
  CAPITAL_REQUEST_ESCALATED = 'DRAW_ESCALATED',

  // Legacy event types still emitted by evidence, collateral, waiver and
  // tranche code. Kept at their original string values because reporting and
  // analytics filter on those strings. Not yet mapped to the domain event model.
  EVIDENCE_SUBMITTED = 'EVIDENCE_SUBMITTED',
  EVIDENCE_VALIDATED = 'EVIDENCE_VALIDATED',
  EVIDENCE_FLAGGED = 'EVIDENCE_FLAGGED',
  EVIDENCE_EXPIRED = 'EVIDENCE_EXPIRED',
  RELEASE_HOLD = 'RELEASE_HOLD',
  COVENANT_WAIVED = 'COVENANT_WAIVED',
  COLLATERAL_FLAGGED = 'COLLATERAL_FLAGGED',
  COLLATERAL_REINSPECT_REQUIRED = 'COLLATERAL_REINSPECT_REQUIRED',
  CAPITAL_PRESERVATION_TRIGGERED = 'CAPITAL_PRESERVATION_TRIGGERED',
}

export interface AuditEvent {
  eventId: string;
  eventType: EventType | string;
  eventVersion: number;
  occurredAt: string;
  recordedAt: string;
  tenantId: string;
  actorType: ActorType;
  actorId: string;
  actorRole: string;
  aggregateType: AggregateType | string;
  aggregateId: string;
  stateBefore: string | null;
  stateAfter: string | null;
  policyVersion: string;
  evidenceManifestHash: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  previousEventHash: string;
  eventHash: string;
  idempotencyKey: string;
  correlationId: string;
}

/** @deprecated Use AuditEvent */
export type ImmutableEvent = AuditEvent;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map(function (k) {
        return JSON.stringify(k) + ':' + canonicalJson(obj[k]);
      })
      .join(',') +
    '}'
  );
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

export function hashEventEnvelope(fields: {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  tenantId: string;
  actorType: string;
  actorId: string;
  actorRole: string;
  aggregateType: string;
  aggregateId: string;
  stateBefore: string | null;
  stateAfter: string | null;
  payloadHash: string;
  evidenceManifestHash: string;
  policyVersion: string;
  previousEventHash: string;
  idempotencyKey: string;
}): string {
  return sha256Hex(
    canonicalJson({
      event_id: fields.eventId,
      event_type: fields.eventType,
      event_version: fields.eventVersion,
      occurred_at: fields.occurredAt,
      tenant_id: fields.tenantId,
      actor_type: fields.actorType,
      actor_id: fields.actorId,
      actor_role: fields.actorRole,
      aggregate_type: fields.aggregateType,
      aggregate_id: fields.aggregateId,
      state_before: fields.stateBefore,
      state_after: fields.stateAfter,
      payload_hash: fields.payloadHash,
      evidence_manifest_hash: fields.evidenceManifestHash,
      policy_version: fields.policyVersion,
      previous_event_hash: fields.previousEventHash,
      idempotency_key: fields.idempotencyKey,
    })
  );
}

export type AppendInput = {
  eventType: EventType | string;
  tenantId: string;
  actorId: string;
  actorRole: string;
  actorType?: ActorType;
  aggregateType?: AggregateType | string;
  aggregateId?: string;
  stateBefore?: string | null;
  stateAfter?: string | null;
  policyVersion?: string;
  evidenceManifestHash?: string;
  payload?: Record<string, unknown>;
  payloadHash?: string;
  idempotencyKey?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

function idempotencyLookup(tenantId: string, key: string, eventType: string): string {
  return [tenantId, key, eventType].join(':');
}

function chainLookup(
  tenantId: string,
  aggregateType: string | undefined,
  aggregateId: string | undefined
): string {
  return [tenantId, aggregateType || 'TENANT', aggregateId || tenantId].join(':');
}

export class EventStore {
  private readonly events: AuditEvent[] = [];
  private readonly byIdempotency = new Map<string, AuditEvent>();
  private readonly lastHashByChain = new Map<string, string>();

  async append(input: AppendInput): Promise<AuditEvent> {
    const tenantId = input.tenantId;
    if (!tenantId) throw new Error('TENANT_REQUIRED');

    const payload = input.payload || input.metadata || {};
    const payloadHash =
      input.payloadHash && input.payloadHash.length > 0
        ? input.payloadHash
        : hashPayload(payload);

    const idempotencyKey = input.idempotencyKey || '';
    if (idempotencyKey) {
      const existing = this.byIdempotency.get(
        idempotencyLookup(tenantId, idempotencyKey, String(input.eventType))
      );
      if (existing) return existing;
    }

    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const chainKey = chainLookup(tenantId, input.aggregateType, input.aggregateId);
    const previousEventHash = this.lastHashByChain.get(chainKey) || '0'.repeat(64);

    const envelope = {
      eventId: eventId,
      eventType: String(input.eventType),
      eventVersion: 1,
      occurredAt: occurredAt,
      tenantId: tenantId,
      actorType: input.actorType || inferActorType(input.actorRole),
      actorId: input.actorId,
      actorRole: input.actorRole,
      aggregateType: input.aggregateType || 'DRAW_REQUEST',
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

    const event: AuditEvent = {
      ...envelope,
      recordedAt: occurredAt,
      payload: payload,
      eventHash: eventHash,
      correlationId: input.correlationId || input.aggregateId || eventId,
    };

    this.events.push(event);
    this.lastHashByChain.set(chainKey, eventHash);
    if (idempotencyKey) {
      this.byIdempotency.set(
        idempotencyLookup(tenantId, idempotencyKey, String(input.eventType)),
        event
      );
    }
    return event;
  }

  async getByTenant(tenantId: string, skip = 0, limit = 100): Promise<AuditEvent[]> {
    return this.events.filter(function (e) {
      return e.tenantId === tenantId;
    }).slice(skip, skip + limit);
  }

  async getByAggregate(
    tenantId: string,
    aggregateType: string,
    aggregateId: string
  ): Promise<AuditEvent[]> {
    return this.events.filter(function (e) {
      return (
        e.tenantId === tenantId &&
        e.aggregateType === aggregateType &&
        e.aggregateId === aggregateId
      );
    });
  }

  verifyChain(events: AuditEvent[]): { ok: boolean; brokenAt?: string } {
    let prev = '0'.repeat(64);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.previousEventHash !== prev) return { ok: false, brokenAt: e.eventId };
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
      if (recomputed !== e.eventHash) return { ok: false, brokenAt: e.eventId };
      prev = e.eventHash;
    }
    return { ok: true };
  }
}

function inferActorType(role: string): ActorType {
  if (role === 'system') return 'SYSTEM';
  if (role === 'EscrowPartner' || role === 'partner') return 'PARTNER';
  if (role === 'SuperAgent') return 'SUPER_AGENT';
  return 'USER';
}
