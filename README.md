# DIBS Trust Capital Network

**Decentralized Infinite Banking System** — Enterprise controlled-capital infrastructure operated by Cornerstone Creative Capital LLC (parent: H.E.R.I.&A. HOLDINGS LLC).

Evidence-gated draw approval, covenant monitoring, ERC-4626 structured-credit tranches (Sentinel/Catalyst), Capital Preservation Mode, non-redeemable seed liquidity, timelocked parameter governance, policy-loan arbitrage analytics, and trust-intelligence layering (VRDCT).

---

## Architecture

### Monorepo Structure

```
dibs-trust-capital-network/
├── contracts/              # Solidity smart contracts (Foundry)
│   ├── vault/               # ERC-4626 vault layer
│   │   ├── DIBSVault.sol            # Base vault: virtual offset, CPM, seed, timelock
│   │   ├── SentinelVault.sol        # Senior-priority (Class A): withdrawal queue, redemption limits
│   │   ├── CatalystVault.sol        # Subordinated first-loss (Class B): dist. suspension, recap, yield routing
│   │   └── CapitalPreservationManager.sol  # Cross-vault coordinator
│   ├── policy/             # Policy-loan and arbitrage contracts
│   └── token/               # Tokenization sandbox
├── backend/                # TypeScript backend services
│   ├── routes/              # 12 API routers
│   ├── services/            # Business logic
│   └── middleware/          # RBAC, tenant isolation, audit
├── frontend/               # React + Vite dashboard
│   └── src/pages/           # 11 operational surfaces
├── tests/                   # Foundry + Jest test suites
│   └── simulation/          # Solidity simulation tests
├── infra/                   # Infrastructure config
├── lib/                     # OpenZeppelin contracts
└── docs/                    # Architecture, RFCs, security, specs
```

### Vault Layer (ERC-4626)

| Vault | Class | Priority | Loss Allocation | Distribution |
|---|---|---|---|---|
| **Sentinel** | A (Senior) | First claim | Absorbs losses only after Catalyst exhausted | After expenses, servicing, losses, reserves, fees |
| **Catalyst** | B (Subordinated) | Residual claim | Absorbs ALL losses before Sentinel | After Sentinel obligations |

**Junior Ratio Formula:**
```
JuniorRatio = NAV_Catalyst / (NAV_Sentinel + NAV_Catalyst)
Trigger: JuniorRatio < MinJuniorRatio (default: 2000 bps = 20%)
```

### Capital Preservation Mode

When the Junior Ratio falls below the minimum threshold, the `CapitalPreservationManager` triggers graduated restrictions:

- **Sentinel withdrawals**: blocked (queued for post-lift processing)
- **Catalyst distributions**: suspended
- **Sentinel deposits**: dilution guard blocks deposits that would further reduce the ratio
- **Reserve releases**: blocked until ratio restored and liquidity tests pass
- **Yield routing**: redirected to segregated reserve or locked recapitalization

Lift requires all three conditions: ratio restored, liquidity tests passed, reserve shortfall addressed.

### Non-Redeemable Seed Liquidity

Vaults must be seeded with non-redeemable initial liquidity before accepting public deposits. Seed shares are:
- Permanently locked (default) or time-locked with a configurable expiry
- Non-transferable (enforced via `_update` override)
- Non-redeemable (enforced via `_withdraw` override)
- Counted via `lockedSharesOf()` and `redeemableSharesOf()` view functions

### Timelocked Parameter Changes

Sensitive configuration changes must be queued and wait for a delay period (default: 48 hours) before execution:

| Timelocked | NOT Timelocked |
|---|---|
| `setMinJuniorRatio` | `emergencyPause` |
| `setPairedVault` | `emergencyUnpause` |
| `setVaultClass` | `triggerPreservationMode` |
| `setPreservationManager` | `liftPreservationMode` |
| `assignEmergencyRole` | `depositToReserve` |
| `setDepositCap` | `routeYield` |
| `setTimelockDelay` | `processQueue` |

Pattern: `queueParameterChange(selector, data)` → wait `timelockDelay` → `executeParameterChange(changeId)`

---

## Testing

### Foundry (Solidity)

```bash
forge test
```

| Suite | Tests | Scope |
|---|---|---|
| `CapitalPreservationModeTest` | 22 | CPM lifecycle: ratio computation, trigger, withdrawal blocking, queue, lift, dilution guard, yield routing, reserve gating |
| `SeedLiquidityAndTimelockTest` | 38 | Seed lifecycle, deposit rejection, share locks (withdrawal + transfer), lock extension, timelock queue/execute/cancel, selector validation |
| `DonationAttackTest` | 4 | Virtual-offset donation attack mitigation, dust deposit rejection, deposit cap, emergency pause |
| **Total** | **64** | All passing |

### Jest (TypeScript Backend)

```bash
npx jest
```

- 10 test suites, 95 tests — all passing
- Covers: capital request workflows, covenant enforcement, VRDCT signals, reconciliation, policy-loan subsystem

### TypeScript Compilation

```bash
npx tsc --noEmit
```

Zero compilation errors.

---

## Quick Start

### Prerequisites

- Node.js 20+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- npm

### Install Dependencies

```bash
npm install
cd frontend && npm install
```

### Run Tests

```bash
# Solidity tests
forge test

# Backend tests
npx jest

# Frontend build
cd frontend && npm run build
```

### Start Dev Server

```bash
cd frontend && npm run dev
# → http://localhost:3000
```

---

## Deployment

### Contract Deployment Sequence

1. Deploy asset token (or use existing ERC-20)
2. Deploy `SentinelVault(asset, "Sentinel", "SEN", depositCap)`
3. Deploy `CatalystVault(asset, "Catalyst", "CAT", depositCap)`
4. Set minimum junior ratio on both vaults: `setMinJuniorRatio(2000)`
5. Pair vaults: `sentinel.setPairedVault(catalyst)`, `catalyst.setPairedVault(sentinel)`
6. Deploy `CapitalPreservationManager(sentinel, catalyst, reserveTarget)`
7. Authorize manager: `sentinel.setPreservationManager(manager)`, `catalyst.setPreservationManager(manager)`
8. Set liquidity test result: `sentinel.setLiquidityTestResult(true)`, `catalyst.setLiquidityTestResult(true)`
9. Set minimum seed deposits: `vault.setMinimumSeedDeposit(amount)`
10. Seed vaults: `vault.seedVault(seedAmount, 0)` (0 = permanent lock)
11. (Optional) Assign emergency role: `vault.assignEmergencyRole(emergencyAddress)`
12. (Optional) Enable Catalyst recapitalization: `catalyst.enableRecapitalization(navDropThreshold)`

### Post-Deployment Verification

```
✓ sentinel.vaultClass() == Sentinel (1)
✓ catalyst.vaultClass() == Catalyst (2)
✓ sentinel.pairedVault() == address(catalyst)
✓ catalyst.pairedVault() == address(sentinel)
✓ sentinel.preservationManager() == address(manager)
✓ sentinel.isSeeded() == true
✓ !sentinel.preservationModeActive()
✓ !catalyst.distributionsSuspended()
```

---

## Security Posture

- **Donation attack mitigation**: Virtual assets/shares with 6-decimal offset (`_DECIMALS_OFFSET = 6`)
- **Seed liquidity**: Non-redeemable initial deposit prevents inflation attacks
- **Timelocked governance**: 48-hour default delay on sensitive parameter changes
- **Role separation**: Admin, emergency role, and preservation manager are distinct
- **Emergency controls**: Pause/unpause available without timelock for rapid response

**Security statement**: "Vaults use virtual assets, virtual shares, and a configurable decimals offset to materially reduce the economic viability of ERC-4626 donation and rounding attacks."

**Prohibited statements**: "Zero gas overhead", "Fully neutralized", "No inflation attack possible", "Audited means safe", "Immutable means risk-free."

---

## License

UNLICENSED

## Repository

`github.com/dibs-financial/dibs-trust-capital-network`

## Operator

Cornerstone Creative Capital LLC — Parent: H.E.R.I.&A. HOLDINGS LLC
