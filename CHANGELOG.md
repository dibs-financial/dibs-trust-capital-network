# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Features
- **[`88bb309`]** (2026-08-09) **Feature**: Non-redeemable seed liquidity, minimum initial deposit, and timelocked parameter changes
  - Implemented non-redeemable seed liquidity mechanics in `DIBSVault.sol` with `seedVault()`, `setMinimumSeedDeposit()`, `extendSeedLock()`, and share transfer/withdrawal blocks (`_withdraw`, `_update`).
  - Added 48-hour timelock queue for administrative parameter changes including `queueParameterChange()`, `executeParameterChange()`, and `cancelParameterChange()`.

- **[`712f539`]** (2026-08-09) **Feature**: Capital Preservation Mode (CPM) across vault contracts
  - Added cross-vault `JuniorRatio` monitoring, automatic preservation mode trigger and lift mechanics, dilution guards, FIFO withdrawal queuing in `SentinelVault.sol`, distribution suspension in `CatalystVault.sol`, segregated reserve management, and yield routing.
  - Implemented `CapitalPreservationManager.sol` cross-vault coordinator for status monitoring and automated risk enforcement.

- **[`0a29b6b`]** (2026-08-09) **Feature**: Backend API router wiring and React/Vite operational dashboard scaffolding
  - Connected 20 backend service modules to Express API Gateway (`backend/api/index.ts`) with tenant isolation (`x-dibs-tenant`) and RBAC (`x-dibs-role`) middleware.
  - Scaffolded React 18 + Vite 5 frontend client with 11 operational dashboards (Operator Console, Lender Dashboard, Sponsor Dashboard, Borrower Portal, Evidence Upload, Covenant Dashboard, Collateral Dashboard, Tranche Analytics, Policy-Loan Arbitrage, Audit Viewer, Admin Portal).

- **[`eed5c31`]** (2026-08-09) **Feature**: Advanced analytics, restricted token sandbox, and external API marketplace (Build Steps 18–20)
  - Implemented multi-category analytics engine covering 8 metric groups with real-time dashboard aggregation.
  - Implemented `RestrictedTokenSandbox.sol` with 5 compliance prerequisite gates (Legal, Custody, Governance, Security, Compliance).
  - Built External API Marketplace with API key management, tier-based rate limiting (Growth/Institutional/Enterprise), and 15 permission scopes.

- **[`b874274`]** (2026-08-09) **Feature**: Evidence, settlement, reconciliation, collateral, VRDCT, reporting, and policy-loan services (Build Steps 5–17)
  - Created SHA-256 evidence ingestion service and evidence-gating workflow.
  - Built idempotent settlement service and variance reconciliation engine.
  - Added collateral hold system, VRDCT trust signal adapter with protected-class proxy rejection, adverse action notice engine, and exception/waiver workflows.
  - Implemented `PolicyLoanVault.sol` and `ArbitrageRiskEngine.sol` for policy-loan arbitrage.

- **[`111e6c7`]** (2026-08-09) **Feature**: Core monorepo architecture and base contracts
  - Scaffolded base contracts (`DIBSVault.sol`, `SentinelVault.sol`, `CatalystVault.sol`, `RiskEngine.sol`, `RegistryHub.sol`, `LiquidationEngine.sol`), Express API gateway, hash-linked event store, capital request state machine, and 24-category covenant engine.

#### Infrastructure & CI/CD
- **[`d2f3e19`]** (2026-08-09) **Infra**: GitHub Actions CI/CD workflows
  - Added `.github/workflows/ci.yml` featuring parallel jobs for Foundry unit tests, Jest backend tests, and Vite frontend production builds with caching and step summaries.
  - Added `.github/workflows/deploy.yml` stub pipeline with detailed GitHub Secrets documentation for smart contract, backend, and frontend deployments.

- **[`fb83704`]** (2026-08-09) **Infra**: Master environment configuration template
  - Added `.env.example` template covering EVM RPC endpoints, deployment wallet keys, Express server settings, PostgreSQL, Redis, VRDCT analytics, settlement banking, sanctions API, and Vite client variables.

- **[`996846f`]** (2026-08-09) **Infra**: Repository initialization
  - Initialized Git repository for the DIBS Trust Capital Network monorepo.

#### Documentation
- **[`fb83704`]** (2026-08-09) **Docs**: Capital Preservation Mode technical documentation
  - Created `docs/Capital-Preservation-Mode-Technical-Documentation.md` detailing CPM architecture, seed liquidity, timelock governance, state models, event specifications, and test coverage specs.

- **[`17f1617`]** (2026-08-09) **Docs**: Master project README documentation
  - Replaced stub README with monorepo architecture, vault tranche tables, Junior Ratio formula, CPM trigger rules, timelock governance matrix, test summaries, deployment sequence, and security guidelines.

- **[`a17719f`]** (2026-08-09) **Docs**: Initial blueprint and architecture specs
  - Created initial monorepo blueprint `DIBS-Trust-Capital-Network.md`, baseline `README.md`, `CONTRIBUTING.md`, and initial documentation structure.

#### Tests
- **[`88bb309`]** (2026-08-09) **Tests**: Non-redeemable seed liquidity and timelock unit test suite
  - Added `SeedLiquidityAndTimelockTest.sol` containing 38 unit and integration tests covering seed deposit locks, share transfer restrictions, lock extension, timelock queueing, execution, cancellation, and selector rules.

- **[`712f539`]** (2026-08-09) **Tests**: Capital Preservation Mode unit test suite
  - Added `CapitalPreservationModeTest.sol` containing 22 unit tests covering Junior Ratio computation, preservation triggers/lifts, Sentinel withdrawal queuing, Catalyst distribution suspension, reserve gating, and dilution guards.

### Fixed

- **[`8bad89d`]** (2026-08-09) **Fix**: Emergency role setter, CSS syntax, and post-donation test assertions
  - Added `assignEmergencyRole()` in `DIBSVault.sol` to enable emergency role configuration.
  - Fixed Tailwind CSS class syntax in `BorrowerPortal.tsx`.
  - Updated post-donation dust deposit test assertions in `DonationAttackTest.sol` for virtual-offset rounding behavior.

- **[`3ba24f9`]** (2026-08-09) **Fix**: Settlement reconciliation test exception trigger
  - Added explicit `reconcile()` invocation following `recordException()` in `SettlementReconciliation` Jest tests to ensure exception detection prior to assertion checks.

- **[`a9c3745`]** (2026-08-09) **Fix**: TypeScript compilation, enum references, and test framework migration
  - Replaced string literal `EventType` references with enum constants across services and tests.
  - Added `failed_settlement` to reconciliation variance types.
  - Augmented Express Request typing with `tenantId`.
  - Converted Vitest imports to Jest across unit tests.

- **[`a7153a1`]** (2026-08-09) **Fix**: Foundry compilation, OpenZeppelin imports, and via_ir optimizer
  - Installed `forge-std` and OpenZeppelin contract submodules.
  - Fixed missing `IERC20` imports in `SentinelVault.sol` and `CatalystVault.sol`.
  - Enabled `via_ir` compiler pipeline and 200-run optimizer in `foundry.toml` to eliminate stack-too-deep compilation errors.
