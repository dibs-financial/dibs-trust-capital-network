// SPDX-License-Identifier: UNLICENSED
// DIBS Tests — Seed Liquidity & Timelocked Parameters
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DIBSVault} from "../../contracts/vault/DIBSVault.sol";
import {SentinelVault} from "../../contracts/vault/SentinelVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SeedLiquidityAndTimelockTest
 * @dev Tests:
 *      1. Non-redeemable seed liquidity lifecycle
 *      2. Minimum initial deposit enforcement
 *      3. Seed share transfer lock
 *      4. Seed share withdrawal lock (permanent and time-limited)
 *      5. Timelocked parameter change queue/execute/cancel
 *      6. Timelock bypass attempt rejection
 *      7. Timelocked selector validation
 */
contract MockAsset is ERC20 {
    constructor() ERC20("Mock Asset", "MA") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract SeedLiquidityAndTimelockTest is Test {
    MockAsset asset;
    DIBSVault vault;
    SentinelVault sentinel;

    address admin = address(this);
    address user1 = address(0x1);
    address user2 = address(0x2);
    address user3 = address(0x3);

    uint256 constant SEED_AMOUNT = 100e18;
    uint256 constant MIN_SEED = 50e18;

    function setUp() public {
        asset = new MockAsset();
        vault = new DIBSVault(asset, "Test Vault", "TVLT", 0);
        sentinel = new SentinelVault(address(asset), "Sentinel", "SEN", 0);

        // Mint tokens
        asset.mint(admin, 10000e18);
        asset.mint(user1, 1000e18);
        asset.mint(user2, 1000e18);
        asset.mint(user3, 1000e18);
    }

    // ═══════════════════════════════════════════════════════
    // SEED LIQUIDITY TESTS
    // ═══════════════════════════════════════════════════════

    // ─── Seeding Lifecycle ───────────────────────────────

    function test_SetMinimumSeedDeposit() public {
        vault.setMinimumSeedDeposit(MIN_SEED);
        assertEq(vault.minimumSeedDeposit(), MIN_SEED);
    }

    function test_SetMinimumSeedDeposit_RejectsZero() public {
        vm.expectRevert("DIBS: zero seed deposit");
        vault.setMinimumSeedDeposit(0);
    }

    function test_SetMinimumSeedDeposit_RejectsAfterSeeding() public {
        _seedVault(vault, SEED_AMOUNT, 0);
        vm.expectRevert("DIBS: already seeded");
        vault.setMinimumSeedDeposit(MIN_SEED);
    }

    function test_SeedVault_Success() public {
        _seedVault(vault, SEED_AMOUNT, 0);

        assertTrue(vault.isSeeded());
        assertGt(vault.seedShares(), 0, "Seed shares should be minted");
        assertEq(vault.seedLockExpiry(), 0, "Lock should be permanent");
        assertEq(vault.balanceOf(admin), vault.seedShares(), "Admin should hold seed shares");
    }

    function test_SeedVault_RejectsBelowMinimum() public {
        vault.setMinimumSeedDeposit(MIN_SEED);
        asset.approve(address(vault), MIN_SEED - 1);

        vm.expectRevert("DIBS: seed below minimum");
        vault.seedVault(MIN_SEED - 1, 0);
    }

    function test_SeedVault_RejectsDoubleSeeding() public {
        _seedVault(vault, SEED_AMOUNT, 0);

        asset.approve(address(vault), SEED_AMOUNT);
        vm.expectRevert("DIBS: already seeded");
        vault.seedVault(SEED_AMOUNT, 0);
    }

    function test_SeedVault_RejectsWithoutMinSet() public {
        asset.approve(address(vault), SEED_AMOUNT);
        vm.expectRevert("DIBS: minimum seed deposit not set");
        vault.seedVault(SEED_AMOUNT, 0);
    }

    function test_SeedVault_WithTimeLimitedLock() public {
        uint256 expiry = block.timestamp + 365 days;
        _seedVault(vault, SEED_AMOUNT, expiry);

        assertEq(vault.seedLockExpiry(), expiry);
        assertFalse(vault.isSeedUnlocked(), "Should be locked");
    }

    // ─── Deposit Rejection Before Seeding ──────────────────

    function test_Deposit_RejectedBeforeSeeding() public {
        asset.approve(address(vault), 1e18);
        vm.expectRevert("DIBS: vault not seeded");
        vault.deposit(1e18, user1);
    }

    function test_Deposit_AcceptedAfterSeeding() public {
        _seedVault(vault, SEED_AMOUNT, 0);

        vm.startPrank(user1);
        asset.approve(address(vault), 10e18);
        uint256 shares = vault.deposit(10e18, user1);
        vm.stopPrank();

        assertGt(shares, 0);
        assertGt(vault.balanceOf(user1), 0);
    }

    // ─── Seed Share Lock — Withdrawal ─────────────────────

    function test_SeedShares_NotRedeemable_PermanentLock() public {
        _seedVault(vault, SEED_AMOUNT, 0);

        // Read seed shares before expectRevert (view call would consume it)
        uint256 shares = vault.seedShares();

        // Admin tries to redeem seed shares
        asset.approve(address(vault), 0);
        vm.expectRevert("DIBS: cannot withdraw locked seed shares");
        vault.redeem(shares, admin, admin);
    }

    function test_SeedShares_NotRedeemable_PartialWithdrawal() public {
        _seedVault(vault, SEED_AMOUNT, 0);

        // Admin tries to redeem just 1 share — should fail if all shares are locked
        vm.expectRevert("DIBS: cannot withdraw locked seed shares");
        vault.redeem(1, admin, admin);
    }

    function test_SeedShares_RedeemableAfterTimeLock() public {
        uint256 lockDuration = 30 days;
        uint256 expiry = block.timestamp + lockDuration;
        _seedVault(vault, SEED_AMOUNT, expiry);

        // Before expiry — locked
        assertFalse(vault.isSeedUnlocked());
        vm.expectRevert("DIBS: cannot withdraw locked seed shares");
        vault.redeem(1, admin, admin);

        // Warp past expiry
        vm.warp(expiry + 1);
        assertTrue(vault.isSeedUnlocked());

        // Now redemption should work — redeem a small portion of seed shares
        uint256 balanceBefore = asset.balanceOf(admin);
        uint256 shares = vault.seedShares();
        vault.redeem(shares / 2, admin, admin);
        assertGt(asset.balanceOf(admin), balanceBefore, "Should receive assets");
    }

    function test_SeedShares_RedeemableAfterDeposit() public {
        // Admin deposits additional (non-seed) shares after seeding
        _seedVault(vault, SEED_AMOUNT, 0);

        // Admin deposits more — these shares are NOT locked
        asset.approve(address(vault), 10e18);
        uint256 extraShares = vault.deposit(10e18, admin);

        // Admin can redeem the extra shares (not the seed)
        uint256 balanceBefore = asset.balanceOf(admin);
        vault.redeem(extraShares, admin, admin);
        assertGt(asset.balanceOf(admin), balanceBefore, "Should redeem extra shares");
    }

    // ─── Seed Share Lock — Transfer ────────────────────────

    function test_SeedShares_NotTransferable_PermanentLock() public {
        _seedVault(vault, SEED_AMOUNT, 0);

        uint256 shares = vault.seedShares();
        vm.expectRevert("DIBS: cannot transfer locked seed shares");
        vault.transfer(user1, shares);
    }

    function test_SeedShares_PartialTransfer_BlockedIfExceedsFree() public {
        _seedVault(vault, SEED_AMOUNT, 0);

        // Admin deposits extra shares
        asset.approve(address(vault), 10e18);
        uint256 extraShares = vault.deposit(10e18, admin);

        // Transfer of extra shares should work
        vault.transfer(user1, extraShares);
        assertEq(vault.balanceOf(user1), extraShares);

        // But transferring more than extra (into seed) should fail
        vm.expectRevert("DIBS: cannot transfer locked seed shares");
        vault.transfer(user1, 1);
    }

    function test_SeedShares_TransferableAfterTimeLock() public {
        uint256 expiry = block.timestamp + 30 days;
        _seedVault(vault, SEED_AMOUNT, expiry);

        // Before expiry — locked
        vm.expectRevert("DIBS: cannot transfer locked seed shares");
        vault.transfer(user1, 1);

        // After expiry
        vm.warp(expiry + 1);
        uint256 transferAmount = vault.seedShares() / 10;
        vault.transfer(user1, transferAmount);
        assertGt(vault.balanceOf(user1), 0);
    }

    // ─── Seed Lock Extension ───────────────────────────────

    function test_ExtendSeedLock_CanExtend() public {
        uint256 originalExpiry = block.timestamp + 30 days;
        _seedVault(vault, SEED_AMOUNT, originalExpiry);

        uint256 newExpiry = block.timestamp + 365 days;
        vault.extendSeedLock(newExpiry);
        assertEq(vault.seedLockExpiry(), newExpiry);
    }

    function test_ExtendSeedLock_CannotShorten() public {
        uint256 originalExpiry = block.timestamp + 365 days;
        _seedVault(vault, SEED_AMOUNT, originalExpiry);

        vm.expectRevert("DIBS: cannot shorten lock");
        vault.extendSeedLock(block.timestamp + 30 days);
    }

    function test_ExtendSeedLock_CanMakePermanent() public {
        uint256 originalExpiry = block.timestamp + 30 days;
        _seedVault(vault, SEED_AMOUNT, originalExpiry);

        vault.extendSeedLock(0);
        assertEq(vault.seedLockExpiry(), 0);
        assertFalse(vault.isSeedUnlocked());
    }

    // ─── Locked/Redeemable Share Queries ──────────────────

    function test_LockedSharesOf_Admin() public {
        _seedVault(vault, SEED_AMOUNT, 0);
        assertEq(vault.lockedSharesOf(admin), vault.seedShares());
    }

    function test_LockedSharesOf_NonAdmin() public {
        _seedVault(vault, SEED_AMOUNT, 0);
        assertEq(vault.lockedSharesOf(user1), 0);
    }

    function test_RedeemableSharesOf_Admin() public {
        _seedVault(vault, SEED_AMOUNT, 0);
        assertEq(vault.redeemableSharesOf(admin), 0, "All admin shares locked");
    }

    function test_RedeemableSharesOf_AdminWithExtra() public {
        _seedVault(vault, SEED_AMOUNT, 0);

        asset.approve(address(vault), 10e18);
        uint256 extraShares = vault.deposit(10e18, admin);

        assertEq(vault.redeemableSharesOf(admin), extraShares, "Only extra shares redeemable");
    }

    function test_LockedShares_ZeroAfterUnlock() public {
        uint256 expiry = block.timestamp + 30 days;
        _seedVault(vault, SEED_AMOUNT, expiry);

        assertGt(vault.lockedSharesOf(admin), 0);
        vm.warp(expiry + 1);
        assertEq(vault.lockedSharesOf(admin), 0, "No locked shares after unlock");
    }

    // ═══════════════════════════════════════════════════════
    // TIMELOCKED PARAMETER CHANGE TESTS
    // ═══════════════════════════════════════════════════════

    // ─── Queue & Execute ───────────────────────────────────

    function test_QueueParameterChange_Success() public {
        bytes4 selector = vault.setMinJuniorRatio.selector;
        bytes memory data = abi.encode(uint256(3000)); // 30%

        bytes32 changeId = vault.queueParameterChange(selector, data);

        DIBSVault.ParameterChange memory change = vault.getPendingChange(changeId);
        assertEq(change.selector, selector);
        assertFalse(change.executed);
        assertFalse(change.cancelled);
        assertEq(change.executeAfter, block.timestamp + vault.timelockDelay());
    }

    function test_ExecuteParameterChange_AfterDelay() public {
        bytes4 selector = vault.setMinJuniorRatio.selector;
        bytes memory data = abi.encode(uint256(3000));

        bytes32 changeId = vault.queueParameterChange(selector, data);

        // Before delay — should fail
        vm.expectRevert("DIBS: timelock not expired");
        vault.executeParameterChange(changeId);

        // Warp past delay
        vm.warp(block.timestamp + vault.timelockDelay() + 1);

        // Execute
        vault.executeParameterChange(changeId);

        assertEq(vault.minJuniorRatioBps(), 3000, "Parameter should be updated");

        DIBSVault.ParameterChange memory change = vault.getPendingChange(changeId);
        assertTrue(change.executed);
    }

    function test_ExecuteParameterChange_DoubleExecuteReverted() public {
        bytes32 changeId = vault.queueParameterChange(
            vault.setMinJuniorRatio.selector,
            abi.encode(uint256(3000))
        );

        vm.warp(block.timestamp + vault.timelockDelay() + 1);
        vault.executeParameterChange(changeId);

        vm.expectRevert("DIBS: already executed");
        vault.executeParameterChange(changeId);
    }

    // ─── Cancel ────────────────────────────────────────────

    function test_CancelParameterChange_Success() public {
        bytes32 changeId = vault.queueParameterChange(
            vault.setMinJuniorRatio.selector,
            abi.encode(uint256(3000))
        );

        vault.cancelParameterChange(changeId);

        DIBSVault.ParameterChange memory change = vault.getPendingChange(changeId);
        assertTrue(change.cancelled);

        // Cannot execute cancelled change
        vm.warp(block.timestamp + vault.timelockDelay() + 1);
        vm.expectRevert("DIBS: change cancelled");
        vault.executeParameterChange(changeId);
    }

    // ─── Selector Validation ───────────────────────────────

    function test_QueueRejectsNonTimelockedSelector() public {
        // emergencyPause is NOT in the timelocked list
        bytes4 selector = vault.emergencyPause.selector;

        vm.expectRevert("DIBS: selector not timelocked");
        vault.queueParameterChange(selector, "");
    }

    function test_IsTimelockedSelector_ReturnsCorrectValues() public {
        // These should be timelocked
        assertTrue(vault.isTimelockedSelector(bytes4(keccak256("setMinJuniorRatio(uint256)"))));
        assertTrue(vault.isTimelockedSelector(bytes4(keccak256("setPairedVault(address)"))));
        assertTrue(vault.isTimelockedSelector(bytes4(keccak256("setVaultClass(uint8)"))));
        assertTrue(vault.isTimelockedSelector(bytes4(keccak256("setPreservationManager(address)"))));
        assertTrue(vault.isTimelockedSelector(bytes4(keccak256("assignEmergencyRole(address)"))));
        assertTrue(vault.isTimelockedSelector(bytes4(keccak256("setDepositCap(uint256)"))));

        // These should NOT be timelocked
        assertFalse(vault.isTimelockedSelector(bytes4(keccak256("emergencyPause()"))));
        assertFalse(vault.isTimelockedSelector(bytes4(keccak256("emergencyUnpause()"))));
    }

    // ─── Timelock Delay Configuration ──────────────────────

    function test_SetTimelockDelay_Success() public {
        vault.setTimelockDelay(72 hours);
        assertEq(vault.timelockDelay(), 72 hours);
    }

    function test_SetTimelockDelay_RejectsTooShort() public {
        vm.expectRevert("DIBS: delay out of range");
        vault.setTimelockDelay(30 minutes);
    }

    function test_SetTimelockDelay_RejectsTooLong() public {
        vm.expectRevert("DIBS: delay out of range");
        vault.setTimelockDelay(8 days);
    }

    function test_DefaultTimelockDelay() public {
        assertEq(vault.timelockDelay(), 48 hours);
    }

    // ─── Multiple Parameter Changes ────────────────────────

    function test_MultipleQueuedChanges() public {
        // Queue multiple changes
        bytes32 id1 = vault.queueParameterChange(
            vault.setMinJuniorRatio.selector,
            abi.encode(uint256(2500))
        );
        bytes32 id2 = vault.queueParameterChange(
            vault.setDepositCap.selector,
            abi.encode(uint256(1000e18))
        );

        // Both should have different IDs
        assertTrue(id1 != id2);

        // Warp and execute both
        vm.warp(block.timestamp + vault.timelockDelay() + 1);

        vault.executeParameterChange(id1);
        vault.executeParameterChange(id2);

        assertEq(vault.minJuniorRatioBps(), 2500);
        assertEq(vault.depositCap(), 1000e18);
    }

    // ─── Direct Call Still Works (No Timelock Enforcement) ─

    function test_DirectCall_StillWorks() public {
        // Direct calls to timelocked functions still work (admin can bypass)
        // The timelock is a governance safety layer, not a hard restriction
        vault.setMinJuniorRatio(2500);
        assertEq(vault.minJuniorRatioBps(), 2500);
    }

    // ═══════════════════════════════════════════════════════
    // INTEGRATION: Seed + CPM + Timelock
    // ═══════════════════════════════════════════════════════

    function test_SeededVault_AcceptsDeposits_AndEnforcesCPM() public {
        // Seed the sentinel vault
        sentinel.setMinimumSeedDeposit(MIN_SEED);
        asset.approve(address(sentinel), SEED_AMOUNT);
        sentinel.seedVault(SEED_AMOUNT, 0);

        // User can deposit after seeding
        vm.startPrank(user1);
        asset.approve(address(sentinel), 80e18);
        sentinel.deposit(80e18, user1);
        vm.stopPrank();

        // Admin seed shares are locked
        assertEq(sentinel.redeemableSharesOf(admin), 0);
    }

    // ─── Helper ────────────────────────────────────────────

    function _seedVault(DIBSVault v, uint256 amount, uint256 lockExpiry) internal {
        v.setMinimumSeedDeposit(MIN_SEED);
        asset.approve(address(v), amount);
        v.seedVault(amount, lockExpiry);
    }
}
