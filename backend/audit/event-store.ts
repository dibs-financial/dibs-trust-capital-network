/**
 * DIBS Backend — Immutable Event Model
 *
 * Every capital-state change requires an immutable audit event.
 * No silent data synchronization. No capital-state change without an immutable audit event.
 *
 * Event Record:
 * - Immutable event ID
 * - Timestamped transition
 * - Hash-linked evidence objects
 * - Versioned policy logic
 * - Versioned calculation inputs
 * - Versioned risk parameters
 * - Reconciliation records
 * - External settlement confirmations
 * - Data-source provenance
 * - Role and authorization history
 */

export interface ImmutableEvent {
  eventId: string;           // Immutable, never reused
  timestamp: string;         // ISO-8601 UTC
  eventType: EventType;
  actorId: string;           // Who triggered the event
  actorRole: string;         // Authorization role
  tenantId: string;          // Tenant isolation
  payloadHash: string;       // Hash of event payload
  previousEventHash: string; // Hash-linked chain
  policyVersion: string;     // Applicable policy version
  metadata: Record<string, unknown>;
}

export enum EventType {
  // Capital authorization events
  CAPITAL_REQUEST_CREATED = 'CAPITAL_REQUEST_CREATED',
  CAPITAL_REQUEST_APPROVED = 'CAPITAL_REQUEST_APPROVED',
  CAPITAL_REQUEST_HELD = 'CAPITAL_REQUEST_HELD',
  CAPITAL_REQUEST_REJECTED = 'CAPITAL_REQUEST_REJECTED',
  CAPITAL_REQUEST_ESCALATED = 'CAPITAL_REQUEST_ESCALATED',

  // Evidence events
  EVIDENCE_SUBMITTED = 'EVIDENCE_SUBMITTED',
  EVIDENCE_VALIDATED = 'EVIDENCE_VALIDATED',
  EVIDENCE_FLAGGED = 'EVIDENCE_FLAGGED',
  EVIDENCE_EXPIRED = 'EVIDENCE_EXPIRED',

  // Release events
  RELEASE_AUTHORIZED = 'RELEASE_AUTHORIZED',
  RELEASE_HOLD = 'RELEASE_HOLD',
  RELEASE_REJECTED = 'RELEASE_REJECTED',
  SETTLEMENT_INSTRUCTION_SENT = 'SETTLEMENT_INSTRUCTION_SENT',
  SETTLEMENT_CONFIRMED = 'SETTLEMENT_CONFIRMED',
  SETTLEMENT_EXCEPTION = 'SETTLEMENT_EXCEPTION',

  // Covenant events
  COVENANT_COMPLIANT = 'COVENANT_COMPLIANT',
  COVENANT_WARNING = 'COVENANT_WARNING',
  COVENANT_BREACHED = 'COVENANT_BREACHED',
  COVENANT_CURE_ENTERED = 'COVENANT_CURE_ENTERED',
  COVENANT_WAIVED = 'COVENANT_WAIVED',
  COVENANT_DEFAULT = 'COVENANT_DEFAULT',

  // Collateral events
  COLLATERAL_FLAGGED = 'COLLATERAL_FLAGGED',
  COLLATERAL_REINSPECT_REQUIRED = 'COLLATERAL_REINSPECT_REQUIRED',

  // Tranche events
  CAPITAL_PRESERVATION_TRIGGERED = 'CAPITAL_PRESERVATION_TRIGGERED',
  CAPITAL_PRESERVATION_LIFTED = 'CAPITAL_PRESERVATION_LIFTED',
  RESERVE_RELEASED = 'RESERVE_RELEASED',
  DISTRIBUTION_SUSPENDED = 'DISTRIBUTION_SUSPENDED',
  RECAPITALIZATION_EXECUTED = 'RECAPITALIZATION_EXECUTED',

  // Authorization events
  AUTHORIZATION_REVOKED = 'AUTHORIZATION_REVOKED',
  AUTHORIZATION_EXPIRED = 'AUTHORIZATION_EXPIRED',

  // Emergency events
  EMERGENCY_PAUSE = 'EMERGENCY_PAUSE',
  EMERGENCY_UNPAUSE = 'EMERGENCY_UNPAUSE',
}

/**
 * Append-only event store. Events are never mutated or deleted.
 * Each event is hash-linked to the previous event, creating a tamper-evident chain.
 */
export class EventStore {
  private events: ImmutableEvent[] = [];

  async append(event: Omit<ImmutableEvent, 'eventId' | 'timestamp' | 'previousEventHash'>): Promise<ImmutableEvent> {
    const eventId = this.generateEventId();
    const timestamp = new Date().toISOString();
    const previousEventHash = this.events.length > 0
      ? this.hashEvent(this.events[this.events.length - 1])
      : '0x0';

    const fullEvent: ImmutableEvent = {
      ...event,
      eventId,
      timestamp,
      previousEventHash,
    };

    this.events.push(fullEvent);
    // TODO: Persist to append-only store (PostgreSQL or dedicated event store)
    // TODO: Index for query by tenant, type, actor, timestamp
    return fullEvent;
  }

  async getByTenant(tenantId: string, skip = 0, limit = 100): Promise<ImmutableEvent[]> {
    return this.events
      .filter(e => e.tenantId === tenantId)
      .slice(skip, skip + limit);
  }

  private generateEventId(): string {
    // TODO: UUIDv7 or ULID for sortable unique IDs
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  private hashEvent(event: ImmutableEvent): string {
    // TODO: Use proper cryptographic hash (SHA-256)
    return JSON.stringify(event).length.toString(16);
  }
}
