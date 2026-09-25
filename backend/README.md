# DIBS Backend — Capital Autopilot (Sprints 0–6)

Module ownership for the controlled-draw MVP. A module owns only what its line says. Anything outside it is out of scope for Sprints 0–6.

```text
backend/api/          HTTP, OIDC, tenant from session, idempotency
backend/workflow/     DrawRequest, waiver
backend/evidence/     ingest, hash, manifest, gate
backend/audit/        EventStore
backend/covenant/     measurements that HOLD a draw
backend/settlement/   instruction, confirmation, recon
backend/reporting/    exception queues only
backend/adapters/     PARKED
contracts/            PARKED
```

## Rules

- **api/** authenticates with OIDC and takes the tenant from the authenticated session, never from a client-supplied header. Every endpoint that creates or changes financial, approval, settlement, waiver or integration state requires `Idempotency-Key`.
- **workflow/** owns the `DrawRequest` state machine and waivers. A waiver is a new authorization record; it never overwrites the original failure.
- **evidence/** ingests, hashes and versions documents, freezes the manifest at `SUBMITTED`, and gates approval on it.
- **audit/** is the append-only, hash-chained `EventStore`. No `UPDATE` or `DELETE`.
- **covenant/** measures covenants and places holds. It does not approve, release or waive.
- **settlement/** records instructions, takes confirmations (CSV first, signed webhooks after pilot) and reconciles. Unmatched records are exceptions, never auto-reconciled. DIBS does not move funds.
- **reporting/** serves exception queues: holds, breaches, reconciliation exceptions, overdue reviews. Portfolio analytics are out of scope.
- **adapters/** and **contracts/** are PARKED. Nothing in Sprints 0–6 imports them or opens new work there.

## Persistence

- Schema: `migrations/*.sql` (PostgreSQL 16), applied with `DATABASE_URL=… npm run db:migrate` as the schema owner.
- The service connects as a member of `dibs_app`: not a superuser, no `BYPASSRLS`. Row-level security on every table reads the tenant from `app.tenant_id`, which `backend/api/db.ts` `withTenantTx` sets from the session. Unset means no rows.
- `audit_event` is append-only with one hash chain per tenant. `dibs_app` has no `UPDATE`, `DELETE` or `TRUNCATE` on it, and triggers refuse them even for the owner. `PgEventStore.verifyChain()` re-verifies every link and hash.
- `backend/workflow/draw-service.ts` drives the `DrawRequest` machine. Each operation writes its audit event first, then changes rows, in one transaction.
- Money is `BIGINT` + `CHAR(3)` in Postgres, `bigint` in TypeScript and decimal strings at the edge. Never `Number()`.
- Integration tests: `tests/integration/`, one throwaway database per file. They need `DATABASE_URL` (an owner connection); CI provides Postgres.

Specs: `docs/architecture/DIBS-Trust-Capital-Network-Master-Scaffold.md`, `docs/architecture/DIBS-Implementation-Plan.md`.
