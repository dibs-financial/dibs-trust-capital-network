// SPDX-License-Identifier: UNLICENSED
// DIBS Tests — Donation Attack Simulation
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DIBSVault} from "../../contracts/vault/DIBSVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title DonationAttackTest
 * @dev Tests ERC-4626 donation/inflation attack vectors and virtual-offset mitigation.
 *
 * Attack Sequence:
 * 1. Attacker deposits minimal assets into empty vault
 * 2. Attacker receives minimal shares
 * 3. Attacker donates assets directly to vault
 * 4. Donation changes apparent share-to-asset exchange rate
 * 5. Later depositor receives too few shares due to rounding
 * 6. In extreme cases, later depositor receives zero shares
 * 7. Attacker extracts value through manipulated share ownership
 *
 * Mitigation: Virtual assets, virtual shares, configurable decimals offset.
 * Shares = Assets * (TotalSupply + 10^offset) / (TotalAssets + 1)
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

    function setUp() public {
        asset = new MockAsset();
        vault = new DIBSVault(asset, "DIBS Vault", "DIBS", 0);

        // Mint tokens to test addresses
        asset.mint(address(this), 1e24);
        asset.mint(address(0x1), 1e24);
        asset.mint(address(0x2), 1e24);
    }

    /**
     * Test: Direct donation should not prevent subsequent depositors from receiving shares.
     */
    function test_DonationAttack_VirtualOffsetMitigation() public {
        // Attacker deposits minimal amount
        address attacker = address(0x1);
        vm.startPrank(attacker);
        asset.approve(address(vault), type(uint256).max);
        uint256 attackerShares = vault.deposit(1e6, attacker);
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
     * Test: Minimum shares out enforcement prevents dust deposits.
     */
    function test_MinSharesOut_RevertsOnDustDeposit() public {
        address user = address(0x1);
        vm.startPrank(user);
        asset.approve(address(vault), type(uint256).max);

        // Dust deposit should revert
        vm.expectRevert("DIBS: shares below minimum");
        vault.deposit(1, user);
        vm.stopPrank();
    }

    /**
     * Test: Deposit cap enforcement.
     */
    function test_DepositCap_Enforced() public {
        DIBSVault cappedVault = new DIBSVault(asset, "Capped", "CAP", 1e18);

        address user = address(0x1);
        vm.startPrank(user);
        asset.approve(address(cappedVault), type(uint256).max);

        // Deposit up to cap
        cappedVault.deposit(1e18, user);

        // Deposit beyond cap should revert
        vm.expectRevert("DIBS: deposit cap exceeded");
        cappedVault.deposit(1, user);
        vm.stopPrank();
    }

    /**
     * Test: Emergency pause blocks deposits.
     */
    function test_EmergencyPause_BlocksDeposits() public {
        address emergencyRole = address(0x3);

        // Set emergency role (TODO: implement proper role assignment)
        // vault.setEmergencyRole(emergencyRole);

        // Pause
        vm.prank(emergencyRole);
        // vault.emergencyPause();

        // Deposit should revert
        address user = address(0x1);
        vm.startPrank(user);
        asset.approve(address(vault), type(uint256).max);
        vm.expectRevert("DIBS: paused");
        vault.deposit(1e18, user);
        vm.stopPrank();
    }
}
