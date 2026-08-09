// SPDX-License-Identifier: UNLICENSED
// DIBS Tests — Capital Preservation Mode (Solidity)
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SentinelVault} from "../../contracts/vault/SentinelVault.sol";
import {CatalystVault} from "../../contracts/vault/CatalystVault.sol";
import {CapitalPreservationManager} from "../../contracts/vault/CapitalPreservationManager.sol";
import {DIBSVault} from "../../contracts/vault/DIBSVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title CapitalPreservationModeTest
 * @dev Tests the full Capital Preservation Mode lifecycle:
 *      1. Ratio computation across paired vaults
 *      2. Trigger when JuniorRatio < MinJuniorRatio
 *      3. Sentinel withdrawal blocking + queue
 *      4. Catalyst distribution suspension
 *      5. Reserve release gating
 *      6. Lift after ratio restoration + liquidity tests
 *      7. Queue processing after lift
 *      8. Dilution guard on Sentinel deposits during preservation
 */
contract MockAsset is ERC20 {
    constructor() ERC20("Mock Asset", "MA") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CapitalPreservationModeTest is Test {
    MockAsset asset;
    SentinelVault sentinel;
    CatalystVault catalyst;
    CapitalPreservationManager manager;

    address admin = address(this);
    address user1 = address(0x1);
    address user2 = address(0x2);
    address user3 = address(0x3);

    uint256 constant SENTINEL_DEPOSIT = 80e18;
    uint256 constant CATALYST_DEPOSIT = 20e18;
    uint256 constant MIN_JUNIOR_RATIO_BPS = 2000; // 20%

    function setUp() public {
        asset = new MockAsset();

        // Deploy vaults
        sentinel = new SentinelVault(address(asset), "Sentinel", "SEN", 0);
        catalyst = new CatalystVault(address(asset), "Catalyst", "CAT", 0);

        // Set vault classes (already set in constructors, but verify)
        assert(uint256(sentinel.vaultClass()) == uint256(DIBSVault.VaultClass.Sentinel));
        assert(uint256(catalyst.vaultClass()) == uint256(DIBSVault.VaultClass.Catalyst));

        // Set minimum junior ratio
        sentinel.setMinJuniorRatio(MIN_JUNIOR_RATIO_BPS);
        catalyst.setMinJuniorRatio(MIN_JUNIOR_RATIO_BPS);

        // Pair the vaults
        sentinel.setPairedVault(address(catalyst));
        catalyst.setPairedVault(address(sentinel));

        // Set liquidity tests to pass by default
        sentinel.setLiquidityTestResult(true);
        catalyst.setLiquidityTestResult(true);

        // Deploy manager
        manager = new CapitalPreservationManager(
            address(sentinel),
            address(catalyst),
            0 // no reserve target initially
        );

        // Authorize manager to trigger/lift preservation on vaults
        sentinel.setPreservationManager(address(manager));
        catalyst.setPreservationManager(address(manager));

        // Mint tokens to users and admin
        asset.mint(admin, 1000e18);
        asset.mint(user1, 1000e18);
        asset.mint(user2, 1000e18);
        asset.mint(user3, 1000e18);

        // Seed both vaults with small non-redeemable initial liquidity
        // (small amount to minimize impact on JuniorRatio computation)
        sentinel.setMinimumSeedDeposit(1e12);
        asset.approve(address(sentinel), 1e12);
        sentinel.seedVault(1e12, 0);

        catalyst.setMinimumSeedDeposit(1e12);
        asset.approve(address(catalyst), 1e12);
        catalyst.seedVault(1e12, 0);

        // Initial deposits: 80% Sentinel, 20% Catalyst (JuniorRatio = 20%)
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(SENTINEL_DEPOSIT, user1);
        vm.stopPrank();

        vm.startPrank(user2);
        asset.approve(address(catalyst), type(uint256).max);
        catalyst.deposit(CATALYST_DEPOSIT, user2);
        vm.stopPrank();
    }

    // ─── JuniorRatio Computation ───────────────────────────

    function test_JuniorRatio_Initial20Percent() public {
        uint256 ratio = sentinel.computeJuniorRatioBps();
        // 20e18 / (80e18 + 20e18) = 0.20 = 2000 bps
        assertEq(ratio, 2000, "JuniorRatio should be 20%");
    }

    function test_JuniorRatio_WhenCatalystShrinks() public {
        // Catalyst loses value (simulate by burning shares)
        // In practice, losses flow through the vault
        // For test: deposit more to Sentinel to dilute ratio
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        // Now: 20 / (100 + 20) = 16.67%
        uint256 ratio = sentinel.computeJuniorRatioBps();
        assertLt(ratio, MIN_JUNIOR_RATIO_BPS, "Ratio should be below minimum");
    }

    function test_JuniorRatio_WhenCatalystGrows() public {
        vm.startPrank(user2);
        asset.approve(address(catalyst), type(uint256).max);
        catalyst.deposit(20e18, user2);
        vm.stopPrank();

        // Now: 40 / (80 + 40) = 33.3%
        uint256 ratio = sentinel.computeJuniorRatioBps();
        assertGt(ratio, 3000, "Ratio should be above 30%");
    }

    function test_JuniorRatio_NoPair() public {
        // Create unpaired vault
        SentinelVault unpaired = new SentinelVault(address(asset), "U", "U", 0);
        assertEq(unpaired.computeJuniorRatioBps(), 10000, "Unpaired should be 100%");
    }

    // ─── Preservation Trigger ──────────────────────────────

    function test_TriggerPreservation_RatioBelowMinimum() public {
        // Dilute: deposit 20e18 more to Sentinel
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        // Trigger via manager
        bool triggered = manager.checkAndTrigger();
        assertTrue(triggered, "Should trigger");
        assertTrue(sentinel.preservationModeActive(), "Sentinel should be in preservation");
        assertTrue(catalyst.preservationModeActive(), "Catalyst should be in preservation");
        assertTrue(catalyst.distributionsSuspended(), "Distributions should be suspended");
    }

    function test_NoTrigger_RatioAtMinimum() public {
        // Ratio is exactly 20% (at minimum, not below)
        bool triggered = manager.checkAndTrigger();
        assertFalse(triggered, "Should not trigger at minimum");
        assertFalse(sentinel.preservationModeActive(), "Should not be active");
    }

    function test_NoTrigger_RatioAboveMinimum() public {
        // Increase Catalyst NAV
        vm.startPrank(user2);
        asset.approve(address(catalyst), type(uint256).max);
        catalyst.deposit(10e18, user2);
        vm.stopPrank();

        bool triggered = manager.checkAndTrigger();
        assertFalse(triggered, "Should not trigger above minimum");
    }

    // ─── Sentinel Withdrawal Blocking ─────────────────────

    function test_SentinelWithdrawal_BlockedDuringPreservation() public {
        // Trigger preservation
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Try to withdraw from Sentinel — should revert
        vm.startPrank(user1);
        vm.expectRevert("DIBS: Sentinel withdrawals blocked during preservation mode");
        sentinel.withdraw(1e18, user1, user1);
        vm.stopPrank();
    }

    function test_SentinelWithdrawal_QueueDuringPreservation() public {
        // Trigger preservation
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Queue a withdrawal (assets, shares)
        vm.startPrank(user1);
        uint256 queueShares = sentinel.previewWithdraw(1e18);
        sentinel.queueWithdrawal(1e18, queueShares);
        vm.stopPrank();

        assertEq(sentinel.queueLength(), 1, "Queue should have 1 request");
        assertEq(sentinel.pendingQueueCount(), 1, "Pending count should be 1");
    }

    // ─── Catalyst Distribution Suspension ──────────────────

    function test_CatalystWithdrawal_BlockedDuringPreservation() public {
        // Trigger preservation
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Try to withdraw from Catalyst — should revert
        vm.startPrank(user2);
        vm.expectRevert("DIBS: Catalyst distributions suspended during preservation mode");
        catalyst.withdraw(1e18, user2, user2);
        vm.stopPrank();
    }

    // ─── Reserve Release Gating ────────────────────────────

    function test_ReserveRelease_BlockedDuringPreservation() public {
        // Trigger preservation
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        assertFalse(sentinel.canReleaseReserve(), "Should not release during preservation");
    }

    function test_ReserveRelease_AllowedWhenConditionsMet() public {
        // No preservation, ratio at minimum, liquidity passed
        assertTrue(sentinel.canReleaseReserve(), "Should allow release");
    }

    // ─── Lift Preservation ─────────────────────────────────

    function test_LiftPreservation_AfterRatioRestored() public {
        // Trigger by diluting
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();
        assertTrue(sentinel.preservationModeActive());

        // Restore ratio: deposit more to Catalyst
        vm.startPrank(user2);
        asset.approve(address(catalyst), type(uint256).max);
        catalyst.deposit(20e18, user2);
        vm.stopPrank();

        // Now ratio = 40 / (100 + 40) = 28.6% > 20%
        // Lift preservation
        manager.liftPreservation();

        assertFalse(sentinel.preservationModeActive(), "Should be lifted");
        assertFalse(catalyst.preservationModeActive(), "Should be lifted");
        assertFalse(catalyst.distributionsSuspended(), "Distributions should resume");
    }

    function test_LiftPreservation_BlocksIfRatioStillLow() public {
        // Trigger
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Try to lift without restoring ratio
        vm.expectRevert("DIBS: ratio still below minimum");
        manager.liftPreservation();
    }

    function test_LiftPreservation_BlocksIfLiquidityTestsFail() public {
        // Trigger
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Restore ratio
        vm.startPrank(user2);
        asset.approve(address(catalyst), type(uint256).max);
        catalyst.deposit(20e18, user2);
        vm.stopPrank();

        // But fail liquidity tests
        manager.setLiquidityTestResult(false);

        vm.expectRevert("DIBS: liquidity tests not passed");
        manager.liftPreservation();
    }

    // ─── Queue Processing After Lift ──────────────────────

    function test_QueueProcessing_AfterLift() public {
        // Trigger
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Queue withdrawal
        vm.startPrank(user1);
        uint256 qShares = sentinel.previewWithdraw(1e18);
        sentinel.queueWithdrawal(1e18, qShares);
        vm.stopPrank();

        assertEq(sentinel.pendingQueueCount(), 1);

        // Restore ratio
        vm.startPrank(user2);
        asset.approve(address(catalyst), type(uint256).max);
        catalyst.deposit(20e18, user2);
        vm.stopPrank();

        // Lift (processes queue internally)
        manager.liftPreservation();

        assertEq(sentinel.pendingQueueCount(), 0, "Queue should be drained");
    }

    // ─── Dilution Guard ───────────────────────────────────

    function test_DilutionGuard_BlocksSentinelDepositDuringPreservation() public {
        // Trigger
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Try to deposit more to Sentinel (would further dilute)
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        vm.expectRevert("DIBS: deposit blocked during preservation mode (dilution)");
        sentinel.deposit(10e18, user1);
        vm.stopPrank();
    }

    function test_DilutionGuard_AllowsNonDilutiveDeposit() public {
        // Trigger
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Deposit to Catalyst instead (improves ratio, not dilutive)
        vm.startPrank(user2);
        asset.approve(address(catalyst), type(uint256).max);
        catalyst.deposit(20e18, user2);
        vm.stopPrank();

        // Ratio should now be improved
        uint256 ratio = sentinel.computeJuniorRatioBps();
        assertGt(ratio, MIN_JUNIOR_RATIO_BPS, "Ratio should be restored");
    }

    // ─── System Status ────────────────────────────────────

    function test_SystemStatus_ReportsCorrectValues() public {
        (
            bool active,
            uint256 ratio,
            uint256 minRatio,
            uint256 senNAV,
            uint256 catNAV,
            uint256 senReserve,
            uint256 shortfall,
            uint256 queueLen,
            bool distSuspended
        ) = manager.getSystemStatus();

        assertFalse(active);
        assertEq(ratio, 2000);
        assertEq(minRatio, MIN_JUNIOR_RATIO_BPS);
        assertEq(senNAV, SENTINEL_DEPOSIT + 1e12);
        assertEq(catNAV, CATALYST_DEPOSIT + 1e12);
        assertEq(senReserve, 0);
        assertEq(shortfall, 0);
        assertEq(queueLen, 0);
        assertFalse(distSuspended);
    }

    // ─── Yield Routing ────────────────────────────────────

    function test_YieldRouting_ToReserveDuringPreservation() public {
        // Trigger
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Route yield to reserve
        uint256 yieldAmount = 5e18;
        asset.mint(address(this), yieldAmount);
        asset.approve(address(catalyst), yieldAmount);

        // Route via Catalyst vault
        catalyst.routeYield(yieldAmount);

        assertEq(sentinel.segregatedReserve() + catalyst.segregatedReserve(), yieldAmount,
            "Yield should be in segregated reserve");
        assertGt(catalyst.totalYieldRoutedToReserve(), 0, "Should track routed yield");
    }

    // ─── Reserve Deposit ─────────────────────────────────

    function test_ReserveDeposit_IncreasesBalance() public {
        uint256 amount = 10e18;
        asset.mint(address(this), amount);
        asset.approve(address(sentinel), amount);
        sentinel.depositToReserve(amount);

        assertEq(sentinel.segregatedReserve(), amount, "Reserve should increase");
    }

    function test_ReserveRelease_BlocksWhenRatioLow() public {
        // Deposit reserve first
        uint256 amount = 10e18;
        asset.mint(address(this), amount);
        asset.approve(address(sentinel), amount);
        sentinel.depositToReserve(amount);

        // Trigger preservation (ratio drops)
        vm.startPrank(user1);
        asset.approve(address(sentinel), type(uint256).max);
        sentinel.deposit(20e18, user1);
        vm.stopPrank();

        manager.checkAndTrigger();

        // Try to release — should fail
        vm.expectRevert("DIBS: reserve release not permitted");
        sentinel.releaseReserve(5e18, user3);
    }
}
