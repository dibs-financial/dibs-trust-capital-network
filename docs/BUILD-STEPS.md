# DIBS Trust Capital Network — 20-Step Build Architecture

> **Document Status**: Final — reflects repository state at commit `b51e7e8`
> **Repository**: `github.com/dibs-financial/dibs-trust-capital-network`
> **Last Updated**: 2026-08-09
> **Total Files**: 102 tracked | **Total Lines**: ~31,640 | **Commits**: 17

---

## Table of Contents

- [Overview](#overview)
- [Build Steps](#build-steps)
  - [Step 1 — Multi-Tenant Authentication](#step-1--multi-tenant-authentication)
  - [Step 2 — Roles and Tenant Isolation](#step-2--roles-and-tenant-isolation)
  - [Step 3 — Immutable Event Model](#step-3--immutable-event-model)
  - [Step 4 — Capital-Request and Draw Workflow](#step-4--capital-request-and-draw-workflow)
  - [Step 5 — Evidence-Gating Workflow](#step-5--evidence-gating-workflow)
  - [Step 6 — Object-Level Authorization](#step-6--object-level-authorization)
  - [Step 7 — Settlement Partner Integration](#step-7--settlement-partner-integration)
  - [Step 8 — Reconciliation Engine](#step-8--reconciliation-engine)
  - [Step 9 — Covenant Engine](#step-9--covenant-engine)
  - [Step 10 — Collateral Hold System](#step-10--collateral-hold-system)
  - [Step 11 — Exception and Waiver Workflow](#step-11--exception-and-waiver-workflow)
  - [Step 12 — VRDCT Monitoring Adapter](#step-12--vrdct-monitoring-adapter)
  - [Step 13 — Enterprise Reporting](#step-13--enterprise-reporting)
  - [Step 14 — ERC-4626 Vault Prototype](#step-14--erc-4626-vault-prototype)
  - [Step 15 — Reserve and Tranche Engine](#step-15--reserve-and-tranche-engine)
  - [Step 16 — External Yield Routing](#step-16--external-yield-routing)
  - [Step 17 — Policy-Loan Subsystem](#step-17--policy-loan-subsystem)
  - [Step 18 — Advanced Analytics](#step-18--advanced-analytics)
  - [Step 19 — Tokenization](#step-19--tokenization)
  - [Step 20 — External API Marketplace](#step-20--external-api-marketplace)
- [Dependency Graph](#dependency-graph)
- [Test Coverage Matrix](#test-coverage-matrix)
- [File-to-Step Mapping](#file-to-step-mapping)

---

## Overview

The DIBS Trust Capital Network was built in 20 sequential steps, each producing one or more production-grade modules across four repository layers:

| Layer | Directory | Files | Lines | Language |
|---|---|---|---|---|
| Smart Contracts | `contracts/` | 12 | 4,628 | Solidity 0.8.35 |
| Backend Services | `backend/` | 21 | 6,548 | TypeScript |
| Frontend Dashboards | `frontend/src/` | 25 | 1,024 | TSX / CSS |
| Shared Libraries | `shared/` | 6 | 1,012 | TypeScript |
| Test Suites | `tests/` | 15 | 4,067 | TS / Solidity |
| Documentation | `docs/` + root | 8 | ~4,361 | Markdown |
| CI/CD | `.github/` | 2 | ~200 | YAML |

### Build Principles

- **Sequential dependency**: Each step builds on the output of prior steps. No step introduces a circular dependency.
- **Vertical slice**: Each step delivers a testable unit — contract, service, or API surface — that can be independently verified.
- **Separation of concerns**: Authorization (Steps 1–6) → Settlement/Reconciliation (Steps 7–8) → Monitoring (Steps 9–12) → Reporting (Step 13) → Capital Infrastructure (Steps 14–17) → Extension (Steps 18–20).
- **Security-first**: Donation attack mitigation, timelocked governance, and Capital Preservation Mode are integrated into the vault layer from Step 14 onward.

---

## Build Steps

---

### Step 1 — Multi-Tenant Authentication

**Status**: ✅ Complete
**Commit**: `111e6c7`
**Files**: `backend/api/index.ts` (789 lines)

#### Purpose
Establishes the Express API gateway with tenant-scoped middleware. Every downstream request is tagged with a `tenantId` extracted from the `x-dibs-tenant` header, ensuring complete data isolation between organizations.

#### Implementation
- Express application with middleware chain: `tenantId` extraction → role extraction → request logging → route dispatch.
- Tenant ID propagated to all service-layer calls via request context.
- `x-dibs-tenant` header is mandatory; requests without it are rejected with `400 MISSING_TENANT_HEADER`.

#### Key Interfaces
```typescript
// Middleware signature
(req: Request & { tenantId: string }, res: Response, next: NextFunction) => void
```

#### Dependencies
- None (foundational step)

---

### Step 2 — Roles and Tenant Isolation

**Status**: ✅ Complete
**Commit**: `111e6c7`
**Files**: `backend/api/index.ts`, `shared/types/index.ts` (195 lines)

#### Purpose
Implements role-based access control (RBAC) layered on top of tenant isolation. The `x-dibs-role` header assigns one of seven operational roles per request, each with distinct API surface access.

#### Roles Defined
| Role | Access Scope |
|---|---|
| `operator` | Full system access — all dashboards, all endpoints |
| `lender` | Capital requests, covenant monitoring, tranche analytics |
| `sponsor` | Project-scoped requests, evidence upload, milestone tracking |
| `borrower` | Evidence submission, draw requests, status viewing |
| `inspector` | Evidence submission (inspection reports only) |
| `admin` | User management, parameter configuration, system health |
| `auditor` | Read-only access to all audit logs and event store |

#### Implementation
- Role check middleware applied per-route group.
- Role enumeration in `shared/types/index.ts`.
- Frontend dashboards gated by role in `frontend/src/App.tsx` routing.

#### Dependencies
- Step 1 (tenant authentication)

---

### Step 3 — Immutable Event Model

**Status**: ✅ Complete
**Commit**: `111e6c7`
**Files**: `backend/audit/event-store.ts` (125 lines), `shared/events/index.ts` (284 lines)

#### Purpose
Establishes the append-only, hash-linked audit chain that serves as the system of record for every state transition. No capital-state change occurs without an immutable event.

#### Implementation
- `EventStore` class stores events in an in-memory append-only array.
- Each event includes: `eventId`, `eventType` (enum), `tenantId`, `actorId`, `timestamp`, `metadata`, and a `prevEventHash` forming a hash chain.
- 28 event types defined in `shared/events/index.ts` covering: capital requests, evidence, validation, covenants, collateral, settlement, reconciliation, VRDCT, policy-loan, exceptions, and system governance.

#### Event Types (28)
```
CAPITAL_REQUEST_SUBMITTED, CAPITAL_REQUEST_APPROVED, CAPITAL_REQUEST_REJECTED,
CAPITAL_REQUEST_RELEASED, CAPITAL_REQUEST_HOLD,
EVIDENCE_SUBMITTED, EVIDENCE_VALIDATED, EVIDENCE_FLAGGED, EVIDENCE_EXPIRED,
COVENANT_STATE_TRANSITION, COVENANT_BREACH, COVENANT_WARNING,
COLLATERAL_HOLD_PLACED, COLLATERAL_HOLD_RELEASED,
SETTLEMENT_SUBMITTED, SETTLEMENT_CONFIRMED, SETTLEMENT_FAILED,
RECONCILIATION_VARIANCE_DETECTED, RECONCILIATION_RESOLVED,
VRDCT_SIGNAL_INGESTED, VRDCT_SCORE_UPDATED, VRDCT_ADVERSE_ACTION_NOTICE,
POLICY_LOAN_CREATED, POLICY_LOAN_REPAID, POLICY_LOAN_LIQUIDATED,
EXCEPTION_RAISED, WAIVER_GRANTED, WAIVER_DENIED
```

#### Key Interfaces
```typescript
interface AuditEvent {
  eventId: string;
  eventType: EventType;
  tenantId: string;
  actorId: string;
  actorRole: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  prevEventHash: string;
}
```

#### Dependencies
- Step 1 (tenant authentication)
- Step 2 (roles)

---

### Step 4 — Capital-Request and Draw Workflow

**Status**: ✅ Complete
**Commit**: `111e6c7` → `0a29b6b` (wired to API)
**Files**: `backend/workflow/capital-request.ts` (177 lines), `shared/types/index.ts`

#### Purpose
Implements the stateful capital-request lifecycle — the core business object that drives the controlled-draw process. A capital request moves through six states, each gated by preconditions.

#### State Machine
```
pending → evidence_submission → validation → approval → approved_for_release → released
                ↑                                                        ↓
                ← ← ← ← ← ← HOLD ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← ←
```

#### Capital Request Object
```typescript
interface CapitalRequest {
  requestId: string;
  borrowerOrSponsorId: string;
  projectId: string;
  spvId: string;
  requestedAmount: number;
  paymentDestination: string;
  drawCategory: string;
  milestoneAssociation: string;
  covenantDependencies: string[];
  collateralDependencies: string[];
  requiredApprovers: string[];
  currentState: CapitalRequestState;
  policyVersion: string;
  tenantId: string;
}
```

#### Implementation
- State transitions validated against allowed state map.
- Each transition emits an `EventType` to the event store.
- 13 release preconditions defined in `shared/validation/index.ts` (see Step 6).

#### Dependencies
- Step 1 (tenant authentication)
- Step 2 (roles)
- Step 3 (event model)

---

### Step 5 — Evidence-Gating Workflow

**Status**: ✅ Complete
**Commits**: `b874274` (service) → `6611bf6` (tests) → `b51e7e8` (gating tests)
**Files**: `backend/evidence/evidence-ingestion.ts` (610 lines), `backend/evidence/evidence-gating.ts` (209 lines), `backend/evidence/evidence.routes.ts` (249 lines)

#### Purpose
Enforces evidence preconditions before capital can be released or transitioned. Validates presence of all policy-required evidence classes, checks freshness, detects expiration, aggregates flags, and computes ultimate gating status.

#### Evidence Classes (18)
| Class | Default Max Age (Days) |
|---|---|
| `construction_photo` | 30 |
| `inspection_report` | 60 |
| `invoice` | 90 |
| `contract` | 365 |
| `change_order` | 90 |
| `lien_waiver` | 90 |
| `title_update` | 180 |
| `insurance_verification` | 365 |
| `borrower_representation` | 180 |
| `vendor_validation` | 365 |
| `appraisal` | 365 |
| `draw_budget_reconciliation` | 60 |
| `bank_account_validation` | 180 |
| `collateral_value_documentation` | 180 |
| `covenant_compliance_attestation` | 90 |
| `third_party_inspection` | 90 |
| `authorized_signatory_verification` | 365 |
| `kyc_documentation` | 365 |

#### Ingestion Service (`EvidenceIngestionService`)
- SHA-256 document hashing (`computeSHA256`)
- Validation pipeline: presence → type → freshness → issuer → hash → project → milestone → approvals → expiry → exceptions
- Deep conflict detection: duplicate invoices, budget mismatch, destination change, missing lien waiver, expired insurance, collateral drop
- Emits `EVIDENCE_SUBMITTED`, `EVIDENCE_VALIDATED`, `EVIDENCE_FLAGGED`, `EVIDENCE_EXPIRED` events

#### Gating Service (`evaluateEvidenceGating`)
- **Input**: Capital request, gating policy, evidence list
- **Output**: `EvidenceGatingResult` containing `allPresent`, `allFresh`, `allValid`, `missingClasses`, `expiredEvidence`, `flags`, `gatePassed`
- Strict mode (`strictNoFlags: true`): gate passes only if all required classes present, all fresh, all valid, and zero flags
- Non-strict mode (`strictNoFlags: false`): gate passes if present + fresh + valid, flags tolerated

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `EvidenceIngestion.test.ts` | 33 | Jest |
| `EvidenceGating.test.ts` | 34 | Jest |
| **Total** | **67** | |

#### Dependencies
- Steps 1–3 (authentication, roles, events)
- Step 4 (capital request provides context for which evidence is required)

---

### Step 6 — Object-Level Authorization

**Status**: ✅ Complete
**Commit**: `111e6c7` → `0a29b6b`
**Files**: `shared/validation/index.ts` (248 lines), `shared/types/index.ts`

#### Purpose
Implements 13 machine-verifiable release preconditions that must all pass before capital is released. No trust-based disbursement is permitted under any circumstance.

#### Release Preconditions (13)
| # | Precondition | Failure Flag |
|---|---|---|
| 1 | Draw budget remaining ≥ requested amount | `REQUEST_EXCEEDS_DRAW_BUDGET` |
| 2 | Collateral conditions satisfied | `COLLATERAL_CONDITIONS_NOT_SATISFIED` |
| 3 | Covenant conditions satisfied | `COVENANT_CONDITIONS_NOT_SATISFIED` |
| 4 | No active hold | `ACTIVE_HOLD_EXISTS` |
| 5 | No fraud block | `COUNTERPARTY_BLOCK_ACTIVE` |
| 6 | No sanctions block | `COUNTERPARTY_BLOCK_ACTIVE` |
| 7 | No KYC block | `COUNTERPARTY_BLOCK_ACTIVE` |
| 8 | Settlement account verified | `SETTLEMENT_ACCOUNT_NOT_VERIFIED` |
| 9 | No reconciliation exception | `UNRESOLVED_RECONCILIATION_EXCEPTION` |
| 10 | Release window open | `RELEASE_WINDOW_NOT_OPEN` |
| 11 | Policy version current | `POLICY_VERSION_STALE` |
| 12 | Authorization signatures valid | `AUTHORIZATION_SIGNATURES_INVALID` |
| 13 | All required evidence present and valid | (from Step 5) |

#### Implementation
```typescript
function validateReleasePreconditions(
  request: CapitalRequest,
  context: ReleasePreconditionContext
): { passed: boolean; failures: string[] }
```

#### Dependencies
- Steps 1–5 (all prior steps provide context for precondition evaluation)

---

### Step 7 — Settlement Partner Integration

**Status**: ✅ Complete
**Commit**: `b874274` → `0a29b6b`
**Files**: `backend/settlement/settlement-service.ts` (282 lines), `backend/settlement/settlement.routes.ts` (134 lines)

#### Purpose
Routes settlement instructions to external regulated banking and payment counterparties. The DIBS platform does not execute settlement itself — it submits instructions and records confirmations.

#### Implementation
- `SettlementService` class with idempotent instruction submission
- Partner confirmation tracking with `confirmationIndex`
- Instruction cancellation and expiry
- Settlement states: `pending` → `confirmed` | `cancelled` | `expired`
- Emits `SETTLEMENT_SUBMITTED`, `SETTLEMENT_CONFIRMED`, `SETTLEMENT_FAILED`

#### Key Interfaces
```typescript
interface SettlementInstruction {
  instructionId: string;
  requestId: string;
  partnerId: string;
  amount: number;
  destination: string;
  currency: string;
  status: 'pending' | 'confirmed' | 'failed' | 'cancelled' | 'expired';
  submissionTimestamp: string;
  confirmationTimestamp?: string;
  confirmationIndex?: number;
}
```

#### Dependencies
- Steps 1–4 (tenant context, event logging, capital request linkage)

---

### Step 8 — Reconciliation Engine

**Status**: ✅ Complete
**Commit**: `b874274` → `3ba24f9` (test fix)
**Files**: `backend/settlement/reconciliation-engine.ts` (275 lines)

#### Purpose
Detects and tracks variances between expected and actual settlement outcomes. Ensures the system can prove why capital moved (or did not move) with quantitative precision.

#### Variance Types
| Type | Description |
|---|---|
| `amount_mismatch` | Disbursed amount ≠ expected amount |
| `timing_delay` | Confirmation received outside expected window |
| `destination_mismatch` | Funds sent to wrong account |
| `missing_confirmation` | No confirmation received within timeout |
| `duplicate_settlement` | Same instruction confirmed twice |
| `failed_settlement` | Settlement partner returned failure |

#### Implementation
- `ReconciliationEngine` with `reconcile()` and `recordException()` methods
- Variance records stored with resolution state: `open` → `investigating` → `resolved` | `unresolved`
- Emits `RECONCILIATION_VARIANCE_DETECTED`, `RECONCILIATION_RESOLVED`

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `SettlementReconciliation.test.ts` | 12 | Jest |

#### Dependencies
- Step 7 (settlement service provides records to reconcile)

---

### Step 9 — Covenant Engine

**Status**: ✅ Complete
**Commit**: `111e6c7` → `0a29b6b`
**Files**: `backend/covenant/covenant-engine.ts` (156 lines)

#### Purpose
Implements automated covenant monitoring across 24 categories, with state transitions governed by a strict state machine. Covenant breaches block capital according to policy.

#### Covenant Categories (24)
| Category | Category |
|---|---|
| `loan_to_value` | `debt_service_coverage_ratio` |
| `debt_yield` | `minimum_liquidity` |
| `construction_budget_variance` | `completion_date_variance` |
| `interest_reserve_sufficiency` | `insurance_coverage` |
| `property_tax_status` | `lien_status` |
| `title_status` | `occupancy_threshold` |
| `revenue_threshold` | `sponsor_net_worth` |
| `dscr_threshold` | `current_ratio` |
| `debt_to_equity` | `fixed_charge_coverage` |
| `interest_coverage_ratio` | `maximum_leverage` |
| `minimum_equity` | `cash_reserve_months` |
| `capex_completion` | `permit_status` |
| `environmental_compliance` | `property_condition` |

#### Covenant State Machine
```
compliant → warning → breached → cure_period → compliant (or default)
                                   → waived (requires signed waiver)
                                   → default
```

#### Implementation
- `validateCovenantTransition(from, to, hasSignedWaiver)` enforces valid transitions
- Breach of `breached → waived` requires `hasSignedWaiver = true`
- `default` is terminal — no outbound transitions
- Emits `COVENANT_STATE_TRANSITION`, `COVENANT_BREACH`, `COVENANT_WARNING`

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `CovenantEngine.test.ts` | 8 | Jest |

#### Dependencies
- Steps 1–3 (authentication, roles, events)
- Step 4 (capital request provides covenant dependencies)

---

### Step 10 — Collateral Hold System

**Status**: ✅ Complete
**Commit**: `b874274` → `0a29b6b`
**Files**: `backend/covenant/collateral-hold.ts` (414 lines), `backend/covenant/collateral.routes.ts` (184 lines)

#### Purpose
Manages collateral risk evaluation, hold placement, and release dependencies. Collateral conditions must be satisfied before capital release (Precondition #2 in Step 6).

#### Risk Evaluation (`evaluateCollateralRisk`)
| Flag | Trigger |
|---|---|
| `APPRAISAL_MUNICIPAL_VARIANCE_HIGH` | Appraisal vs municipal valuation variance > 15% |
| `STALE_APPRAISAL` | Valuation date > 365 days old |
| `UCC_FILING_DETECTED` | UCC filing on collateral |
| `TAX_LIEN_DETECTED` | Tax lien on collateral |
| `MECHANICS_LIEN_DETECTED` | Mechanics lien on collateral |
| `TITLE_DEFECT` | Title status ≠ clear |
| `INSURANCE_LAPSE` | Insurance status ≠ active |
| `LTV_EXCEEDS_POLICY` | LTV > policy maximum |

#### Implementation
- `CollateralHoldSystem` class with hold placement, release, and query operations
- Holds linked to capital requests — active hold blocks release (Precondition #4)
- Emits `COLLATERAL_HOLD_PLACED`, `COLLATERAL_HOLD_RELEASED`

#### Dependencies
- Steps 1–3 (authentication, roles, events)
- Step 6 (collateral satisfaction is a release precondition)

---

### Step 11 — Exception and Waiver Workflow

**Status**: ✅ Complete
**Commit**: `b874274`
**Files**: `backend/workflow/exception-waiver.ts` (516 lines)

#### Purpose
Manages structured exception handling and waiver authorization for cases where automated preconditions cannot be met but human judgment authorizes proceeding. Enhanced approval is required for exceptions, waivers, and collateral impairment events.

#### Exception Lifecycle
```
raised → reviewing → approved | denied | escalated
                       ↓
                  waiver_requested → waiver_granted | waiver_denied
```

#### Implementation
- `ExceptionWaiverService` with exception creation, review, approval/denial, escalation
- Waiver requests linked to exceptions — require `hasSignedWaiver` for covenant waivers
- Waiver approval checks: authorization validity, role match, signed payload, expiry, revocation state
- Emits `EXCEPTION_RAISED`, `WAIVER_GRANTED`, `WAIVER_DENIED`

#### Authorization Validation
```typescript
function validateAuthorization(
  authorization: {
    authorizerIdentity: string;
    authorizationRole: string;
    signedPayloadHash: string;
    authorizationExpiry: string;
    revocationState: string;
  },
  requiredRole: string
): { valid: boolean; failures: string[] }
```

#### Dependencies
- Steps 1–3 (authentication, roles, events)
- Step 9 (covenant engine — waivers interact with covenant state transitions)
- Step 10 (collateral holds — exceptions can override holds)

---

### Step 12 — VRDCT Monitoring Adapter

**Status**: ✅ Complete
**Commit**: `b874274`
**Files**: `backend/adapters/vrdct-adapter.ts` (326 lines)

#### Purpose
Implements the VRDCT (Verified Risk, Data, and Credit Trust) trust-intelligence layer. Aggregates consented, explainable, verifiable behavioral and performance signals into a trust-score framework. Protected-class proxy signals are explicitly rejected.

#### Signal Types (29)
Categories: behavioral, performance, transactional, counterparty, collateral, covenant, settlement, evidence, exception, system-health

#### Implementation
- `VRDCTAdapter` class with signal ingestion, score computation, and adverse action notice generation
- Protected-class proxy rejection: signals with `protectedClass` attribute are rejected with `PROTECTED_CLASS_REJECTED` flag
- Score components: behavioral, performance, counterparty, collateral, covenant, settlement
- Adverse action notice engine: generates notice when score drops below threshold or flagged signal detected
- Emits `VRDCT_SIGNAL_INGESTED`, `VRDCT_SCORE_UPDATED`, `VRDCT_ADVERSE_ACTION_NOTICE`

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `VRDCTTrustSignals.test.ts` | 11 | Jest |

#### Dependencies
- Steps 1–3 (authentication, roles, events)
- Steps 5, 9, 10 (evidence, covenants, collateral provide signal sources)

---

### Step 13 — Enterprise Reporting

**Status**: ✅ Complete
**Commit**: `b874274` → `0a29b6b`
**Files**: `backend/reporting/reporting-engine.ts` (340 lines), `backend/reporting/reporting.routes.ts` (78 lines)

#### Purpose
Generates operational and compliance reports across all system domains. Reports are tenant-scoped and role-gated.

#### Report Types
| Report | Audience | Content |
|---|---|---|
| Capital Request Summary | Lender, Operator | Request status, amount, draw category, state |
| Evidence Compliance | Auditor, Operator | Evidence classes present/missing, freshness, flags |
| Covenant Status | Lender, Operator | Covenant states, breaches, warnings, cure periods |
| Collateral Health | Lender, Operator | LTV, lien status, insurance, appraisal variance |
| Settlement Reconciliation | Auditor, Operator | Variance records, resolution status |
| VRDCT Trust Profile | Operator | Score components, flagged signals, adverse notices |
| Policy-Loan Portfolio | Operator | Active loans, LTV, arbitrage economics |
| Exception Log | Auditor, Operator | Exceptions raised, waivers granted/denied |

#### Implementation
- `ReportingEngine` class with report generation and export
- Reports pull from event store (immutable source of truth)
- Tenant isolation enforced at query level

#### Dependencies
- Steps 1–12 (reporting aggregates data from all prior modules)

---

### Step 14 — ERC-4626 Vault Prototype

**Status**: ✅ Complete
**Commits**: `111e6c7` (base) → `712f539` (CPM) → `88bb309` (seed + timelock) → `8bad89d` (fixes)
**Files**: `contracts/vault/DIBSVault.sol` (647 lines), `contracts/vault/SentinelVault.sol` (162 lines), `contracts/vault/CatalystVault.sol` (207 lines), `contracts/vault/CapitalPreservationManager.sol` (204 lines)

#### Purpose
Implements the ERC-4626-compatible vault core with virtual assets, virtual shares, and a configurable decimals offset to materially reduce the economic viability of donation and rounding attacks.

#### DIBSVault.sol (Base Layer)
| Feature | Implementation |
|---|---|
| Decimals offset | 6 (virtual shares/assets offset) |
| Minimum shares out | `MIN_SHARES_OUT = 1e3` (prevents dust deposits) |
| Deposit cap | Configurable per-vault (zero = uncapped) |
| Emergency pause | `onlyEmergency` role, `paused` state flag |
| Seed liquidity | `seedVault()` — non-redeemable, share transfers blocked |
| Minimum seed deposit | `setMinimumSeedDeposit()` — configurable threshold |
| Timelocked governance | 48-hour queue for 7 parameter selectors |
| Capital Preservation Mode | Cross-vault JuniorRatio monitoring, automatic trigger/lift |

#### Timelocked Parameter Selectors (7)
1. `setDepositCap`
2. `setMinimumSeedDeposit`
3. `setMinSharesOut`
4. `assignEmergencyRole`
5. `setMinJuniorRatio`
6. `setPreservationMode`
7. `setReserveTarget`

#### Security Statement
> "Vaults use virtual assets, virtual shares, and a configurable decimals offset to materially reduce the economic viability of ERC-4626 donation and rounding attacks."

#### Prohibited Statements
> "Zero gas overhead" · "Fully neutralized" · "No inflation attack possible" · "Audited means safe" · "Immutable means risk-free"

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `DonationAttackTest.sol` | 4 | Foundry |
| `SeedLiquidityAndTimelockTest.sol` | 38 | Foundry |
| `CapitalPreservationModeTest.sol` | 22 | Foundry |
| `CapitalPreservationMode.test.ts` | 4 | Jest |
| **Total** | **68** | |

#### Dependencies
- Steps 1–3 (authentication, roles, events — backend integration)

---

### Step 15 — Reserve and Tranche Engine

**Status**: ✅ Complete
**Commits**: `111e6c7` → `712f539` (CPM integration)
**Files**: `contracts/vault/SentinelVault.sol`, `contracts/vault/CatalystVault.sol`, `contracts/vault/CapitalPreservationManager.sol`

#### Purpose
Implements the two-tranche structured-credit protocol. Sentinel (senior, first-loss protected) and Catalyst (junior, higher-yield) vaults operate with a cross-vault Junior Ratio that triggers Capital Preservation Mode when coverage falls below policy thresholds.

#### Tranche Architecture
| Vault | Position | Risk | Redemption | Yield |
|---|---|---|---|---|
| Sentinel | Senior tranche | First-loss protected | FIFO queue (CPM-gated) | Stable, lower |
| Catalyst | Junior tranche | Higher risk | Distribution suspended under CPM | Higher, variable |

#### Junior Ratio Formula
```
JuniorRatio = CatalystTotalAssets / (SentinelTotalAssets + CatalystTotalAssets)
```

#### Capital Preservation Mode (CPM)
| Trigger | Action |
|---|---|
| `JuniorRatio < MinJuniorRatio` | Enter CPM |
| CPM active | Sentinel withdrawals queued (FIFO), new Sentinel deposits blocked if dilutive |
| CPM active | Catalyst distributions suspended |
| CPM active | Yield routed to segregated reserve (reserve rebuild) |
| `JuniorRatio ≥ MinJuniorRatio` + liquidity test passed | Exit CPM, resume normal operations |

#### CapitalPreservationManager.sol
- Cross-vault coordinator monitoring JuniorRatio
- Automated preservation mode trigger and lift
- Reserve target enforcement and release gating
- State-transition events for all CPM state changes

#### Dependencies
- Step 14 (ERC-4626 vault core)
- Steps 1–3 (event logging for CPM state transitions)

---

### Step 16 — External Yield Routing

**Status**: ✅ Complete
**Commit**: `6611bf6`
**Files**: `contracts/routing/Adapters.sol` (2,189 lines)

#### Purpose
Implements external yield routing adapters for Morpho Blue and Pendle integrations, along with settlement, oracle, withdrawal queue, and yield diversion routers. All adapters operate under strict caps and concentration limits.

#### Adapters Implemented (6)

##### 1. MorphoAdapter
- Market registration, deposit/withdraw routing
- Position cap and concentration limit enforcement
- Market cap enforcement
- Liquidity haircut valuation
- Emergency unwind (per-market + global)
- Collateral management

##### 2. PendleAdapter
- PT/YT routing (buy/sell)
- Rate-stripping strategy
- Maturity-aware allocation weighting
- Stressed exit valuation (haircut + discount)
- Oracle freshness checks
- Emergency stressed exit

##### 3. SettlementAdapter
- Settlement instruction submission
- Partner confirmation, cancellation, expiry
- Reconciliation record creation
- Confirmation indexing

##### 4. OracleAdapter
- Multi-oracle registration
- Freshness checks, stale flagging
- 3 aggregation modes: median, weighted-average, minimum
- Oracle failure simulation

##### 5. WithdrawalQueueRouter
- Priority-ordered queue: small retail → large → LP
- Liquidity test gating
- Batch processing
- Queue state publishing

##### 6. YieldDiversionRouter
- Yield routing modes: normal, segregated reserve, locked recap, retained earnings
- Reserve rebuild constraints
- Reserve release gating (ratio + liquidity + rebuild complete)

#### External Interfaces
`IMorphoBlue`, `IPendleRouter`, `IOracle`, `ISettlementPartner`, `IDIBSVault`, `ISentinelVault`

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `RoutingAdaptersTest.sol` (Oracle) | 14 | Foundry |
| `RoutingAdaptersTest.sol` (Settlement) | 10 | Foundry |
| `RoutingAdaptersTest.sol` (Yield) | 9 | Foundry |
| **Total** | **33** | |

#### Dependencies
- Step 14 (vault core — adapters route vault assets)
- Step 15 (tranche engine — CPM interacts with yield routing)
- Step 7 (settlement adapter mirrors backend settlement service)

---

### Step 17 — Policy-Loan Subsystem

**Status**: ✅ Complete
**Commits**: `eed5c31` (contracts) → `b874274` (backend service)
**Files**: `contracts/policy-loan/PolicyLoanVault.sol` (567 lines), `contracts/policy-loan/ArbitrageRiskEngine.sol` (217 lines), `backend/adapters/policy-loan-service.ts` (791 lines)

#### Purpose
Implements the personal infinite-banking and policy-loan arbitrage subsystem. Tracks insurance-policy loan economics without assuming the role of an insurer. Provides arbitrage analysis between policy-loan cost and alternative investment yield.

#### PolicyLoanVault.sol
- Policy lifecycle: `created → active → repaid | liquidated`
- Loan-to-value tracking against policy cash value
- Interest accrual and payment recording
- Liquidation trigger when LTV exceeds policy threshold
- Non-custodial — does not hold the insurance policy itself

#### ArbitrageRiskEngine.sol
- Arbitrage spread computation: `spread = investmentYield - policyLoanRate`
- Risk threshold enforcement
- Liquidation risk assessment
- Break-even analysis

#### Policy-Loan Service (Backend)
- Full lifecycle management API
- Portfolio aggregation and reporting
- arbitrage opportunity identification
- Risk metric calculation

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `RiskFormulas.test.ts` | 9 | Jest |

#### Dependencies
- Steps 1–3 (authentication, roles, events)
- Step 14 (vault infrastructure — PolicyLoanVault inherits ERC-4626 patterns)

---

### Step 18 — Advanced Analytics

**Status**: ✅ Complete
**Commit**: `eed5c31` → `0a29b6b`
**Files**: `backend/reporting/analytics-engine.ts` (446 lines), `backend/reporting/analytics.routes.ts` (66 lines)

#### Purpose
Implements multi-category analytics engine covering 8 metric groups with real-time dashboard aggregation. Powers the frontend Tranche Analytics dashboard.

#### Metric Groups (8)
| Group | Metrics |
|---|---|
| Capital Flow | Total deployed, draw velocity, release rate, hold rate |
| Covenant Health | Compliance rate, breach count, cure period count, waiver count |
| Collateral Risk | Average LTV, lien count, insurance lapse count, appraisal staleness |
| Settlement Performance | Confirmation rate, average settlement time, variance count |
| Evidence Compliance | Submission rate, validation rate, flag count, expiry count |
| Tranche Health | Junior Ratio, Sentinel TVL, Catalyst TVL, CPM status |
| VRDCT Signals | Score distribution, signal volume, adverse action count |
| Policy-Loan Portfolio | Active loans, total borrowed, average LTV, arbitrage spread |

#### Implementation
- `AnalyticsEngine` class with metric computation and aggregation
- Real-time computation from event store and entity state
- Tenant-scoped queries with role-based access

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `AnalyticsEngine.test.ts` | 10 | Jest |

#### Dependencies
- Steps 1–13 (analytics aggregates data from all operational modules)

---

### Step 19 — Tokenization

**Status**: ✅ Complete (Sandbox)
**Commit**: `eed5c31`
**Files**: `contracts/restricted-token/RestrictedTokenSandbox.sol` (248 lines), `tests/unit/ApiMarketplace.test.ts` (140 lines)

#### Purpose
Implements a restricted-token sandbox for tokenized private credit and RWA (Real-World Asset) representation. The sandbox is gated behind 5 compliance prerequisites — tokenization features remain dormant until legal, custody, governance, security, and compliance requirements are formally satisfied.

#### Compliance Prerequisite Gates (5)
| Gate | Requirement |
|---|---|
| Legal | Legal opinion on tokenized security status |
| Custody | Qualified custodian identified and contracted |
| Governance | Transfer restriction rules defined and tested |
| Security | Smart-contract audit completed |
| Compliance | KYC/AML gateway, sanctions screening, accreditation verification |

#### Implementation
- `RestrictedTokenSandbox` contract with ERC-20 base
- Transfer restrictions: only between verified, non-blocked addresses
- Admin can pause transfers, freeze individual accounts
- All gates must be `true` before token functionality activates
- Sandbox state: `inactive` → `gates_satisfied` → `active`

#### Dependencies
- Step 14 (vault core — tokenization builds on ERC-20/ERC-4626 patterns)
- Steps 1–3 (event logging, tenant isolation)

---

### Step 20 — External API Marketplace

**Status**: ✅ Complete
**Commit**: `eed5c31`
**Files**: `backend/api/marketplace.ts` (381 lines)

#### Purpose
Implements an external API marketplace with API key management, tier-based rate limiting, and 15 permission scopes. Enables third-party integration partners to access DIBS platform data under controlled, audited access.

#### API Tiers
| Tier | Rate Limit | Scope Access |
|---|---|---|
| Growth | 100 req/min | Read-only: capital requests, evidence, covenants |
| Institutional | 1,000 req/min | Read + write: capital requests, evidence, settlement |
| Enterprise | 10,000 req/min | Full access: all scopes including analytics and reporting |

#### Permission Scopes (15)
```
read:capital_requests, write:capital_requests,
read:evidence, write:evidence,
read:covenants, write:covenants,
read:collateral, write:collateral,
read:settlement, write:settlement,
read:reconciliation, write:reconciliation,
read:analytics, read:reporting, read:vrdct
```

#### Implementation
- API key generation with tier assignment
- Rate limiting middleware (sliding window)
- Scope validation per endpoint
- Key rotation and revocation
- All API calls logged to event store

#### Test Coverage
| Suite | Tests | Framework |
|---|---|---|
| `ApiMarketplace.test.ts` | 9 | Jest |

#### Dependencies
- Steps 1–13 (marketplace exposes all prior module APIs)
- Steps 18 (analytics endpoints exposed to Enterprise tier)

---

## Dependency Graph

```
Step 1 (Auth)
  └─ Step 2 (Roles)
       └─ Step 3 (Events)
            └─ Step 4 (Capital Request)
                 ├─ Step 5 (Evidence Gating)
                 │    └─ Step 6 (Release Preconditions) ←── also depends on Steps 7,8,9,10
                 │
                 ├─ Step 7 (Settlement)
                 │    └─ Step 8 (Reconciliation)
                 │
                 ├─ Step 9 (Covenant Engine)
                 │    └─ Step 10 (Collateral Hold)
                 │         └─ Step 11 (Exception/Waiver) ←── also depends on Step 9
                 │
                 ├─ Step 12 (VRDCT) ←── depends on Steps 5,9,10 for signal sources
                 │
                 └─ Step 13 (Reporting) ←── aggregates Steps 1–12

Step 14 (ERC-4626 Vault) ←── depends on Steps 1–3 for backend integration
  └─ Step 15 (Tranche Engine / CPM)
       └─ Step 16 (Yield Routing) ←── depends on Steps 7,14,15
            └─ Step 17 (Policy-Loan) ←── depends on Step 14

Step 18 (Analytics) ←── aggregates Steps 1–17
Step 19 (Tokenization) ←── depends on Steps 14,1–3
Step 20 (API Marketplace) ←── exposes Steps 1–18
```

---

## Test Coverage Matrix

### Foundry (Solidity) — 97 Tests

| Test Suite | File | Tests | Steps Covered |
|---|---|---|---|
| Donation Attack | `tests/simulation/DonationAttackTest.sol` | 4 | 14 |
| Seed Liquidity + Timelock | `tests/simulation/SeedLiquidityAndTimelockTest.sol` | 38 | 14 |
| Capital Preservation Mode | `tests/simulation/CapitalPreservationModeTest.sol` | 22 | 14, 15 |
| Oracle Adapter | `tests/simulation/RoutingAdaptersTest.sol` | 14 | 16 |
| Settlement Adapter | `tests/simulation/RoutingAdaptersTest.sol` | 10 | 16 |
| Yield Diversion Router | `tests/simulation/RoutingAdaptersTest.sol` | 9 | 16 |
| **Total** | | **97** | |

### Jest (TypeScript) — 161 Tests

| Test Suite | File | Tests | Steps Covered |
|---|---|---|---|
| Release Preconditions | `tests/unit/ReleasePreconditions.test.ts` | 8 | 6 |
| Settlement Reconciliation | `tests/unit/SettlementReconciliation.test.ts` | 12 | 7, 8 |
| Covenant Engine | `tests/unit/CovenantEngine.test.ts` | 8 | 9 |
| Risk Formulas | `tests/unit/RiskFormulas.test.ts` | 9 | 17 |
| VRDCT Trust Signals | `tests/unit/VRDCTTrustSignals.test.ts` | 11 | 12 |
| Analytics Engine | `tests/unit/AnalyticsEngine.test.ts` | 10 | 18 |
| API Marketplace | `tests/unit/ApiMarketplace.test.ts` | 9 | 20 |
| Capital Preservation Mode | `tests/simulation/CapitalPreservationMode.test.ts` | 4 | 14, 15 |
| Evidence Ingestion | `tests/unit/EvidenceIngestion.test.ts` | 33 | 5 |
| Evidence Gating | `tests/unit/EvidenceGating.test.ts` | 34 | 5 |
| **Total** | | **161** | |

### Combined: 258 Tests · 16 Test Suites · 0 Failures

---

## File-to-Step Mapping

### Smart Contracts (`contracts/`)

| File | Lines | Primary Step(s) |
|---|---|---|
| `vault/DIBSVault.sol` | 647 | 14 |
| `vault/SentinelVault.sol` | 162 | 15 |
| `vault/CatalystVault.sol` | 207 | 15 |
| `vault/CapitalPreservationManager.sol` | 204 | 15 |
| `routing/Adapters.sol` | 2,189 | 16 |
| `policy-loan/PolicyLoanVault.sol` | 567 | 17 |
| `policy-loan/ArbitrageRiskEngine.sol` | 217 | 17 |
| `restricted-token/RestrictedTokenSandbox.sol` | 248 | 19 |
| `risk/RiskEngine.sol` | 101 | 14 |
| `registry/RegistryHub.sol` | 53 | 14 |
| `liquidation/LiquidationEngine.sol` | 33 | 14 |
| **Subtotal** | **4,628** | |

### Backend Services (`backend/`)

| File | Lines | Primary Step(s) |
|---|---|---|
| `api/index.ts` | 789 | 1, 2, 4 |
| `api/marketplace.ts` | 381 | 20 |
| `audit/event-store.ts` | 125 | 3 |
| `workflow/capital-request.ts` | 177 | 4 |
| `workflow/exception-waiver.ts` | 516 | 11 |
| `evidence/evidence-ingestion.ts` | 610 | 5 |
| `evidence/evidence-gating.ts` | 209 | 5 |
| `evidence/evidence.routes.ts` | 249 | 5 |
| `settlement/settlement-service.ts` | 282 | 7 |
| `settlement/settlement.routes.ts` | 134 | 7 |
| `settlement/reconciliation-engine.ts` | 275 | 8 |
| `covenant/covenant-engine.ts` | 156 | 9 |
| `covenant/collateral-hold.ts` | 414 | 10 |
| `covenant/collateral.routes.ts` | 184 | 10 |
| `adapters/vrdct-adapter.ts` | 326 | 12 |
| `adapters/policy-loan-service.ts` | 791 | 17 |
| `reporting/reporting-engine.ts` | 340 | 13 |
| `reporting/reporting.routes.ts` | 78 | 13 |
| `reporting/analytics-engine.ts` | 446 | 18 |
| `reporting/analytics.routes.ts` | 66 | 18 |
| **Subtotal** | **6,548** | |

### Frontend (`frontend/src/`)

| File | Lines | Step(s) Exposed |
|---|---|---|
| `App.tsx` | 33 | Routing (all) |
| `components/Layout.tsx` | 61 | Shell |
| `api/client.ts` | 114 | API layer (all) |
| `pages/OperatorConsole.tsx` | 93 | 1–20 (operator view) |
| `pages/LenderDashboard.tsx` | 44 | 4, 9, 13 |
| `pages/SponsorDashboard.tsx` | 41 | 4, 5 |
| `pages/BorrowerPortal.tsx` | 46 | 4, 5 |
| `pages/EvidenceUpload.tsx` | 64 | 5 |
| `pages/CovenantDashboard.tsx` | 53 | 9 |
| `pages/CollateralDashboard.tsx` | 53 | 10 |
| `pages/TrancheAnalytics.tsx` | 78 | 14, 15, 18 |
| `pages/PolicyLoanDashboard.tsx` | 79 | 17 |
| `pages/AuditViewer.tsx` | 62 | 3 |
| `pages/AdminPortal.tsx` | 109 | 1, 2, 14 |
| `index.css` | 69 | — |
| `main.tsx` | 25 | — |
| **Subtotal** | **1,024** | |

### Shared Libraries (`shared/`)

| File | Lines | Steps Served |
|---|---|---|
| `types/index.ts` | 195 | 1–20 (type definitions) |
| `events/index.ts` | 284 | 3 (event types) |
| `validation/index.ts` | 248 | 5, 6, 9, 11 |
| `schemas/index.ts` | 135 | 1–20 (Zod schemas) |
| `formulas/index.ts` | 150 | 14, 15, 17 (financial formulas) |
| `package.json` | — | — |
| **Subtotal** | **1,012** | |

### Test Suites (`tests/`)

| File | Lines | Framework | Step(s) Tested |
|---|---|---|---|
| `simulation/DonationAttackTest.sol` | 140 | Foundry | 14 |
| `simulation/SeedLiquidityAndTimelockTest.sol` | 476 | Foundry | 14 |
| `simulation/CapitalPreservationModeTest.sol` | 470 | Foundry | 14, 15 |
| `simulation/RoutingAdaptersTest.sol` | 410 | Foundry | 16 |
| `simulation/CapitalPreservationMode.test.ts` | 52 | Jest | 14, 15 |
| `unit/ReleasePreconditions.test.ts` | 151 | Jest | 6 |
| `unit/SettlementReconciliation.test.ts` | 251 | Jest | 7, 8 |
| `unit/CovenantEngine.test.ts` | 110 | Jest | 9 |
| `unit/VRDCTTrustSignals.test.ts` | 198 | Jest | 12 |
| `unit/RiskFormulas.test.ts` | 109 | Jest | 17 |
| `unit/AnalyticsEngine.test.ts` | 136 | Jest | 18 |
| `unit/ApiMarketplace.test.ts` | 140 | Jest | 20 |
| `unit/EvidenceIngestion.test.ts` | 654 | Jest | 5 |
| `unit/EvidenceGating.test.ts` | 770 | Jest | 5 |
| **Subtotal** | **4,067** | |

### Documentation

| File | Lines | Content |
|---|---|---|
| `DIBS-Trust-Capital-Network.md` | 1,937 | Master blueprint |
| `docs/DEPLOYMENT.md` | 476 | Production deployment guide |
| `docs/Capital-Preservation-Mode-Technical-Documentation.md` | ~700 | CPM architecture |
| `docs/blueprint-overview.md` | ~40 | Architecture summary |
| `CHANGELOG.md` | ~86 | Keep-a-Changelog format |
| `README.md` | ~214 | Project README |
| `CONTRIBUTING.md` | ~50 | Contribution guidelines |
| `.env.example` | ~60 | Environment template |
| **Subtotal** | **~4,361** | |

### CI/CD (`.github/workflows/`)

| File | Content | Trigger |
|---|---|---|
| `ci.yml` | Parallel jobs: Foundry tests, Jest tests, Vite build | Push to `main`, PR to `main` |
| `deploy.yml` | Deployment pipeline (requires secrets) | Manual dispatch |

---

## Commit-to-Step History

| Commit | Date | Steps Delivered |
|---|---|---|
| `996846f` | 2026-08-09 | Repository initialization |
| `a17719f` | 2026-08-09 | Blueprint, README, contributing guidelines |
| `111e6c7` | 2026-08-09 | Steps 1–17 (base contracts, backend, shared) |
| `b874274` | 2026-08-09 | Steps 5–17 (evidence, settlement, reconciliation, collateral, VRDCT, reporting, policy-loan) |
| `eed5c31` | 2026-08-09 | Steps 18–20 (analytics, tokenization, API marketplace) |
| `a7153a1` | 2026-08-09 | Foundry compilation fixes (OpenZeppelin, via_ir) |
| `a9c3745` | 2026-08-09 | TypeScript compilation fixes |
| `3ba24f9` | 2026-08-09 | Settlement reconciliation test fix |
| `0a29b6b` | 2026-08-09 | API wiring + frontend scaffolding (all steps exposed) |
| `8bad89d` | 2026-08-09 | Foundry/frontend test fixes |
| `712f539` | 2026-08-09 | Steps 14–15 (CPM + 22-test Foundry suite) |
| `88bb309` | 2026-08-09 | Step 14 (seed liquidity, timelock, 38-test suite) |
| `17f1617` | 2026-08-09 | Comprehensive README |
| `fb83704` | 2026-08-09 | Environment template + CPM technical docs |
| `d2f3e19` | 2026-08-09 | CI/CD workflows |
| `6611bf6` | 2026-08-09 | Step 16 (routing adapters, 33 Foundry tests) + evidence tests + deployment docs |
| `b51e7e8` | 2026-08-09 | Step 5 (EvidenceGating test suite, 34 Jest tests) |
