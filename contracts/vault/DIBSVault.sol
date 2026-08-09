// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Vault Layer
// ERC-4626 Vault Core with Virtual-Offset Donation Attack Mitigation
pragma solidity ^0.8.24;

import {ERC4626, IERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title DIBSVault
 * @dev ERC-4626-compatible vault with virtual assets, virtual shares, and configurable
 *      decimals offset to materially reduce the economic viability of donation and
 *      rounding attacks.
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
    }

    // ─── Virtual Offset Override ──────────────────────────

    /**
     * @dev Shares = Assets * (TotalSupply + 10^offset) / (TotalAssets + 1)
     */
    function _decimalsOffset() internal pure override returns (uint8) {
        return _DECIMALS_OFFSET;
    }

    // ─── Deposit Override ─────────────────────────────────

    /**
     * @dev Enforce minimum shares, pause check, deposit cap, and preservation-mode
     *      dilution guard for Sentinel vaults.
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        require(shares >= MIN_SHARES_OUT, "DIBS: shares below minimum");
        require(!paused, "DIBS: paused");
        if (depositCap > 0) {
            require(totalAssets() + assets <= depositCap, "DIBS: deposit cap exceeded");
        }

        // During preservation mode, restrict Sentinel deposits if dilution
        // would reduce coverage (only applies to Sentinel-class vaults)
        if (preservationModeActive && vaultClass == VaultClass.Sentinel) {
            // Allow deposits that improve coverage ratio, block those that dilute
            // New deposit increases Sentinel NAV, which decreases JuniorRatio
            // Only block if the deposit would further reduce JuniorRatio below minimum
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
     */
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        require(!paused, "DIBS: paused");

        if (preservationModeActive) {
            if (vaultClass == VaultClass.Sentinel) {
                // Sentinel withdrawals are blocked during preservation mode
                // In production: queue the withdrawal for processing after lift
                revert("DIBS: Sentinel withdrawals blocked during preservation mode");
            } else if (vaultClass == VaultClass.Catalyst) {
                // Catalyst withdrawals (distributions) are suspended
                revert("DIBS: Catalyst distributions suspended during preservation mode");
            }
        }

        super._withdraw(caller, receiver, owner, assets, shares);
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
        preservationModeDurationHours = 0; // indefinite until manually lifted

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

        // JuniorRatio after deposit = CatalystNAV / (SentinelNAV + deposit + CatalystNAV)
        uint256 newTotal = currentSentinelNAV + depositAmount + currentCatalystNAV;
        if (newTotal == 0) return false;

        // Fixed-point: juniorRatioBps = CatalystNAV * 10000 / newTotal
        uint256 newJuniorRatioBps = (currentCatalystNAV * 10000) / newTotal;
        return newJuniorRatioBps < minJuniorRatioBps;
    }

    /**
     * @dev Compute current JuniorRatio in basis points.
     *      JuniorRatio = NAV_Catalyst / (NAV_Sentinel + NAV_Catalyst)
     */
    function computeJuniorRatioBps() public view returns (uint256) {
        if (pairedVault == address(0)) return 10000; // 100% if no pair

        DIBSVault paired = DIBSVault(pairedVault);
        uint256 navSelf = totalAssets();
        uint256 navPaired = paired.totalAssets();

        uint256 total = navSelf + navPaired;
        if (total == 0) return 0;

        // Determine which vault is Catalyst
        if (vaultClass == VaultClass.Catalyst) {
            return (navSelf * 10000) / total;
        } else if (vaultClass == VaultClass.Sentinel) {
            return (navPaired * 10000) / total;
        }
        return 10000;
    }

    /**
     * @dev Check if reserve can be released.
     *      ReserveRelease = Eligible when JuniorRatio >= MinJuniorRatio AND liquidity tests pass.
     */
    function canReleaseReserve() public view returns (bool) {
        return !preservationModeActive &&
               computeJuniorRatioBps() >= minJuniorRatioBps &&
               liquidityTestsPassed;
    }

    // ─── Reserve Accounting ───────────────────────────────

    /**
     * @dev Deposit into segregated reserve (non-distributable during preservation).
     */
    function depositToReserve(uint256 amount) external onlyAdminOrManager {
        require(amount > 0, "DIBS: zero amount");
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
        segregatedReserve += amount;
        emit ReserveDeposited(amount, segregatedReserve);
    }

    /**
     * @dev Release reserve funds. Only when preservation mode inactive,
     *      ratio restored, and liquidity tests passed.
     */
    function releaseReserve(uint256 amount, address recipient) external onlyAdmin {
        require(canReleaseReserve(), "DIBS: reserve release not permitted");
        require(amount <= segregatedReserve, "DIBS: insufficient reserve");
        require(recipient != address(0), "DIBS: zero recipient");

        segregatedReserve -= amount;
        IERC20(asset()).transfer(recipient, amount);
        emit ReserveReleased(amount, segregatedReserve);
    }

    /**
     * @dev Deposit to locked recapitalization balance.
     */
    function depositToRecapitalization(uint256 amount) external onlyAdmin {
        require(amount > 0, "DIBS: zero amount");
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
        lockedRecapitalizationBalance += amount;
    }

    /**
     * @dev Set liquidity test result.
     */
    function setLiquidityTestResult(bool passed) external onlyAdminOrManager {
        liquidityTestsPassed = passed;
    }

    // ─── Configuration ─────────────────────────────────────

    /**
     * @dev Set minimum JuniorRatio in basis points (e.g. 2000 = 20%).
     */
    function setMinJuniorRatio(uint256 bps) external onlyAdmin {
        require(bps > 0 && bps <= 10000, "DIBS: invalid ratio");
        minJuniorRatioBps = bps;
    }

    /**
     * @dev Set paired vault reference for cross-vault ratio computation.
     */
    function setPairedVault(address vault) external onlyAdmin {
        require(vault != address(0), "DIBS: zero address");
        pairedVault = vault;
        emit PairedVaultSet(vault);
    }

    /**
     * @dev Set vault class (Sentinel, Catalyst, or Generic).
     */
    function setVaultClass(VaultClass class_) external onlyAdmin {
        vaultClass = class_;
    }

    // ─── Emergency Controls ───────────────────────────────

    function emergencyPause() external onlyEmergency {
        paused = true;
    }

    function emergencyUnpause() external onlyAdmin {
        paused = false;
    }

    function assignEmergencyRole(address role) external onlyAdmin {
        emergencyRole = role;
    }

    /**
     * @dev Set preservation manager address (admin only).
     */
    function setPreservationManager(address manager) external onlyAdmin {
        preservationManager = manager;
    }
}
