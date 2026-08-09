// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Vault Layer
// Sentinel Vault — Senior-Priority, Class A
pragma solidity ^0.8.24;

import {DIBSVault} from "./DIBSVault.sol";

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
    ) {}

    // TODO: Withdrawal queue integration
    // - Queue, cap, or pause withdrawals when Capital Preservation Mode is active
    // - Redemption priority ordering
    // - Liquidity test gating

    // TODO: Reserve-rebuild constraint
    // - ReserveRelease = 0 when JuniorRatio < MinJuniorRatio
    // - ReserveRelease = Eligible when JuniorRatio >= MinJuniorRatio and liquidity tests pass
}
