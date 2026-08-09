# DIBS Backend Services

## Service Modules

### `api/`
- Multi-tenant API gateway with tenant isolation

### `identity/`
- Authentication, authorization, role-based access control, object-level permissions

### `evidence/`
- Evidence ingestion, validation, document hashing, project/milestone association

### `workflow/`
- Capital-request state machine, draw workflow, evidence-gating, exception/waiver handling

### `covenant/`
- Covenant calculation service, threshold evaluation, state transitions, alert generation

### `reconciliation/`
- Settlement reconciliation engine, exception handling, draw balance verification

### `notification/`
- Multi-party notification service for approvals, holds, breaches, and state transitions

### `audit/`
- Immutable event indexing, hash-linked evidence objects, versioned policy/calculation storage

### `settlement/`
- External settlement adapter coordination, settlement instruction transmission

### `adapters/`
- Carrier data adapters (policy-loan integration), RWA data adapters, external API connectors

### `reporting/`
- Enterprise reporting engine, risk dashboards, compliance reports, APY and reserve health

## Tech Stack
- **Runtime**: Node.js with TypeScript (strict mode)
- **Framework**: Fastify or Express
- **Database**: PostgreSQL (primary), Redis (cache/queues)
- **Event Store**: Append-only immutable event log
- **Queue**: BullMQ or SQS for async workflow processing

## Build Priority (from blueprint)
1. Multi-tenant authentication
2. Roles and tenant isolation
3. Immutable event model
4. Capital-request and draw workflow
5. Evidence-gating workflow
6. Object-level authorization
7. Settlement partner integration
8. Reconciliation engine
9. Covenant engine
10. Collateral hold system
11. Exception and waiver workflow
12. VRDCT monitoring adapter
13. Enterprise reporting
