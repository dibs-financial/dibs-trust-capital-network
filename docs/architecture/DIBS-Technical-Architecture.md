# DIBS — Technical Architecture (Track A)

| Field | Value |
|---|---|
| Version | 2026.09.19 |
| Status | Implementation architecture for Capital Autopilot |
| Commit to | `docs/architecture/DIBS-Technical-Architecture.md` |
| Domain / machine / events | `docs/architecture/DIBS-Domain-State-Event-Model.md` |
| Product thesis | `docs/architecture/DIBS-Core-Thesis-MVP.md` |
| Does not replace | `README.md` |

This file is how the product is built. The companion domain file is what exists in the model. Together they supersede `backend/README.md` build-priority list, `capital-request.ts` state names, and the vault-era folder story.

***

## 1. What this architecture is

A multi-tenant control plane. Lenders submit and approve construction / bridge / renovation draws. DIBS evaluates policy, freezes evidence, binds approvals, writes settlement *instructions*, records partner *confirmations*, and reconciles.

DIBS does not hold funds, issue credit, or press a payment-provider release.

```text
Browser / API
    → API gateway (OIDC, tenant from session)
        → workflow, evidence, policy, approval, hold, settlement-status, recon
            → PostgreSQL  (current state)
            → audit_event (append-only chain)
            → object store (evidence bytes)
            → queue (notifications, CSV ingest, webhook retries)
        → partner boundary
            CSV inbox or signed webhook
            Escrow Factory / bank / custodian
```

No chain, no QPU, no marketplace, no vault runtime in this picture.

***

## 2. Legal and write boundaries

| Actor | May write | May not write |
|---|---|---|
| DIBS | Draw state, policy results, manifests, approvals, holds, instructions, confirmation *records*, recon breaks, events | Funds, credit decisions as lender of record, escrow release |
| Lender users | Deal setup, matrix, waivers per role, approvals per matrix | Partner ledgers |
| Borrower / sponsor | Draw request, evidence | Approval, instruction |
| Escrow / bank / custodian | Their own movement of funds; a signed confirmation DIBS stores | DIBS policy |
| Inspector / title / KYC vendor | Source file DIBS hashes | Draw status |
| SuperAgent | Tasks, summaries | Approvals, waivers, policy, instructions |

If DIBS policy and an Escrow Factory milestone disagree, DIBS holds. It does not silently prefer either side.

***

## 3. System of record

Two stores, one transaction. Not a slogan.

| Fact | Source of truth | Store |
|---|---|---|
| Current draw / deal / payee / hold status | Operational row | PostgreSQL, `tenant_id` from session |
| Why it is that way | `AuditEvent` | Append-only `audit_event`, hash-chained per aggregate |
| Document bytes | Object at `storage_uri` | S3-compatible; content-hash is the name |
| Evidence set used on a draw | `evidence_manifest.manifest_hash` | Frozen at `SUBMITTED` |
| Policy used on a draw | `draw_request.locked_policy_version` | Set at `SUBMITTED` |
| Live deal policy | `deal.effective_policy_version` | New submissions only |
| What DIBS asked to pay | `settlement_instruction` | DIBS |
| What the partner says happened | `settlement_confirmation` | Partner-signed or dual-entry CSV |
| Whether books match | `reconciliation_record` | DIBS; no auto-match of mismatches |
| Funds actually moved | Partner ledger | Never DIBS alone |

Token NAV, vault shares, VRDCT scores, and QAOA bitstrings are not sources of truth for a draw.

### Write path

```text
BEGIN
  lock DrawRequest
  assert tenant, SoD, transition, binding, TTL, holds
  INSERT AuditEvent (
    state_before, state_after,
    payload_hash, previous_event_hash, event_hash,
    actor_id, idempotency_key
  )
  UPDATE DrawRequest.status
  INSERT side row if any (instruction, confirmation, recon, hold)
COMMIT
```

If the event insert fails, the state change does not happen. Prototype `transitionState()` that mutates memory and TODOs the event is inverted.

Replay for an auditor:

```text
1. Events for aggregate X ordered by occurred_at
2. Verify previous_event_hash chain
3. Re-hash payloads
4. Each state_after equals the next state_before
5. Current row.status equals the last state_after
```

If step 5 fails, the row was written outside the machine. That is an incident.

***

## 4. Runtime and modules

Map to the repo that exists. Do not invent a greenfield monorepo this week.

```text
backend/api/          HTTP, OIDC, tenant from session, idempotency
backend/workflow/     DrawRequest machine, waiver, tasks
backend/evidence/     ingest, hash, manifest, gate
backend/audit/        EventStore → AuditEvent
backend/covenant/     measurements that can HOLD a draw
backend/settlement/   instruction + confirmation records + recon
backend/reporting/    exception queues only (park APY / reserve dashboards)
backend/adapters/     parked (VRDCT, policy-loan, RWA)
frontend/              draw desk, evidence, approval queue, recon breaks
contracts/             parked for Autopilot
```

Control-plane services are modules, not products:

```text
Policy engine
Evidence service
Approval service
Hold / exception service
Settlement-status service     (records only)
Reconciliation engine
Audit ledger
Task / notification service
```

No rail gets its own approval, audit, or settlement logic.

***

## 5. Request path (one draw)

```text
1. Authenticate. Tenant from session. Reject client-supplied tenant_id.
2. Authorize role + object + SoD + conflict check.
3. DRAFT created with idempotency key and budget lines.
4. Evidence uploaded. Bytes to object store. Hash to DB.
5. SUBMITTED: freeze manifest, lock policy version, evaluate policy.
6. UNDER_REVIEW: matrix routes tasks.
7. APPROVED only if the companion file §2.5 condition holds. Binding written. TTL starts.
8. TreasuryOwner (≠ any approver) writes SettlementInstruction = binding.
9. Partner executes. Signed webhook or dual-entry CSV becomes SettlementConfirmation.
10. Exact match → RECONCILED → CLOSED. Any mismatch → RECONCILIATION_EXCEPTION.
11. Every step is one transaction with an AuditEvent.
```

CSV is the MVP confirmation channel. Webhooks second. No browser talks to a payment provider through DIBS.

***

## 6. Decision precedence

Highest first. First hard fail wins. Do not average.

```text
1. Tenant isolation and authenticated actor
2. Compliance hold                    (ComplianceReviewer only)
3. Open hold at any scope             (tenant > deal > SPV > counterparty > draw)
4. Failed hard covenant without a covering waiver
5. Incomplete or stale evidence manifest
6. Payee not VERIFIED, or sanctions outside freshness window
7. Budget / retainage / eligible-amount miss
8. Approval matrix or SoD miss        (requester ≠ approver ≠ instructor)
9. Binding broken or TTL elapsed
10. Policy PASS + matrix satisfied → APPROVED
```

| Conflict | Winner |
|---|---|
| Evidence stale, current policy would allow it | Frozen manifest wins. Re-submit. |
| Covenant BREACHED, waiver signed | Waiver if in-scope, unexpired, attributed, not self-approved |
| Collateral impaired after APPROVED, before instruct | APPROVED → HELD |
| Covenant breaches after SETTLEMENT_INSTRUCTED | Record hold. Do not un-instruct. Wait for partner. |
| Policy edited after submit | In-flight draw keeps `locked_policy_version` |
| Binding TTL elapsed | APPROVED → UNDER_REVIEW, not EXPIRED |
| Partner debit possible after failed instruction | RECONCILIATION_EXCEPTION, not CANCELLED |
| Escrow milestone text ≠ DIBS policy | Hold |
| Treasury used as T3 approver | Illegal. Treasury instructs. T3 is PM + Risk + LenderAdmin |
| PlatformAdmin “just push it through” | No financial authority. Log the attempt. |

No emergency override that skips the event. Pause is a hold.

***

## 7. HTTP surface (Track A)

All under `/v1`. Tenant from session. Idempotency key required on financial-state writes.

```text
Auth / tenant
  POST   /v1/auth/oidc/callback
  GET    /v1/me

Deal setup
  POST   /v1/deals
  GET    /v1/deals/:id
  POST   /v1/deals/:id/counterparties
  POST   /v1/payees/:id/accounts
  POST   /v1/payees/:id/accounts/:aid/verify

Draw cycle
  POST   /v1/deals/:id/draws
  POST   /v1/draws/:id/submit
  POST   /v1/draws/:id/evidence
  POST   /v1/draws/:id/manifest/freeze
  POST   /v1/draws/:id/approve
  POST   /v1/draws/:id/reject
  POST   /v1/draws/:id/holds
  POST   /v1/holds/:id/release
  POST   /v1/draws/:id/waivers
  POST   /v1/draws/:id/instructions
  POST   /v1/draws/:id/cancel

Partner
  POST   /v1/partner/webhooks/:connection_id
  POST   /v1/partner/csv

Read
  GET    /v1/draws/:id
  GET    /v1/draws/:id/events
  GET    /v1/queues/exceptions
  GET    /v1/exports/audit
```

Do not add `/v1/quantum-lab/*`, `/v1/vaults/*`, `/v1/tokens/*`, `/v1/marketplace/*` in Track A.

***

## 8. Data plane

```text
PostgreSQL
  operational rows
  row-level tenant isolation (RLS or equivalent)
  unique (tenant_id, idempotency_key) where set
  no UPDATE/DELETE grants on audit_event

Object store
  evidence bytes
  key = content_hash
  no client documents sent to quantum providers

Queue
  webhook retries
  CSV parse
  notifications
  never a second source of truth

Not used for Autopilot
  chain, QPU, VRDCT store, marketplace DB, vault indexer
```

Money columns are `BIGINT` minor units plus `CHAR(3)` currency. Application code uses integers. Display is the only place a decimal appears.

***

## 9. Security minimum (Track A)

```text
OIDC for humans. No shared approval accounts.
MFA for RiskOwner, TreasuryOwner, LenderAdmin, ComplianceReviewer.
Tenant from session. Client-supplied tenant identifiers discarded.
Object-level authorization on every write.
SoD check at decision time against current RoleAssignments.
Webhook signatures verified before parse. Raw body stored first.
CSV dual-entry: two distinct operators, compared, then applied.
Evidence is superseded, never deleted.
Secrets in a manager, not in the event payload.
PQC (ML-KEM / ML-DSA) is Track B. Do not block Autopilot on it.
```

***

## 10. What the current code must change

| Current | Required |
|---|---|
| `CapitalRequest` | `DrawRequest` |
| `pending / evidence_submission / validation / approval / approved_for_release / settled` | Machine in the domain file |
| `requestedAmount: number` | `amount_requested_minor: integer` |
| `EventStore.hashEvent = JSON.stringify(event).length` | SHA-256 over canonical bytes |
| `ImmutableEvent` missing before/after, aggregate id, event_hash | `AuditEvent` in the domain file |
| Event types `CAPITAL_PRESERVATION_*`, `RESERVE_RELEASED`, `RECAPITALIZATION_*` | Drop from MVP enum |
| `transitionState` mutates then TODOs the event | Event + row in one transaction |

Keep `backend/evidence/` hashing and gating. Wire it to the machine. Do not start from `contracts/` or `backend/adapters/`.

***

## 11. Out of this architecture

```text
ERC-4626 vaults, Sentinel, Catalyst
Yield routers (Morpho, Pendle)
Tokenization / RWA issuance
VRDCT scoring
Policy-loan / infinite banking
API marketplace
Quantum Optimization Lab
On-chain settlement
```

Those folders may stay in the repo. They are not on the Autopilot runtime path.
