# ADR-0002: DrawRequest is the capital aggregate

- Status: Accepted
- Date: 2026-09-19
- Deciders: Track A
- Code: backend/workflow/draw-request.ts

## Context

The prototype used `CapitalRequest` with `requestedAmount`, `currentState: pending`, and a loose transition helper. That model could not express Autopilot gates, locks, or SoD.

## Options

1. Keep `CapitalRequest` and extend it.
2. Replace it with `DrawRequest` and a closed state machine.
3. Split request / approval / settlement into separate aggregates with choreography.

## Decision

Option 2.

`DrawRequest` is the aggregate. Status is a closed enum. The only writer is `transitionDraw`. Legal edges live in `ALLOWED_TRANSITIONS`. `APPROVED` requires `approvalFailures` to return empty. Terminals are `CLOSED`, `REJECTED`, `CANCELLED`, `EXPIRED`.

Canonical path:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
      -> SETTLEMENT_INSTRUCTED -> SETTLEMENT_CONFIRMED
      -> RECONCILED -> CLOSED
```

## Consequences

- Good: one object to audit, lock, and approve.
- Good: API can stay at `/api/capital/*` while the type changes.
- Bad: `backend/adapters/policy-loan-service.ts` also exports a type named `DrawRequest`. Import it as `PolicyLoanDraw`.
- Bad: prototype `CapitalRequest` callers must be rewired; that work is done in `backend/api/index.ts`.
