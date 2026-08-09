# DIBS Trust Capital Network — Capital Preservation Mode & Vault Architecture Technical Documentation

## Executive Summary & System Overview

This technical documentation provides a comprehensive, exhaustive specification of the **Capital Preservation Mode (CPM)**, **Non-Redeemable Seed Liquidity**, and **Timelocked Parameter Changes** implemented across the DIBS Trust Capital Network monorepo smart contracts (`contracts/vault/`).

The architecture establishes a dual-tranche, ERC-4626-compliant capital structure designed for institutional-grade risk isolation, dynamic buffer enforcement, and protection against inflation/donation attacks. The primary contracts governed by this documentation are:

- **`DIBSVault.sol`**: Core ERC-4626 vault with virtual assets/shares offset (`_DECIMALS_OFFSET = 6`), seed liquidity controls, timelocked administration, and core Capital Preservation accounting.
- **`SentinelVault.sol`**: Senior-priority (Class A) vault providing senior economic claims, redemptions, and FIFO withdrawal queueing during preservation mode.
- **`CatalystVault.sol`**: Subordinated first-loss (Class B) vault providing a first-loss capital buffer, distribution suspension, recapitalization mechanics, and yield routing.
- **`CapitalPreservationManager.sol`**: Cross-vault coordinator monitoring system health (`JuniorRatio`), triggering preservation mode across paired vaults, and enforcing lifting criteria.

---

## 1. Architectural Overview

```
                      +------------------------------------------+
                      |       CapitalPreservationManager         |
                      |  (Cross-Vault Health & Monitoring)       |
                      +--------------------+---------------------+
                                           |
                    checkAndTrigger() / liftPreservation()
                                           |
                 +-------------------------+-------------------------+
                 |                                                   |
                 v                                                   v
    +-------------------------+                         +-------------------------+
    |     SentinelVault       | <---- Paired Vault ----> |      CatalystVault      |
    |   (Senior / Class A)    |                         |  (Subordinated Class B) |
    +-------------------------+                         +-------------------------+
    | - Senior economic claim |                         | - First-loss buffer     |
    | - Withdrawal FIFO Queue |                         | - Residual yield claim  |
    | - Dilution Guard        |                         | - Suspended yield route |
    +-------------------------+                         +-------------------------+
                 |                                                   |
                 +-------------------------+-------------------------+
                                           |
                                           v
                            +-----------------------------+
                            |         DIBSVault           |
                            |   (ERC-4626 Core Base)      |
                            +-----------------------------+
                            | - Virtual Offset (10^6)     |
                            | - Seed Liquidity Lock       |
                            | - Timelocked Admin Params   |
                            | - Reserve Accounting        |
                            +-----------------------------+
```

### 1.1 Capital Waterfall & Dual-Tranche Mechanics
The DIBS network splits deposited asset capital into two economic classes:
1. **Senior Class A (`SentinelVault`)**: Holds priority claim on underlying assets. Absorbs losses only after Class B capital is fully wiped out. Yield target is prioritized, but subject to liquidity constraints and redemption limits.
2. **Subordinated Class B (`CatalystVault`)**: First-loss capital buffer absorbing all protocol/credit losses before Sentinel. Earns residual yields, but subject to distribution suspension, yield redirection, and share dilution via recapitalization.

### 1.2 Dynamic Capital Floor (`JuniorRatio`)
The system maintains dynamic risk coverage by computing the ratio of junior (first-loss) capital relative to total system Net Asset Value (NAV):

$$	ext{JuniorRatioBps} = rac{	ext{NAV}_{	ext{Catalyst}}}{	ext{NAV}_{	ext{Sentinel}} + 	ext{NAV}_{	ext{Catalyst}}} 	imes 10,000$$

Where $	ext{MinJuniorRatioBps}$ (default: $2,000$ bps = $20\%$) defines the critical threshold. If $	ext{JuniorRatioBps} < 	ext{MinJuniorRatioBps}$, the system enters **Capital Preservation Mode (CPM)**.

### 1.3 ERC-4626 Virtual Offset Mitigation
To eliminate zero-share inflation/donation attacks inherent in standard ERC-4626 vaults, `DIBSVault` implements OpenZeppelin's virtual assets and virtual shares model with a fixed decimal offset:
- `_DECIMALS_OFFSET = 6` ($10^6$)
- Conversion formula:
  $$	ext{Shares} = 	ext{Assets} 	imes rac{	ext{TotalSupply} + 10^6}{	ext{TotalAssets} + 1}$$

---

## 2. Three Implementation Phases Specification

### 2.1 Phase 1: Capital Preservation Mode (CPM) [Commit `712f539`]
Phase 1 introduces the automated defensive state machine governing cross-vault liquidity and loss isolation.

#### Core Functionality:
- **`DIBSVault.sol`**: Contains core preservation state (`preservationModeActive`, `preservationModeTriggeredAt`, `preservationModeDurationHours`), paired vault reference (`pairedVault`), and methods for triggering, lifting, computing junior ratio (`computeJuniorRatioBps`), evaluating dilution risks (`wouldDiluteJuniorRatio`), and gating reserve releases (`canReleaseReserve`).
- **`SentinelVault.sol`**: Implements `WithdrawalRequest` struct and an array-based FIFO `withdrawalQueue`. When CPM is active, direct redemptions revert, requiring users to call `queueWithdrawal()`. When CPM is lifted, `processQueue()` processes queued requests in batches.
- **`CatalystVault.sol`**: Suspends distributions during CPM (`distributionsSuspended`). Diverts yield away from Class B holders using `YieldDestination` enum (`CatalystVault`, `SegregatedReserve`, `LockedRecapitalization`, `RetainedEarnings`). Enables recapitalization (`RecapitalizationEvent`, `executeRecapitalization`) to mint new shares and restore junior coverage.
- **`CapitalPreservationManager.sol`**: Permissionless monitoring engine via `checkAndTrigger()`. Calculates shortfall against `reserveTarget`, invokes `triggerPreservationMode()` on both vaults, suspends Catalyst distributions, and coordinates lifting via `liftPreservation()`.

---

### 2.2 Phase 2: Non-Redeemable Seed Liquidity + Minimum Initial Deposit [Commit `88bb309`]
Phase 2 protects against exchange-rate manipulation prior to public deposits by requiring a mandatory seeding step by the admin.

#### Core Functionality:
- **State Variables**: `isSeeded` (bool flag), `minimumSeedDeposit` (min asset threshold), `seedShares` (amount of seed shares minted), `seedLockExpiry` ($0$ = permanent, $>0$ = timestamp).
- **Constant**: `SEED_LOCK_PERMANENT = 0`.
- **Seeding Flow**:
  1. Admin sets `minimumSeedDeposit` via `setMinimumSeedDeposit()`.
  2. Admin calls `seedVault(assets, lockExpiry)`.
  3. `seedVault()` transfers tokens, mints `seedShares` directly via `_mint()`, sets `isSeeded = true`, and records `seedLockExpiry`.
- **Internal Overrides Enforcing Seed Lock**:
  - `_deposit()`: Enforces `require(isSeeded, "DIBS: vault not seeded")` before any public deposit is processed.
  - `_withdraw()`: Checks `lockedSharesOf(owner)`. Reverts with `"DIBS: cannot withdraw locked seed shares"` if caller attempts to burn locked seed shares.
  - `_update()` (ERC-20 transfer): Checks `lockedSharesOf(from)`. Reverts with `"DIBS: cannot transfer locked seed shares"` if transferring locked seed shares.
- **Lock Management**: `extendSeedLock(newExpiry)` allows admin to extend or permanently lock seed shares (cannot shorten lock). `isSeedUnlocked()`, `lockedSharesOf(account)`, and `redeemableSharesOf(account)` provide view queries.

---

### 2.3 Phase 3: Timelocked Parameter Changes [Commit `88bb309`]
Phase 3 implements a governance security timelock delay for sensitive configuration changes, preventing flash administrative exploits.

#### Core Functionality:
- **`ParameterChange` Struct**:
  ```solidity
  struct ParameterChange {
      bytes4 selector;       // Target function selector
      bytes data;            // ABI-encoded arguments
      uint256 queuedAt;      // Queue timestamp
      uint256 executeAfter;  // Execution unlock timestamp
      bool executed;         // Execution status
      bool cancelled;        // Cancellation status
  }
  ```
- **Timelock Delay Constants**:
  - `MIN_TIMELOCK_DELAY = 1 hours`
  - `MAX_TIMELOCK_DELAY = 7 days`
  - `DEFAULT_TIMELOCK_DELAY = 48 hours`
- **Execution Workflow**:
  1. Admin calls `queueParameterChange(selector, data)`. Generates `changeId = keccak256(abi.encodePacked(selector, data, block.timestamp))`. Sets `executeAfter = block.timestamp + timelockDelay`.
  2. After delay passes, admin calls `executeParameterChange(changeId)`. Executes target function via low-level `address(this).delegatecall(abi.encodePacked(selector, data))`.
  3. Admin can cancel pending changes via `cancelParameterChange(changeId)`.
- **Timelocked Selectors (`isTimelockedSelector`)**:
  - `setMinJuniorRatio(uint256)` (`0x2774aeb9`)
  - `setPairedVault(address)` (`0xa1cbfae6`)
  - `setVaultClass(uint8)` (`0x11e5f8f8`)
  - `setPreservationManager(address)` (`0x3e1be877`)
  - `assignEmergencyRole(address)` (`0x7144e1f7`)
  - `setDepositCap(uint256)` (`0x8035ed39`)
  - `setTimelockDelay(uint256)` (`0x42fcfb03`)
- **Emergency Exemption**: Emergency actions (`emergencyPause()`, `emergencyUnpause()`) bypass the timelock for immediate incident response.

---

## 3. Complete State Model

### 3.1 `DIBSVault.sol` State Variables
| Variable Name | Type | Visibility / Mutability | Description | Phase Introduced |
| :--- | :--- | :--- | :--- | :--- |
| `_DECIMALS_OFFSET` | `uint8` | `internal constant` | Virtual decimals offset ($6$) for ERC-4626 inflation attack prevention | Base |
| `MIN_SHARES_OUT` | `uint256` | `public constant` | Minimum shares output threshold ($1,000$) | Base |
| `depositCap` | `uint256` | `public` | Maximum total assets vault can hold ($0$ = unlimited) | Base |
| `paused` | `bool` | `public` | Pause flag for deposits/withdrawals | Base |
| `admin` | `address` | `public` | Governance/admin address | Base |
| `emergencyRole` | `address` | `public` | Emergency pause operator address | Base |
| `preservationManager` | `address` | `public` | CapitalPreservationManager contract address | Phase 1 |
| `isSeeded` | `bool` | `public` | True if vault received initial seed deposit | Phase 2 |
| `minimumSeedDeposit` | `uint256` | `public` | Minimum required seed asset amount | Phase 2 |
| `seedShares` | `uint256` | `public` | Total seed shares minted to admin | Phase 2 |
| `seedLockExpiry` | `uint256` | `public` | Unlock timestamp ($0$ = permanently locked) | Phase 2 |
| `SEED_LOCK_PERMANENT`| `uint256` | `public constant` | Constant defining permanent lock ($0$) | Phase 2 |
| `pendingChanges` | `mapping(bytes32 => ParameterChange)` | `public` | Mapping of changeId to ParameterChange struct | Phase 3 |
| `timelockDelay` | `uint256` | `public` | Current timelock delay in seconds | Phase 3 |
| `MIN_TIMELOCK_DELAY` | `uint256` | `public constant` | Minimum timelock delay ($1	ext{ hour}$) | Phase 3 |
| `MAX_TIMELOCK_DELAY` | `uint256` | `public constant` | Maximum timelock delay ($7	ext{ days}$) | Phase 3 |
| `DEFAULT_TIMELOCK_DELAY`| `uint256` | `public constant` | Default timelock delay ($48	ext{ hours}$) | Phase 3 |
| `preservationModeActive`| `bool` | `public` | True if Capital Preservation Mode is active | Phase 1 |
| `preservationModeTriggeredAt`| `uint256` | `public` | Timestamp when CPM was triggered | Phase 1 |
| `preservationModeDurationHours`| `uint256` | `public` | Duration in hours of last CPM session | Phase 1 |
| `minJuniorRatioBps` | `uint256` | `public` | Minimum Junior Ratio in bps (default: $2,000$ = $20\%$) | Phase 1 |
| `pairedVault` | `address` | `public` | Reference to counterpart vault (Sentinel $\leftrightarrow$ Catalyst) | Phase 1 |
| `segregatedReserve` | `uint256` | `public` | Reserve assets held in segregated buffer | Phase 1 |
| `lockedRecapitalizationBalance`| `uint256` | `public` | Balance reserved for recapitalization | Phase 1 |
| `liquidityTestsPassed`| `bool` | `public` | True if off-chain/on-chain liquidity tests pass | Phase 1 |
| `vaultClass` | `VaultClass` | `public` | Enum specifying Generic, Sentinel, or Catalyst | Phase 1 |

---

### 3.2 `SentinelVault.sol` State Variables
| Variable Name | Type | Visibility / Mutability | Description |
| :--- | :--- | :--- | :--- |
| `withdrawalQueue` | `WithdrawalRequest[]` | `public` | Array storing queued withdrawal requests |
| `totalQueuedAssets` | `uint256` | `public` | Total assets currently queued in withdrawal requests |
| `maxQueueSize` | `uint256` | `public` | Maximum allowed queue size ($100$) |
| `queueProcessingBatchSize`| `uint256` | `public` | Default batch size for queue processing ($10$) |
| `maxRedemptionPerWindow`| `uint256` | `public` | Max assets redeemable within time window |
| `redemptionWindowSeconds`| `uint256` | `public` | Time window duration for redemption limits ($1	ext{ day}$) |
| `redemptionsInWindow` | `mapping(uint256 => uint256)`| `public` | Window start timestamp $	o$ total assets redeemed |

---

### 3.3 `CatalystVault.sol` State Variables
| Variable Name | Type | Visibility / Mutability | Description |
| :--- | :--- | :--- | :--- |
| `distributionsSuspended`| `bool` | `public` | True if yield distributions are suspended |
| `distributionSuspensionTimestamp`| `uint256` | `public` | Timestamp when distributions were suspended |
| `recapitalizationHistory`| `RecapitalizationEvent[]`| `public` | Historical array of recapitalization events |
| `recapitalizationThreshold`| `uint256` | `public` | Minimum NAV drop required to enable recapitalization |
| `recapitalizationEnabled`| `bool` | `public` | Flag enabling recapitalization minting |
| `yieldDestination` | `YieldDestination` | `public` | Enum routing yield (Catalyst, Reserve, Recap, Retained) |
| `retainedEarnings` | `uint256` | `public` | Retained earnings accumulated during preservation |
| `totalYieldRoutedToReserve`| `uint256` | `public` | Cumulative yield routed to segregated reserve |
| `totalYieldRoutedToRecap`| `uint256` | `public` | Cumulative yield routed to recapitalization balance |

---

### 3.4 `CapitalPreservationManager.sol` State Variables
| Variable Name | Type | Visibility / Mutability | Description |
| :--- | :--- | :--- | :--- |
| `sentinel` | `SentinelVault` | `public` | Instance reference to Sentinel Vault |
| `catalyst` | `CatalystVault` | `public` | Instance reference to Catalyst Vault |
| `admin` | `address` | `public` | Administrative governance address |
| `lastCheckedJuniorRatioBps`| `uint256` | `public` | Last calculated Junior Ratio in bps |
| `lastCheckTimestamp` | `uint256` | `public` | Timestamp of last health check |
| `autoTriggerEnabled` | `bool` | `public` | Flag enabling permissionless trigger execution |
| `reserveShortfall` | `uint256` | `public` | Calculated reserve shortfall amount |
| `reserveTarget` | `uint256` | `public` | Target reserve asset amount |

---

### 3.5 Structs & Enums

#### Struct: `SentinelVault.WithdrawalRequest`
```solidity
struct WithdrawalRequest {
    address user;         // User requesting withdrawal
    uint256 assets;       // Target asset amount
    uint256 shares;       // Corresponding shares to burn
    uint256 requestedAt;  // Request timestamp
    bool processed;       // Execution status
}
```

#### Struct: `CatalystVault.RecapitalizationEvent`
```solidity
struct RecapitalizationEvent {
    uint256 amountRaised;      // Asset capital injected
    uint256 sharesIssued;      // New Catalyst shares minted
    uint256 preRecapNAV;       // NAV prior to recapitalization
    uint256 postRecapNAV;      // NAV after recapitalization
    uint256 timestamp;         // Event timestamp
    uint256 dilutionFactorBps; // Dilution factor in bps (oldSupply / newSupply * 10000)
}
```

#### Enum: `DIBSVault.VaultClass`
```solidity
enum VaultClass { Generic, Sentinel, Catalyst }
```

#### Enum: `CatalystVault.YieldDestination`
```solidity
enum YieldDestination { CatalystVault, SegregatedReserve, LockedRecapitalization, RetainedEarnings }
```

---

## 4. Access Control Architecture

### 4.1 Modifiers Specification
- **`onlyAdmin`**: Enforces `msg.sender == admin`. Used for critical parameter changes, timelocked administration, and reserve releases.
- **`onlyEmergency`**: Enforces `msg.sender == emergencyRole`. Used exclusively for immediate emergency pausing.
- **`onlyAdminOrManager`**: Enforces `msg.sender == admin || msg.sender == preservationManager`. Used for routine operational management (reserve deposits, liquidity test updates, queue processing).
- **`onlyPreservationManager`**: Enforces `msg.sender == admin || msg.sender == emergencyRole || msg.sender == preservationManager`. Used for triggering and lifting preservation mode.
- **`notPaused`**: Enforces `!paused`. Prevents deposits/withdrawals while contract is paused.
- **`onlySeeded`**: Enforces `isSeeded == true`. Prevents public deposits/minting before seed liquidity is established.

### 4.2 Role Matrix
| Role | Capabilities | Managed Contracts |
| :--- | :--- | :--- |
| **Admin** | Full system administration, seed vault, queue/execute/cancel timelocked parameter changes, lift preservation, set emergency roles, adjust deposit caps | `DIBSVault`, `SentinelVault`, `CatalystVault`, `CapitalPreservationManager` |
| **Emergency Role** | Pause vault (`emergencyPause`), trigger preservation mode | `DIBSVault` |
| **Preservation Manager** | Trigger/lift CPM across vaults, process queue, route yields, update liquidity test results | `CapitalPreservationManager` |
| **Public / Any User** | Deposit/withdraw (when unpaused & seeded), queue withdrawals during CPM, invoke permissionless `checkAndTrigger()` monitoring | All contracts |

---

## 5. Functional Specification

### 5.1 `DIBSVault.sol` Functions

#### `setMinimumSeedDeposit(uint256 amount)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Preconditions**: `!isSeeded` ("DIBS: already seeded"), `amount > 0` ("DIBS: zero seed deposit").
- **Mutations**: `minimumSeedDeposit = amount`.
- **Events**: `MinimumSeedDepositSet(amount)`.

#### `seedVault(uint256 assets, uint256 lockExpiry_)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Preconditions**: `!isSeeded` ("DIBS: already seeded"), `assets >= minimumSeedDeposit` ("DIBS: seed below minimum"), `minimumSeedDeposit > 0` ("DIBS: minimum seed deposit not set"), if `lockExpiry_ != 0` then `lockExpiry_ > block.timestamp` ("DIBS: lock expiry in past"), calculated `shares > 0` ("DIBS: zero seed shares").
- **Mutations**: Transfers `assets` from admin to vault. Mints `shares` directly to admin via `_mint()`. Sets `isSeeded = true`, `seedShares = shares`, `seedLockExpiry = lockExpiry_`.
- **Events**: `VaultSeeded(msg.sender, assets, shares, lockExpiry_)`.

#### `extendSeedLock(uint256 newExpiry)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Preconditions**: `isSeeded` ("DIBS: not seeded"), if `seedLockExpiry != 0` then `newExpiry == 0 || newExpiry > seedLockExpiry` ("DIBS: cannot shorten lock").
- **Mutations**: Updates `seedLockExpiry = newExpiry`.
- **Events**: `SeedLockUpdated(newExpiry)`.

#### `isSeedUnlocked()`
- **Visibility**: `public view returns (bool)`
- **Logic**: Returns `false` if `!isSeeded` or `seedLockExpiry == 0` (permanent lock). Returns `block.timestamp >= seedLockExpiry`.

#### `lockedSharesOf(address account)`
- **Visibility**: `public view returns (uint256)`
- **Logic**: Returns `0` if `!isSeeded` or `isSeedUnlocked()`. If `account == admin`, returns `min(balanceOf(admin), seedShares)`. Otherwise returns `0`.

#### `redeemableSharesOf(address account)`
- **Visibility**: `public view returns (uint256)`
- **Logic**: Returns `balanceOf(account) - lockedSharesOf(account)`.

#### `queueParameterChange(bytes4 selector, bytes calldata data)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin` | **Returns**: `bytes32 changeId`
- **Preconditions**: `selector != bytes4(0)` ("DIBS: zero selector"), `isTimelockedSelector(selector)` ("DIBS: selector not timelocked"), `pendingChanges[changeId].queuedAt == 0` ("DIBS: change already queued").
- **Mutations**: Computes `changeId = keccak256(abi.encodePacked(selector, data, block.timestamp))`. Stores `ParameterChange` struct with `executeAfter = block.timestamp + timelockDelay`.
- **Events**: `ParameterChangeQueued(changeId, selector, executeAfter)`.

#### `executeParameterChange(bytes32 changeId)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Preconditions**: `change.queuedAt != 0` ("DIBS: change not found"), `!change.executed` ("DIBS: already executed"), `!change.cancelled` ("DIBS: change cancelled"), `block.timestamp >= change.executeAfter` ("DIBS: timelock not expired"). Delegatecall execution must succeed ("DIBS: parameter change execution failed").
- **Mutations**: Sets `change.executed = true`. Performs `address(this).delegatecall(abi.encodePacked(change.selector, change.data))`.
- **Events**: `ParameterChangeExecuted(changeId, change.selector)`.

#### `cancelParameterChange(bytes32 changeId)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Preconditions**: `change.queuedAt != 0` ("DIBS: change not found"), `!change.executed` ("DIBS: already executed").
- **Mutations**: Sets `change.cancelled = true`.
- **Events**: `ParameterChangeCancelled(changeId)`.

#### `setTimelockDelay(uint256 newDelay)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Preconditions**: `newDelay >= MIN_TIMELOCK_DELAY && newDelay <= MAX_TIMELOCK_DELAY` ("DIBS: delay out of range").
- **Mutations**: Updates `timelockDelay = newDelay`.
- **Events**: `TimelockDelayUpdated(newDelay)`.

#### `triggerPreservationMode(uint256 juniorRatioBps_, uint256 reserveShortfall_)`
- **Visibility**: `external` | **Modifier**: `onlyPreservationManager`
- **Preconditions**: `!preservationModeActive` ("DIBS: preservation mode already active"), `juniorRatioBps_ < minJuniorRatioBps` ("DIBS: ratio above minimum").
- **Mutations**: Sets `preservationModeActive = true`, `preservationModeTriggeredAt = block.timestamp`, `preservationModeDurationHours = 0`.
- **Events**: `CapitalPreservationTriggered`, and if `vaultClass == Catalyst`, emits `DistributionSuspended`.

#### `liftPreservationMode(uint256 restoredJuniorRatioBps_, uint256 reserveRebuiltAmount_)`
- **Visibility**: `external` | **Modifier**: `onlyPreservationManager`
- **Preconditions**: `preservationModeActive` ("DIBS: preservation mode not active"), `restoredJuniorRatioBps_ >= minJuniorRatioBps` ("DIBS: ratio still below minimum"), `liquidityTestsPassed` ("DIBS: liquidity tests not passed").
- **Mutations**: Sets `preservationModeActive = false`, calculates `preservationModeDurationHours`.
- **Events**: `CapitalPreservationLifted`, and if `vaultClass == Catalyst`, emits `DistributionResumed`.

#### Internal Overrides (`_deposit`, `_withdraw`, `_update`)
- **`_deposit(caller, receiver, assets, shares)`**: Reverts if `!isSeeded` ("DIBS: vault not seeded"), `shares < MIN_SHARES_OUT` ("DIBS: shares below minimum"), `paused` ("DIBS: paused"), or total assets exceed `depositCap` ("DIBS: deposit cap exceeded"). If CPM is active and `vaultClass == Sentinel`, reverts if `wouldDiluteJuniorRatio(assets)` ("DIBS: deposit blocked during preservation mode (dilution)").
- **`_withdraw(caller, receiver, owner, assets, shares)`**: Reverts if `paused`. Reverts if `shares > freeShares` ("DIBS: cannot withdraw locked seed shares"). If CPM is active: reverts for Sentinel ("DIBS: Sentinel withdrawals blocked during preservation mode") and Catalyst ("DIBS: Catalyst distributions suspended during preservation mode").
- **`_update(from, to, value)`**: If `from != address(0)`, enforces `value <= freeShares` ("DIBS: cannot transfer locked seed shares").

---

### 5.2 `SentinelVault.sol` Functions

#### `queueWithdrawal(uint256 assets, uint256 shares)`
- **Visibility**: `external` | **Returns**: `uint256 queuePosition`
- **Preconditions**: `preservationModeActive` ("DIBS: preservation mode not active"), `withdrawalQueue.length < maxQueueSize` ("DIBS: queue full").
- **Mutations**: Pushes `WithdrawalRequest` to `withdrawalQueue`. Increases `totalQueuedAssets += assets`.
- **Events**: `WithdrawalQueuedInVault`, `WithdrawalQueued`.

#### `processQueue(uint256 maxCount)`
- **Visibility**: `external` | **Modifier**: `onlyAdminOrManager`
- **Preconditions**: `!preservationModeActive` ("DIBS: preservation mode still active").
- **Mutations**: Iterates FIFO through `withdrawalQueue`, processes up to `maxCount` unprocessed requests, marks `req.processed = true`, reduces `totalQueuedAssets`, and invokes `_withdraw` to transfer assets to user.
- **Events**: `WithdrawalProcessed`, `QueueDrained`.

#### `setRedemptionLimits(uint256 maxPerWindow, uint256 windowSeconds)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Mutations**: Sets `maxRedemptionPerWindow` and `redemptionWindowSeconds`.

---

### 5.3 `CatalystVault.sol` Functions

#### `suspendDistributions()` / `resumeDistributions()`
- **Visibility**: `external` | **Modifier**: `onlyAdminOrManager`
- **Mutations**: Toggles `distributionsSuspended` and sets `yieldDestination` to `SegregatedReserve` (suspended) or `CatalystVault` (resumed).
- **Events**: `DistributionsSuspended`, `DistributionsResumed`.

#### `routeYield(uint256 amount)`
- **Visibility**: `external` | **Modifier**: `onlyAdminOrManager`
- **Preconditions**: `amount > 0` ("DIBS: zero amount").
- **Mutations**: Routes yield assets to `segregatedReserve`, `lockedRecapitalizationBalance`, or `retainedEarnings` based on `yieldDestination`.
- **Events**: `YieldRouted(yieldDestination, amount)`.

#### `executeRecapitalization(uint256 amountRaised, uint256 sharesIssued, uint256 preRecapNAV)`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Preconditions**: `recapitalizationEnabled` ("DIBS: recapitalization not enabled"), `amountRaised > 0 && sharesIssued > 0` ("DIBS: zero recap").
- **Mutations**: Mints `sharesIssued` to `msg.sender`. Computes `dilutionFactorBps = oldSupply * 10000 / (oldSupply + sharesIssued)`. Records `RecapitalizationEvent`.
- **Events**: `RecapitalizationExecuted`.

---

### 5.4 `CapitalPreservationManager.sol` Functions

#### `checkAndTrigger()`
- **Visibility**: `external` | **Returns**: `bool triggered`
- **Preconditions**: `autoTriggerEnabled == true`, `!sentinel.preservationModeActive()`.
- **Logic**: Reads `sentinel.computeJuniorRatioBps()`. If ratio $< 	ext{minJuniorRatioBps}$, computes `reserveShortfall`, calls `triggerPreservationMode` on Sentinel and Catalyst, suspends Catalyst distributions.
- **Events**: `PreservationTriggered`.

#### `liftPreservation()`
- **Visibility**: `external` | **Modifier**: `onlyAdmin`
- **Preconditions**: Vaults in preservation mode, `juniorRatio >= minJuniorRatioBps` ("DIBS: ratio still below minimum"), `sentinel.liquidityTestsPassed()` ("DIBS: liquidity tests not passed"), `reserveShortfall == 0 || sentinel.segregatedReserve() >= reserveTarget - reserveShortfall` ("DIBS: reserve shortfall not addressed").
- **Mutations**: Lifts CPM on both vaults, resumes Catalyst distributions, processes Sentinel queue up to queue length.
- **Events**: `PreservationLifted`.

---

## 6. Event Catalogue

| Event Name | Signature / Parameters | Emitting Contract | Trigger Condition |
| :--- | :--- | :--- | :--- |
| `CapitalPreservationTriggered` | `(uint256 indexed timestamp, uint256 juniorRatioBps, uint256 minJuniorRatioBps, uint256 reserveShortfall)` | `DIBSVault` | CPM triggered on vault |
| `CapitalPreservationLifted` | `(uint256 indexed timestamp, uint256 restoredJuniorRatioBps, uint256 reserveRebuiltAmount)` | `DIBSVault` | CPM lifted on vault |
| `ReserveDeposited` | `(uint256 indexed amount, uint256 indexed newTotal)` | `DIBSVault` | Assets deposited to segregated reserve |
| `ReserveReleased` | `(uint256 indexed amount, uint256 indexed newTotal)` | `DIBSVault` | Assets released from reserve |
| `WithdrawalQueued` | `(address indexed user, uint256 indexed assets, uint256 queuePosition)` | `DIBSVault` | Generic withdrawal queued event |
| `DistributionSuspended` | `(uint256 indexed timestamp)` | `DIBSVault` / `CatalystVault` | Catalyst distributions suspended |
| `DistributionResumed` | `(uint256 indexed timestamp)` | `DIBSVault` / `CatalystVault` | Catalyst distributions resumed |
| `PairedVaultSet` | `(address indexed pairedVault)` | `DIBSVault` | Counterpart vault paired |
| `VaultSeeded` | `(address indexed depositor, uint256 assets, uint256 shares, uint256 lockExpiry)` | `DIBSVault` | Seed deposit executed |
| `SeedLockUpdated` | `(uint256 newExpiry)` | `DIBSVault` | Seed lock expiry extended or made permanent |
| `MinimumSeedDepositSet` | `(uint256 amount)` | `DIBSVault` | Minimum seed deposit threshold updated |
| `ParameterChangeQueued` | `(bytes32 indexed changeId, bytes4 indexed selector, uint256 executeAfter)` | `DIBSVault` | Timelocked parameter change queued |
| `ParameterChangeExecuted`| `(bytes32 indexed changeId, bytes4 indexed selector)` | `DIBSVault` | Timelocked change executed via delegatecall |
| `ParameterChangeCancelled`| `(bytes32 indexed changeId)` | `DIBSVault` | Pending parameter change cancelled |
| `TimelockDelayUpdated` | `(uint256 newDelay)` | `DIBSVault` | Governance timelock delay modified |
| `WithdrawalQueuedInVault`| `(address indexed user, uint256 assets, uint256 shares, uint256 queuePosition)` | `SentinelVault` | Withdrawal queued during CPM |
| `WithdrawalProcessed` | `(address indexed user, uint256 assets, uint256 queueIndex)` | `SentinelVault` | Queued withdrawal request processed |
| `QueueDrained` | `(uint256 processedCount, uint256 totalAssets)` | `SentinelVault` | Queue processing batch completed |
| `RecapitalizationExecuted`| `(uint256 indexed amountRaised, uint256 sharesIssued, uint256 preRecapNAV, uint256 postRecapNAV, uint256 dilutionFactorBps)` | `CatalystVault` | Capital recapitalization executed |
| `YieldRouted` | `(YieldDestination indexed destination, uint256 amount)` | `CatalystVault` | Yield redirected during CPM |
| `PreservationTriggered` | `(uint256 juniorRatioBps, uint256 minJuniorRatioBps, uint256 shortfall)` | `CapitalPreservationManager` | Manager triggers CPM system-wide |
| `PreservationLifted` | `(uint256 restoredRatioBps, uint256 reserveRebuilt)` | `CapitalPreservationManager` | Manager lifts CPM system-wide |
| `AutoTriggerEnabled` | `(bool enabled)` | `CapitalPreservationManager` | Auto-trigger setting updated |
| `ReserveTargetSet` | `(uint256 target)` | `CapitalPreservationManager` | Reserve target amount updated |
| `ReserveShortfallUpdated`| `(uint256 shortfall)` | `CapitalPreservationManager` | Reserve shortfall updated |

---

## 7. CPM Lifecycle State Machine & Transition Diagrams

```
                    +--------------------------------+
                    |           UNSEEDED             |
                    +---------------+----------------+
                                    |
                                    | setMinimumSeedDeposit() + seedVault()
                                    v
                    +--------------------------------+
                    |             NORMAL             |
                    |   (Unpaused, Seeded, CPM Off)  |
                    +---------------+----------------+
                                    |
                                    | JuniorRatio < MinJuniorRatio
                                    | (checkAndTrigger)
                                    v
                    +--------------------------------+
                    |   CAPITAL PRESERVATION MODE    |
                    |  - Sentinel Withdrawals Blocked|
                    |  - Catalyst Yield Suspended    |
                    |  - Dilutive Deposits Blocked   |
                    +---------------+----------------+
                                    |
                                    | queueWithdrawal()
                                    v
                    +--------------------------------+
                    |        QUEUEING ACTIVE         |
                    |  Requests stored FIFO in queue |
                    +---------------+----------------+
                                    |
                                    | Ratio Restored + Liquidity Tests Passed
                                    | + Reserve Shortfall Addressed
                                    | (liftPreservation)
                                    v
                    +--------------------------------+
                    |     CPM LIFTED & DRAINING      |
                    |  processQueue() executes FIFO  |
                    +---------------+----------------+
                                    |
                                    | Queue Drained
                                    v
                    +--------------------------------+
                    |             NORMAL             |
                    +--------------------------------+
```

---

## 8. Complete Test Coverage Specification (64 Total Tests)

### 8.1 `CapitalPreservationModeTest.sol` (22 Tests)
1. `test_JuniorRatio_Initial20Percent`: Verifies initial 80e18 Sentinel / 20e18 Catalyst balance yields exactly 2,000 bps (20%).
2. `test_JuniorRatio_WhenCatalystShrinks`: Asserts ratio drops below 2,000 bps when Sentinel NAV increases relative to Catalyst.
3. `test_JuniorRatio_WhenCatalystGrows`: Asserts ratio rises above 3,000 bps when Catalyst receives additional deposits.
4. `test_JuniorRatio_NoPair`: Asserts unpaired vault defaults to 10,000 bps (100%).
5. `test_TriggerPreservation_RatioBelowMinimum`: Tests `checkAndTrigger()` successfully activates CPM and suspends distributions when ratio < 20%.
6. `test_NoTrigger_RatioAtMinimum`: Verifies `checkAndTrigger()` returns false when ratio is exactly 20%.
7. `test_NoTrigger_RatioAboveMinimum`: Verifies `checkAndTrigger()` returns false when ratio > 20%.
8. `test_SentinelWithdrawal_BlockedDuringPreservation`: Asserts `sentinel.withdraw()` reverts with `"DIBS: Sentinel withdrawals blocked during preservation mode"`.
9. `test_SentinelWithdrawal_QueueDuringPreservation`: Confirms `queueWithdrawal()` accepts request and increments `queueLength` during CPM.
10. `test_CatalystWithdrawal_BlockedDuringPreservation`: Asserts `catalyst.withdraw()` reverts with `"DIBS: Catalyst distributions suspended during preservation mode"`.
11. `test_ReserveRelease_BlockedDuringPreservation`: Verifies `canReleaseReserve()` returns false while CPM is active.
12. `test_ReserveRelease_AllowedWhenConditionsMet`: Verifies `canReleaseReserve()` returns true when CPM is inactive and ratio is healthy.
13. `test_LiftPreservation_AfterRatioRestored`: Tests `liftPreservation()` succeeds after depositing additional Catalyst capital to restore ratio.
14. `test_LiftPreservation_BlocksIfRatioStillLow`: Asserts `liftPreservation()` reverts with `"DIBS: ratio still below minimum"` if invoked prematurely.
15. `test_LiftPreservation_BlocksIfLiquidityTestsFail`: Asserts `liftPreservation()` reverts with `"DIBS: liquidity tests not passed"` when `liquidityTestsPassed == false`.
16. `test_QueueProcessing_AfterLift`: Verifies queued withdrawals are processed and drained via `processQueue()` upon lifting CPM.
17. `test_DilutionGuard_BlocksSentinelDepositDuringPreservation`: Asserts Sentinel deposits revert with `"DIBS: deposit blocked during preservation mode (dilution)"`.
18. `test_DilutionGuard_AllowsNonDilutiveDeposit`: Verifies deposits to Catalyst are accepted during CPM as they restore coverage.
19. `test_SystemStatus_ReportsCorrectValues`: Verifies accuracy of all tuple fields returned by `manager.getSystemStatus()`.
20. `test_YieldRouting_ToReserveDuringPreservation`: Verifies `routeYield()` diverts assets to `segregatedReserve` during CPM.
21. `test_ReserveDeposit_IncreasesBalance`: Confirms `depositToReserve()` increases `segregatedReserve` balance.
22. `test_ReserveRelease_BlocksWhenRatioLow`: Asserts `releaseReserve()` reverts with `"DIBS: reserve release not permitted"` when ratio is below threshold.

---

### 8.2 `SeedLiquidityAndTimelockTest.sol` — Seed Liquidity Suite (25 Tests)
1. `test_SetMinimumSeedDeposit`: Confirms `setMinimumSeedDeposit` sets `minimumSeedDeposit`.
2. `test_SetMinimumSeedDeposit_RejectsZero`: Reverts with `"DIBS: zero seed deposit"`.
3. `test_SetMinimumSeedDeposit_RejectsAfterSeeding`: Reverts with `"DIBS: already seeded"`.
4. `test_SeedVault_Success`: Confirms seed shares minted and `isSeeded = true`.
5. `test_SeedVault_RejectsBelowMinimum`: Reverts with `"DIBS: seed below minimum"`.
6. `test_SeedVault_RejectsDoubleSeeding`: Reverts with `"DIBS: already seeded"`.
7. `test_SeedVault_RejectsWithoutMinSet`: Reverts with `"DIBS: minimum seed deposit not set"`.
8. `test_SeedVault_WithTimeLimitedLock`: Confirms time-limited lock expiry recorded.
9. `test_Deposit_RejectedBeforeSeeding`: Reverts public deposits with `"DIBS: vault not seeded"`.
10. `test_Deposit_AcceptedAfterSeeding`: Allows public deposits once seeded.
11. `test_SeedShares_NotRedeemable_PermanentLock`: Reverts admin redemption with `"DIBS: cannot withdraw locked seed shares"`.
12. `test_SeedShares_NotRedeemable_PartialWithdrawal`: Reverts partial redemption of locked seed shares.
13. `test_SeedShares_RedeemableAfterTimeLock`: Permits redemption after `block.timestamp >= seedLockExpiry`.
14. `test_SeedShares_RedeemableAfterDeposit`: Permits admin to redeem non-seed extra deposited shares.
15. `test_SeedShares_NotTransferable_PermanentLock`: Reverts seed share transfers with `"DIBS: cannot transfer locked seed shares"`.
16. `test_SeedShares_PartialTransfer_BlockedIfExceedsFree`: Permits transfer up to free shares, blocks excess.
17. `test_SeedShares_TransferableAfterTimeLock`: Permits transfers after time lock expires.
18. `test_ExtendSeedLock_CanExtend`: Successfully extends `seedLockExpiry`.
19. `test_ExtendSeedLock_CannotShorten`: Reverts shortening lock with `"DIBS: cannot shorten lock"`.
20. `test_ExtendSeedLock_CanMakePermanent`: Converts time lock to permanent lock ($0$).
21. `test_LockedSharesOf_Admin`: Returns exact `seedShares` for admin.
22. `test_LockedSharesOf_NonAdmin`: Returns $0$ for non-admin accounts.
23. `test_RedeemableSharesOf_Admin`: Returns $0$ when admin holds only seed shares.
24. `test_RedeemableSharesOf_AdminWithExtra`: Returns extra deposit balance.
25. `test_LockedShares_ZeroAfterUnlock`: Returns $0$ locked shares after timestamp warp.

---

### 8.3 `SeedLiquidityAndTimelockTest.sol` — Timelocked Parameter Changes Suite (12 Tests)
1. `test_QueueParameterChange_Success`: Verifies parameter change stored in `pendingChanges` with correct delay.
2. `test_ExecuteParameterChange_AfterDelay`: Confirms successful delegatecall execution after timelock delay passes.
3. `test_ExecuteParameterChange_DoubleExecuteReverted`: Reverts duplicate execution with `"DIBS: already executed"`.
4. `test_CancelParameterChange_Success`: Cancels queued change and blocks execution (`"DIBS: change cancelled"`).
5. `test_QueueRejectsNonTimelockedSelector`: Reverts non-whitelisted selector with `"DIBS: selector not timelocked"`.
6. `test_IsTimelockedSelector_ReturnsCorrectValues`: Validates boolean responses for all 7 timelocked selectors vs emergency selectors.
7. `test_SetTimelockDelay_Success`: Updates `timelockDelay` within bounds.
8. `test_SetTimelockDelay_RejectsTooShort`: Reverts $< 1	ext{ hour}$ with `"DIBS: delay out of range"`.
9. `test_SetTimelockDelay_RejectsTooLong`: Reverts $> 7	ext{ days}$ with `"DIBS: delay out of range"`.
10. `test_DefaultTimelockDelay`: Confirms initial delay equals 48 hours.
11. `test_MultipleQueuedChanges`: Manages independent queue hashes concurrently without collisions.
12. `test_DirectCall_StillWorks`: Validates direct admin function call execution.

---

### 8.4 `SeedLiquidityAndTimelockTest.sol` — Integrated Cross-Phase Test (1 Test)
1. `test_SeededVault_AcceptsDeposits_AndEnforcesCPM`: Validates interaction between seed liquidity, deposit acceptance, and CPM enforcement in a single integrated lifecycle.

---

### 8.5 `DonationAttackTest.sol` — Virtual Offset Suite (4 Tests)
1. `test_DonationAttack_VirtualOffsetMitigation`: Demonstrates direct asset donation to vault does not dilute victim's share minting due to $10^6$ virtual offset.
2. `test_MinSharesOut_RevertsOnDustDeposit`: Verifies $1	ext{ wei}$ dust deposit reverts with `"DIBS: shares below minimum"` after massive donation inflation.
3. `test_DepositCap_Enforced`: Asserts deposits exceeding `depositCap` revert with `"DIBS: deposit cap exceeded"`.
4. `test_EmergencyPause_BlocksDeposits`: Asserts deposits revert with `"DIBS: paused"` when paused by emergency role.

---

## 9. Technical Trade-Offs and Design Decisions

1. **Delegatecall Execution in Timelock**:
   - *Decision*: `executeParameterChange` uses `address(this).delegatecall(abi.encodePacked(change.selector, change.data))`.
   - *Trade-off*: Avoids hardcoded dispatch logic for every administrative parameter, but introduces low-level risks if malformed data is queued.
2. **Virtual Offset ($10^6$) vs Precision Loss**:
   - *Decision*: `_DECIMALS_OFFSET = 6` adds $1,000,000$ virtual shares/assets.
   - *Trade-off*: Materially neutralizes inflation attacks for small pools, but introduces minor rounding dust favoring the vault on initial deposits.
3. **Permanent Seed Lock (`SEED_LOCK_PERMANENT = 0`)**:
   - *Decision*: Admin seed liquidity can be locked forever.
   - *Trade-off*: Permanent economic sacrifice by admin/protocol to ensure the vault ratio can never be reset to zero, protecting all future depositors.
4. **Off-Chain Keeper Execution (`CapitalPreservationManager.checkAndTrigger`)**:
   - *Decision*: Monitoring is permissionless but requires an external transaction to trigger CPM.
   - *Trade-off*: Minimizes gas overhead on regular `deposit`/`withdraw` transactions, but relies on Keepers to trigger preservation promptly during sudden NAV drops.

---

## 10. Deployment Sequence

To deploy the DIBS Capital Preservation architecture cleanly:

1. **Deploy Underlying ERC-20 Asset**: Ensure target asset contract is deployed.
2. **Deploy Vault Contracts**:
   - Deploy `SentinelVault(asset, "DIBS Sentinel Class A", "dSEN", 0)`.
   - Deploy `CatalystVault(asset, "DIBS Catalyst Class B", "dCAT", 0)`.
3. **Deploy Capital Preservation Manager**:
   - Deploy `CapitalPreservationManager(address(sentinel), address(catalyst), reserveTarget)`.
4. **Configure Vault Pairing & Roles**:
   - Call `sentinel.setPairedVault(address(catalyst))`.
   - Call `catalyst.setPairedVault(address(sentinel))`.
   - Call `sentinel.setPreservationManager(address(manager))`.
   - Call `catalyst.setPreservationManager(address(manager))`.
5. **Seed Vaults**:
   - Call `sentinel.setMinimumSeedDeposit(minSeedAmount)` and `sentinel.seedVault(seedAmount, 0)`.
   - Call `catalyst.setMinimumSeedDeposit(minSeedAmount)` and `catalyst.seedVault(seedAmount, 0)`.
6. **Set Timelock & Initial Parameters**:
   - Call `sentinel.setTimelockDelay(48 hours)`.
   - Call `catalyst.setTimelockDelay(48 hours)`.

---

## 11. Known Limitations & Security Considerations

1. **Delegatecall Surface**: `executeParameterChange` executes self-delegatecalls. Admin must carefully encode parameters to avoid self-destruct or uninitialized storage overrides.
2. **Unbounded Queue Processing**: `processQueue(maxCount)` in `SentinelVault` requires batching (`maxCount`). Draining very large queues requires multiple transactions.
3. **Oracle / NAV Dependencies**: `computeJuniorRatioBps()` relies on `totalAssets()`. If underlying asset valuation relies on illiquid or vulnerable spot oracles, price manipulation could trigger false CPM entries.

---

## 12. Error Reference (All Revert Messages)

| Contract | Revert Message | Trigger Condition | Remediation |
| :--- | :--- | :--- | :--- |
| `DIBSVault` | `"DIBS: only admin"` | Caller is not admin | Call from admin address |
| `DIBSVault` | `"DIBS: only emergency role"` | Caller is not emergency role | Call from emergency role |
| `DIBSVault` | `"DIBS: only admin or manager"` | Caller is neither admin nor manager | Call from authorized address |
| `DIBSVault` | `"DIBS: only preservation manager"` | Caller is not manager or admin | Call from manager address |
| `DIBSVault` | `"DIBS: paused"` | Action attempted while paused | Unpause contract first |
| `DIBSVault` | `"DIBS: vault not seeded"` | Public deposit before seeding | Admin must run `seedVault()` |
| `DIBSVault` | `"DIBS: already seeded"` | `seedVault()` called second time | None (already seeded) |
| `DIBSVault` | `"DIBS: zero seed deposit"` | `setMinimumSeedDeposit(0)` | Provide deposit $> 0$ |
| `DIBSVault` | `"DIBS: seed below minimum"` | `seedVault()` with assets $<$ min | Deposit $\ge 	ext{minimumSeedDeposit}$ |
| `DIBSVault` | `"DIBS: minimum seed deposit not set"` | Seeding before setting min | Call `setMinimumSeedDeposit()` first |
| `DIBSVault` | `"DIBS: lock expiry in past"` | Expiry timestamp in the past | Provide future timestamp or $0$ |
| `DIBSVault` | `"DIBS: zero seed shares"` | Minted seed shares evaluated to 0 | Increase seed asset amount |
| `DIBSVault` | `"DIBS: cannot shorten lock"` | `extendSeedLock()` with earlier date | Provide later date or $0$ |
| `DIBSVault` | `"DIBS: zero selector"` | Queuing selector `0x00000000` | Provide valid function selector |
| `DIBSVault` | `"DIBS: selector not timelocked"` | Queuing non-whitelisted selector | Only queue timelocked functions |
| `DIBSVault` | `"DIBS: change already queued"` | Re-queuing identical hash | Wait or generate distinct payload |
| `DIBSVault` | `"DIBS: change not found"` | Executing non-existent changeId | Check changeId string |
| `DIBSVault` | `"DIBS: already executed"` | Executing change twice | None (already executed) |
| `DIBSVault` | `"DIBS: change cancelled"` | Executing cancelled changeId | Queue new change |
| `DIBSVault` | `"DIBS: timelock not expired"` | Executing before `executeAfter` | Wait for timelock delay |
| `DIBSVault` | `"DIBS: parameter change execution failed"` | Delegatecall execution reverted | Verify encoded parameters |
| `DIBSVault` | `"DIBS: delay out of range"` | Delay $< 1	ext{h}$ or $> 7	ext{d}$ | Set delay between 1h and 7d |
| `DIBSVault` | `"DIBS: shares below minimum"` | Shares minted $< 	ext{MIN\_SHARES\_OUT}$ | Increase deposit amount |
| `DIBSVault` | `"DIBS: deposit cap exceeded"` | Deposit exceeds `depositCap` | Reduce deposit size |
| `DIBSVault` | `"DIBS: deposit blocked during preservation mode (dilution)"` | Sentinel deposit dilutes junior ratio during CPM | Deposit into Catalyst instead |
| `DIBSVault` | `"DIBS: cannot withdraw locked seed shares"` | Withdrawing locked seed shares | Wait for unlock or redeem free shares |
| `DIBSVault` | `"DIBS: Sentinel withdrawals blocked during preservation mode"` | Direct Sentinel withdrawal in CPM | Use `queueWithdrawal()` |
| `DIBSVault` | `"DIBS: Catalyst distributions suspended during preservation mode"` | Direct Catalyst withdrawal in CPM | Wait for CPM lift |
| `DIBSVault` | `"DIBS: cannot transfer locked seed shares"` | Transferring locked seed shares | Transfer only free shares |
| `DIBSVault` | `"DIBS: preservation mode already active"` | Re-triggering CPM | None (already active) |
| `DIBSVault` | `"DIBS: ratio above minimum"` | Triggering CPM when ratio healthy | None needed |
| `DIBSVault` | `"DIBS: preservation mode not active"` | Lifting CPM when not active | None needed |
| `DIBSVault` | `"DIBS: ratio still below minimum"` | Lifting CPM before ratio restored | Inject Catalyst capital first |
| `DIBSVault` | `"DIBS: liquidity tests not passed"` | Lifting CPM while liquidity fails | Pass liquidity tests first |
| `DIBSVault` | `"DIBS: zero amount"` | Operating on $0$ assets | Provide amount $> 0$ |
| `DIBSVault` | `"DIBS: reserve release not permitted"` | Releasing reserve improperly | Ensure ratio restored & tests pass |
| `DIBSVault` | `"DIBS: insufficient reserve"` | Releasing more than reserve | Reduce release amount |
| `DIBSVault` | `"DIBS: zero recipient"` | Reserve release to `address(0)` | Provide valid address |
| `SentinelVault` | `"DIBS: queue full"` | Queuing past `maxQueueSize` | Process queue first |
| `SentinelVault` | `"DIBS: preservation mode still active"` | Processing queue while CPM active | Lift CPM first |
| `CatalystVault` | `"DIBS: already suspended"` | Suspending distributions twice | None |
| `CatalystVault` | `"DIBS: not suspended"` | Resuming unsuspended distributions | None |
| `CatalystVault` | `"DIBS: zero threshold"` | Setting threshold $= 0$ | Set threshold $> 0$ |
| `CatalystVault` | `"DIBS: recapitalization not enabled"` | Executing recap while disabled | Enable recapitalization first |
| `CatalystVault` | `"DIBS: zero recap"` | Recapitalizing with 0 assets/shares | Provide positive parameters |
| `CapitalPreservationManager` | `"DIBS: zero address"` | Deploying with `address(0)` | Provide valid vault addresses |
| `CapitalPreservationManager` | `"DIBS: reserve shortfall not addressed"` | Lifting CPM with shortfall | Fill reserve shortfall first |

---

## 13. Integration Points

1. **ERC-20 Token Integration**: Interacts with standard ERC-20 tokens via OpenZeppelin's `IERC20` and `SafeERC20` wrappers.
2. **Keeper / Off-Chain Automation**:
   - Automated bots poll `manager.checkAndTrigger()` periodically or subscribe to off-chain telemetry.
   - When NAV drops, bot triggers CPM permissionlessly.
3. **Governance & Multisig Integration**:
   - Protocol admin (Gnosis Safe multisig) queues sensitive parameter changes using `queueParameterChange()`.
   - Operations team and community indexers monitor `ParameterChangeQueued` events during the 48-hour delay window.
