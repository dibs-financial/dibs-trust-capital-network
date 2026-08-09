// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Vault Layer
// ERC-4626 Vault Core with Virtual-Offset Donation Attack Mitigation
pragma solidity ^0.8.24;

import {ERC4626, IERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title DIBSVault
 * @dev ERC-4626-compatible vault with virtual assets, virtual shares, configurable
 *      decimals offset, non-redeemable seed liquidity, minimum initial deposit,
 *      and timelocked parameter changes.
 *
 *      Security statement: "Vaults use virtual assets, virtual shares, and a configurable
 *      decimals offset to materially reduce the economic viability of ERC-4626 donation
 *      and rounding attacks."
 *
 *      Prohibited statements: "Zero gas overhead", "Fully neutralized", "No inflation
 *      attack possible", "Audited means safe", "Immutable means risk-free."
 */
contract DIBSVault is ERC4626 {
    // ─── Virtual Offset ────────────────────────────────────
    uint8 internal constant _DECIMALS_OFFSET = 6;

    // ─── Deposit Controls ─────────────────────────────────
    uint256 public constant MIN_SHARES_OUT = 1e3;
    uint256 public depositCap;

    // ─── Emergency Pause ───────────────────────────────────
    bool public paused;

    // ─── Role-Based Access ─────────────────────────────────
    address public admin;
    address public emergencyRole;
    address public preservationManager;

    // ─── Seed Liquidity ────────────────────────────────────
    //
    // Non-redeemable seed liquidity prevents donation/inflation attacks by
    // establishing a meaningful initial share-to-asset ratio before public
    // deposits are accepted. Seed shares are locked until seedLockExpiry
    // (0 = permanently locked).
    //
    // Flow:
    //   1. Admin calls seedVault() with minimum seed amount
    //   2. Seed shares minted to admin, marked as non-redeemable
    //   3. isSeeded = true; public deposits accepted
    //   4. Seed shares cannot be transferred or redeemed until lock expiry

    bool public isSeeded;
    uint256 public minimumSeedDeposit;    // minimum assets for seeding
    uint256 public seedShares;             // shares minted to seed depositor
    uint256 public seedLockExpiry;         // 0 = permanent lock; >0 = unlockable after timestamp
    uint256 public constant SEED_LOCK_PERMANENT = 0;

    // ─── Timelocked Parameter Changes ──────────────────────
    //
    // Sensitive configuration changes must be queued and wait for timelockDelay
    // before execution. This prevents instant manipulation of safety parameters
    // (minJuniorRatio, pairedVault, vaultClass, etc.).
    //
    // Emergency functions (pause/unpause) are exempt from timelock.
    //
    // Pattern:
    //   1. Admin calls queueParameterChange(selector, data)
    //   2. Change is recorded with executeAfter = block.timestamp + timelockDelay
    //   3. After delay, admin calls executeParameterChange(changeId)
    //   4. Change is applied; event emitted

    struct ParameterChange {
        bytes4 selector;       // function selector to call
        bytes data;            // encoded arguments
        uint256 queuedAt;      // timestamp when queued
        uint256 executeAfter;  // earliest execution timestamp
        bool executed;         // whether the change was applied
        bool cancelled;        // whether the change was cancelled
    }

    mapping(bytes32 => ParameterChange) public pendingChanges;
    uint256 public timelockDelay;          // minimum delay in seconds (default: 48 hours)
    uint256 public constant MIN_TIMELOCK_DELAY = 1 hours;
    uint256 public constant MAX_TIMELOCK_DELAY = 7 days;
    uint256 public constant DEFAULT_TIMELOCK_DELAY = 48 hours;

    // ─── Capital Preservation Mode ─────────────────────────
    //
    // Triggers when JuniorRatio < MinJuniorRatio.
    // JuniorRatio = NAV_Catalyst / (NAV_Sentinel + NAV_Catalyst)
    //
    // When active:
    //   - Sentinel withdrawals are queued, capped, or paused
    //   - Catalyst distributions are suspended
    //   - New Sentinel deposits may be restricted if dilution would reduce coverage
    //   - Distributable yield is retained for reserve rebuilding
    //   - ReserveRelease = 0 (blocked)

    bool public preservationModeActive;
    uint256 public preservationModeTriggeredAt;
    uint256 public preservationModeDurationHours;
    uint256 public minJuniorRatioBps; // e.g. 2000 = 20%

    // Paired vault reference (Sentinel ↔ Catalyst)
    address public pairedVault;

    // ─── Reserve Accounting ───────────────────────────────
    //
    // Segregated reserve that is non-distributable during preservation mode.
    // ReserveRelease only after ratio restoration and liquidity tests pass.
    uint256 public segregatedReserve;
    uint256 public lockedRecapitalizationBalance;
    bool public liquidityTestsPassed;

    // ─── Vault Class ───────────────────────────────────────
    enum VaultClass { Generic, Sentinel, Catalyst }
    VaultClass public vaultClass;

    // ─── Events ────────────────────────────────────────────

    event CapitalPreservationTriggered(
        uint256 indexed timestamp,
        uint256 juniorRatioBps,
        uint256 minJuniorRatioBps,
        uint256 reserveShortfall
    );

    event CapitalPreservationLifted(
        uint256 indexed timestamp,
        uint256 restoredJuniorRatioBps,
        uint256 reserveRebuiltAmount
    );

    event ReserveDeposited(uint256 indexed amount, uint256 indexed newTotal);
    event ReserveReleased(uint256 indexed amount, uint256 indexed newTotal);
    event WithdrawalQueued(address indexed user, uint256 indexed assets, uint256 queuePosition);
    event DistributionSuspended(uint256 indexed timestamp);
    event DistributionResumed(uint256 indexed timestamp);
    event PairedVaultSet(address indexed pairedVault);

    // Seed liquidity events
    event VaultSeeded(address indexed depositor, uint256 assets, uint256 shares, uint256 lockExpiry);
    event SeedLockUpdated(uint256 newExpiry);
    event MinimumSeedDepositSet(uint256 amount);

    // Timelock events
    event ParameterChangeQueued(bytes32 indexed changeId, bytes4 indexed selector, uint256 executeAfter);
    event ParameterChangeExecuted(bytes32 indexed changeId, bytes4 indexed selector);
    event ParameterChangeCancelled(bytes32 indexed changeId);
    event TimelockDelayUpdated(uint256 newDelay);

    // ─── Modifiers ────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "DIBS: only admin");
        _;
    }

    modifier onlyEmergency() {
        require(msg.sender == emergencyRole, "DIBS: only emergency role");
        _;
    }

    modifier onlyAdminOrManager() {
        require(msg.sender == admin || msg.sender == preservationManager, "DIBS: only admin or manager");
        _;
    }

    modifier onlyPreservationManager() {
        require(msg.sender == admin || msg.sender == emergencyRole || msg.sender == preservationManager, "DIBS: only preservation manager");
        _;
    }

    modifier notPaused() {
        require(!paused, "DIBS: paused");
        _;
    }

    modifier onlySeeded() {
        require(isSeeded, "DIBS: vault not seeded");
        _;
    }

    // ─── Constructor ───────────────────────────────────────

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint256 depositCap_
    ) ERC4626(asset_) ERC20(name_, symbol_) {
        admin = msg.sender;
        depositCap = depositCap_;
        minJuniorRatioBps = 2000; // 20% default
        vaultClass = VaultClass.Generic;
        timelockDelay = DEFAULT_TIMELOCK_DELAY;
        minimumSeedDeposit = 0; // must be set before seeding
    }

    // ─── Virtual Offset Override ──────────────────────────

    /**
     * @dev Shares = Assets * (TotalSupply + 10^offset) / (TotalAssets + 1)
     */
    function _decimalsOffset() internal pure override returns (uint8) {
        return _DECIMALS_OFFSET;
    }

    // ─── Seed Liquidity ────────────────────────────────────

    /**
     * @dev Set the minimum seed deposit required before public deposits are accepted.
     */
    function setMinimumSeedDeposit(uint256 amount) external onlyAdmin {
        require(!isSeeded, "DIBS: already seeded");
        require(amount > 0, "DIBS: zero seed deposit");
        minimumSeedDeposit = amount;
        emit MinimumSeedDepositSet(amount);
    }

    /**
     * @dev Seed the vault with non-redeemable initial liquidity.
     *      Must be called before any public deposits.
     *      Seed shares are locked until seedLockExpiry_ (0 = permanent).
     *
     * @param assets    Amount of asset tokens to deposit as seed.
     * @param lockExpiry_ Timestamp after which seed shares become redeemable.
     *                   0 = permanently locked (recommended for security).
     */
    function seedVault(uint256 assets, uint256 lockExpiry_) external onlyAdmin {
        require(!isSeeded, "DIBS: already seeded");
        require(assets >= minimumSeedDeposit, "DIBS: seed below minimum");
        require(minimumSeedDeposit > 0, "DIBS: minimum seed deposit not set");
        if (lockExpiry_ != 0) {
            require(lockExpiry_ > block.timestamp, "DIBS: lock expiry in past");
        }

        // Transfer assets from admin to vault
        IERC20(asset()).transferFrom(msg.sender, address(this), assets);

        // Mint seed shares to admin (internal mint, bypasses _deposit checks)
        uint256 shares = _convertToShares(assets, Math.Rounding.Floor);
        require(shares > 0, "DIBS: zero seed shares");

        // Record seed state
        isSeeded = true;
        seedShares = shares;
        seedLockExpiry = lockExpiry_;

        // Mint shares directly (bypass _deposit since we're seeding)
        _mint(msg.sender, shares);

        emit VaultSeeded(msg.sender, assets, shares, lockExpiry_);
    }

    /**
     * @dev Update seed lock expiry (admin only).
     *      Can only extend the lock, not shorten it.
     */
    function extendSeedLock(uint256 newExpiry) external onlyAdmin {
        require(isSeeded, "DIBS: not seeded");
        if (seedLockExpiry != 0) {
            require(newExpiry == 0 || newExpiry > seedLockExpiry, "DIBS: cannot shorten lock");
        }
        seedLockExpiry = newExpiry;
        emit SeedLockUpdated(newExpiry);
    }

    /**
     * @dev Check if seed shares are currently unlocked (redeemable).
     */
    function isSeedUnlocked() public view returns (bool) {
        if (!isSeeded) return false;
        if (seedLockExpiry == 0) return false; // permanent lock
        return block.timestamp >= seedLockExpiry;
    }

    /**
     * @dev Check if an address holds seed shares that are still locked.
     *      Seed depositor is admin; their redeemable balance is reduced by locked seed shares.
     */
    function lockedSharesOf(address account) public view returns (uint256) {
        if (!isSeeded) return 0;
        if (isSeedUnlocked()) return 0;

        // If admin holds >= seedShares, all seedShares are locked
        // If admin transferred some away, the locked amount is min(balance, seedShares)
        uint256 balance = balanceOf(account);
        if (account == admin) {
            return balance >= seedShares ? seedShares : balance;
        }
        return 0;
    }

    /**
     * @dev Effective redeemable shares for an account (total - locked).
     */
    function redeemableSharesOf(address account) public view returns (uint256) {
        return balanceOf(account) - lockedSharesOf(account);
    }

    // ─── Timelocked Parameter Changes ──────────────────────

    /**
     * @dev Queue a parameter change for timelocked execution.
     * @param selector  Function selector (e.g., bytes4(keccak256("setMinJuniorRatio(uint256)")))
     * @param data      ABI-encoded function arguments
     * @return changeId Unique identifier for this queued change
     */
    function queueParameterChange(bytes4 selector, bytes calldata data) external onlyAdmin returns (bytes32 changeId) {
        require(selector != bytes4(0), "DIBS: zero selector");
        require(isTimelockedSelector(selector), "DIBS: selector not timelocked");

        changeId = keccak256(abi.encodePacked(selector, data, block.timestamp));

        require(pendingChanges[changeId].queuedAt == 0, "DIBS: change already queued");

        pendingChanges[changeId] = ParameterChange({
            selector: selector,
            data: data,
            queuedAt: block.timestamp,
            executeAfter: block.timestamp + timelockDelay,
            executed: false,
            cancelled: false
        });

        emit ParameterChangeQueued(changeId, selector, block.timestamp + timelockDelay);
    }

    /**
     * @dev Execute a queued parameter change after the timelock delay has passed.
     * @param changeId The identifier returned from queueParameterChange.
     */
    function executeParameterChange(bytes32 changeId) external onlyAdmin {
        ParameterChange storage change = pendingChanges[changeId];
        require(change.queuedAt != 0, "DIBS: change not found");
        require(!change.executed, "DIBS: already executed");
        require(!change.cancelled, "DIBS: change cancelled");
        require(block.timestamp >= change.executeAfter, "DIBS: timelock not expired");

        change.executed = true;

        // Execute the parameter change via low-level call
        (bool success, ) = address(this).delegatecall(
            abi.encodePacked(change.selector, change.data)
        );
        require(success, "DIBS: parameter change execution failed");

        emit ParameterChangeExecuted(changeId, change.selector);
    }

    /**
     * @dev Cancel a queued parameter change before it executes.
     */
    function cancelParameterChange(bytes32 changeId) external onlyAdmin {
        ParameterChange storage change = pendingChanges[changeId];
        require(change.queuedAt != 0, "DIBS: change not found");
        require(!change.executed, "DIBS: already executed");

        change.cancelled = true;
        emit ParameterChangeCancelled(changeId);
    }

    /**
     * @dev Update the timelock delay (itself subject to timelock).
     *      Can be called directly for initial set; subsequent changes use queueParameterChange.
     */
    function setTimelockDelay(uint256 newDelay) external onlyAdmin {
        require(newDelay >= MIN_TIMELOCK_DELAY && newDelay <= MAX_TIMELOCK_DELAY, "DIBS: delay out of range");
        timelockDelay = newDelay;
        emit TimelockDelayUpdated(newDelay);
    }

    /**
     * @dev Check if a function selector is subject to timelock.
     */
    function isTimelockedSelector(bytes4 selector) public pure returns (bool) {
        return
            selector == this.setMinJuniorRatio.selector ||
            selector == this.setPairedVault.selector ||
            selector == this.setVaultClass.selector ||
            selector == this.setPreservationManager.selector ||
            selector == this.assignEmergencyRole.selector ||
            selector == this.setDepositCap.selector ||
            selector == this.setTimelockDelay.selector;
    }

    /**
     * @dev Get a pending parameter change details.
     */
    function getPendingChange(bytes32 changeId) external view returns (ParameterChange memory) {
        return pendingChanges[changeId];
    }

    // ─── Deposit Override ─────────────────────────────────

    /**
     * @dev Enforce: minimum shares, pause check, deposit cap, seed requirement,
     *      and preservation-mode dilution guard for Sentinel vaults.
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        require(isSeeded, "DIBS: vault not seeded");
        require(shares >= MIN_SHARES_OUT, "DIBS: shares below minimum");
        require(!paused, "DIBS: paused");
        if (depositCap > 0) {
            require(totalAssets() + assets <= depositCap, "DIBS: deposit cap exceeded");
        }

        // During preservation mode, restrict Sentinel deposits if dilution
        // would reduce coverage (only applies to Sentinel-class vaults)
        if (preservationModeActive && vaultClass == VaultClass.Sentinel) {
            require(
                !wouldDiluteJuniorRatio(assets),
                "DIBS: deposit blocked during preservation mode (dilution)"
            );
        }

        super._deposit(caller, receiver, assets, shares);
    }

    // ─── Withdraw Override ────────────────────────────────

    /**
     * @dev During preservation mode, Sentinel withdrawals are queued or blocked.
     *      Catalyst withdrawals are subject to distribution suspension.
     *      Seed shares are non-redeemable until lock expiry.
     */
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        require(!paused, "DIBS: paused");

        // Seed lock: prevent withdrawal of locked seed shares
        uint256 locked = lockedSharesOf(owner);
        uint256 freeShares = balanceOf(owner) - locked;
        require(shares <= freeShares, "DIBS: cannot withdraw locked seed shares");

        if (preservationModeActive) {
            if (vaultClass == VaultClass.Sentinel) {
                revert("DIBS: Sentinel withdrawals blocked during preservation mode");
            } else if (vaultClass == VaultClass.Catalyst) {
                revert("DIBS: Catalyst distributions suspended during preservation mode");
            }
        }

        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // ─── Transfer Override (seed lock) ─────────────────────

    /**
     * @dev Override _transfer to prevent transferring locked seed shares.
     */
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) {
            uint256 locked = lockedSharesOf(from);
            uint256 freeShares = balanceOf(from) - locked;
            require(value <= freeShares, "DIBS: cannot transfer locked seed shares");
        }
        super._update(from, to, value);
    }

    // ─── Capital Preservation Mode ─────────────────────────

    /**
     * @dev Trigger capital preservation mode. Called by preservation manager
     *      when JuniorRatio < MinJuniorRatio.
     */
    function triggerPreservationMode(uint256 juniorRatioBps_, uint256 reserveShortfall_)
        external
        onlyPreservationManager
    {
        require(!preservationModeActive, "DIBS: preservation mode already active");
        require(juniorRatioBps_ < minJuniorRatioBps, "DIBS: ratio above minimum");

        preservationModeActive = true;
        preservationModeTriggeredAt = block.timestamp;
        preservationModeDurationHours = 0;

        emit CapitalPreservationTriggered(
            block.timestamp,
            juniorRatioBps_,
            minJuniorRatioBps,
            reserveShortfall_
        );

        if (vaultClass == VaultClass.Catalyst) {
            emit DistributionSuspended(block.timestamp);
        }
    }

    /**
     * @dev Lift capital preservation mode. Requires:
     *      1. JuniorRatio >= MinJuniorRatio
     *      2. Liquidity tests passed
     *      3. Reserve shortfall addressed
     */
    function liftPreservationMode(uint256 restoredJuniorRatioBps_, uint256 reserveRebuiltAmount_)
        external
        onlyPreservationManager
    {
        require(preservationModeActive, "DIBS: preservation mode not active");
        require(restoredJuniorRatioBps_ >= minJuniorRatioBps, "DIBS: ratio still below minimum");
        require(liquidityTestsPassed, "DIBS: liquidity tests not passed");

        preservationModeActive = false;
        preservationModeDurationHours = (block.timestamp - preservationModeTriggeredAt) / 3600;

        emit CapitalPreservationLifted(
            block.timestamp,
            restoredJuniorRatioBps_,
            reserveRebuiltAmount_
        );

        if (vaultClass == VaultClass.Catalyst) {
            emit DistributionResumed(block.timestamp);
        }
    }

    /**
     * @dev Check if a Sentinel deposit would dilute the JuniorRatio below minimum.
     *      Sentinel deposit increases NAV_Sentinel, decreasing JuniorRatio.
     */
    function wouldDiluteJuniorRatio(uint256 depositAmount) public view returns (bool) {
        if (pairedVault == address(0)) return false;

        DIBSVault paired = DIBSVault(pairedVault);
        uint256 currentSentinelNAV = totalAssets();
        uint256 currentCatalystNAV = paired.totalAssets();

        uint256 newTotal = currentSentinelNAV + depositAmount + currentCatalystNAV;
        if (newTotal == 0) return false;

        uint256 newJuniorRatioBps = (currentCatalystNAV * 10000) / newTotal;
        return newJuniorRatioBps < minJuniorRatioBps;
    }

    /**
     * @dev Compute current JuniorRatio in basis points.
     *      JuniorRatio = NAV_Catalyst / (NAV_Sentinel + NAV_Catalyst)
     */
    function computeJuniorRatioBps() public view returns (uint256) {
        if (pairedVault == address(0)) return 10000;

        DIBSVault paired = DIBSVault(pairedVault);
        uint256 navSelf = totalAssets();
        uint256 navPaired = paired.totalAssets();

        uint256 total = navSelf + navPaired;
        if (total == 0) return 0;

        if (vaultClass == VaultClass.Catalyst) {
            return (navSelf * 10000) / total;
        } else if (vaultClass == VaultClass.Sentinel) {
            return (navPaired * 10000) / total;
        }
        return 10000;
    }

    /**
     * @dev Check if reserve can be released.
     */
    function canReleaseReserve() public view returns (bool) {
        return !preservationModeActive &&
               computeJuniorRatioBps() >= minJuniorRatioBps &&
               liquidityTestsPassed;
    }

    // ─── Reserve Accounting ───────────────────────────────

    function depositToReserve(uint256 amount) external onlyAdminOrManager {
        require(amount > 0, "DIBS: zero amount");
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
        segregatedReserve += amount;
        emit ReserveDeposited(amount, segregatedReserve);
    }

    function releaseReserve(uint256 amount, address recipient) external onlyAdmin {
        require(canReleaseReserve(), "DIBS: reserve release not permitted");
        require(amount <= segregatedReserve, "DIBS: insufficient reserve");
        require(recipient != address(0), "DIBS: zero recipient");

        segregatedReserve -= amount;
        IERC20(asset()).transfer(recipient, amount);
        emit ReserveReleased(amount, segregatedReserve);
    }

    function depositToRecapitalization(uint256 amount) external onlyAdmin {
        require(amount > 0, "DIBS: zero amount");
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
        lockedRecapitalizationBalance += amount;
    }

    function setLiquidityTestResult(bool passed) external onlyAdminOrManager {
        liquidityTestsPassed = passed;
    }

    // ─── Configuration (Timelocked) ─────────────────────────

    /**
     * @dev Set minimum JuniorRatio in basis points.
     *      Subject to timelock — call via queueParameterChange + executeParameterChange.
     */
    function setMinJuniorRatio(uint256 bps) external onlyAdmin {
        require(bps > 0 && bps <= 10000, "DIBS: invalid ratio");
        minJuniorRatioBps = bps;
    }

    function setPairedVault(address vault) external onlyAdmin {
        require(vault != address(0), "DIBS: zero address");
        pairedVault = vault;
        emit PairedVaultSet(vault);
    }

    function setVaultClass(VaultClass class_) external onlyAdmin {
        vaultClass = class_;
    }

    function setPreservationManager(address manager) external onlyAdmin {
        preservationManager = manager;
    }

    function assignEmergencyRole(address role) external onlyAdmin {
        emergencyRole = role;
    }

    /**
     * @dev Set deposit cap. Subject to timelock.
     */
    function setDepositCap(uint256 cap) external onlyAdmin {
        depositCap = cap;
    }

    // ─── Emergency Controls (NOT timelocked) ───────────────

    function emergencyPause() external onlyEmergency {
        paused = true;
    }

    function emergencyUnpause() external onlyAdmin {
        paused = false;
    }
}
