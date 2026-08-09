// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Vault Layer
// Sentinel Vault — Senior-Priority, Class A
pragma solidity ^0.8.24;

import {DIBSVault} from "./DIBSVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SentinelVault
 * @dev Senior-priority vault class.
 *
 *      Attributes:
 *      - Senior-priority economic claim
 *      - Target yield, NOT guaranteed yield
 *      - Subject to pool liquidity, redemption queue, reserve state
 *      - Subject to strategy, counterparty, smart-contract, oracle, legal, and asset-servicing risk
 *
 *      Capital Waterfall Position: Distributed AFTER expenses, servicing costs,
 *      realized losses, required reserves, and protocol fees.
 *
 *      Loss Allocation: Absorbs losses only AFTER Catalyst capital is exhausted.
 */
contract SentinelVault is DIBSVault {
    // ─── Withdrawal Queue ──────────────────────────────────
    struct WithdrawalRequest {
        address user;
        uint256 assets;
        uint256 shares;
        uint256 requestedAt;
        bool processed;
    }

    WithdrawalRequest[] public withdrawalQueue;
    uint256 public totalQueuedAssets;
    uint256 public maxQueueSize;
    uint256 public queueProcessingBatchSize;

    // ─── Redemption Limits ─────────────────────────────────
    uint256 public maxRedemptionPerWindow; // max assets redeemable per time window
    uint256 public redemptionWindowSeconds; // time window for redemption limit
    mapping(uint256 => uint256) public redemptionsInWindow; // windowStart → total redeemed

    event WithdrawalQueuedInVault(address indexed user, uint256 assets, uint256 shares, uint256 queuePosition);
    event WithdrawalProcessed(address indexed user, uint256 assets, uint256 queueIndex);
    event QueueDrained(uint256 processedCount, uint256 totalAssets);

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
        vaultClass = VaultClass.Sentinel;
        maxQueueSize = 100;
        queueProcessingBatchSize = 10;
        maxRedemptionPerWindow = type(uint256).max; // unlimited by default
        redemptionWindowSeconds = 1 days;
    }

    /**
     * @dev Queue a withdrawal during preservation mode instead of reverting.
     *      Called when preservation mode blocks direct withdrawals.
     *      In production, this integrates with the redemption priority ordering.
     */
    function queueWithdrawal(uint256 assets, uint256 shares) external returns (uint256 queuePosition) {
        require(preservationModeActive, "DIBS: preservation mode not active");
        require(withdrawalQueue.length < maxQueueSize, "DIBS: queue full");

        queuePosition = withdrawalQueue.length;
        withdrawalQueue.push(WithdrawalRequest({
            user: msg.sender,
            assets: assets,
            shares: shares,
            requestedAt: block.timestamp,
            processed: false
        }));

        totalQueuedAssets += assets;

        emit WithdrawalQueuedInVault(msg.sender, assets, shares, queuePosition);
        emit WithdrawalQueued(msg.sender, assets, queuePosition);
    }

    /**
     * @dev Process queued withdrawals after preservation mode is lifted.
     *      Processes in FIFO order up to batch size.
     */
    function processQueue(uint256 maxCount) external onlyAdminOrManager {
        require(!preservationModeActive, "DIBS: preservation mode still active");

        uint256 processed = 0;
        uint256 totalAssetsProcessed = 0;

        for (uint256 i = 0; i < withdrawalQueue.length && processed < maxCount; i++) {
            if (withdrawalQueue[i].processed) continue;

            WithdrawalRequest storage req = withdrawalQueue[i];
            req.processed = true;
            totalQueuedAssets -= req.assets;
            totalAssetsProcessed += req.assets;

            // Execute the withdrawal
            _withdraw(req.user, req.user, req.user, req.assets, req.shares);

            emit WithdrawalProcessed(req.user, req.assets, i);
            processed++;
        }

        emit QueueDrained(processed, totalAssetsProcessed);
    }

    /**
     * @dev Check redemption limit for current time window.
     */
    function canRedeem(uint256 assets) public view returns (bool) {
        if (maxRedemptionPerWindow == type(uint256).max) return true;

        uint256 windowStart = (block.timestamp / redemptionWindowSeconds) * redemptionWindowSeconds;
        uint256 redeemedInWindow = redemptionsInWindow[windowStart];
        return redeemedInWindow + assets <= maxRedemptionPerWindow;
    }

    /**
     * @dev Set redemption window limits.
     */
    function setRedemptionLimits(uint256 maxPerWindow, uint256 windowSeconds) external onlyAdmin {
        maxRedemptionPerWindow = maxPerWindow;
        redemptionWindowSeconds = windowSeconds;
    }

    /**
     * @dev Set queue configuration.
     */
    function setQueueConfig(uint256 maxSize, uint256 batchSize) external onlyAdmin {
        maxQueueSize = maxSize;
        queueProcessingBatchSize = batchSize;
    }

    /**
     * @dev Get queue length.
     */
    function queueLength() external view returns (uint256) {
        return withdrawalQueue.length;
    }

    /**
     * @dev Get pending (unprocessed) queue count.
     */
    function pendingQueueCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < withdrawalQueue.length; i++) {
            if (!withdrawalQueue[i].processed) count++;
        }
        return count;
    }
}
