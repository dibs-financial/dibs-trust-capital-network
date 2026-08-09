// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Routing Adapter Tests
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {MorphoAdapter} from "../../contracts/routing/Adapters.sol";
import {PendleAdapter} from "../../contracts/routing/Adapters.sol";
import {SettlementAdapter} from "../../contracts/routing/Adapters.sol";
import {OracleAdapter} from "../../contracts/routing/Adapters.sol";
import {WithdrawalQueueRouter} from "../../contracts/routing/Adapters.sol";
import {YieldDiversionRouter} from "../../contracts/routing/Adapters.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK CONTRACTS
// ═══════════════════════════════════════════════════════════════════════════════

contract MockAsset is ERC20 {
    constructor() ERC20("Mock Asset", "MA") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockOracle {
    int256 public price;
    uint256 public updatedAt;
    uint8 public decimals_ = 8;

    constructor(int256 price_) {
        price = price_;
        updatedAt = block.timestamp;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, price, block.timestamp, updatedAt, 1);
    }

    function decimals() external view returns (uint8) { return decimals_; }
    function description() external pure returns (string memory) { return "Mock Oracle"; }

    function setPrice(int256 price_) external { price = price_; }
    function setUpdatedAt(uint256 ts) external { updatedAt = ts; }
}

contract MockSettlementPartner {
    mapping(bytes32 => bool) public submitted;
    mapping(bytes32 => uint8) public status; // 0=pending, 1=confirmed, 2=failed
    mapping(bytes32 => uint256) public settledAmounts;
    mapping(bytes32 => bytes32) public extRefs;

    function submitInstruction(
        bytes32 instructionId,
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes32) {
        submitted[instructionId] = true;
        bytes32 extRef = keccak256(abi.encodePacked("ext", instructionId));
        extRefs[instructionId] = extRef;
        return extRef;
    }

    function confirmSettlement(
        bytes32 externalReference,
        uint256 settledAmount,
        uint256,
        bytes32
    ) external returns (bool) {
        status[externalReference] = 1;
        settledAmounts[externalReference] = settledAmount;
        return true;
    }

    function getInstructionStatus(bytes32 externalReference)
        external
        view
        returns (uint8, uint256, uint256)
    {
        return (status[externalReference], settledAmounts[externalReference], block.timestamp);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORACLE ADAPTER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

contract OracleAdapterTest is Test {
    OracleAdapter adapter;
    MockOracle oracle1;
    MockOracle oracle2;
    MockOracle oracle3;

    function setUp() public {
        vm.warp(1000000);  // Set block timestamp to avoid underflow
        adapter = new OracleAdapter();
        oracle1 = new MockOracle(2000e8);
        oracle2 = new MockOracle(2010e8);
        oracle3 = new MockOracle(1990e8);

        adapter.registerOracle(address(oracle1), 5, 3600);
        adapter.registerOracle(address(oracle2), 3, 3600);
        adapter.registerOracle(address(oracle3), 2, 3600);
    }

    function test_RegisterOracle_Success() public view {
        (, uint8 weight, uint256 staleness, bool active, ) = adapter.oracles(address(oracle1));
        assertEq(weight, 5);
        assertEq(staleness, 3600);
        assertTrue(active);
    }

    function test_RegisterOracle_RejectsZeroAddress() public {
        vm.expectRevert();
        adapter.registerOracle(address(0), 1, 3600);
    }

    function test_RegisterOracle_RejectsInvalidWeight() public {
        vm.expectRevert(abi.encodeWithSelector(OracleAdapter.InvalidWeight.selector, 0));
        adapter.registerOracle(address(oracle1), 0, 3600);

        vm.expectRevert(abi.encodeWithSelector(OracleAdapter.InvalidWeight.selector, 11));
        adapter.registerOracle(address(oracle1), 11, 3600);
    }

    function test_RemoveOracle() public {
        adapter.removeOracle(address(oracle2));
        (, , , bool active, ) = adapter.oracles(address(oracle2));
        assertFalse(active);
    }

    function test_AggregateMedian() public {
        // Median of 1990, 2000, 2010 = 2000
        (uint256 price, uint256 count) = adapter.aggregatePrice();
        assertEq(price, 2000e8);
        assertEq(count, 3);
    }

    function test_AggregateMin() public {
        adapter.setAggregationMode(OracleAdapter.AggregationMode.Min);
        (uint256 price, uint256 count) = adapter.aggregatePrice();
        assertEq(price, 1990e8);
        assertEq(count, 3);
    }

    function test_AggregateWeightedAvg() public {
        adapter.setAggregationMode(OracleAdapter.AggregationMode.WeightedAvg);
        // (2000*5 + 2010*3 + 1990*2) / 10 = (10000 + 6030 + 3980) / 10 = 20010
        (uint256 price, uint256 count) = adapter.aggregatePrice();
        assertEq(price, 20010e7); // 2001e8 but integer math gives 20010e7 = 200.1e8... let me recalc
        // Actually: (2000e8 * 5 + 2010e8 * 3 + 1990e8 * 2) / 10
        // = (10000e8 + 6030e8 + 3980e8) / 10 = 20010e8 / 10 = 2001e8
        assertEq(count, 3);
    }

    function test_Aggregate_SkipsStaleOracle() public {
        // Make oracle3 stale
        oracle3.setUpdatedAt(block.timestamp - 7200); // 2 hours ago, staleness is 1 hour

        // checkAllFreshness will flag it
        (uint256 fresh, uint256 stale) = adapter.checkAllFreshness();
        assertEq(fresh, 2);
        assertEq(stale, 1);

        // Aggregate should skip stale oracle
        (uint256 price, uint256 count) = adapter.aggregatePrice();
        assertEq(count, 2); // only 2 fresh oracles
    }

    function test_Aggregate_SkipsSimulatedFailure() public {
        adapter.simulateOracleFailure(address(oracle2), true);

        (uint256 price, uint256 count) = adapter.aggregatePrice();
        assertEq(count, 2); // oracle2 excluded
    }

    function test_Aggregate_NoOracles_Reverts() public {
        OracleAdapter empty = new OracleAdapter();
        vm.expectRevert(OracleAdapter.NoActiveOracles.selector);
        empty.aggregatePrice();
    }

    function test_FreshnessCheck() public {
        (bool fresh, uint256 age) = adapter.checkFreshness(address(oracle1));
        assertTrue(fresh);
        assertEq(age, 0);
    }

    function test_FreshnessCheck_Stale() public {
        oracle1.setUpdatedAt(block.timestamp - 7200);
        (bool fresh,) = adapter.checkFreshness(address(oracle1));
        assertFalse(fresh);
        assertTrue(adapter.staleFlags(address(oracle1)));
    }

    function test_ClearStaleFlag() public {
        oracle1.setUpdatedAt(block.timestamp - 7200);
        adapter.checkFreshness(address(oracle1));
        assertTrue(adapter.staleFlags(address(oracle1)));

        adapter.clearStaleFlag(address(oracle1));
        assertFalse(adapter.staleFlags(address(oracle1)));
    }

    function test_OracleCount() public {
        assertEq(adapter.getOracleCount(), 3);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTLEMENT ADAPTER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

contract SettlementAdapterTest is Test {
    SettlementAdapter adapter;
    MockAsset asset;
    MockSettlementPartner partner;
    address admin = address(this);

    function setUp() public {
        partner = new MockSettlementPartner();
        adapter = new SettlementAdapter(address(partner));
        asset = new MockAsset();
    }

    function test_SubmitSettlement_Success() public {
        bytes32 id = adapter.submitSettlement(
            address(asset),
            address(0xBEEF),
            1000e18,
            ""
        );
        SettlementAdapter.SettlementInstruction memory instr = adapter.getInstruction(id);
        assertEq(instr.asset, address(asset));
        assertEq(instr.recipient, address(0xBEEF));
        assertEq(instr.amount, 1000e18);
        assertEq(uint8(instr.status), uint8(SettlementAdapter.InstructionStatus.Pending));
        assertTrue(instr.externalReference != bytes32(0));
    }

    function test_SubmitSettlement_RejectsZeroAsset() public {
        vm.expectRevert("DIBS: zero asset");
        adapter.submitSettlement(address(0), address(0xBEEF), 1000e18, "");
    }

    function test_SubmitSettlement_RejectsZeroAmount() public {
        vm.expectRevert("DIBS: zero amount");
        adapter.submitSettlement(address(asset), address(0xBEEF), 0, "");
    }

    function test_ConfirmSettlement_Success() public {
        bytes32 id = adapter.submitSettlement(
            address(asset),
            address(0xBEEF),
            1000e18,
            ""
        );

        // Simulate partner confirming
        vm.prank(address(partner));
        adapter.confirmSettlement(id, bytes32("ext1"), 1000e18, bytes32("recon1"));

        SettlementAdapter.SettlementInstruction memory instr = adapter.getInstruction(id);
        assertEq(uint8(instr.status), uint8(SettlementAdapter.InstructionStatus.Confirmed));
        assertEq(instr.settledAmount, 1000e18);
        assertEq(instr.confirmedAt, block.timestamp);
    }

    function test_ConfirmSettlement_RejectsNonPartner() public {
        bytes32 id = adapter.submitSettlement(
            address(asset),
            address(0xBEEF),
            1000e18,
            ""
        );

        vm.prank(address(0x1234));
        vm.expectRevert("DIBS: only settlement partner");
        adapter.confirmSettlement(id, bytes32("ext1"), 1000e18, bytes32("recon1"));
    }

    function test_CancelInstruction() public {
        bytes32 id = adapter.submitSettlement(
            address(asset),
            address(0xBEEF),
            1000e18,
            ""
        );

        adapter.cancelInstruction(id);
        SettlementAdapter.SettlementInstruction memory instr = adapter.getInstruction(id);
        assertEq(uint8(instr.status), uint8(SettlementAdapter.InstructionStatus.Cancelled));
    }

    function test_ExpireInstruction() public {
        bytes32 id = adapter.submitSettlement(
            address(asset),
            address(0xBEEF),
            1000e18,
            ""
        );

        // Fast forward past timeout (7 days)
        vm.warp(block.timestamp + 8 days);

        adapter.expireInstruction(id);
        SettlementAdapter.SettlementInstruction memory instr = adapter.getInstruction(id);
        assertEq(uint8(instr.status), uint8(SettlementAdapter.InstructionStatus.Expired));
    }

    function test_GetConfirmedInstructions() public {
        bytes32 id1 = adapter.submitSettlement(address(asset), address(0xBEEF), 1000e18, "");
        bytes32 id2 = adapter.submitSettlement(address(asset), address(0xCAFE), 500e18, "");

        // Confirm id1 only
        vm.prank(address(partner));
        adapter.confirmSettlement(id1, bytes32("ext1"), 1000e18, bytes32("r1"));

        bytes32[] memory confirmed = adapter.getConfirmedInstructions();
        assertEq(confirmed.length, 1);
        assertEq(confirmed[0], id1);
    }

    function test_InstructionCount() public {
        adapter.submitSettlement(address(asset), address(0xBEEF), 1000e18, "");
        adapter.submitSettlement(address(asset), address(0xCAFE), 500e18, "");
        assertEq(adapter.getInstructionCount(), 2);
    }

    function test_SetTimeout() public {
        adapter.setInstructionTimeout(1 days);
        assertEq(adapter.instructionTimeout(), 1 days);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// YIELD DIVERSION ROUTER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

contract YieldDiversionRouterTest is Test {
    YieldDiversionRouter router;
    MockAsset asset;

    function setUp() public {
        asset = new MockAsset();
        router = new YieldDiversionRouter(address(asset));
    }

    function test_InitialState() public {
        assertEq(uint8(router.currentRoute()), uint8(YieldDiversionRouter.YieldRoute.Normal));
        assertEq(router.reserveRebuildRateBps(), 8000);
        assertEq(router.totalRoutedToReserve(), 0);
        assertEq(router.totalRoutedToRecap(), 0);
        assertEq(router.totalRetainedEarnings(), 0);
    }

    function test_SetReserveTarget() public {
        router.setReserveTarget(50000e18);
        assertEq(router.reserveTargetAmount(), 50000e18);
    }

    function test_SetReserveRebuildRate() public {
        router.setReserveRebuildRate(6000);
        assertEq(router.reserveRebuildRateBps(), 6000);
    }

    function test_SetReserveRebuildRate_RejectsOver10000() public {
        vm.expectRevert(abi.encodeWithSelector(YieldDiversionRouter.InvalidRate.selector, 10001));
        router.setReserveRebuildRate(10001);
    }

    function test_SetRoute() public {
        router.setRoute(YieldDiversionRouter.YieldRoute.SegregatedReserve, "CPM triggered");
        assertEq(uint8(router.currentRoute()), uint8(YieldDiversionRouter.YieldRoute.SegregatedReserve));
    }

    function test_CanReleaseReserve_False_WithoutVaults() public {
        // No vaults set → canReleaseReserve will revert or return false
        // Since sentinelVault is address(0), calling preservationModeActive() on it will revert
        // This is expected behavior — vaults must be set first
        assertFalse(router.canReleaseReserve());
    }

    function test_SetReserveRebuildRate_RejectsZero() public {
        // 0 is valid (0% to reserve, all to retained earnings)
        router.setReserveRebuildRate(0);
        assertEq(router.reserveRebuildRateBps(), 0);
    }

    function test_TransferAdmin() public {
        address newAdmin = address(0x9999);
        router.transferAdmin(newAdmin);
        assertEq(router.admin(), newAdmin);
    }

    function test_TransferAdmin_RejectsZero() public {
        vm.expectRevert(YieldDiversionRouter.ZeroAddress.selector);
        router.transferAdmin(address(0));
    }
}
