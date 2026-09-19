# DIBS — Core Thesis + MVP

| Field | Value |
|---|---|
| Version | 2026.09.19 |
| Status | Operating thesis for engineering, counsel, and first customers |
| Product | DIBS Capital Autopilot |
| Commit to | `docs/architecture/DIBS-Core-Thesis-MVP.md` |
| Does not replace | `README.md` or `DIBS-Trust-Capital-Network.md` |

***

## Thesis

**DIBS Trust Capital Network** is software that a private lender uses to decide whether a construction, bridge, or renovation draw may be instructed, then records what happened.

Capital cannot be instructed until policy, evidence, approvals, payee verification, and covenants pass, and every hold reason is readable in under one minute. After a regulated partner moves the money, DIBS reconciles the instruction to the confirmation and writes an immutable event.

> **Core invariant:** No capital-state change without **policy**, **evidence**, **authorization**, **settlement confirmation**, **reconciliation**, and an **immutable audit event**.

```text
DIBS is:
  The control plane and system of record for authorized private-capital workflows.

DIBS is not:
  A bank, lender, custodian, escrow agent, broker-dealer, adviser, or insurer.
  Quantum finance. Tokenization. Infinite banking. A guaranteed-yield product.
```

**Crystal legal line (use verbatim):**

> DIBS does not have possession, control, or authority over customer funds. DIBS approves and records. Regulated partners hold, settle, and transfer. DIBS does not issue credit, take deposits, or act as escrow.

***

## Who does what

| Actor | Owns | Does not own |
|---|---|---|
| DIBS Financial Solutions LLC | Workflow, policy evaluation, evidence hashes, approval records, settlement *instructions*, reconciliation records, audit log | Customer funds, credit as lender of record, custody, escrow, insurance, tax advice |
| Lender / debt fund | Credit policy, approval matrix, waiver authority, named RiskOwner and TreasuryOwner | DIBS source code; a banking charter |
| Borrower / sponsor | Draw request, evidence upload, project updates | Approval, instruction, release |
| SPV / Series LLC | Title, books, investors, bankruptcy-remote structure (via counsel) | The software |
| Escrow / bank / custodian / payment partner | Holding, settling, and transferring funds under their license | Portfolio policy |
| Inspector / appraiser / title / KYC vendor | Their report or screening result | Draw approval |
| Counsel, tax, audit firms | Legal, tax, and attest opinions | Product operation |

If DIBS and a partner disagree, DIBS **holds** the draw and records an exception. It does not silently prefer either side. It never pushes a release button at a payment provider.

***

## First product

**Name:** DIBS Capital Autopilot.

**Customer:** private construction, bridge, or renovation lender or debt fund.

```text
Book:     $25M–$500M committed
Volume:   10–100 draw requests per month
Stack:    spreadsheets, email, PDF folders, phone inspections, manual recon
Buyer:    head of credit / COO / fund CFO
User:     draw administrator, portfolio manager
```

**Job:** fewer bad disbursements, faster good disbursements, less admin, a file you can defend.

***

## What MVP ships

```text
Tenant, roles, segregation of duties
Deal, SPV link, counterparties, verified payee accounts
Budget lines, retainage, change orders
DrawRequest state machine
Evidence documents + frozen manifest
Policy evaluation against a locked policy version
Approval matrix + approval binding
Holds, exceptions, time-limited waivers
Settlement instruction and confirmation records (CSV first)
Reconciliation with breaks
Append-only audit events
Exception queues a human can read in under one minute
```

A draw becomes `APPROVED` only when the manifest is complete, the amount fits budget and retainage, covenants are CURRENT or WATCH (or a dated waiver covers a breach), the matrix is satisfied, requester ≠ approver ≠ instructor, the payee account is verified, and no hold is open. Treasury writes a settlement instruction bound to that approval. The partner executes. DIBS reconciles. Every transition writes an `AuditEvent`.

***

## What MVP does not ship

```text
VRDCT / trust scoring
ERC-4626 vaults
Reserve and tranche engines
External yield routing
Policy-loan / infinite-banking product
Tokenization / RWA issuance
API marketplace
Quantum Optimization Lab
Post-quantum crypto as a draw dependency
Full SPV formation automation
Deal Passport as a network score
```

Those names may exist in older docs. They are not this product. They are not in Sprints 0–6.

***

## Done looks like

```text
Three lenders run request → reconciled record in DIBS instead of a spreadsheet.
Every approved draw has evidence, policy, approval, instruction, confirmation, recon, event.
No DIBS-mediated send to an unverified payee.
Every hold reason is readable in under one minute.
Zero unresolved recon breaks at reporting cut-off.
One of the three renews.
```

***

## How to read the rest of the repo

```text
This file                                         what the product is
docs/architecture/DIBS-Domain-State-Event-Model.md  how it works
docs/architecture/DIBS-Complete-Scaffold.md         older 31-section reference
DIBS-Trust-Capital-Network.md                       archive thesis — not the spec
README.md                                           repo entry; do not paste this file into it
```

If a sentence cannot be traced to a draw a lender runs this quarter, it does not belong in this file.
