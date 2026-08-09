// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Capital Preservation Manager
// Cross-vault coordinator that monitors JuniorRatio and triggers preservation mode.
pragma solidity ^0.8.24;

import {DIBSVault} from "./DIBSVault.sol";
import {SentinelVault} from "./SentinelVault.sol";
import {CatalystVault} from "./CatalystVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CapitalPreservationManager
 * @dev Monitors JuniorRatio across Sentinel and Catalyst vaults.
 *      Triggers Capital Preservation Mode when JuniorRatio < MinJuniorRatio.
 *      Lifts preservation mode when ratio restored + liquidity tests pass.
 *
 *      JuniorRatio = NAV_Catalyst / (NAV_Sentinel + NAV_Catalyst)
 *
 *      Trigger conditions (any):
 *      - JuniorRatio falls below MinJuniorRatio
 *      - Reserve shortfall detected
 *      - Liquidity test failure
 *
 *      Lift conditions (all):
 *      - JuniorRatio >= MinJuniorRatio
 *      - Liquidity tests passed
 *      - Reserve shortfall addressed
 */
contract CapitalPreservationManager {
    SentinelVault public sentinel;
    CatalystVault public catalyst;
    address public admin;

    // ─── Monitoring State ──────────────────────────────────
    uint256 public lastCheckedJuniorRatioBps;
    uint256 public lastCheckTimestamp;
    bool public autoTriggerEnabled;

    // ─── Reserve Shortfall ─────────────────────────────────
    uint256 public reserveShortfall;
    uint256 public reserveTarget;

    // ─── Events ────────────────────────────────────────────
    event PreservationTriggered(uint256 juniorRatioBps, uint256 minJuniorRatioBps, uint256 shortfall);
    event PreservationLifted(uint256 restoredRatioBps, uint256 reserveRebuilt);
    event AutoTriggerEnabled(bool enabled);
    event ReserveTargetSet(uint256 target);
    event ReserveShortfallUpdated(uint256 shortfall);

    modifier onlyAdmin() {
        require(msg.sender == admin, "DIBS: only admin");
        _;
    }

    constructor(
        address sentinel_,
        address catalyst_,
        uint256 reserveTarget_
    ) {
        require(sentinel_ != address(0) && catalyst_ != address(0), "DIBS: zero address");
        sentinel = SentinelVault(sentinel_);
        catalyst = CatalystVault(catalyst_);
        admin = msg.sender;
        reserveTarget = reserveTarget_;
        autoTriggerEnabled = true;
    }

    /**
     * @dev Check current JuniorRatio and trigger preservation if needed.
     *      Anyone can call this — it's a monitoring function.
     */
    function checkAndTrigger() external returns (bool triggered) {
        if (!autoTriggerEnabled) return false;
        if (sentinel.preservationModeActive()) return false;

        uint256 juniorRatio = sentinel.computeJuniorRatioBps();
        lastCheckedJuniorRatioBps = juniorRatio;
        lastCheckTimestamp = block.timestamp;

        if (juniorRatio < sentinel.minJuniorRatioBps()) {
            // Calculate reserve shortfall
            uint256 sentinelReserve = sentinel.segregatedReserve();
            if (reserveTarget > sentinelReserve) {
                reserveShortfall = reserveTarget - sentinelReserve;
            } else {
                reserveShortfall = 0;
            }

            // Trigger on both vaults
            sentinel.triggerPreservationMode(juniorRatio, reserveShortfall);
            catalyst.triggerPreservationMode(juniorRatio, reserveShortfall);

            // Suspend Catalyst distributions
            catalyst.suspendDistributions();

            emit PreservationTriggered(juniorRatio, sentinel.minJuniorRatioBps(), reserveShortfall);
            return true;
        }

        return false;
    }

    /**
     * @dev Lift preservation mode after conditions met.
     *      Requires: ratio restored, liquidity tests passed, shortfall addressed.
     */
    function liftPreservation() external onlyAdmin {
        require(sentinel.preservationModeActive(), "DIBS: not in preservation mode");

        uint256 juniorRatio = sentinel.computeJuniorRatioBps();
        require(juniorRatio >= sentinel.minJuniorRatioBps(), "DIBS: ratio still below minimum");
        require(sentinel.liquidityTestsPassed(), "DIBS: liquidity tests not passed");
        require(reserveShortfall == 0 || sentinel.segregatedReserve() >= reserveTarget - reserveShortfall,
            "DIBS: reserve shortfall not addressed");

        uint256 reserveRebuilt = sentinel.segregatedReserve();

        // Lift on both vaults
        sentinel.liftPreservationMode(juniorRatio, reserveRebuilt);
        catalyst.liftPreservationMode(juniorRatio, reserveRebuilt);

        // Resume Catalyst distributions
        catalyst.resumeDistributions();

        // Process queued Sentinel withdrawals
        sentinel.processQueue(sentinel.queueLength());

        emit PreservationLifted(juniorRatio, reserveRebuilt);
    }

    /**
     * @dev Update reserve shortfall.
     */
    function setReserveShortfall(uint256 shortfall) external onlyAdmin {
        reserveShortfall = shortfall;
        emit ReserveShortfallUpdated(shortfall);
    }

    /**
     * @dev Set reserve target.
     */
    function setReserveTarget(uint256 target) external onlyAdmin {
        reserveTarget = target;
        emit ReserveTargetSet(target);
    }

    /**
     * @dev Enable/disable auto-trigger.
     */
    function setAutoTrigger(bool enabled) external onlyAdmin {
        autoTriggerEnabled = enabled;
        emit AutoTriggerEnabled(enabled);
    }

    /**
     * @dev Set liquidity test result on both vaults.
     */
    function setLiquidityTestResult(bool passed) external onlyAdmin {
        sentinel.setLiquidityTestResult(passed);
        catalyst.setLiquidityTestResult(passed);
    }

    /**
     * @dev Get current system status.
     */
    function getSystemStatus() external view returns (
        bool preservationActive,
        uint256 juniorRatioBps,
        uint256 minJuniorRatioBps,
        uint256 sentinelNAV,
        uint256 catalystNAV,
        uint256 sentinelReserve,
        uint256 reserveShortfall_,
        uint256 queueLength,
        bool distributionsSuspended
    ) {
        return (
            sentinel.preservationModeActive(),
            sentinel.computeJuniorRatioBps(),
            sentinel.minJuniorRatioBps(),
            sentinel.totalAssets(),
            catalyst.totalAssets(),
            sentinel.segregatedReserve(),
            reserveShortfall,
            sentinel.queueLength(),
            catalyst.distributionsSuspended()
        );
    }

    /**
     * @dev Deposit to Sentinel reserve to address shortfall.
     */
    function depositToReserve(uint256 amount) external onlyAdmin {
        IERC20 asset = IERC20(sentinel.asset());
        asset.transferFrom(msg.sender, address(sentinel), amount);
        sentinel.depositToReserve(amount);

        // Reduce shortfall
        if (reserveShortfall > 0) {
            uint256 applied = amount < reserveShortfall ? amount : reserveShortfall;
            reserveShortfall -= applied;
        }
    }
}
