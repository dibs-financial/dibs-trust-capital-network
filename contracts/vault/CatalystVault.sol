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

    // TODO: Distribution suspension logic
    // - Suspend distributions when Capital Preservation Mode is active
    // - Suspend when reserve conditions do not permit

    // TODO: Recapitalization logic
    // - Permit recapitalization under disclosed pricing rules
    // - Dilution accounting

    // TODO: Reserve-rebuild routing
    // - Do NOT route all yield into freely redeemable Catalyst vault
    // - Route to: segregated reserve, non-distributable reserve shares,
    //   locked recapitalization balance, or contract-enforced retained earnings
}
