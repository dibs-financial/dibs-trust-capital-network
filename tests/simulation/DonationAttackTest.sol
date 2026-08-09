// SPDX-License-Identifier: UNLICENSED
// DIBS Tests — Donation Attack Simulation
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DIBSVault} from "../../contracts/vault/DIBSVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title DonationAttackTest
 * @dev Tests ERC-4626 donation/inflation attack vectors and virtual-offset mitigation.
 */
contract MockAsset is ERC20 {
    constructor() ERC20("Mock Asset", "MA") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DonationAttackTest is Test {
    MockAsset asset;
    DIBSVault vault;
    uint256 constant SEED_AMOUNT = 1e12;

    function setUp() public {
        asset = new MockAsset();
        vault = new DIBSVault(asset, "DIBS Vault", "DIBS", 0);

        // Mint tokens to test addresses
        asset.mint(address(this), 1e24);
        asset.mint(address(0x1), 1e24);
        asset.mint(address(0x2), 1e24);
        asset.mint(address(0x3), 1e24);

        // Seed the vault with non-redeemable initial liquidity
        vault.setMinimumSeedDeposit(SEED_AMOUNT);
        asset.approve(address(vault), SEED_AMOUNT);
        vault.seedVault(SEED_AMOUNT, 0); // permanent lock
    }

    function _seedVault(DIBSVault v, uint256 amount) internal {
        v.setMinimumSeedDeposit(amount);
        asset.approve(address(v), amount);
        v.seedVault(amount, 0);
    }

    /**
     * Test: Direct donation should not prevent subsequent depositors from receiving shares.
     */
    function test_DonationAttack_VirtualOffsetMitigation() public {
        // Attacker deposits (scaled relative to seed)
        address attacker = address(0x1);
        vm.startPrank(attacker);
        asset.approve(address(vault), type(uint256).max);
        uint256 attackerShares = vault.deposit(1e12, attacker);
        vm.stopPrank();

        // Attacker donates large amount directly to vault
        asset.transfer(address(vault), 1e20);

        // Victim deposits — should still receive meaningful shares
        address victim = address(0x2);
        vm.startPrank(victim);
        asset.approve(address(vault), type(uint256).max);
        uint256 victimShares = vault.deposit(1e18, victim);
        vm.stopPrank();

        // Victim should receive non-zero shares (not zero due to donation attack)
        assertGt(victimShares, 0, "Victim received zero shares - donation attack succeeded");

        // Victim shares should be meaningful (not dust)
        assertGt(victimShares, vault.MIN_SHARES_OUT(), "Victim shares below minimum threshold");
    }

    /**
     * Test: Minimum shares out enforcement prevents dust deposits after donation inflates exchange rate.
     */
    function test_MinSharesOut_RevertsOnDustDeposit() public {
        // First depositor establishes a position
        address first = address(0x1);
        vm.startPrank(first);
        asset.approve(address(vault), type(uint256).max);
        vault.deposit(1e12, first);
        vm.stopPrank();

        // Donate large amount to inflate exchange rate
        asset.transfer(address(vault), 1e22);

        // Now a 1-wei deposit should produce shares below MIN_SHARES_OUT
        address user = address(0x2);
        vm.startPrank(user);
        asset.approve(address(vault), type(uint256).max);
        vm.expectRevert("DIBS: shares below minimum");
        vault.deposit(1, user);
        vm.stopPrank();
    }

    /**
     * Test: Deposit cap enforcement.
     */
    function test_DepositCap_Enforced() public {
        DIBSVault cappedVault = new DIBSVault(asset, "Capped", "CAP", 2e18);
        _seedVault(cappedVault, 1e12);

        address user = address(0x1);
        vm.startPrank(user);
        asset.approve(address(cappedVault), type(uint256).max);

        // Deposit up to remaining cap (2e18 - 1e12 seed ≈ 2e18)
        cappedVault.deposit(1e18, user);

        // Another deposit should exceed cap
        vm.expectRevert("DIBS: deposit cap exceeded");
        cappedVault.deposit(1e18, user);
        vm.stopPrank();
    }

    /**
     * Test: Emergency pause blocks deposits.
     */
    function test_EmergencyPause_BlocksDeposits() public {
        address emergencyRole = address(0x3);

        // Admin sets emergency role
        vault.assignEmergencyRole(emergencyRole);

        // Emergency role pauses
        vm.prank(emergencyRole);
        vault.emergencyPause();

        // Deposit should revert when paused
        address user = address(0x1);
        vm.startPrank(user);
        asset.approve(address(vault), type(uint256).max);
        vm.expectRevert("DIBS: paused");
        vault.deposit(1e18, user);
        vm.stopPrank();
    }
}
