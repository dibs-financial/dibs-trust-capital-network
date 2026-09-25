# DIBS Trust Capital Network — Master Scaffold

**Status:** Architecture specification. Not a production-system claim, offering document, or regulatory filing.

**Product:** DIBS Capital Autopilot (Track A — controlled draws).

**Canonical companions:** `docs/architecture/DIBS-Core-Thesis-MVP.md`, `docs/architecture/DIBS-Domain-State-Event-Model.md`, `docs/architecture/DIBS-Complete-Scaffold.md` (2026.09.19). This file is a tightened operating scaffold, not a third competing spec.

**DIBS Trust Capital Network** is a controlled private-capital operating system. It governs deal intake, SPV lifecycle, controlled draws, evidence, covenants, approvals, settlement confirmation, reconciliation, reporting, and wind-down.

The immediate product is **DIBS Capital Autopilot**: a policy-enforced draw-control platform for private lenders, construction lenders, debt funds, real-estate sponsors, family offices, fund administrators, and repeat sponsors. DIBS must prove reliable controlled-draw operations before expanding into tokenization, policy-loan tools, or quantum optimization.

> **Core invariant:** No capital-state change without **policy**, **evidence**, **authorization**, **settlement confirmation**, **reconciliation**, and an **immutable audit event**.

> **Crystal legal line:** DIBS does not have possession, control, or authority over customer funds. DIBS approves and records. Regulated partners hold, settle, and transfer. DIBS does not issue credit, take deposits, or act as escrow.

## Platform Map

```text
H.E.R.I.&A. HOLDINGS LLC
└── Cornerstone Creative Capital LLC
    └── DIBS Financial Solutions LLC
        └── DIBS Trust Capital Network
            ├── DIBS Capital Autopilot          ← MVP / Sprints 0–6
            │   ├── Deal workspace
            │   ├── Draw controls
            │   ├── Evidence engine
            │   ├── Policy engine
            │   ├── Covenant monitoring
            │   ├── Approvals and waivers
            │   ├── Settlement tracking
            │   ├── Reconciliation
            │   └── Audit ledger
            ├── DIBS SPV Factory                ← partial MVP (link + readiness), not formation automation
            │   ├── Entity intake and blueprinting
            │   ├── Formation readiness
            │   ├── Governance and document controls
            │   ├── Investor and compliance workflows
            │   ├── Capitalization readiness
            │   ├── Asset operations
            │   └── Wind-down
            ├── Escrow Factory Integration      ← webhook/CSV contract in Sprint 4
            │   ├── Milestone events
            │   ├── Evidence status
            │   ├── Protected payment state
            │   └── Settlement confirmation
            ├── Deal Passport                   ← permissioned history only; network score PARKED
            ├── Trust Intelligence Adapter      ← PARKED as capital authority
            ├── Policy-Loan Decision Support    ← PARKED / not Sprints 0–6
            └── Quantum Optimization Lab        ← PARKED / offline / nonbinding
```

DIBS is the capital authority and portfolio-control layer; Escrow Factory is the transaction execution and milestone-proof layer; a regulated bank, custodian, escrow provider, or payment partner settles funds where applicable.

Adjacent modules may exist in the repository. They are not the first product. They must not become draw, approval, waiver, or settlement write paths in Sprints 0–6.

## Product Boundaries

| Component | Role | Must not do |
| :-- | :-- | :-- |
| `DIBS` | Controls policy, evidence, approvals, portfolio state, reconciliation, and audit | Directly custody or move funds in the MVP |
| `Escrow Factory` | Defines milestone proof and protected-payment workflow | Set lender policy or independently manage portfolio risk |
| `SPV Factory` | Creates and lifecycle-manages deal-specific entities | Replace counsel, filing authorities, banks, or tax advisers |
| `Deal Passport` | Stores permissioned verified operating history | Become a public credit score or automatic approval engine |
| `Trust Intelligence` | Prioritizes review through consented, explainable signals | Release capital, waive covenants, or make undisclosed adverse decisions |
| `Quantum Lab` | Generates offline, nonbinding optimization scenarios | Connect directly to settlement or production capital release |

DIBS is software for organizing and enforcing authorized workflows; it is not a bank, custodian, escrow agent, broker-dealer, investment adviser, insurer, legal adviser, tax adviser, or guarantor.

```text
DIBS is:
  The control plane and system of record for authorized private-capital workflows.

DIBS is not:
  A bank, lender, custodian, escrow agent, broker-dealer, adviser, or insurer.
  Quantum finance. Tokenization. Infinite banking. A guaranteed-yield product.
```

## Capital Autopilot

### Business Promise

```text
Capital cannot move until:
  required evidence is complete
  AND policy conditions pass
  AND required approvals are recorded
  AND no applicable hold exists
  AND settlement is confirmed
  AND the event is reconciled and audited
```

A draw becomes `APPROVED` only when the evidence manifest is complete and frozen, the amount fits budget and retainage, covenants are `CURRENT` or `WATCH` (or a dated in-scope waiver covers a breach), the approval matrix is satisfied, requester ≠ approver ≠ instructor, the payee account is verified, sanctions screening is fresh, and no hold is open.

### Controlled Draw Lifecycle

Happy path (HELD is not a required step):

```text
DRAFT
  → SUBMITTED
  → UNDER_REVIEW
  → APPROVED
  → SETTLEMENT_INSTRUCTED
  → SETTLEMENT_CONFIRMED
  → RECONCILED
  → CLOSED
```

Control and exit states:

```text
HELD
REQUIRES_INFORMATION
ESCALATED
REJECTED
CANCELLED
EXPIRED
```

`HELD` and `REQUIRES_INFORMATION` branch from `UNDER_REVIEW` or `APPROVED` (pre-instruction). They are not steps every draw must visit.

Transition guards:

```text
SUBMITTED
  locks locked_policy_version and locked_evidence_manifest_hash
  current policy applies only to new submissions

HELD | REQUIRES_INFORMATION → UNDER_REVIEW
  when missing evidence is supplied or a valid waiver is recorded

APPROVED → HELD
  if evidence expires, a covenant breaches, a hold is applied,
  or the locked manifest/policy binding breaks before instruction

APPROVED → SETTLEMENT_INSTRUCTED
  only TreasuryOwner (or designated instructor)
  instructor ≠ requester ≠ approver
  instruction binds amount_approved_minor, payee_bank_account_id,
  locked_policy_version, locked_evidence_manifest_hash, approval_binding_hash

SETTLEMENT_INSTRUCTED → ESCALATED | REJECTED
  on partner rejection, invalid confirmation, or timeout
  does not auto-return to APPROVED

SETTLEMENT_CONFIRMED → RECONCILED
  only after exact match on amount, currency, payee, date, and reference
  unmatched confirmation sets reconciliation_status = EXCEPTION
  unmatched transactions are never auto-reconciled
```

A failed rule must return a machine-readable reason code and a human-readable explanation. Every open hold must expose `hold_reason_code` and `hold_reason_text` so the reason is discoverable in under one minute.

### End-to-End Workflow

```text
1. Create organization and tenant
2. Configure users, roles, policies, and approval matrix
3. Create counterparties, verified payee accounts, deal, SPV, budget, retainage, change orders, collateral, milestones, and covenants
4. Submit draw request
5. Collect required evidence and freeze the evidence manifest
6. Evaluate policy, budget, retainage, collateral, covenant, payee, and compliance conditions against the locked policy version
7. Route required approval tasks
8. Approve, hold, reject, or apply a time-limited waiver
9. Create settlement instruction for the authorized partner
10. Receive signed settlement confirmation (CSV first; signed webhook after pilot)
11. Reconcile approved and confirmed records
12. Update portfolio state and immutable audit ledger
13. Produce exception, risk, servicing, and reporting outputs
14. Close deal or wind down SPV when applicable
```

## Roles and Segregation

| Role | Primary responsibility | Prohibited action |
| :-- | :-- | :-- |
| `PlatformAdmin` | Tenant and user administration | Bypass policy or self-approve |
| `LenderAdmin` | Deal and portfolio configuration | Break segregation of duties |
| `Underwriter` | Terms, collateral, covenants | Release capital |
| `PortfolioManager` | Portfolio monitoring and exceptions | Approve own material request |
| `RiskOwner` | Risk limits and exception review | Self-approve exception |
| `TreasuryOwner` | Liquidity and settlement readiness; write settlement instructions | Create unlogged override; instruct a draw they requested or approved |
| `OperationsOwner` | Draw workflow and evidence operations | Unilaterally waive controls |
| `BorrowerSponsor` | Draw submissions and project evidence | Approve or settle draws |
| `Inspector` | Inspection and milestone evidence | Modify policy |
| `ComplianceReviewer` | KYC/AML, sanctions, jurisdiction review | Override a compliance hold without authority |
| `FundAdministrator` | Entity, investor, reporting, reconciliation support | Access data outside authorized scope |
| `EscrowPartner` | Milestone and settlement confirmation | Modify DIBS policy |
| `Auditor` | Read-only audit review | Change operational records |
| `SuperAgent` | Summaries, task routing, exception detection | Approve, release, waive, or change policy |

Hard segregation-of-duties rule:

```text
requester ≠ approver ≠ settlement instructor
```

Every material draw path enforces that split. PlatformAdmin cannot bypass policy or self-approve. Service accounts cannot approve. No role may approve its own material request.

Every request must be authorized by tenant, role, object scope, conflict-of-interest rules, and the currently active policy version. Tenant identity comes from the authenticated session, never from a client-supplied header.

## Deal and Data Model

```text
Organization
User
Role
Permission
Counterparty
PayeeBankAccount
Deal
SPV
Asset
LoanOrFacility
Collateral
Covenant
Milestone
DrawBudgetLine
ChangeOrder
DrawRequest
EvidenceDocument
EvidenceRequirement
EvidenceManifest
PolicyEvaluation
ApprovalPolicy
ApprovalDecision
Exception
ExceptionWaiver
Hold
SettlementInstruction
SettlementConfirmation
ReconciliationRecord
AuditEvent
Notification
IntegrationConnection
WebhookEvent
DealPassport
```

Money rule: every amount field is integer minor units plus an ISO-4217 `currency`. Do not store money as floating point.

Timestamps are UTC.

### Entity Relationships

```text
Organization
├── Users
├── Counterparties
│   └── PayeeBankAccounts
├── Deals
│   ├── SPV
│   ├── Assets
│   ├── LoanOrFacility
│   ├── Collateral
│   ├── Covenants
│   ├── Milestones
│   ├── DrawBudgetLines
│   ├── ChangeOrders
│   ├── DrawRequests
│   │   ├── EvidenceDocuments
│   │   ├── EvidenceManifest
│   │   ├── PolicyEvaluations
│   │   ├── ApprovalDecisions
│   │   ├── Holds
│   │   ├── SettlementInstructions
│   │   └── ReconciliationRecords
│   └── AuditEvents
└── IntegrationConnections
    └── WebhookEvents
```

### `DrawRequest`

```text
id
tenant_id
deal_id
spv_id
series_id                          # nullable; required when the SPV uses series isolation
request_number
status
requested_by_user_id
payee_counterparty_id
payee_bank_account_id
amount_requested_minor
amount_approved_minor              # set at APPROVED; must be ≤ amount_requested_minor
currency                           # ISO-4217
budget_line_ids                    # one or more
requested_at
submitted_at
locked_policy_version              # set at SUBMITTED; immutable for this draw
locked_evidence_manifest_hash      # set at SUBMITTED; immutable unless material change forces re-eval
approval_binding_hash              # set at APPROVED; snapshot of amount, payee, manifest, policy, budget
policy_evaluation_id
policy_evaluation_status
evidence_status
approval_status
settlement_status
reconciliation_status              # MATCHED | EXCEPTION | PENDING
hold_reason_code
hold_reason_text
idempotency_key
created_at
updated_at
```

`locked_policy_version` and `locked_evidence_manifest_hash` are set at `SUBMITTED`. Current policy applies to new submissions, not in-flight draws. Material evidence changes after approval must trigger re-evaluation and, where required, new approval. They must not silently mutate a locked manifest.

### `EvidenceDocument`

```text
id
tenant_id
deal_id
spv_id
draw_request_id
milestone_id
document_type
storage_uri
content_hash
version
uploaded_by_user_id
uploaded_at
verified_at
verification_status
source_system
retention_classification
```

### `Covenant`

```text
id
tenant_id
deal_id
spv_id
type
status
threshold
operator
measurement_value
measurement_date
measurement_source
severity
breach_detected_at
cure_deadline
policy_version
created_at
updated_at
```

### `AuditEvent`

```text
id
tenant_id
aggregate_type
aggregate_id
event_type
event_version
occurred_at
actor_type
actor_id
policy_version
request_id
correlation_id
idempotency_key
previous_event_hash
event_hash
payload_hash
evidence_manifest_hash
signature_algorithm
signature_key_id
signature
```

## Policy and Evidence Engine

### Initial Policy Set

```text
Maximum draw amount
Available budget amount
Retainage applied
Change-order coverage
Minimum reserve
Maximum LTV
Required inspection
Required invoice and evidence set
Tranche order
Draw-window date
Maturity restriction
Payee allowlist
Verified payee bank account
Duplicate-request prevention
Approval threshold by amount
Approval threshold by exception type
Requester ≠ approver ≠ instructor
No active compliance hold
No active operational hold
No expired evidence
No expired approval
Sanctions screening freshness
Locked policy version still bound
Locked evidence manifest still bound
```

### Policy Results

```text
PASS
HOLD
FAIL
REVIEW_REQUIRED
```

### Evidence Requirements

```text
Invoice
Inspection report
Milestone attestation
Lien waiver
Borrower attestation
Budget support
Change-order support
Collateral update
Insurance evidence
Executed contract
Title or legal evidence
KYC/AML status
Sanctions-screening result
Verified payee-account support
Settlement-instruction support
```

Every document must be hashed, versioned, attributed, time-stamped, retained according to policy, and linked to its deal, SPV, milestone, draw, and policy evaluation. Evidence bytes are never deleted in place; supersession creates a new version and a new audit event.

## Collateral and Covenants

### Covenant Library

```text
Maximum LTV
Minimum reserve
Debt-service coverage
Budget variance
Funding concentration
Collateral valuation freshness
Inspection completion
Maturity threshold
Remaining-funds threshold
Document completeness
Insurance status
Lien status
Construction-progress threshold
```

### Covenant States

```text
CURRENT
  → WATCH
  → BREACHED
  → CURE_PERIOD
  → WAIVED
  → EXPIRED
  → CLOSED
```

### Core Control Rules

For period $\tau$:

$$
\text{ClosingCash}_{\tau}
=
\text{OpeningCash}_{\tau}
+
\text{CommittedInflows}_{\tau}
+
\text{ApprovedFacilityDraws}_{\tau}
-
\text{ScheduledOutflows}_{\tau}
-
\text{RequiredReserves}_{\tau}
$$

$$
\text{ClosingCash}_{\tau}
\geq
\text{MinimumLiquidityReserve}_{\tau}
$$

`ApprovedFacilityDraws` counts only `SETTLEMENT_CONFIRMED` amounts. Instructed-but-unconfirmed draws stay on the instruction register and do not satisfy the reserve test.

For SPV $s$:

$$
\text{LTV}_{s}
=
\frac{\text{OutstandingDebt}_{s}}
{\text{EligibleCollateralValue}_{s}}
$$

$$
\text{LTV}_{s}
\leq
\text{PolicyLTVLimit}_{s}
$$

A covenant breach creates an exception, routes an alert, applies a draw hold if policy requires it, and creates an immutable audit event.

## Approvals and Waivers

### Approval Requirements

```text
Role-based
Object-level
Amount-based
Deal-specific
SPV-specific
Covenant-specific
Exception-specific
Time-bound
Conflict-checked
Policy-version-bound
Evidence-manifest-bound
Requester ≠ approver ≠ instructor
```

### Waiver Record

```text
Waiver ID
Applicable deal
Applicable SPV
Applicable draw or covenant
Reason and rationale
Requester
Required approver roles
Start date
Expiration date
Maximum permitted exposure
Compensating controls
Policy version
Revocation authority
Related audit events
```

A waiver is a new authorization record. It must not overwrite, erase, or silently correct the original failure or exception. An expired waiver re-holds or returns the draw to `UNDER_REVIEW`.

## Settlement and Reconciliation

```text
DIBS approves and records an instruction.
Authorized settlement partner executes or confirms settlement.
DIBS records the confirmation.
DIBS reconciles the approved and confirmed records.
```

Required matching fields:

```text
Approved amount
Confirmed amount
Currency
Payee
Payee bank account
Settlement date
Settlement reference
Deal ID
SPV ID
Draw request ID
External partner ID
```

DIBS must detect amount, currency, payee, date, duplicate-reference, missing-confirmation, and unapproved-settlement mismatches. Unmatched transactions require exception handling and must never be automatically reconciled.

`reconciliation_status`:

```text
PENDING
MATCHED
EXCEPTION
```

An `EXCEPTION` keeps the draw at `SETTLEMENT_CONFIRMED` or moves it to `ESCALATED`. It does not invent a second DrawRequest happy-path state.

Pilot confirmation path is dual-entry CSV. Signed webhooks come after the CSV path is proven.

## Audit Ledger

Every financial or control-relevant change writes a new append-only event.

```text
Deal creation or change
SPV lifecycle transition
Collateral update
Covenant measurement
Draw request creation
Evidence upload or verification
Evidence manifest lock
Policy evaluation
Approval, rejection, or hold
Exception creation or resolution
Waiver approval, expiration, or revocation
Settlement instruction
Settlement confirmation
Reconciliation result
Webhook event
Privilege escalation
```

Parked event types (may exist in the schema; not MVP write paths):

```text
Crypto-policy change
Quantum experiment transition
```

Historical records are never overwritten. Correction, rollback, suspension, revocation, or reversal actions must reference prior events and create new events. The audit table forbids `UPDATE` and `DELETE` of event rows.

## Escrow Factory Integration

### Responsibility Split

```text
DIBS:
  Capital policy
  Draw authorization
  Covenant monitoring
  Portfolio reporting
  Reconciliation
  Audit history

Escrow Factory:
  Milestone language
  Required proof
  Protected-payment status
  Transaction-level release workflow
  Milestone state

Authorized partner:
  Custody
  Bank settlement
  Escrow services
  Payment execution
```

### Integration Contract

```text
shared_deal_id
shared_spv_id
shared_milestone_id
shared_draw_request_id
event_id
event_version
occurred_at
event_type
signature
signature_key_id
idempotency_key
```

Inbound webhook flow:

```text
Receive event
  → Verify signature
  → Validate timestamp and replay window
  → Reject duplicate event ID
  → Persist raw event
  → Queue processing
  → Apply transactionally
  → Write audit event
  → Update DIBS state
  → Run snapshot reconciliation
  → Alert on failure or mismatch
```

DIBS must tolerate duplicate, delayed, out-of-order, malformed, and replayed events. If DIBS and a partner disagree, DIBS holds the draw and records an exception. It does not silently prefer either side. It never pushes a release button at a payment provider.

## DIBS SPV Factory

### Lifecycle

```text
INTAKE
  → BLUEPRINTED
  → FORMATION_IN_PROGRESS
  → FORMED
  → EIN_PENDING
  → EIN_READY
  → BANKING_PENDING
  → BANKING_READY
  → GOVERNANCE_READY
  → DOCUMENTS_READY
  → COMPLIANCE_REVIEW
  → FUNDING_READY
  → ACTIVE
  → WIND_DOWN_IN_PROGRESS
  → CLOSED
```

MVP uses the SPV as a deal-linked entity with readiness gates. Full formation automation is parked.

### Functional Modules

```text
Entity intake
Entity blueprint templates
Jurisdiction and entity-type configuration
Formation tracking
EIN tracking
Banking-readiness tracking
Governance and authority records
Operating agreement and formation documents
Investor eligibility workflow
KYC/AML and sanctions integration
Capitalization readiness
Series-isolation ledger
Asset onboarding
Valuation records
Servicing and cash-flow ingestion
Investor reporting
Distribution records
Disposition workflow
Wind-down workflow
```

### Readiness Gate

```text
Formation valid
AND required legal documents complete
AND governance authority recorded
AND compliance conditions satisfied
AND banking or escrow relationship configured where needed
AND funding policy configured
AND series records isolated
AND readiness evidence recorded
```

Every formation, document, investor, EIN, compliance, governance, and readiness mutation must create an immutable audit event.

## Deal Passport and Trust Intelligence

Parked for Sprints 0–6. May enrich review later. Cannot become capital authority.

### Deal Passport

```text
Verified sponsor identity
Verified entity history
Evidence timeliness
Draw-cycle performance
Milestone performance
Covenant compliance
Exception and waiver history
Settlement quality
Reconciliation quality
Authorized historical deal records
```

### Trust Intelligence Rules

Permitted:

```text
Review prioritization
Sponsor operational tiers
Evidence-timeliness analysis
Exception routing
Counterparty follow-up
Operational performance reporting
```

Prohibited:

```text
Automatic release
Automatic waiver
Opaque adverse scoring
Unconsented signal use
Independent credit or investment decision
Replacement of compliance or human review
```

## Policy-Loan Decision Support

Parked. Not in Sprints 0–6.

The policy-loan module is a recordkeeping and scenario-analysis subsystem. It is not an automatic borrowing engine and must not make or imply guaranteed arbitrage, policy performance, tax outcomes, or insurance outcomes.

```text
Policy owner
  → Carrier policy loan
  → Policy-loan record
  → DIBS cost and liquidity analysis
  → Approved loan or capital contribution to SPV
  → Asset or deal operations
  → Distribution records
  → Repayment analysis
```

Required fields:

```text
Policy owner
Carrier
Policy identifier
Cash value
Loan balance
Loan rate
Loan type
Recognition type
Dividend assumption
Loan date
Repayment terms
SPV contribution
Distribution attribution
Collateral and LTV relationship
```

Carrier-specific terms, direct versus non-direct recognition, dividends, rates, repayment rules, tax effects, and lapse risk require carrier documentation and qualified insurance, tax, and legal review.

## Super Agents

Super Agents are supervised workflow assistants.

Allowed:

```text
Identify missing or stale evidence
Draft draw summaries
Draft exception summaries
Generate daily exception reports
Open tasks
Route tasks
Flag settlement mismatches
Escalate overdue reviews
Generate review packets
```

Prohibited:

```text
Approve a draw
Release capital
Waive a covenant
Modify policy
Alter audit data
Submit settlement instructions
Change privileges
Override compliance results
Make lending or investment decisions
```

The automation sequence is: prove the workflow, prove the controls, then automate controlled administrative work.

## Security and Post-Quantum Plan

### Baseline Controls (MVP)

```text
OIDC authentication
MFA for privileged roles
Tenant isolation
RBAC
Object-level authorization
Separation of duties
Approval conflict checks
Time-bound elevation
Encryption in transit and at rest
KMS-backed keys
Secret rotation
Structured security logging
Incident response runbooks
```

### Hybrid Cryptography

Parked as a draw dependency. Use supported, vendor-maintained implementations when adopted:

```text
TLS 1.3
+ X25519
+ ML-KEM-768
+ HKDF key schedule
+ AES-256-GCM record protection
```

For high-value audit events (post-MVP):

```text
Canonical payload
  → payload hash
  → enterprise signature
  + ML-DSA-65 signature
  → immutable audit record
```

Never log private keys, shared secrets, KEM ciphertexts, traffic secrets, session tickets, access tokens, raw application payloads, or customer PII in TLS telemetry.

`ML-KEM` establishes key material; it does not replace TLS record protection, signatures, identity verification, or authorization.

## Quantum Optimization Lab

The Quantum Optimization Lab is offline, nonbinding, read-only, isolated from production settlement, and parked from Sprints 0–6.

```text
De-identified scenario
  → Data freeze
  → Classical baseline
  → QUBO compiler
  → QAOA simulator or approved research run
  → Independent validator
  → Human review
  → Versioned policy simulation
  → Limited pilot, if approved
```

### Valid Uses

```text
Portfolio allocation
SPV allocation
Draw scheduling
Reserve sizing
Liquidity planning
Concentration balancing
Stress testing
Operational sequencing
```

### Hard Constraints

```text
Legal eligibility
KYC/AML and sanctions status
Executed-document status
Settlement availability
Maximum LTV
Minimum reserve
Liquidity capacity
Tranche precedence
Assignment cardinality
Maximum exposure
```

The independent validator must use the original, full-precision scenario data and reject candidates that fail legal, compliance, budget, reserve, liquidity, collateral, concentration, or tranche-order checks.

No QAOA output can directly create a draw, modify policy, waive a covenant, approve a transaction, or create a settlement instruction.

## Technology Stack

```text
Frontend:
  Next.js
  TypeScript

API:
  TypeScript
  NestJS or Fastify

Database:
  PostgreSQL
  Strict tenant isolation
  Append-only audit-event schema
  Money as integer minor units

Storage:
  S3-compatible versioned object storage
  Document hashes

Jobs:
  Temporal or durable queue

Auth:
  Enterprise OIDC
  MFA
  RBAC
  Object-level authorization
  Tenant from session

Infrastructure:
  Managed cloud services
  Infrastructure as code
  KMS-backed secret storage
  Centralized observability

Integrations:
  CSV and manual proof first
  Signed APIs and webhooks after pilot validation
```

## Repository Scaffold

```text
dibs-trust-capital-network/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── .env.example
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── apps/
│   ├── web/
│   ├── api/
│   ├── worker/
│   └── admin/
├── packages/
│   ├── domain/
│   │   ├── organizations/
│   │   ├── counterparties/
│   │   ├── deals/
│   │   ├── draws/
│   │   ├── evidence/
│   │   ├── policies/
│   │   ├── covenants/
│   │   ├── approvals/
│   │   ├── exceptions/
│   │   ├── settlements/
│   │   ├── reconciliation/
│   │   ├── audit/
│   │   ├── deal-passport/          # PARKED
│   │   └── spv-factory/
│   ├── database/
│   ├── auth/
│   ├── integrations/
│   │   ├── escrow-factory/
│   │   ├── banking/
│   │   ├── custody/
│   │   ├── kyc-aml/
│   │   ├── accounting/
│   │   └── notifications/
│   ├── pqc/                        # PARKED / not a draw dependency
│   │   ├── crypto-policy/
│   │   ├── tls-audit/
│   │   ├── signature-envelope/
│   │   └── key-rotation/
│   └── quantum-lab/                # PARKED / offline only
│       ├── classical/
│       ├── qubo/
│       ├── qaoa/
│       ├── validators/
│       └── experiments/
├── contracts/                      # PARKED / not Sprints 0–6
│   ├── src/
│   ├── test/
│   └── script/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── policies/
│   ├── spv-factory/
│   ├── escrow-factory/
│   ├── operations/
│   ├── compliance/
│   ├── security/
│   ├── pqc/
│   ├── quantum-lab/
│   └── dibs_arbitrage_model.md
├── infra/
│   ├── terraform/
│   ├── kubernetes/
│   ├── docker/
│   └── monitoring/
├── migrations/
├── scripts/
├── tests/
│   ├── integration/
│   ├── e2e/
│   ├── policy/
│   ├── security/
│   └── fixtures/
└── .github/
    └── workflows/
```

Do not open Sprint 0–6 work on `contracts/vault/*`, `packages/quantum-lab/*`, policy-loan adapters, or an API marketplace.

## API Scaffold

```text
/v1/organizations
/v1/users
/v1/counterparties
/v1/payee-bank-accounts
/v1/deals
/v1/spvs
/v1/assets
/v1/collateral
/v1/covenants
/v1/milestones
/v1/draw-budget-lines
/v1/change-orders
/v1/draw-requests
/v1/evidence-documents
/v1/evidence-manifests
/v1/policy-evaluations
/v1/approval-decisions
/v1/holds
/v1/exceptions
/v1/waivers
/v1/settlement-instructions
/v1/settlement-confirmations
/v1/reconciliation-records
/v1/audit-events
/v1/deal-passports
/v1/integrations/escrow-factory/webhooks
/v1/quantum-lab/experiments          # PARKED
```

Require `Idempotency-Key` for every endpoint that creates or changes financial, approval, settlement, waiver, or integration state.

## Delivery Plan

### Sprint 0 — Foundation

```text
Scope freeze
Domain model
Tenant model
Role model
Policy schema
Audit-event schema (ban UPDATE/DELETE)
Threat model
Repository
CI/CD
Local development environment
Money = integer minor units
```

### Sprint 1 — Core Platform

```text
Authentication
Tenant isolation
RBAC and conflict checks
Counterparties
Verified payee bank accounts
Deals
SPVs
Audit ledger
Document storage
Application shell
```

### Sprint 2 — Controlled Draws

```text
Draw requests
Budget lines
Retainage
Evidence upload
Evidence checklist and frozen manifest
State machine
Policy evaluation against locked policy version
Approval queue
Hold and rejection reasons
```

### Sprint 3 — Covenants

```text
Collateral register
Covenant library
Measurements
LTV and reserve rules
Exceptions
Waivers
Notifications
Approval binding on APPROVED
```

### Sprint 4 — Settlement Integration

```text
Settlement instructions (TreasuryOwner only)
Settlement confirmations
CSV confirmation first
Escrow Factory webhooks after CSV is proven
Signature validation
Replay protection
Idempotency
Reconciliation
EXCEPTION on mismatch
Portfolio dashboard
```

### Sprint 5 — Hardening

```text
Authorization tests
Policy regression tests
Webhook replay tests
Audit-chain validation
Security scanning
Migration tests
Operational runbooks
Pilot reports
```

### Sprint 6 — Pilot

```text
One to three active deals
Configured policies
Configured approvals
Operational users
Manual or CSV settlement confirmation
Daily reconciliation
Measured pilot metrics
Customer review
Renewal plan
```

Definition of done: one lender runs a deal `DRAFT → RECONCILED` with evidence, policy, two-person approval, CSV confirmation, recon match, and a verifiable audit chain — and cannot complete the same path by editing a spreadsheet.

## Pilot Metrics

```text
Three paying lender or fund customers
At least 90% of standard draws decided without spreadsheet/email reconciliation
100% of approved draws have complete policy, evidence, approval, settlement, reconciliation, and audit records
Zero unauthorized DIBS-mediated releases
Zero DIBS-mediated sends to an unverified payee
Improved draw-decision time against baseline
Hold reason discoverable in under one minute
Zero unresolved critical security findings
Zero unresolved reconciliation defects at reporting cutoff
At least one annual renewal commitment
```

The initial hiring priority is a technical co-founder or lead full-stack fintech engineer who can ship the workflow, ledger, permissions, integrations, and audit system. Do not make a generic blockchain developer the first product hire.

## Revenue Model

```text
Enterprise SaaS subscription
Implementation and configuration fees
Per-deal or per-SPV administration fees
Controlled-capital-volume fees
Covenant-monitoring premium module
Audit and reporting premium module
Partner API and white-label fees
Future regulated-service economics after validation
```

The controlled-capital platform is the core recurring-revenue business. A policy-loan decision product can remain a separate track sharing selected infrastructure, but it must not distract from the controlled-draw MVP.

## Deferred Scope

```text
Direct custody
Payment processing
Autonomous draw releases
Autonomous underwriting
Autonomous covenant waivers
Public token issuance
Unrestricted transfers
Secondary trading
DeFi yield deployment
Mainnet capital deployment
QOF/QOZ compliance guarantees
Insurance issuance
Guaranteed policy-loan arbitrage
Quantum-driven production decisions
ERC-4626 vaults and tranche engines
Full SPV formation automation
Deal Passport as a network score
PQC as a draw-path dependency
```

Each deferred capability requires documented legal, compliance, security, operations, partner, and customer-demand validation before implementation.
