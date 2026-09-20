# ADR-0003: Append-only SHA-256 event store

- Status: Accepted
- Date: 2026-09-19
- Deciders: Track A
- Code: backend/audit/event-store.ts

## Context

The prototype hashed `JSON.stringify(payload).length`. That is not a hash. Events were not chained. A row update could change history without detection.

## Options

1. Mutable audit table (update in place).
2. Append-only rows with no hash.
3. Append-only rows with SHA-256 payload hash and previous-event hash, chained per tenant + aggregate.

## Decision

Option 3.

`EventStore.append` writes an `AuditEvent` with `eventId`, `payloadHash`, `previousEventHash`, `eventHash`. Chain key is `tenantId + aggregateType + aggregateId`. Duplicate `(tenantId, eventType, idempotencyKey)` returns the original event. `verifyChain` walks the hash links.

`transitionDraw` appends before it returns the new draw. No status change without an event.

Template literals are forbidden in this file. GitHub UI ate `${}`. Use string concat and `Array.join`.

## Consequences

- Good: a reviewer can prove the chain.
- Good: retries are safe.
- Bad: in-memory store is not durable. Postgres replace is a later ADR.
- Bad: payload must be canonical-JSON serialized the same way on write and verify.
