# DIBS Trust Capital Network — Complete Scaffold

**Status:** Architecture specification. Not a production-system claim, offering document, or regulatory filing.  
**Updated:** 2026-09-19  
**Repo:** [`dibs-financial/dibs-trust-capital-network`](https://github.com/dibs-financial/dibs-trust-capital-network)

Companion identity/thesis document: [`/DIBS-Trust-Capital-Network.md`](../../DIBS-Trust-Capital-Network.md)

## Contents

- [1. Organizational Structure](#1-organizational-structure)
- [2. Product Definition](#2-product-definition)
- [3. Problem Statement](#3-problem-statement)
- [4. Core Operating Principles](#4-core-operating-principles)
- [5. User and Role Model](#5-user-and-role-model)
- [6. Controlled Draw State Machine](#6-controlled-draw-state-machine)
- [7. End-to-End Workflow](#7-end-to-end-workflow)
- [8. Data Model](#8-data-model)
- [9. Policy Engine](#9-policy-engine)
- [10. Evidence and Milestone Control](#10-evidence-and-milestone-control)
- [11. Collateral and Covenant Controls](#11-collateral-and-covenant-controls)
- [12. Approvals, Exceptions, and Waivers](#12-approvals-exceptions-and-waivers)
- [13. Settlement and Reconciliation](#13-settlement-and-reconciliation)
- [14. Audit Ledger](#14-audit-ledger)
- [15. Escrow Factory Integration](#15-escrow-factory-integration)
- [16. SPV Factory](#16-spv-factory)
- [17. Compliance and Investor Controls](#17-compliance-and-investor-controls)
- [18. Policy-Loan Decision Layer](#18-policy-loan-decision-layer)
- [19. Trust Intelligence Adapter](#19-trust-intelligence-adapter)
- [20. Super Agents](#20-super-agents)
- [21. Security Architecture](#21-security-architecture)
- [22. Post-Quantum Security](#22-post-quantum-security)
- [23. Quantum Optimization Lab](#23-quantum-optimization-lab)
- [24. Technology Architecture](#24-technology-architecture)
- [25. Repository Structure](#25-repository-structure)
- [26. API Scaffold](#26-api-scaffold)
- [27. MVP Build Order](#27-mvp-build-order)
- [28. Pilot Success Criteria](#28-pilot-success-criteria)
- [29. Revenue Model](#29-revenue-model)
- [30. Deferred Capabilities](#30-deferred-capabilities)
- [31. Compliance and Product Notice](#31-compliance-and-product-notice)

---

**DIBS Trust Capital Network** is a controlled private-capital operating system. It governs a deal from intake and SPV formation through controlled funding, evidence verification, covenant monitoring, settlement confirmation, reconciliation, reporting, and wind-down.

The core product is not quantum finance, tokenization, or infinite banking. The first commercial product is **DIBS Capital Autopilot**: a policy-enforced controlled-draw system for private lenders, construction lenders, bridge lenders, debt funds, real-estate sponsors, family offices, and fund administrators.

> **Core invariant:** No capital-state change without **policy**, **evidence**, **authorization**, **settlement confirmation**, **reconciliation**, and an **immutable audit event**.

***

## 1. Organizational Structure

Planned operating structure:

```text
H.E.R.I.&A. HOLDINGS LLC
└── Cornerstone Creative Capital LLC
    └── DIBS Financial Solutions LLC
        ├── DIBS Trust Capital Network
        ├── DIBS Capital Autopilot
        ├── DIBS SPV Factory
        ├── Escrow Factory Integration Layer
        ├── Deal Passport
        ├── Covenant and Collateral Control Layer
        ├── Audit and Compliance Ledger
        ├── Trust Intelligence Adapter
        ├── Policy-Loan Decision Layer
        └── Quantum Optimization Lab
```

**DIBS Financial Solutions LLC** is the planned operating entity for the software and private-capital infrastructure. DIBS is a control layer and record system. Regulated institutions, escrow providers, custodians, banks, insurers, attorneys, tax advisers, and filing authorities remain responsible for the regulated functions they perform.

**MVP surface:** Trust Capital Network, Capital Autopilot, SPV Factory, Escrow Factory integration, Deal Passport, covenant and collateral controls, and the audit ledger. Policy-Loan, Trust Intelligence, and the Quantum Optimization Lab are adjacent, non-MVP modules and have no settlement authority.

***

## 2. Product Definition

### 2.1 DIBS Trust Capital Network

DIBS is the parent architecture that links parties, deals, SPVs, capital controls, evidence, governance, compliance, settlement status, and immutable audit records.

```text
DIBS Trust Capital Network
├── Capital authority and policy controls
├── Deal administration
├── SPV lifecycle management
├── Controlled draw workflows
├── Evidence and milestone verification
├── Collateral and covenant monitoring
├── Approval, exception, and waiver management
├── Settlement-status tracking
├── Reconciliation
├── Immutable audit and compliance records
├── Sponsor and counterparty operational history
└── Future optimization decision support
```

### 2.2 DIBS Capital Autopilot

`DIBS Capital Autopilot` is the first product to build.

```text
Business promise:
Capital cannot move until required evidence,
approvals, budget conditions, collateral conditions,
and covenant rules are satisfied.
```

### 2.3 DIBS SPV Factory

`DIBS SPV Factory` is the transaction-vehicle lifecycle subsystem.

```text
SPV Intake
  → Entity blueprint
  → Formation workflow
  → EIN and banking readiness
  → Governance and documents
  → Compliance readiness
  → Investor and capitalization workflow
  → Asset operations
  → Reporting
  → Wind-down
```

An SPV is an isolated legal, accounting, collateral, compliance, investor, and distribution boundary.

### 2.4 Escrow Factory

```text
DIBS:
Approves and governs the capital decision.
Owns the integration contract and audit record.

Escrow Factory:
Coordinates protected payment conditions,
milestone evidence, and permitted release execution.

Bank, custodian, or regulated payment partner:
Holds, settles, or transfers funds where applicable.
```

DIBS does not directly release escrow funds. A regulated partner executes hold and release. DIBS consumes verified milestone and settlement events, applies capital policy, and maintains the portfolio and audit record.

Escrow Factory is the source of truth for milestone wording, proof requirements, and protected-payment conditions. DIBS is the source of truth for portfolio-level capital policy. If the two disagree, DIBS holds the draw and records an exception; it does not silently prefer either side.

### 2.5 Deal Passport

```text
Deal Passport
├── Sponsor identity
├── Verified entities
├── Prior draw-cycle performance
├── Evidence submission performance
├── Milestone delivery performance
├── Covenant compliance history
├── Exception and waiver history
├── Settlement and reconciliation quality
└── Authorized historical deal records
```

Deal Passport is permissioned operational history. It is not a public credit score and must not autonomously determine eligibility, pricing, underwriting, or capital release.

***

## 3. Problem Statement

Private-capital operations often rely on disconnected spreadsheets, emails, PDF folders, phone calls, manual document collection, inconsistent approval records, and delayed reconciliation.

| Failure | Consequence | DIBS control |
|---|---|---|
| Premature draw release | Capital moves before conditions are met | Policy, evidence, and approval gates |
| Missing evidence | Lender cannot prove why capital moved | Evidence requirements, hashes, and audit trail |
| Late covenant review | LTV, reserve, or budget breach worsens | Continuous measurement and hold rules |
| Spreadsheet conflict | Parties rely on inconsistent records | Shared deal state and immutable ledger |
| Silent override | Exception becomes untraceable risk | Explicit, attributable, time-limited waiver |
| Settlement mismatch | Approved and paid amounts differ | Reconciliation engine |
| Slow repeat onboarding | Sponsors repeat manual work | Deal Passport |
| Fragmented SPV administration | Entity, investor, and deal records are scattered | SPV Factory lifecycle controls |

The first commercial objective is to reduce bad disbursements, speed up good disbursements, reduce administrative workload, and create defensible records.

***

## 4. Core Operating Principles

```text
No trust-based disbursement.
No mutable spreadsheet ledger.
No direct user-to-payment-provider release authority.
No unverified webhook state change.
No silent policy override.
No autonomous covenant waiver.
No autonomous capital release.
No automated QAOA-to-settlement connection.
No production quantum-provider access to client data, keys, or documents.
No financial state change without an immutable audit event.
```

DIBS is the policy and decision layer. Escrow Factory is the milestone and protected-payment workflow layer. Banks, custodians, escrow providers, and other regulated partners execute regulated functions.

***

## 5. User and Role Model

| Role | Responsibility | Restricted actions |
|---|---|---|
| `PlatformAdmin` | Tenant configuration and platform administration | Cannot bypass policy or self-approve |
| `LenderAdmin` | Portfolio and deal configuration | Cannot override separation of duties |
| `Underwriter` | Deal terms, collateral, covenants | Cannot release capital |
| `PortfolioManager` | Portfolio risk and exception management | Cannot self-approve relevant decisions |
| `RiskOwner` | Risk limits, covenant review, material exceptions | Cannot approve own request |
| `TreasuryOwner` | Liquidity and settlement readiness | Cannot create unlogged overrides |
| `OperationsOwner` | Draw operations and evidence workflow | Cannot waive controls alone |
| `BorrowerSponsor` | Draw requests and evidence submission | Cannot approve or release capital |
| `Inspector` | Inspection and milestone evidence | Cannot alter policy |
| `ComplianceReviewer` | KYC, AML, sanctions, and jurisdiction review | Cannot bypass a compliance hold |
| `FundAdministrator` | Entity, investor, reporting, and reconciliation support | Restricted by tenant and deal scope |
| `EscrowPartner` | Milestone and settlement confirmations | Integration-only actions |
| `Auditor` | Read-only record review | No operational mutation |
| `SuperAgent` | Task routing, summaries, and exception detection | No approval, waiver, release, or policy change |

All authorization decisions are tenant-scoped, role-scoped, object-scoped, policy-versioned, and audit-recorded.

***

## 6. Controlled Draw State Machine

### 6.1 Primary lifecycle

```text
DRAFT
  → SUBMITTED
  → UNDER_REVIEW
  → HELD
  → APPROVED
  → SETTLEMENT_INSTRUCTED
  → SETTLEMENT_CONFIRMED
  → RECONCILED
  → CLOSED
```

### 6.2 Terminal or failure states

```text
REJECTED
CANCELLED
EXPIRED
REQUIRES_INFORMATION
ESCALATED
```

### 6.3 Required transitions

```text
HELD | REQUIRES_INFORMATION → UNDER_REVIEW
  when missing evidence is supplied or a valid waiver is recorded

APPROVED → HELD
  if required evidence expires, a covenant breaches, or a compliance
  or operational hold is applied before settlement instruction

SETTLEMENT_INSTRUCTED → ESCALATED | REJECTED
  on partner rejection, invalid confirmation, or instruction timeout
  Do not auto-return to APPROVED.

SETTLEMENT_CONFIRMED → RECONCILED
  only after amount, currency, payee, date, and reference match
  Do not skip reconciliation.
```

### 6.4 Approval condition

A `DrawRequest` may enter `APPROVED` only if:

```text
Required evidence is complete
AND draw amount is within applicable limits
AND allocated budget is available
AND applicable covenants pass
    OR a current, in-scope, unexpired, attributed waiver covers
       each failed covenant or evidence rule
AND required approvals are recorded
AND no compliance hold exists
    unless a waiver explicitly names that hold type
AND no operational hold exists
AND payment or settlement route is valid
AND the draw is evaluated against its locked policy version
    and evidence-manifest hash
```

A waiver does not overwrite the original failed condition. It is an additional, time-limited authorization. A failed rule must produce a structured reason code and a plain-language explanation.

### 6.5 Policy outcome to state

```text
PASS + required approvals recorded     → APPROVED
HOLD                                   → HELD
FAIL without a valid covering waiver   → REJECTED
REVIEW_REQUIRED                        → UNDER_REVIEW
```

***

## 7. End-to-End Workflow

```text
1. Create organization and tenant
2. Configure users, roles, and approval matrix
3. Create sponsor and lender counterparties
4. Create deal
5. Provision or link SPV
6. Configure budget, collateral, milestones, covenants, and policy
7. Collect required compliance, jurisdiction, and document evidence
8. Submit draw request
9. Upload invoice, inspection, lien, milestone, and supporting evidence
10. Run policy evaluation
11. Run covenant and collateral checks
12. Route approval tasks
13. Apply hold, rejection, approval, or waiver outcome
14. Create settlement instruction for authorized partner
15. Receive signed settlement confirmation
16. Reconcile amount, currency, payee, date, and reference
17. Update deal, SPV, budget, covenant, and portfolio state
18. Write immutable audit events
19. Produce reporting and exception queues
20. Close or wind down the deal and SPV when applicable
```

***

## 8. Data Model

A **Tenant** is an `Organization`. Every critical record carries `tenant_id`. Tenant identity comes from the authenticated session context. Client-supplied tenant identifiers are never trusted.

Money fields are stored as integer minor units plus an ISO-4217 currency code. Fixed-point decimal arithmetic is used only at calculation and display boundaries.

Cardinality: MVP default is one Deal per SPV. The model must allow Organization → SPV → optional Series → Deal so series-isolation is not a silent 1:1 assumption.

### 8.1 Core entities

```text
Organization
User
Role
Permission
Counterparty
Deal
SPV
Series
Asset
LoanOrFacility
Collateral
Covenant
Milestone
DrawBudgetLine
DrawRequest
EvidenceDocument
EvidenceRequirement
ApprovalPolicy
ApprovalDecision
Exception
ExceptionWaiver
SettlementInstruction
SettlementConfirmation
ReconciliationRecord
AuditEvent
Notification
IntegrationConnection
WebhookEvent
DealPassport
```

### 8.2 Entity relationship scaffold

```text
Organization (Tenant)
├── Users
├── Counterparties
├── SPVs
│   └── optional Series
├── Deals
│   ├── linked SPV / Series
│   ├── Assets
│   ├── LoanOrFacility
│   ├── Collateral
│   ├── Covenants
│   ├── Milestones
│   ├── DrawBudgetLines
│   ├── DrawRequests
│   │   ├── EvidenceDocuments
│   │   ├── PolicyEvaluations
│   │   ├── ApprovalDecisions
│   │   ├── SettlementInstructions
│   │   ├── SettlementConfirmations
│   │   └── ReconciliationRecords
│   └── AuditEvents
└── IntegrationConnections
    └── WebhookEvents
```

### 8.3 Critical records

#### `DrawRequest`

```text
id
tenant_id
deal_id
spv_id
series_id
request_number
status
requested_by_user_id
payee_counterparty_id
amount_minor
currency
budget_line_id
requested_at
submitted_at
locked_policy_version
locked_evidence_manifest_hash
policy_evaluation_status
evidence_status
approval_status
settlement_status
reconciliation_status
idempotency_key
created_at
updated_at
```

`locked_policy_version` and `locked_evidence_manifest_hash` are set at `SUBMITTED`. Re-evaluation occurs only on material evidence change or explicit policy supersession. “Current policy version” applies to new submissions, not in-flight draws.

#### `EvidenceDocument`

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

#### `Covenant`

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

#### `SettlementInstruction`

```text
id
tenant_id
deal_id
spv_id
draw_request_id
amount_minor
currency
payee_counterparty_id
route
partner_id
status
idempotency_key
created_at
updated_at
```

#### `SettlementConfirmation`

```text
id
tenant_id
draw_request_id
settlement_instruction_id
confirmed_amount_minor
currency
payee_counterparty_id
settlement_date
settlement_reference
partner_id
status
raw_event_id
idempotency_key
created_at
```

#### `AuditEvent`

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

***

## 9. Policy Engine

The policy engine turns contractual, operational, risk, and governance rules into deterministic decisions.

### 9.1 Initial policy rules

```text
Maximum draw amount
Available draw-budget amount
Minimum cash reserve
Maximum loan-to-value ratio
Required inspection
Required invoice and evidence set
Tranche order
Draw-window date
Maturity-date restriction
Payee allowlist
Duplicate-request prevention
Approval threshold by amount
Approval threshold by exception type
No active compliance hold
No active operational hold
No expired evidence
No expired approval
```

### 9.2 Policy outcomes

```text
PASS
HOLD
FAIL
REVIEW_REQUIRED
```

### 9.3 Policy result structure

```json
{
  "decision": "HOLD",
  "policy_version": "2026.08.1",
  "rules": [
    {
      "rule_id": "INSPECTION_REQUIRED",
      "status": "FAIL",
      "reason_code": "MISSING_VALID_INSPECTION",
      "message": "A valid inspection is required before this draw may proceed."
    }
  ]
}
```

Each evaluation is versioned, reproducible, attributable, and bound to the evidence manifest evaluated at that time.

***

## 10. Evidence and Milestone Control

### 10.1 Evidence types

```text
Invoice
Inspection report
Milestone attestation
Lien waiver
Borrower attestation
Budget support
Collateral update
Insurance evidence
Executed contract
Title or legal evidence
KYC/AML status
Sanctions screening result
Settlement instruction support
```

### 10.2 Evidence rules

```text
Hash every document.
Preserve all document versions.
Record uploader identity and timestamp.
Bind evidence to deal, SPV, milestone, draw, and policy evaluation.
Prevent silent replacement.
Expire stale evidence when policy requires.
Require re-approval after material evidence changes.
Create exceptions for missing, expired, conflicting, or invalid evidence.
```

### 10.3 Milestone model

```text
Milestone
├── Name
├── Description
├── Due date
├── Required evidence
├── Approved budget amount
├── Inspection requirement
├── Escrow Factory status
├── Responsible counterparty
├── Validation result
└── Audit-event history
```

***

## 11. Collateral and Covenant Controls

DIBS manages covenants as active, measurable controls rather than static loan-file checklists.

### 11.1 Initial covenant library

```text
Maximum LTV
Minimum reserve
Debt-service coverage ratio
Budget variance limit
Funding concentration limit
Collateral valuation freshness
Inspection completion
Maturity-date threshold
Remaining-funds threshold
Required-document status
Insurance status
Lien status
Construction-progress threshold
```

### 11.2 Covenant state machine

```text
CURRENT
  → WATCH
  → BREACHED
  → CURE_PERIOD
  → WAIVED
  → EXPIRED
  → CLOSED
```

Return paths:

```text
CURE_PERIOD → CURRENT   when the measured condition returns inside policy
WAIVED → CURRENT|WATCH  when the waiver expires without a new authorization
BREACHED → CURE_PERIOD  when policy grants a cure window
```

### 11.3 Core formulas

For period \( \tau \):

```math
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
```

Require:

```math
\text{ClosingCash}_{\tau}
\geq
\text{MinimumLiquidityReserve}_{\tau}
```

For SPV \( s \):

```math
\text{LTV}_{s}
=
\frac{\text{OutstandingDebt}_{s}}
{\text{EligibleCollateralValue}_{s}}
```

Require:

```math
\text{LTV}_{s}
\leq
\text{PolicyLTVLimit}_{s}
```

A breach creates an exception, notifies accountable owners, applies a hold when required, and generates a permanent audit record.

***

## 12. Approvals, Exceptions, and Waivers

### 12.1 Approval requirements

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
```

### 12.2 Waiver requirements

```text
Waiver ID
Applicable deal
Applicable SPV
Applicable draw or covenant
Reason and rationale
Requestor
Required approver roles
Start date
Expiration date
Maximum exposure
Compensating controls
Policy version
Revocation authority
Related audit events
```

A waiver does not overwrite the failed condition. It is a new, explicit, time-limited, attributed authorization.

***

## 13. Settlement and Reconciliation

```text
DIBS approves and records the authorized instruction.
Escrow, bank, custodian, or payment partner executes settlement.
DIBS receives confirmation.
DIBS reconciles approved and confirmed records.
```

### 13.1 Required reconciliation fields

```text
Approved amount
Confirmed amount
Currency
Payee
Settlement date
Settlement reference
Deal ID
SPV ID
Draw request ID
External partner ID
Status
Mismatch reason
Resolution owner
```

### 13.2 Required mismatch detection

```text
Amount mismatch
Currency mismatch
Payee mismatch
Duplicate settlement reference
Missing confirmation
Confirmation without approved instruction
Late settlement
Unreconciled payment
```

DIBS must not automatically reconcile an unmatched payment.

***

## 14. Audit Ledger

### 14.1 Requirements

```text
Append-only write model
Event ID
Prior-event hash
Payload hash
Evidence-manifest hash
Actor identity
Role
Tenant ID
Aggregate type and ID
Timestamp
Policy version
Correlation ID
Idempotency key
Signature metadata
Retention classification
```

### 14.2 Audited actions

```text
Deal creation or modification
SPV lifecycle transition
Collateral update
Covenant measurement
Draw request creation
Evidence upload and verification
Policy evaluation
Approval, rejection, or hold
Exception creation and resolution
Waiver approval, expiration, or revocation
Settlement instruction
Settlement confirmation
Reconciliation outcome
Integration or webhook event
Privilege escalation
Cryptographic-policy change
QAOA experiment state change
```

Corrections, suspensions, rollbacks, revocations, and reversals must be new events referencing prior events. Historical records are never overwritten.

***

## 15. Escrow Factory Integration

### 15.1 Shared identifiers

```text
shared_deal_id
shared_spv_id
shared_milestone_id
shared_draw_request_id
```

### 15.2 Webhook contract

```text
Signed
Versioned
Timestamped
Replay-protected
Idempotent
Queued
Audited
Reconciled
```

### 15.3 Inbound workflow

```text
Escrow Factory event
  → Validate signature
  → Validate timestamp and replay window
  → Check idempotency key
  → Persist raw event
  → Queue processing
  → Apply database transaction
  → Generate audit event
  → Update DIBS deal state
  → Reconcile snapshot
  → Alert if needed
```

DIBS must handle duplicates, delays, gaps, retries, malformed messages, and out-of-order events. Use a short replay window, a unique event-ID index, a processing queue, transactionally applied updates, and nightly reconciliation.

***

## 16. SPV Factory

### 16.1 Lifecycle

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

### 16.2 Modules

```text
Entity intake
Entity blueprint templates
Jurisdiction and entity-type configuration
Formation tracking
EIN tracking
Banking-readiness tracking
Governance and authority records
Operating agreement and formation-document management
Investor eligibility workflow
KYC/AML and sanctions integration points
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

### 16.3 Readiness gate

```text
Formation state valid
AND legal documents complete
AND governance authority recorded
AND required compliance conditions satisfied
AND banking or escrow relationship configured where applicable
AND funding policy configured
AND records isolated by entity and series
AND all readiness evidence recorded
```

DIBS SPV Factory coordinates workflows and evidence. It does not replace legal counsel, tax advisers, regulated banks, regulated custodians, or filing authorities.

***

## 17. Compliance and Investor Controls

### 17.1 Registry

```text
Investor identity
Investor eligibility
Accreditation status
KYC status
AML status
Sanctions status
Jurisdiction
Wallet or payment identifier
Subscription status
Transfer restrictions
Required document status
```

### 17.2 Controls

```text
No investor or capital action outside authorized scope.
No transfer authorization without compliance checks.
No reliance on unverified KYC, AML, or sanctions results.
No legal determination without qualified legal review.
No automatic claim of regulatory exemption or qualification.
No public or unrestricted token issuance in the MVP.
```

Tokenization, restricted transfers, QOF/QOZ workflows, regulated fundraising, secondary liquidity, and DeFi are future gated capabilities rather than MVP dependencies.

***

## 18. Policy-Loan Decision Layer

The policy-loan layer is a decision-support and recordkeeping capability, not automatic borrowing, lending, or guaranteed arbitrage.

```text
Policy owner
  → Insurance carrier policy loan
  → Policy-loan record
  → DIBS liquidity and cost analysis
  → Approved capital contribution or loan to SPV
  → Asset or deal operations
  → Cash-flow and distribution records
  → Policy-loan repayment analysis
```

### 18.1 Required records

```text
Policy owner
Carrier
Policy identifier
Cash value
Loan balance
Loan rate
Loan type
Recognition type
Dividend scale assumption
Loan date
Repayment terms
SPV contribution
Distribution attribution
Collateral and LTV relationship
```

Carrier-specific loan mechanics, recognition method, dividend effects, rate changes, tax treatment, and insurance implications require review by qualified carrier, legal, tax, and licensed professionals.

***

## 19. Trust Intelligence Adapter

An external, consented, explainable trust-intelligence adapter (for example VRDCT) may support:

```text
Review-queue prioritization
Sponsor operational tiering
Evidence-timeliness analysis
Exception-routing support
Counterparty follow-up prioritization
Operational performance reporting
```

It must not perform:

```text
Automatic capital release
Automatic covenant waiver
Undisclosed scoring
Opaque adverse decision-making
Unconsented data use
Replacement of legal, compliance, credit, or human approval
```

Trust intelligence informs human review. It does not become independent capital authority.

***

## 20. Super Agents

### 20.1 Permitted actions

```text
Review evidence checklists
Identify missing or stale documents
Draft draw summaries
Draft covenant-exception summaries
Generate daily exception reports
Create follow-up tasks
Route tasks to owners
Flag settlement mismatches
Escalate overdue actions
Produce human review packets
```

### 20.2 Prohibited actions

```text
Approve draws
Release capital
Waive covenants
Change policies
Alter audit history
Submit settlement instructions
Modify user privileges
Override compliance results
Make independent lending or investment decisions
```

Automation is introduced after the platform can prove why each dollar did or did not move.

***

## 21. Security Architecture

### 21.1 Zero-trust controls

```text
OIDC authentication
MFA for privileged access
Tenant isolation
Role-based access control
Object-level authorization
Separation of duties
Approval conflict checks
Time-bound elevated access
Encrypted storage
Encrypted transport
Secret rotation
KMS-backed key management
Security monitoring
Incident-response runbooks
```

### 21.2 Security invariants

```text
Tenant identity comes from authenticated session context.
Client-provided tenant IDs are never trusted.
Financial-state-changing endpoints require idempotency keys.
Webhooks require signature validation and replay protection.
Sensitive actions require structured audit events.
Production secrets never enter source control.
Customer documents, data, and keys are never sent to quantum providers.
```

***

## 22. Post-Quantum Security

Non-MVP. Do not block Sprint 0–4 on PQC implementation.

### 22.1 Hybrid TLS

Use supported `TLS 1.3` hybrid key establishment through an approved TLS stack or service mesh:

```text
TLS 1.3
+ X25519
+ ML-KEM-768
+ HKDF key schedule
+ AES-256-GCM record protection
```

Do not create custom ML-KEM serialization, custom hybrid-secret composition, or custom TLS handshakes.

### 22.2 Audit signatures

```text
Canonical audit payload
  → Payload hash
  → Enterprise signature
  + ML-DSA-65 signature
  → Append-only event record
```

### 22.3 TLS audit metadata

Record:

```text
Event ID
Timestamp
Environment
Connection ID
Trace ID
Direction
Source workload
Destination workload
TLS version
Cipher suite
Classical key exchange
PQC KEM
Negotiated group
Session resumption state
Handshake duration
Certificate fingerprint hashes
Trust-bundle identifier
Crypto-policy identifier
TLS library version
Gateway or sidecar version
Result code
Failure classification
Event hash
Prior-event hash
```

Never log:

```text
Private keys
Shared secrets
ML-KEM ciphertexts
TLS traffic secrets
Session tickets
Raw certificates
Application payloads
Access tokens
Customer PII
```

`ML-KEM` establishes shared secret material. It does not encrypt application data, replace identity signatures, or replace application authorization.

***

## 23. Quantum Optimization Lab

The Quantum Optimization Lab is offline, read-only, nonbinding, and isolated from settlement systems. Non-MVP. No QAOA output may create a draw, waive a covenant, modify policy, or issue a settlement instruction.

```text
De-identified scenario data
  → Scenario freeze
  → Classical solver baseline
  → QUBO compiler
  → QAOA simulator or controlled experiment
  → Independent validator
  → Human governance gate
  → Policy simulation
  → Limited pilot only if approved
```

### 23.1 Permitted use cases

```text
Portfolio allocation
SPV allocation
Draw scheduling
Reserve sizing
Liquidity forecasting
Concentration balancing
Scenario stress testing
Operational sequencing
```

### 23.2 QUBO model

```math
E(x) = E_{\text{economic}}(x) + \sum_{c \in H} P_c g_c(x) + \sum_{s \in S} w_s f_s(x)
```

Hard constraints include:

```text
Legal eligibility
KYC/AML and sanctions conditions
Executed documents
Settlement availability
Maximum LTV
Minimum reserve
Liquidity capacity
Tranche precedence
Assignment/cardinality
Maximum exposure
```

Legal and compliance disqualifiers are excluded before QUBO compilation. They are not soft penalties.

### 23.3 Penalty calibration

```math
P_c >
\frac{\Delta E_{\max}}{v_{\min}^{2}}
```

Where:

- \( \Delta E_{\max} \) is the maximum economic gain possible from violating the constraint.
- \( v_{\min} \) is the smallest nonzero violation.
- \( P_c \) is the penalty coefficient.

```text
Normalize objectives
Solve small benchmark instances exactly
Test a penalty grid
Measure feasibility rate
Measure gap to classical optimum
Run ±10%, ±25%, and ±50% sensitivity checks
Rescale for target simulator or hardware
Freeze versioned penalty policy
```

### 23.4 Independent validator

```text
Candidate bitstring
  → Decode candidate schedule
  → Use original full-precision data
  → Recalculate budgets
  → Recalculate liquidity
  → Recalculate LTV
  → Recalculate reserves
  → Check concentration
  → Check tranche order
  → Check legal and compliance state
  → Run defined stress scenarios
  → Produce signed result
```

Use fixed-point decimal arithmetic for money, rates, and percentages. Any failed hard constraint blocks the candidate.

### 23.5 QAOA approval state machine

```text
DRAFT_SCENARIO
  → DATA_FROZEN
  → CLASSICAL_BASELINE_COMPLETE
  → QUBO_COMPILED
  → QAOA_RUN_COMPLETE
  → CANDIDATE_VALIDATED
  → REVIEW_PACKET_ISSUED
  → MULTI_ROLE_REVIEW
  → APPROVED_FOR_SIMULATION
  → POLICY_SIMULATION_COMPLETE
  → APPROVED_LIMITED_PILOT
  → PILOT_MONITORED
  → EVALUATION_COMPLETE
  → PROMOTED_TO_VERSIONED_POLICY
```

Failure states:

```text
REQUIRES_REMODELING
REJECTED
AUTO_SUSPENDED
ROLLED_BACK
```

***

## 24. Technology Architecture

Target architecture. Current prototype code may differ.

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

Storage:
S3-compatible object storage
Versioned retention
Document content hashes

Jobs:
Temporal or durable queue

Authentication:
Enterprise OIDC
MFA
RBAC
Object-level authorization

Infrastructure:
Managed cloud services
Infrastructure as code
Encrypted secret storage
Centralized observability

Service transport:
TLS 1.3
mTLS
Cryptographic-agility migration path

Integration model:
CSV and manual proof first
API and webhook integrations after pilot validation
```

***

## 25. Repository Structure

Target monorepo layout. Current prototype repositories may differ.

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
│   │   ├── deal-passport/
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
│   ├── shared/
│   ├── pqc/
│   │   ├── crypto-policy/
│   │   ├── tls-audit/
│   │   ├── signature-envelope/
│   │   └── key-rotation/
│   └── quantum-lab/
│       ├── classical/
│       ├── qubo/
│       ├── qaoa/
│       ├── validators/
│       └── experiments/
├── contracts/
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
├── scripts/
├── migrations/
├── tests/
│   ├── integration/
│   ├── e2e/
│   ├── policy/
│   ├── security/
│   └── fixtures/
└── .github/
    └── workflows/
```

***

## 26. API Scaffold

```text
/v1/organizations
/v1/users
/v1/counterparties
/v1/deals
/v1/spvs
/v1/assets
/v1/collateral
/v1/covenants
/v1/milestones
/v1/draw-budget-lines
/v1/draw-requests
/v1/evidence-documents
/v1/policy-evaluations
/v1/approval-decisions
/v1/exceptions
/v1/waivers
/v1/settlement-instructions
/v1/settlement-confirmations
/v1/reconciliation-records
/v1/audit-events
/v1/deal-passports
/v1/integrations/escrow-factory/webhooks
/v1/quantum-lab/experiments
```

Require an `Idempotency-Key` on every endpoint that creates or changes financial state.

```text
POST /v1/draw-requests
POST /v1/approval-decisions
POST /v1/waivers
POST /v1/settlement-instructions
POST /v1/settlement-confirmations
POST /v1/integrations/escrow-factory/webhooks
```

***

## 27. MVP Build Order

Prioritize a technical co-founder or lead full-stack fintech engineer over a generic blockchain hire. The first deliverable is a reliable workflow, ledger, permission model, and audit trail.

### Sprint 0 — Foundation

```text
Product scope freeze
Domain model approval
Tenant model
Role model
Audit-event contract
Policy schema
Threat model
Repository setup
CI/CD
Development environment
```

### Sprint 1 — Core Platform

```text
Authentication
Tenant isolation
RBAC
Deal model
Counterparty model
SPV model
Audit ledger
Document storage
Basic web application shell
```

### Sprint 2 — Controlled Draws

```text
Draw request workflow
Draw budget lines
Evidence upload
Evidence checklist
Draw state machine
Policy evaluation
Approval queue
Hold and rejection reasons
```

### Sprint 3 — Covenant and Exception Controls

```text
Collateral register
Covenant library
Covenant measurement ingestion
Reserve and LTV checks
Exception queue
Waiver workflow
Notifications
```

### Sprint 4 — Settlement and Escrow Integration

```text
Settlement instruction record
Settlement confirmation ingestion
Escrow Factory webhooks
Webhook signatures
Idempotency
Reconciliation workflow
Portfolio status dashboard
```

### Sprint 5 — Pilot Hardening

```text
Authorization tests
Policy regression tests
Webhook replay tests
Audit-chain verification
Security scanning
Migration testing
Operational runbooks
Pilot reports
```

### Sprint 6 — Controlled Pilot

```text
One to three deals
Configured policies
Configured approval matrix
Live operational users
Manual or CSV settlement confirmation
Daily reconciliation
Pilot metrics
Customer feedback
Renewal and expansion plan
```

Do not pull PQC, the Quantum Optimization Lab, policy-loan automation, tokenization, or on-chain vaults into Sprints 0–4.

***

## 28. Pilot Success Criteria

```text
Three paying lender or fund customers use the controlled-draw workflow.
At least 90% of standard draws reach decision without spreadsheet or email reconciliation.
Every approved draw has complete evidence, policy, authorization, settlement, reconciliation, and audit records.
No unauthorized DIBS-mediated release occurs.
Average draw-decision time improves against the customer baseline.
Users identify every hold reason in less than one minute.
No unresolved critical security findings remain.
No unresolved reconciliation defects exist at reporting cut-off.
At least one customer commits to annual renewal.
```

Do not standardize annual pricing until a conservative value-to-price ratio of at least 5:1 is demonstrable for the design customer.

***

## 29. Revenue Model

```text
Enterprise SaaS subscriptions
Implementation and configuration fees
Per-deal or per-SPV administration fees
Controlled-capital-volume fees
Covenant-monitoring premium module
Audit and reporting premium module
Partner API and white-label fees
Future regulated services only after legal and operational readiness
```

The enterprise control platform is the primary recurring-revenue engine. Policy-loan decision support may be a separate product line, but it must not distract from the controlled-draw wedge.

***

## 30. Deferred Capabilities

Do not make these first-release dependencies:

```text
Direct custody
Payment processing
Autonomous capital release
Autonomous underwriting
Autonomous covenant waivers
Public token issuance
Unrestricted token transfer
Secondary trading
DeFi yield deployment
Mainnet capital deployment
QOF/QOZ compliance guarantees
Insurance issuance
Guaranteed policy-loan arbitrage
Quantum-driven production decisions
```

Introduce each only after legal review, customer demand, operating controls, security assurance, partner readiness, and pilot evidence establish a defensible path.

***

## 31. Compliance and Product Notice

DIBS is software for organizing, enforcing, monitoring, documenting, and reconciling authorized private-capital workflows.

DIBS is not a bank, lender, custodian, escrow agent, broker-dealer, investment adviser, insurance carrier, tax adviser, legal adviser, guarantor, or a substitute for qualified professionals and regulated counterparties. It does not guarantee financing, yield, liquidity, investment results, tax treatment, policy performance, principal protection, or regulatory compliance.
