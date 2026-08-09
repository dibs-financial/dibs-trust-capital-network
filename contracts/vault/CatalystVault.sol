// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Vault Layer
// Catalyst Vault — Subordinated First-Loss, Class B
pragma solidity ^0.8.24;

import {DIBSVault} from "./DIBSVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CatalystVault
 * @dev Subordinated first-loss vault class.
 *
 *      Attributes:
 *      - First-loss capital buffer
 *      - Residual-yield claim
 *      - Absorbs losses BEFORE Sentinel
 *      - Receives distribution only after costs, reserves, fees, and Sentinel obligations
 *      - May be subject to distribution suspension
 *      - May be diluted through recapitalization
 *      - May be exposed to full loss
 *
 *      Capital Waterfall Position: Distributed AFTER Sentinel obligations.
 *      Loss Allocation: Absorbs ALL losses before Sentinel.
 *
 *      Dynamic Capital Floor:
 *      JuniorRatio = NAV_Catalyst / (NAV_Sentinel + NAV_Catalyst)
 *      JuniorRatio >= MinJuniorRatio
 */
contract CatalystVault is DIBSVault {
    // ─── Distribution Suspension ──────────────────────────
    bool public distributionsSuspended;
    uint256 public distributionSuspensionTimestamp;

    // ─── Recapitalization ──────────────────────────────────
    struct RecapitalizationEvent {
        uint256 amountRaised;
        uint256 sharesIssued;
        uint256 preRecapNAV;
        uint256 postRecapNAV;
        uint256 timestamp;
        uint256 dilutionFactorBps; // old shares / new total shares * 10000
    }

    RecapitalizationEvent[] public recapitalizationHistory;
    uint256 public recapitalizationThreshold; // minimum NAV drop to trigger recap
    bool public recapitalizationEnabled;

    // ─── Yield Routing ─────────────────────────────────────
    // During preservation mode, yield is NOT routed to freely redeemable vault.
    // Instead, it goes to: segregated reserve, non-distributable reserve,
    // locked recapitalization balance, or contract-enforced retained earnings.

    enum YieldDestination {
        CatalystVault,        // normal: distribute to Catalyst holders
        SegregatedReserve,    // preservation: rebuild reserve
        LockedRecapitalization, // preservation: fund recapitalization
        RetainedEarnings      // preservation: retained by protocol
    }

    YieldDestination public yieldDestination;
    uint256 public retainedEarnings;
    uint256 public totalYieldRoutedToReserve;
    uint256 public totalYieldRoutedToRecap;

    event RecapitalizationExecuted(
        uint256 indexed amountRaised,
        uint256 sharesIssued,
        uint256 preRecapNAV,
        uint256 postRecapNAV,
        uint256 dilutionFactorBps
    );

    event YieldRouted(YieldDestination indexed destination, uint256 amount);
    event DistributionsSuspended(uint256 timestamp);
    event DistributionsResumed(uint256 timestamp);

    constructor(
        address asset_,
        string memory name_,
        string memory symbol_,
        uint256 depositCap_
    ) DIBSVault(
        IERC20(asset_),
        name_,
        symbol_,
        depositCap_
    ) {
        vaultClass = VaultClass.Catalyst;
        distributionsSuspended = false;
        recapitalizationEnabled = false;
        recapitalizationThreshold = 0;
        yieldDestination = YieldDestination.CatalystVault;
    }

    /**
     * @dev Suspend distributions when preservation mode is active.
     *      Called automatically by triggerPreservationMode via _withdraw override,
     *      but can also be called explicitly.
     */
    function suspendDistributions() external onlyAdminOrManager {
        require(!distributionsSuspended, "DIBS: already suspended");
        distributionsSuspended = true;
        distributionSuspensionTimestamp = block.timestamp;
        yieldDestination = YieldDestination.SegregatedReserve;
        emit DistributionsSuspended(block.timestamp);
    }

    /**
     * @dev Resume distributions after preservation mode is lifted.
     */
    function resumeDistributions() external onlyAdminOrManager {
        require(distributionsSuspended, "DIBS: not suspended");
        distributionsSuspended = false;
        yieldDestination = YieldDestination.CatalystVault;
        emit DistributionsResumed(block.timestamp);
    }

    /**
     * @dev Route yield to the appropriate destination during preservation mode.
     *      In normal mode, yield goes to CatalystVault (distributable).
     *      During preservation, yield goes to reserve, recapitalization, or retained earnings.
     */
    function routeYield(uint256 amount) external onlyAdminOrManager {
        require(amount > 0, "DIBS: zero amount");

        if (yieldDestination == YieldDestination.SegregatedReserve) {
            segregatedReserve += amount;
            totalYieldRoutedToReserve += amount;
        } else if (yieldDestination == YieldDestination.LockedRecapitalization) {
            lockedRecapitalizationBalance += amount;
            totalYieldRoutedToRecap += amount;
        } else if (yieldDestination == YieldDestination.RetainedEarnings) {
            retainedEarnings += amount;
        }

        emit YieldRouted(yieldDestination, amount);
    }

    /**
     * @dev Set yield routing destination.
     */
    function setYieldDestination(YieldDestination dest) external onlyAdmin {
        yieldDestination = dest;
    }

    // ─── Recapitalization ─────────────────────────────────

    /**
     * @dev Enable recapitalization with a NAV drop threshold.
     */
    function enableRecapitalization(uint256 threshold) external onlyAdmin {
        require(threshold > 0, "DIBS: zero threshold");
        recapitalizationEnabled = true;
        recapitalizationThreshold = threshold;
    }

    /**
     * @dev Execute recapitalization: issue new shares at disclosed pricing rules.
     *      Records dilution for existing holders.
     */
    function executeRecapitalization(
        uint256 amountRaised,
        uint256 sharesIssued,
        uint256 preRecapNAV
    ) external onlyAdmin {
        require(recapitalizationEnabled, "DIBS: recapitalization not enabled");
        require(amountRaised > 0 && sharesIssued > 0, "DIBS: zero recap");

        uint256 postRecapNAV = preRecapNAV + amountRaised;
        uint256 oldSupply = totalSupply();
        uint256 dilutionFactorBps = oldSupply == 0 ? 0 : (oldSupply * 10000) / (oldSupply + sharesIssued);

        // Mint new shares (diluting existing holders)
        _mint(msg.sender, sharesIssued);

        recapitalizationHistory.push(RecapitalizationEvent({
            amountRaised: amountRaised,
            sharesIssued: sharesIssued,
            preRecapNAV: preRecapNAV,
            postRecapNAV: postRecapNAV,
            timestamp: block.timestamp,
            dilutionFactorBps: dilutionFactorBps
        }));

        emit RecapitalizationExecuted(
            amountRaised,
            sharesIssued,
            preRecapNAV,
            postRecapNAV,
            dilutionFactorBps
        );
    }

    /**
     * @dev Get recapitalization count.
     */
    function recapitalizationCount() external view returns (uint256) {
        return recapitalizationHistory.length;
    }

    /**
     * @dev Get retained earnings.
     */
    function getRetainedEarnings() external view returns (uint256) {
        return retainedEarnings;
    }
}
