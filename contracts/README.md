# DIBS Smart Contracts

## Contract Layers

### Vault Layer (`vault/`)
- ERC-4626 vault implementation with virtual-offset donation attack mitigation
- Sentinel (senior-priority) and Catalyst (first-loss) share accounting
- Reserve accounting and fee accrual
- Deposit/withdrawal controls and Capital Preservation Mode

### Registry Layer (`registry/`)
- Entity, investor eligibility, asset, policy, SPV, compliance, authorized signer, oracle, and strategy adapter registries

### Risk Layer (`risk/`)
- `MinJuniorRatio` evaluation, collateral ratio, LTV, DSCR, oracle freshness, exposure caps, concentration limits, covenant state integration, emergency-state triggers

### Liquidation Layer (`liquidation/`)
- Position health checks, liquidation eligibility, repayment/recovery paths, loss recognition, reserve absorption, Catalyst-first loss allocation, Sentinel residual-loss accounting

### Routing Layer (`routing/`)
- Morpho adapter, Pendle adapter, Treasury/RWA adapter, settlement adapter, oracle adapter, policy-loan deployment adapter, withdrawal queue router, yield diversion router

### Compliance Layer (`compliance/`)
- KYC/AML gating, sanctions screening, transfer restrictions, investor eligibility enforcement

### Policy-Loan Accounting Layer (`policy-loan/`)
- PolicyLoanVault, PremiumScheduleVault, PolicySettlement, PolicyIntegrationAdapter, ArbitrageRiskEngine

### Restricted-Token Sandbox (`restricted-token/`)
- Tokenization infrastructure — **only after legal, custody, governance, and security prerequisites are satisfied**

## Toolchain
- **Foundry** (forge, cast, anvil) for compilation, testing, fuzzing, and fork testing
- **OpenZeppelin Contracts** for ERC-4626, ERC-20, AccessControl, and security utilities

## Build
```bash
forge build
forge test
forge test --fuzz-runs 10000
forge test --fork-url $MAINNET_RPC_URL
```
