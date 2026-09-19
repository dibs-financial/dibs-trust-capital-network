# DIBS — Track A Implementation Plan

| Field | Value |
|---|---|
| Version | 2026.09.19 |
| Repo | `dibs-financial/dibs-trust-capital-network` |
| Branch | `main` |
| Path | `docs/architecture/DIBS-Implementation-Plan.md` |
| Spec | `docs/architecture/DIBS-Domain-State-Event-Model.md` |
| Architecture | `docs/architecture/DIBS-Technical-Architecture.md` |
| Thesis | `docs/architecture/DIBS-Core-Thesis-MVP.md` |
| Does not replace | `README.md` |

Do not open work on `backend/adapters/*`, `backend/api/marketplace.ts`, `contracts/vault/*`, QLab, or PQC.

***

## Sprint 0 — Freeze the contract (1 week)

```text
- Adopt DrawRequest state names; publish the enum
- Adopt AuditEvent envelope; ban UPDATE/DELETE on audit_event
- Money = integer minor units
- Tenant from session only
- SoD matrix T1–T3, X1/X2, P1, C1 as config, not code constants
- Kill "policyVersionCurrent" live check; locks write at SUBMITTED
```

Exit: thesis, domain/state/event, technical architecture, and this plan are on `main` under `docs/architecture/`. README points at them. README still does not claim vaults are the product.

***

## Sprint 1 — Foundation

```text
backend/audit/event-store.ts     real SHA-256, state_before/after, per-tenant chain
auth                            OIDC + MFA for privileged roles
RBAC + conflict check           requester ≠ approver ≠ instructor
Organization, User, Deal, SPV, Counterparty, PayeeBankAccount tables
```

Exit: two tenants cannot read each other. An event exists before any draw row changes.

***

## Sprint 2 — Draw + evidence + policy

```text
backend/workflow/capital-request.ts
  rename DrawRequest
  replace CapitalRequestState with the canonical machine
  drop requestedAmount: number
backend/evidence/*
  hash on upload, manifest freeze, no delete
policy evaluator
  PASS | HOLD | FAIL | REVIEW_REQUIRED
  result bound to locked policy + manifest hash
```

Exit: a fixture draw can move DRAFT → UNDER_REVIEW → APPROVED in tests, and cannot APPROVE with a missing inspection.

***

## Sprint 3 — Holds, covenants, waivers

```text
Hold at tenant / deal / SPV / counterparty / draw scope
Covenant measurement in → WATCH or BREACH → Hold
Waiver: requester files, RiskOwner approves, TTL required
ApprovalBinding written on APPROVED
```

Exit: a BREACH without waiver cannot be instructed. A waiver expiry returns the draw to HELD or UNDER_REVIEW.

***

## Sprint 4 — Settlement records + recon

```text
SettlementInstruction reproduces the binding exactly
TreasuryOwner only; not an approver on that draw
Confirmation via dual-entry CSV first (webhook second)
Exact match → RECONCILED
Any mismatch → RECONCILIATION_EXCEPTION
No auto-reconcile
```

Exit: CSV of three confirmations produces two matched rows and one aging break. Cancel after a possible debit is refused.

***

## Sprint 5 — Harden and pilot

```text
Authorization tests, policy regression, webhook replay, audit-chain verify
One lender, 1–3 live deals, manual/CSV confirmation
Hold reason visible in < 1 minute
```

Exit: the pilot criteria in the thesis page, not a vault demo.

***

## Explicitly not scheduled

```text
VRDCT
ERC-4626 vaults
Reserve / tranche engine
External yield routing
Policy-loan / infinite banking
Advanced analytics
Tokenization
API marketplace
Quantum Optimization Lab
PQC implementation
SPV formation automation
```

***

## Definition of done for Autopilot v0

```text
One lender can run one deal through
DRAFT → … → RECONCILED
with evidence, policy, two-person approval, CSV confirmation,
a recon match, and a verifiable audit chain —
and cannot complete that path by editing a spreadsheet.
```
