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

Research code lives outside `backend/` in `packages/quantum-lab/` (PARKED, offline). `backend/` and `packages/quantum-lab/` must not import each other.

Specs: `docs/architecture/DIBS-Trust-Capital-Network-Master-Scaffold.md`, `docs/architecture/DIBS-Implementation-Plan.md`.
