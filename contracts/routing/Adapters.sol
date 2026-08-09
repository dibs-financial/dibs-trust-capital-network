// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Routing Layer
// Morpho Blue, Pendle, Treasury/RWA, Settlement, and Oracle Adapters
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// EXTERNAL PROTOCOL INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/// @dev Minimal Morpho Blue market interface — isolated lending markets.
interface IMorphoBlue {
    struct MarketParams {
        address loanToken;       // asset lent to borrowers
        address collateralToken; // asset deposited as collateral
        address oracle;          // price feed for collateral valuation
        address irm;             // interest rate model contract
        uint256 lltv;            // liquidation LTV in basis points (e.g., 8600 = 86%)
    }

    struct Market {
        uint256 totalSupplyAssets;   // total assets supplied to the market
        uint256 totalSupplyShares;   // total supply shares
        uint256 totalBorrowAssets;   // total assets borrowed
        uint256 totalBorrowShares;   // total borrow shares
        uint256 totalCollateral;    // total collateral deposited
        uint256 lastUpdate;         // last interest accrual timestamp
        uint256 fee;                // protocol fee in basis points
    }

    /// @dev Supply assets to a Morpho Blue market on behalf of a user.
    function supply(
        MarketParams calldata marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalfOf,
        bytes calldata data
    ) external returns (uint256 assetsSupplied, uint256 sharesSupplied);

    /// @dev Withdraw assets from a Morpho Blue market.
    function withdraw(
        MarketParams calldata marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalfOf,
        address receiver
    ) external returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn);

    /// @dev Borrow assets from a Morpho Blue market using collateral.
    function borrow(
        MarketParams calldata marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalfOf,
        address receiver
    ) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);

    /// @dev Repay borrowed assets.
    function repay(
        MarketParams calldata marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalfOf,
        bytes calldata data
    ) external returns (uint256 assetsRepaid, uint256 sharesRepaid);

    /// @dev Supply collateral to a Morpho Blue market.
    function supplyCollateral(
        MarketParams calldata marketParams,
        uint256 assets,
        address onBehalfOf,
        bytes calldata data
    ) external;

    /// @dev Withdraw collateral from a Morpho Blue market.
    function withdrawCollateral(
        MarketParams calldata marketParams,
        uint256 assets,
        address onBehalfOf
    ) external;

    /// @dev Read market state for a given market.
    function market(MarketParams calldata marketParams) external view returns (Market memory);

    /// @dev Read user's supply position in a market.
    function position(
        MarketParams calldata marketParams,
        address user
    ) external view returns (uint256 supplyShares, uint256 borrowShares, uint256 collateral);

    /// @dev Liquidate a borrower position (partial liquidation).
    function liquidate(
        MarketParams calldata marketParams,
        address borrower,
        uint256 repaidAssets,
        uint256 seizedCollateral,
        bytes calldata data
    ) external returns (uint256 repaid, uint256 seized);

    /// @dev Check if a market is enabled/created.
    function isMarketEnabled(MarketParams calldata marketParams) external view returns (bool);
}

/// @dev Minimal Pendle interface for PT/YT (Principal/Yield Token) routing.
interface IPendleRouter {
    struct SwapData {
        address router;
        bytes data;
    }

    /// @dev Swap exact token for PT (Principal Token) on a Pendle market.
    function swapExactTokenForPt(
        address receiver,
        address market,
        uint256 minPtOut,
        SwapData calldata swapData,
        uint256 netSyIn
    ) external returns (uint256 netPtOut);

    /// @dev Swap exact PT for token on a Pendle market.
    function swapPtForToken(
        address receiver,
        address market,
        uint256 exactPtIn,
        uint256 minTokenOut,
        SwapData calldata swapData
    ) external returns (uint256 netTokenOut);

    /// @dev Swap exact token for YT (Yield Token) on a Pendle market.
    function swapExactTokenForYt(
        address receiver,
        address market,
        uint256 minYtOut,
        SwapData calldata swapData
    ) external returns (uint256 netYtOut);

    /// @dev Swap exact YT for token on a Pendle market.
    function swapYtForToken(
        address receiver,
        address market,
        uint256 exactYtIn,
        uint256 minTokenOut,
        SwapData calldata swapData
    ) external returns (uint256 netTokenOut);

    /// @dev Get current PT rate (PT redemption value per share).
    function getPtRate(address market) external view returns (uint256);

    /// @dev Get current implied yield rate for a market.
    function getImpliedYield(address market) external view returns (uint256);

    /// @dev Get market maturity timestamp.
    function maturity(address market) external view returns (uint256);

    /// @dev Get active status of a market.
    function isActive(address market) external view returns (bool);

    /// @dev Get total liquidity in a market (in underlying token terms).
    function totalLiquidity(address market) external view returns (uint256);
}

/// @dev Minimal Chainlink-style oracle interface.
interface IOracle {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
}

/// @dev Settlement partner interface for external regulated settlement.
interface ISettlementPartner {
    function submitInstruction(
        bytes32 instructionId,
        address asset,
        address recipient,
        uint256 amount,
        bytes calldata metadata
    ) external returns (bytes32 externalReference);

    function confirmSettlement(
        bytes32 externalReference,
        uint256 settledAmount,
        uint256 settledTimestamp,
        bytes32 reconciliationHash
    ) external returns (bool confirmed);

    function getInstructionStatus(
        bytes32 externalReference
    ) external view returns (uint8 status, uint256 settledAmount, uint256 settledTimestamp);
}

/// @dev DIBSVault interface for reserve and preservation interactions.
interface IDIBSVault {
    function depositToReserve(uint256 amount) external;
    function releaseReserve(uint256 amount, address recipient) external;
    function canReleaseReserve() external view returns (bool);
    function preservationModeActive() external view returns (bool);
    function segregatedReserve() external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function asset() external view returns (address);
}

/// @dev SentinelVault interface for withdrawal queue interactions.
interface ISentinelVault {
    struct WithdrawalRequest {
        address user;
        uint256 assets;
        uint256 shares;
        uint256 requestedAt;
        bool processed;
    }

    function withdrawalQueue(uint256 index) external view returns (WithdrawalRequest memory);
    function totalQueuedAssets() external view returns (uint256);
    function pendingQueueCount() external view returns (uint256);
    function processQueue(uint256 maxBatch) external returns (uint256 processedCount);
    function preservationModeActive() external view returns (bool);
    function liquidityTestsPassed() external view returns (bool);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MORPHO ADAPTER — Isolated Lending Market Routing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title MorphoAdapter
 * @dev Adapter for Morpho Blue isolated lending markets.
 *
 *      Responsibilities:
 *      - Configure and track Morpho Blue market parameters
 *      - Route deposits/withdrawals to selected markets
 *      - Enforce position caps, concentration limits, and market caps
 *      - Apply liquidity haircuts to valuation
 *      - Execute emergency unwind (graceful exit from all positions)
 *
 *      Risk Limitation:
 *      Isolated markets reduce cross-market contagion but do NOT eliminate:
 *      borrower default, collateral failure, oracle failure, liquidation failure,
 *      liquidity failure, smart-contract failure, governance risk, adapter risk.
 */
contract MorphoAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutables & Config ───────────────────────────────
    IMorphoBlue public immutable morpho;
    address public admin;
    IERC20 public immutable loanAsset;

    // ─── Market Configuration ──────────────────────────────
    struct MarketConfig {
        IMorphoBlue.MarketParams params;
        uint256 positionCap;            // max supply per single position
        uint256 marketCap;              // max total supply to this market
        uint256 concentrationLimitBps;  // max % of total assets in one market (e.g., 4000 = 40%)
        uint256 liquidityHaircutBps;    // valuation discount (e.g., 9500 = value at 95%)
        bool active;                    // whether new deposits are accepted
        bool emergencyUnwind;           // whether emergency exit is triggered
    }

    mapping(bytes32 => MarketConfig) public markets;   // marketId => config
    bytes32[] public marketIds;                        // all registered market IDs
    uint256 public totalAllocated;                     // total assets deployed across all markets

    // ─── Position Tracking ────────────────────────────────
    struct Position {
        uint256 supplyShares;           // shares in Morpho market
        uint256 collateralAmount;       // collateral deposited
        uint256 borrowShares;           // borrow position
        uint256 lastValuation;          // last computed valuation
    }

    mapping(bytes32 => mapping(address => Position)) public positions; // marketId => user => Position

    // ─── Events ────────────────────────────────────────────
    event MarketRegistered(bytes32 indexed marketId, address loanToken, address collateralToken, uint256 lltv);
    event MarketConfigured(bytes32 indexed marketId, uint256 positionCap, uint256 marketCap, uint256 concentrationLimitBps, uint256 liquidityHaircutBps);
    event MarketActivated(bytes32 indexed marketId, bool active);
    event Deposited(bytes32 indexed marketId, address indexed caller, uint256 assets, uint256 shares);
    event Withdrawn(bytes32 indexed marketId, address indexed caller, uint256 assets, uint256 shares);
    event CollateralSupplied(bytes32 indexed marketId, address indexed caller, uint256 assets);
    event CollateralWithdrawn(bytes32 indexed marketId, address indexed caller, uint256 assets);
    event EmergencyUnwindTriggered(bytes32 indexed marketId, uint256 assetsRecovered);
    event EmergencyUnwindComplete(uint256 totalAssetsRecovered);
    event LiquidityHaircutApplied(bytes32 indexed marketId, uint256 grossValue, uint256 haircutValue);

    // ─── Errors ────────────────────────────────────────────
    error MarketNotRegistered(bytes32 marketId);
    error MarketNotActive(bytes32 marketId);
    error PositionCapExceeded(uint256 requested, uint256 cap, uint256 current);
    error MarketCapExceeded(uint256 requested, uint256 cap, uint256 totalInMarket);
    error ConcentrationLimitExceeded(uint256 requestedBps, uint256 limitBps);
    error EmergencyUnwindActive(bytes32 marketId);
    error InsufficientShares(uint256 requested, uint256 available);
    error Unauthorized(address caller);

    // ─── Modifiers ────────────────────────────────────────
    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        _;
    }

    // ─── Constructor ───────────────────────────────────────
    constructor(address morpho_, address loanAsset_) {
        require(morpho_ != address(0) && loanAsset_ != address(0), "DIBS: zero address");
        morpho = IMorphoBlue(morpho_);
        loanAsset = IERC20(loanAsset_);
        admin = msg.sender;
    }

    // ─── Market Configuration ──────────────────────────────

    /**
     * @dev Register a new Morpho Blue market with risk parameters.
     * @param marketId Unique identifier (keccak256 of market params)
     * @param params Morpho Blue market parameters
     * @param positionCap Max assets deployable to a single position
     * @param marketCap Max total assets deployable to this market
     * @param concentrationLimitBps Max concentration (e.g., 4000 = 40%)
     * @param liquidityHaircutBps Valuation haircut (e.g., 9500 = 95% of face)
     */
    function registerMarket(
        bytes32 marketId,
        IMorphoBlue.MarketParams calldata params,
        uint256 positionCap,
        uint256 marketCap,
        uint256 concentrationLimitBps,
        uint256 liquidityHaircutBps
    ) external onlyAdmin {
        require(markets[marketId].params.loanToken == address(0), "DIBS: market already registered");
        require(params.loanToken != address(0), "DIBS: zero loan token");
        require(concentrationLimitBps > 0 && concentrationLimitBps <= 10000, "DIBS: invalid concentration");
        require(liquidityHaircutBps > 0 && liquidityHaircutBps <= 10000, "DIBS: invalid haircut");

        markets[marketId] = MarketConfig({
            params: params,
            positionCap: positionCap,
            marketCap: marketCap,
            concentrationLimitBps: concentrationLimitBps,
            liquidityHaircutBps: liquidityHaircutBps,
            active: false,
            emergencyUnwind: false
        });
        marketIds.push(marketId);

        emit MarketRegistered(marketId, params.loanToken, params.collateralToken, params.lltv);
        emit MarketConfigured(marketId, positionCap, marketCap, concentrationLimitBps, liquidityHaircutBps);
    }

    /**
     * @dev Update risk parameters for an existing market.
     */
    function configureMarket(
        bytes32 marketId,
        uint256 positionCap,
        uint256 marketCap,
        uint256 concentrationLimitBps,
        uint256 liquidityHaircutBps
    ) external onlyAdmin {
        if (markets[marketId].params.loanToken == address(0)) revert MarketNotRegistered(marketId);
        require(concentrationLimitBps > 0 && concentrationLimitBps <= 10000, "DIBS: invalid concentration");
        require(liquidityHaircutBps > 0 && liquidityHaircutBps <= 10000, "DIBS: invalid haircut");

        MarketConfig storage config = markets[marketId];
        config.positionCap = positionCap;
        config.marketCap = marketCap;
        config.concentrationLimitBps = concentrationLimitBps;
        config.liquidityHaircutBps = liquidityHaircutBps;

        emit MarketConfigured(marketId, positionCap, marketCap, concentrationLimitBps, liquidityHaircutBps);
    }

    /**
     * @dev Activate or deactivate a market for new deposits.
     */
    function setMarketActive(bytes32 marketId, bool active) external onlyAdmin {
        if (markets[marketId].params.loanToken == address(0)) revert MarketNotRegistered(marketId);
        markets[marketId].active = active;
        emit MarketActivated(marketId, active);
    }

    // ─── Deposit / Withdraw Routing ────────────────────────

    /**
     * @dev Deposit assets into a Morpho Blue market.
     *      Enforces: market active, position cap, market cap, concentration limit.
     * @param marketId Target market identifier
     * @param assets Amount to deposit
     * @param minSharesOut Minimum shares expected (slippage protection)
     * @param onBehalfOf Address to credit shares to
     */
    function deposit(
        bytes32 marketId,
        uint256 assets,
        uint256 minSharesOut,
        address onBehalfOf
    ) external nonReentrant returns (uint256 assetsSupplied, uint256 sharesSupplied) {
        MarketConfig storage config = markets[marketId];
        if (config.params.loanToken == address(0)) revert MarketNotRegistered(marketId);
        if (!config.active) revert MarketNotActive(marketId);
        if (config.emergencyUnwind) revert EmergencyUnwindActive(marketId);
        require(assets > 0, "DIBS: zero assets");
        require(onBehalfOf != address(0), "DIBS: zero address");

        // ── Position Cap Check ──
        (uint256 existingShares,,) = morpho.position(config.params, onBehalfOf);
        uint256 existingAssets = _sharesToAssets(marketId, existingShares);
        if (existingAssets + assets > config.positionCap) {
            revert PositionCapExceeded(assets, config.positionCap, existingAssets);
        }

        // ── Market Cap Check ──
        IMorphoBlue.Market memory marketState = morpho.market(config.params);
        if (marketState.totalSupplyAssets + assets > config.marketCap) {
            revert MarketCapExceeded(assets, config.marketCap, marketState.totalSupplyAssets);
        }

        // ── Concentration Limit Check ──
        uint256 newTotalAllocated = totalAllocated + assets;
        uint256 marketConcentrationBps = (marketState.totalSupplyAssets + assets) * 10000 / newTotalAllocated;
        if (marketConcentrationBps > config.concentrationLimitBps) {
            revert ConcentrationLimitExceeded(marketConcentrationBps, config.concentrationLimitBps);
        }

        // ── Transfer & Supply ──
        loanAsset.safeTransferFrom(msg.sender, address(this), assets);
        loanAsset.safeIncreaseAllowance(address(morpho), assets);

        (assetsSupplied, sharesSupplied) = morpho.supply(config.params, assets, 0, onBehalfOf, "");

        require(sharesSupplied >= minSharesOut, "DIBS: slippage exceeded");

        // ── Update Tracking ──
        positions[marketId][onBehalfOf].supplyShares += sharesSupplied;
        positions[marketId][onBehalfOf].lastValuation = assetsSupplied;
        totalAllocated += assetsSupplied;

        emit Deposited(marketId, msg.sender, assetsSupplied, sharesSupplied);
    }

    /**
     * @dev Withdraw assets from a Morpho Blue market.
     * @param marketId Target market identifier
     * @param assets Amount to withdraw (or use shares if shares > 0)
     * @param shares Alternative: specify shares to withdraw (0 = use assets)
     * @param receiver Address to receive withdrawn assets
     */
    function withdraw(
        bytes32 marketId,
        uint256 assets,
        uint256 shares,
        address receiver
    ) external nonReentrant returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn) {
        MarketConfig storage config = markets[marketId];
        if (config.params.loanToken == address(0)) revert MarketNotRegistered(marketId);
        require(receiver != address(0), "DIBS: zero address");
        require(assets > 0 || shares > 0, "DIBS: zero withdraw amount");

        // ── Position Share Check ──
        Position storage pos = positions[marketId][msg.sender];
        if (shares > 0 && shares > pos.supplyShares) {
            revert InsufficientShares(shares, pos.supplyShares);
        }

        (assetsWithdrawn, sharesWithdrawn) = morpho.withdraw(config.params, assets, shares, msg.sender, receiver);

        pos.supplyShares -= sharesWithdrawn;
        pos.lastValuation = _sharesToAssets(marketId, pos.supplyShares);
        totalAllocated -= assetsWithdrawn;

        emit Withdrawn(marketId, msg.sender, assetsWithdrawn, sharesWithdrawn);
    }

    // ─── Collateral Management ────────────────────────────

    /**
     * @dev Supply collateral to a Morpho Blue market for borrowing.
     */
    function supplyCollateral(
        bytes32 marketId,
        uint256 assets,
        address onBehalfOf
    ) external nonReentrant {
        MarketConfig storage config = markets[marketId];
        if (config.params.loanToken == address(0)) revert MarketNotRegistered(marketId);
        if (!config.active) revert MarketNotActive(marketId);
        require(assets > 0, "DIBS: zero assets");

        IERC20(config.params.collateralToken).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(config.params.collateralToken).safeIncreaseAllowance(address(morpho), assets);

        morpho.supplyCollateral(config.params, assets, onBehalfOf, "");

        positions[marketId][onBehalfOf].collateralAmount += assets;
        emit CollateralSupplied(marketId, msg.sender, assets);
    }

    /**
     * @dev Withdraw collateral from a Morpho Blue market.
     */
    function withdrawCollateral(
        bytes32 marketId,
        uint256 assets,
        address receiver
    ) external nonReentrant {
        MarketConfig storage config = markets[marketId];
        if (config.params.loanToken == address(0)) revert MarketNotRegistered(marketId);
        require(receiver != address(0), "DIBS: zero address");

        morpho.withdrawCollateral(config.params, assets, msg.sender);

        positions[marketId][msg.sender].collateralAmount -= assets;
        emit CollateralWithdrawn(marketId, msg.sender, assets);
    }

    // ─── Emergency Unwind ──────────────────────────────────

    /**
     * @dev Trigger emergency unwind for a specific market.
     *      Blocks new deposits and initiates full withdrawal.
     */
    function triggerEmergencyUnwind(bytes32 marketId) external onlyAdmin {
        if (markets[marketId].params.loanToken == address(0)) revert MarketNotRegistered(marketId);
        markets[marketId].emergencyUnwind = true;
        markets[marketId].active = false;
        emit EmergencyUnwindTriggered(marketId, 0);
    }

    /**
     * @dev Execute emergency unwind across ALL registered markets.
     *      Withdraws all positions, returns assets to admin.
     * @return totalRecovered Total assets recovered from all markets
     */
    function executeGlobalUnwind() external onlyAdmin nonReentrant returns (uint256 totalRecovered) {
        for (uint256 i = 0; i < marketIds.length; i++) {
            bytes32 marketId = marketIds[i];
            MarketConfig storage config = markets[marketId];
            if (!config.emergencyUnwind) continue;

            (uint256 supplyShares,, ) = morpho.position(config.params, address(this));
            if (supplyShares == 0) continue;

            IMorphoBlue.Market memory marketState = morpho.market(config.params);
            uint256 assetsToWithdraw = (marketState.totalSupplyAssets * supplyShares) / marketState.totalSupplyShares;

            try morpho.withdraw(config.params, assetsToWithdraw, supplyShares, address(this), admin) returns (
                uint256 withdrawn, uint256 sharesWithdrawn
            ) {
                totalRecovered += withdrawn;
                positions[marketId][address(this)].supplyShares -= sharesWithdrawn;
                emit EmergencyUnwindTriggered(marketId, withdrawn);
            } catch {
                // Market may be illiquid — record failure but continue
                emit EmergencyUnwindTriggered(marketId, 0);
            }
        }
        totalAllocated -= totalRecovered;
        emit EmergencyUnwindComplete(totalRecovered);
    }

    // ─── Valuation with Liquidity Haircut ──────────────────

    /**
     * @dev Compute valuation of a position with liquidity haircut applied.
     * @param marketId Market identifier
     * @param user Address holding the position
     * @return grossValue Gross value before haircut
     * @return haircutValue Net value after liquidity haircut
     */
    function positionValuation(
        bytes32 marketId,
        address user
    ) external view returns (uint256 grossValue, uint256 haircutValue) {
        MarketConfig storage config = markets[marketId];
        if (config.params.loanToken == address(0)) return (0, 0);

        Position storage pos = positions[marketId][user];
        grossValue = _sharesToAssets(marketId, pos.supplyShares);

        haircutValue = (grossValue * config.liquidityHaircutBps) / 10000;
    }

    /**
     * @dev Compute total portfolio valuation across all markets with haircuts.
     * @return totalGross Total gross value
     * @return totalHaircut Total value after haircuts
     */
    function portfolioValuation() external view returns (uint256 totalGross, uint256 totalHaircut) {
        for (uint256 i = 0; i < marketIds.length; i++) {
            bytes32 marketId = marketIds[i];
            MarketConfig storage config = markets[marketId];
            if (config.params.loanToken == address(0)) continue;

            (uint256 supplyShares,, ) = morpho.position(config.params, address(this));
            uint256 gross = _sharesToAssets(marketId, supplyShares);
            uint256 haircut = (gross * config.liquidityHaircutBps) / 10000;

            totalGross += gross;
            totalHaircut += haircut;
        }
    }

    // ─── Internal Helpers ──────────────────────────────────

    /**
     * @dev Convert shares to assets for a market.
     */
    function _sharesToAssets(bytes32 marketId, uint256 shares) internal view returns (uint256) {
        if (shares == 0) return 0;
        IMorphoBlue.Market memory m = morpho.market(markets[marketId].params);
        if (m.totalSupplyShares == 0) return 0;
        return (m.totalSupplyAssets * shares) / m.totalSupplyShares;
    }

    /**
     * @dev Check if a market meets concentration requirements.
     */
    function checkConcentration(bytes32 marketId, uint256 additionalAssets) external view returns (bool) {
        MarketConfig storage config = markets[marketId];
        if (config.params.loanToken == address(0)) return false;

        IMorphoBlue.Market memory m = morpho.market(config.params);
        uint256 marketTotal = m.totalSupplyAssets + additionalAssets;
        uint256 totalAfter = totalAllocated + additionalAssets;
        if (totalAfter == 0) return true;

        return (marketTotal * 10000) / totalAfter <= config.concentrationLimitBps;
    }

    // ─── Admin ─────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "DIBS: zero address");
        admin = newAdmin;
    }

    function getMarketCount() external view returns (uint256) {
        return marketIds.length;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PENDLE ADAPTER — PT/YT Maturity-Specific Yield Routing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title PendleAdapter
 * @dev Adapter for Pendle PT/YT maturity-specific yield routing.
 *
 *      Valuation Requirements:
 *      Do NOT rely only on flash-loanable DEX spot prices. Include redemption value,
 *      time to maturity, liquidity haircut, oracle reliability, stressed exit
 *      assumptions, underlying protocol risk, reserve and withdrawal obligations.
 *
 *      Allocation Strategy:
 *      - PT (Principal Token): Fixed-yield, redeemable at maturity
 *      - YT (Yield Token): Floating-yield, trades to zero at maturity
 *      - Rate-stripping: Lock in fixed rate via PT while retaining yield upside via YT
 */
contract PendleAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutables & Config ───────────────────────────────
    IPendleRouter public immutable pendleRouter;
    address public admin;
    IERC20 public immutable underlyingAsset;

    // ─── Market Configuration ──────────────────────────────
    struct PendleMarketConfig {
        address market;               // Pendle market address
        address ptToken;               // Principal Token address
        address ytToken;               // Yield Token address
        uint256 maturity;              // Maturity timestamp
        uint256 maxAllocation;         // Max assets allocatable to this market
        uint256 liquidityHaircutBps;   // Valuation haircut (e.g., 9000 = 90%)
        uint256 stressedExitDiscountBps; // Extra discount for stressed exit (e.g., 500 = 5%)
        uint256 oracleStalenessSeconds; // Max acceptable oracle age
        bool active;
        bool rateStripping;            // Whether rate-stripping strategy is active
    }

    mapping(bytes32 => PendleMarketConfig) public pendleMarkets;
    bytes32[] public pendleMarketIds;

    // ─── Position Tracking ────────────────────────────────
    struct PendlePosition {
        uint256 ptBalance;             // PT tokens held
        uint256 ytBalance;             // YT tokens held
        uint256 costBasis;            // Total assets spent acquiring position
        uint256 lastValuation;        // Last computed valuation
        uint256 entryTimestamp;       // When position was opened
    }

    mapping(bytes32 => PendlePosition) public pendlePositions;  // marketId => position

    // ─── Oracle ────────────────────────────────────────────
    mapping(address => IOracle) public marketOracles;  // market => oracle
    uint256 public defaultStalenessSeconds = 3600;      // 1 hour default

    // ─── Events ────────────────────────────────────────────
    event PendleMarketRegistered(bytes32 indexed marketId, address market, address ptToken, address ytToken, uint256 maturity);
    event PtPurchased(bytes32 indexed marketId, uint256 assetsIn, uint256 ptOut);
    event PtRedeemed(bytes32 indexed marketId, uint256 ptIn, uint256 tokenOut);
    event YtPurchased(bytes32 indexed marketId, uint256 assetsIn, uint256 ytOut);
    event YtRedeemed(bytes32 indexed marketId, uint256 ytIn, uint256 tokenOut);
    event RateStrippingExecuted(bytes32 indexed marketId, uint256 ptAmount, uint256 ytAmount);
    event StressedExitExecuted(bytes32 indexed marketId, uint256 grossValue, uint256 netValue);
    event OracleStalenessDetected(bytes32 indexed marketId, uint256 oracleAge, uint256 maxAge);
    event LiquidityHaircutApplied(bytes32 indexed marketId, uint256 gross, uint256 haircut);

    // ─── Errors ────────────────────────────────────────────
    error MarketNotRegistered(bytes32 marketId);
    error MarketNotActive(bytes32 marketId);
    error MarketExpired(uint256 maturity, uint256 currentTime);
    error OracleStale(uint256 age, uint256 maxAge);
    error NoOracleSet(address market);
    error MaxAllocationExceeded(uint256 requested, uint256 max);
    error Unauthorized(address caller);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        _;
    }

    // ─── Constructor ───────────────────────────────────────
    constructor(address pendleRouter_, address underlyingAsset_) {
        require(pendleRouter_ != address(0) && underlyingAsset_ != address(0), "DIBS: zero address");
        pendleRouter = IPendleRouter(pendleRouter_);
        underlyingAsset = IERC20(underlyingAsset_);
        admin = msg.sender;
    }

    // ─── Market Registration ──────────────────────────────

    /**
     * @dev Register a Pendle market with risk parameters.
     */
    function registerPendleMarket(
        bytes32 marketId,
        address market,
        address ptToken,
        address ytToken,
        uint256 maturity_,
        uint256 maxAllocation,
        uint256 liquidityHaircutBps,
        uint256 stressedExitDiscountBps,
        uint256 oracleStalenessSeconds,
        bool rateStripping
    ) external onlyAdmin {
        require(pendleMarkets[marketId].market == address(0), "DIBS: market already registered");
        require(market != address(0), "DIBS: zero market address");
        require(maturity_ > block.timestamp, "DIBS: market already expired");
        require(liquidityHaircutBps > 0 && liquidityHaircutBps <= 10000, "DIBS: invalid haircut");
        require(stressedExitDiscountBps <= 10000, "DIBS: invalid discount");

        pendleMarkets[marketId] = PendleMarketConfig({
            market: market,
            ptToken: ptToken,
            ytToken: ytToken,
            maturity: maturity_,
            maxAllocation: maxAllocation,
            liquidityHaircutBps: liquidityHaircutBps,
            stressedExitDiscountBps: stressedExitDiscountBps,
            oracleStalenessSeconds: oracleStalenessSeconds,
            active: true,
            rateStripping: rateStripping
        });
        pendleMarketIds.push(marketId);

        emit PendleMarketRegistered(marketId, market, ptToken, ytToken, maturity_);
    }

    /**
     * @dev Set oracle for a Pendle market.
     */
    function setMarketOracle(bytes32 marketId, address oracle) external onlyAdmin {
        if (pendleMarkets[marketId].market == address(0)) revert MarketNotRegistered(marketId);
        require(oracle != address(0), "DIBS: zero oracle");
        marketOracles[pendleMarkets[marketId].market] = IOracle(oracle);
    }

    // ─── PT (Principal Token) Routing ─────────────────────

    /**
     * @dev Purchase Principal Tokens (PT) — lock in fixed yield until maturity.
     * @param marketId Pendle market identifier
     * @param assets Amount of underlying to spend
     * @param minPtOut Minimum PT expected (slippage protection)
     */
    function buyPt(
        bytes32 marketId,
        uint256 assets,
        uint256 minPtOut
    ) external nonReentrant returns (uint256 ptOut) {
        PendleMarketConfig storage config = pendleMarkets[marketId];
        if (config.market == address(0)) revert MarketNotRegistered(marketId);
        if (!config.active) revert MarketNotActive(marketId);
        if (block.timestamp >= config.maturity) revert MarketExpired(config.maturity, block.timestamp);
        require(assets > 0, "DIBS: zero assets");

        _checkOracleFreshness(marketId, config);

        underlyingAsset.safeTransferFrom(msg.sender, address(this), assets);
        underlyingAsset.safeIncreaseAllowance(address(pendleRouter), assets);

        ptOut = pendleRouter.swapExactTokenForPt(
            address(this),
            config.market,
            minPtOut,
            IPendleRouter.SwapData({router: address(0), data: ""}),
            assets
        );

        pendlePositions[marketId].ptBalance += ptOut;
        pendlePositions[marketId].costBasis += assets;
        if (pendlePositions[marketId].entryTimestamp == 0) {
            pendlePositions[marketId].entryTimestamp = block.timestamp;
        }

        emit PtPurchased(marketId, assets, ptOut);
    }

    /**
     * @dev Redeem Principal Tokens — convert PT back to underlying.
     *      Pre-maturity: sells on Pendle secondary market (subject to liquidity).
     *      Post-maturity: redeems at face value (1:1 with underlying).
     */
    function sellPt(
        bytes32 marketId,
        uint256 ptAmount,
        uint256 minTokenOut
    ) external nonReentrant returns (uint256 tokenOut) {
        PendleMarketConfig storage config = pendleMarkets[marketId];
        if (config.market == address(0)) revert MarketNotRegistered(marketId);
        require(ptAmount > 0, "DIBS: zero PT amount");
        require(pendlePositions[marketId].ptBalance >= ptAmount, "DIBS: insufficient PT balance");

        tokenOut = pendleRouter.swapPtForToken(
            msg.sender,
            config.market,
            ptAmount,
            minTokenOut,
            IPendleRouter.SwapData({router: address(0), data: ""})
        );

        pendlePositions[marketId].ptBalance -= ptAmount;

        emit PtRedeemed(marketId, ptAmount, tokenOut);
    }

    // ─── YT (Yield Token) Routing ──────────────────────────

    /**
     * @dev Purchase Yield Tokens (YT) — capture floating yield until maturity.
     */
    function buyYt(
        bytes32 marketId,
        uint256 assets,
        uint256 minYtOut
    ) external nonReentrant returns (uint256 ytOut) {
        PendleMarketConfig storage config = pendleMarkets[marketId];
        if (config.market == address(0)) revert MarketNotRegistered(marketId);
        if (!config.active) revert MarketNotActive(marketId);
        if (block.timestamp >= config.maturity) revert MarketExpired(config.maturity, block.timestamp);
        require(assets > 0, "DIBS: zero assets");

        _checkOracleFreshness(marketId, config);

        underlyingAsset.safeTransferFrom(msg.sender, address(this), assets);
        underlyingAsset.safeIncreaseAllowance(address(pendleRouter), assets);

        ytOut = pendleRouter.swapExactTokenForYt(
            address(this),
            config.market,
            minYtOut,
            IPendleRouter.SwapData({router: address(0), data: ""})
        );

        pendlePositions[marketId].ytBalance += ytOut;
        pendlePositions[marketId].costBasis += assets;

        emit YtPurchased(marketId, assets, ytOut);
    }

    /**
     * @dev Redeem Yield Tokens — convert YT back to underlying.
     */
    function sellYt(
        bytes32 marketId,
        uint256 ytAmount,
        uint256 minTokenOut
    ) external nonReentrant returns (uint256 tokenOut) {
        PendleMarketConfig storage config = pendleMarkets[marketId];
        if (config.market == address(0)) revert MarketNotRegistered(marketId);
        require(ytAmount > 0, "DIBS: zero YT amount");
        require(pendlePositions[marketId].ytBalance >= ytAmount, "DIBS: insufficient YT balance");

        tokenOut = pendleRouter.swapYtForToken(
            msg.sender,
            config.market,
            ytAmount,
            minTokenOut,
            IPendleRouter.SwapData({router: address(0), data: ""})
        );

        pendlePositions[marketId].ytBalance -= ytAmount;

        emit YtRedeemed(marketId, ytAmount, tokenOut);
    }

    // ─── Rate Stripping ────────────────────────────────────

    /**
     * @dev Execute rate-stripping strategy: split assets between PT (fixed yield)
     *      and YT (floating yield) to capture both rate certainty and upside.
     * @param marketId Pendle market identifier
     * @param totalAssetsIn Total assets to deploy
     * @param ptRatioBps Portion for PT (e.g., 6000 = 60% PT, 40% YT)
     */
    function executeRateStripping(
        bytes32 marketId,
        uint256 totalAssetsIn,
        uint256 ptRatioBps
    ) external nonReentrant returns (uint256 ptOut, uint256 ytOut) {
        PendleMarketConfig storage config = pendleMarkets[marketId];
        if (config.market == address(0)) revert MarketNotRegistered(marketId);
        if (!config.active) revert MarketNotActive(marketId);
        if (!config.rateStripping) revert MarketNotActive(marketId);
        require(ptRatioBps > 0 && ptRatioBps < 10000, "DIBS: invalid ratio");
        require(totalAssetsIn > 0, "DIBS: zero assets");

        _checkOracleFreshness(marketId, config);

        uint256 ptAssets = (totalAssetsIn * ptRatioBps) / 10000;
        uint256 ytAssets = totalAssetsIn - ptAssets;

        underlyingAsset.safeTransferFrom(msg.sender, address(this), totalAssetsIn);
        underlyingAsset.safeIncreaseAllowance(address(pendleRouter), totalAssetsIn);

        // Buy PT with fixed portion
        ptOut = pendleRouter.swapExactTokenForPt(
            address(this),
            config.market,
            0,
            IPendleRouter.SwapData({router: address(0), data: ""}),
            ptAssets
        );

        // Buy YT with floating portion
        ytOut = pendleRouter.swapExactTokenForYt(
            address(this),
            config.market,
            0,
            IPendleRouter.SwapData({router: address(0), data: ""})
        );

        pendlePositions[marketId].ptBalance += ptOut;
        pendlePositions[marketId].ytBalance += ytOut;
        pendlePositions[marketId].costBasis += totalAssetsIn;
        pendlePositions[marketId].entryTimestamp = block.timestamp;

        emit RateStrippingExecuted(marketId, ptOut, ytOut);
    }

    // ─── Maturity-Aware Allocation ─────────────────────────

    /**
     * @dev Compute maturity-weighted allocation across all Pendle markets.
     *      Markets closer to maturity get higher allocation weight (lower duration risk).
     * @return ids Array of market IDs
     * @return weights Array of suggested weight in basis points
     */
    function maturityWeightedAllocation() external view returns (bytes32[] memory ids, uint256[] memory weights) {
        uint256 count = pendleMarketIds.length;
        ids = new bytes32[](count);
        weights = new uint256[](count);

        uint256 totalWeight = 0;

        for (uint256 i = 0; i < count; i++) {
            bytes32 marketId = pendleMarketIds[i];
            PendleMarketConfig storage config = pendleMarkets[marketId];
            if (!config.active || block.timestamp >= config.maturity) {
                weights[i] = 0;
                continue;
            }

            // Weight inversely proportional to time-to-maturity
            // Closer to maturity = higher weight (less duration risk)
            uint256 timeRemaining = config.maturity - block.timestamp;
            uint256 weight = (365 days * 10000) / timeRemaining;
            if (weight > 10000) weight = 10000;

            ids[i] = marketId;
            weights[i] = weight;
            totalWeight += weight;
        }

        // Normalize weights to sum to 10000
        if (totalWeight > 0) {
            for (uint256 i = 0; i < count; i++) {
                weights[i] = (weights[i] * 10000) / totalWeight;
            }
        }
    }

    // ─── Stressed Exit Valuation ───────────────────────────

    /**
     * @dev Compute stressed exit valuation for a position.
     *      Applies both liquidity haircut AND stressed exit discount.
     *      This is the worst-case exit value assuming adverse market conditions.
     */
    function stressedExitValuation(bytes32 marketId) external view returns (uint256 grossValue, uint256 stressedValue) {
        PendleMarketConfig storage config = pendleMarkets[marketId];
        if (config.market == address(0)) return (0, 0);

        PendlePosition storage pos = pendlePositions[marketId];

        // PT valuation: use PT rate (redemption value) or market price
        uint256 ptValue = (pos.ptBalance * pendleRouter.getPtRate(config.market)) / 1e18;

        // YT valuation: use implied yield * remaining time
        uint256 ytValue = (pos.ytBalance * pendleRouter.getImpliedYield(config.market)) / 1e18;

        grossValue = ptValue + ytValue;

        // Apply liquidity haircut
        uint256 afterHaircut = (grossValue * config.liquidityHaircutBps) / 10000;

        // Apply stressed exit discount on top of haircut
        stressedValue = (afterHaircut * (10000 - config.stressedExitDiscountBps)) / 10000;
    }

    /**
     * @dev Execute stressed exit — liquidate all positions at market price
     *      regardless of slippage. Used during emergency unwind.
     */
    function executeStressedExit(bytes32 marketId) external nonReentrant returns (uint256 totalRecovered) {
        PendleMarketConfig storage config = pendleMarkets[marketId];
        if (config.market == address(0)) revert MarketNotRegistered(marketId);
        require(msg.sender == admin, "DIBS: only admin");

        PendlePosition storage pos = pendlePositions[marketId];
        uint256 grossValue = 0;

        if (pos.ptBalance > 0) {
            uint256 ptOut = pendleRouter.swapPtForToken(
                admin,
                config.market,
                pos.ptBalance,
                0,  // no slippage protection in stressed exit
                IPendleRouter.SwapData({router: address(0), data: ""})
            );
            totalRecovered += ptOut;
            grossValue += ptOut;
            pos.ptBalance = 0;
        }

        if (pos.ytBalance > 0) {
            uint256 ytOut = pendleRouter.swapYtForToken(
                admin,
                config.market,
                pos.ytBalance,
                0,
                IPendleRouter.SwapData({router: address(0), data: ""})
            );
            totalRecovered += ytOut;
            grossValue += ytOut;
            pos.ytBalance = 0;
        }

        pos.costBasis = 0;
        emit StressedExitExecuted(marketId, grossValue, totalRecovered);
    }

    // ─── Oracle Reliability Checks ────────────────────────

    /**
     * @dev Check oracle freshness for a market. Reverts if stale.
     */
    function _checkOracleFreshness(bytes32 marketId, PendleMarketConfig storage config) internal view {
        IOracle oracle = marketOracles[config.market];
        if (address(oracle) == address(0)) return; // No oracle = skip check (configurable)

        (, , , uint256 updatedAt, ) = oracle.latestRoundData();
        uint256 age = block.timestamp - updatedAt;
        uint256 maxAge = config.oracleStalenessSeconds > 0
            ? config.oracleStalenessSeconds
            : defaultStalenessSeconds;

        if (age > maxAge) {
            revert OracleStale(age, maxAge);
        }
    }

    /**
     * @dev Public oracle freshness check (non-reverting).
     */
    function checkOracleFreshness(bytes32 marketId) external view returns (bool fresh, uint256 age) {
        PendleMarketConfig storage config = pendleMarkets[marketId];
        if (config.market == address(0)) return (false, 0);

        IOracle oracle = marketOracles[config.market];
        if (address(oracle) == address(0)) return (true, 0);

        (, , , uint256 updatedAt, ) = oracle.latestRoundData();
        age = block.timestamp - updatedAt;
        uint256 maxAge = config.oracleStalenessSeconds > 0 ? config.oracleStalenessSeconds : defaultStalenessSeconds;
        fresh = age <= maxAge;
    }

    // ─── Admin ─────────────────────────────────────────────

    function setMarketActive(bytes32 marketId, bool active) external onlyAdmin {
        if (pendleMarkets[marketId].market == address(0)) revert MarketNotRegistered(marketId);
        pendleMarkets[marketId].active = active;
    }

    function setDefaultStaleness(uint256 seconds_) external onlyAdmin {
        defaultStalenessSeconds = seconds_;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "DIBS: zero address");
        admin = newAdmin;
    }

    function getMarketCount() external view returns (uint256) {
        return pendleMarketIds.length;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTLEMENT ADAPTER — External Regulated Settlement Partner
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title SettlementAdapter
 * @dev Adapter for external regulated settlement partners.
 *      Transmits settlement instructions; does not execute regulated functions.
 *
 *      Flow:
 *      1. Vault or admin creates a settlement instruction (asset, recipient, amount)
 *      2. Adapter submits to the external settlement partner via submitInstruction
 *      3. Partner executes settlement off-chain and calls confirmSettlement
 *      4. Adapter indexes the confirmation and emits event for reconciliation
 */
contract SettlementAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Config ────────────────────────────────────────────
    ISettlementPartner public immutable settlementPartner;
    address public admin;

    // ─── Instruction State ─────────────────────────────────
    enum InstructionStatus {
        Pending,        // submitted, awaiting partner execution
        Confirmed,      // partner confirmed settlement
        Failed,         // partner rejected or execution failed
        Cancelled,      // admin cancelled before execution
        Expired        // instruction timed out without confirmation
    }

    struct SettlementInstruction {
        bytes32 instructionId;       // internal unique ID
        bytes32 externalReference;   // partner-assigned reference
        address asset;               // ERC-20 token
        address recipient;           // settlement recipient
        uint256 amount;              // settlement amount
        uint256 submittedAt;         // timestamp submitted to partner
        uint256 confirmedAt;         // timestamp partner confirmed (0 = not confirmed)
        uint256 settledAmount;       // actual settled amount (may differ due to fees)
        InstructionStatus status;    // current status
        bytes metadata;              // partner-specific metadata
    }

    mapping(bytes32 => SettlementInstruction) public instructions;
    bytes32[] public instructionIds;
    uint256 public instructionTimeout;  // seconds before instruction expires
    uint256 public totalConfirmedAmount;

    // ─── Events ────────────────────────────────────────────
    event InstructionSubmitted(bytes32 indexed instructionId, address indexed asset, address indexed recipient, uint256 amount);
    event InstructionConfirmed(bytes32 indexed instructionId, bytes32 externalReference, uint256 settledAmount, uint256 confirmedAt);
    event InstructionFailed(bytes32 indexed instructionId, string reason);
    event InstructionCancelled(bytes32 indexed instructionId);
    event InstructionExpired(bytes32 indexed instructionId);
    event ReconciliationRecordCreated(bytes32 indexed instructionId, bytes32 reconciliationHash);
    event SettlementTimeoutUpdated(uint256 newTimeout);

    // ─── Errors ────────────────────────────────────────────
    error InstructionNotFound(bytes32 instructionId);
    error InstructionNotPending(bytes32 instructionId);
    error InstructionAlreadyConfirmed(bytes32 instructionId);
    error Unauthorized(address caller);
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        _;
    }

    // ─── Constructor ───────────────────────────────────────
    constructor(address settlementPartner_) {
        require(settlementPartner_ != address(0), "DIBS: zero address");
        settlementPartner = ISettlementPartner(settlementPartner_);
        admin = msg.sender;
        instructionTimeout = 7 days;
    }

    // ─── Instruction Transmission ──────────────────────────

    /**
     * @dev Submit a settlement instruction to the external partner.
     *      Does NOT transfer tokens — the partner handles regulated settlement.
     * @param asset ERC-20 token address
     * @param recipient Settlement recipient
     * @param amount Settlement amount
     * @param metadata Partner-specific metadata
     */
    function submitSettlement(
        address asset,
        address recipient,
        uint256 amount,
        bytes calldata metadata
    ) external nonReentrant returns (bytes32 instructionId) {
        require(asset != address(0), "DIBS: zero asset");
        require(recipient != address(0), "DIBS: zero recipient");
        require(amount > 0, "DIBS: zero amount");

        instructionId = keccak256(abi.encodePacked(
            block.timestamp,
            msg.sender,
            asset,
            recipient,
            amount,
            instructionIds.length
        ));

        require(instructions[instructionId].instructionId == bytes32(0), "DIBS: duplicate instruction");

        instructions[instructionId] = SettlementInstruction({
            instructionId: instructionId,
            externalReference: bytes32(0),
            asset: asset,
            recipient: recipient,
            amount: amount,
            submittedAt: block.timestamp,
            confirmedAt: 0,
            settledAmount: 0,
            status: InstructionStatus.Pending,
            metadata: metadata
        });
        instructionIds.push(instructionId);

        // Submit to external partner
        bytes32 extRef = settlementPartner.submitInstruction(
            instructionId,
            asset,
            recipient,
            amount,
            metadata
        );
        instructions[instructionId].externalReference = extRef;

        emit InstructionSubmitted(instructionId, asset, recipient, amount);
    }

    // ─── Settlement Confirmation ──────────────────────────

    /**
     * @dev Confirm settlement — called by the external partner via callback.
     * @param instructionId Internal instruction ID
     * @param externalReference Partner's external reference
     * @param settledAmount Actual settled amount
     * @param reconciliationHash Hash of reconciliation data
     */
    function confirmSettlement(
        bytes32 instructionId,
        bytes32 externalReference,
        uint256 settledAmount,
        bytes32 reconciliationHash
    ) external nonReentrant returns (bool confirmed) {
        SettlementInstruction storage instr = instructions[instructionId];
        if (instr.instructionId == bytes32(0)) revert InstructionNotFound(instructionId);
        if (instr.status != InstructionStatus.Pending) revert InstructionNotPending(instructionId);

        // Verify caller is the settlement partner
        require(msg.sender == address(settlementPartner), "DIBS: only settlement partner");

        instr.status = InstructionStatus.Confirmed;
        instr.confirmedAt = block.timestamp;
        instr.settledAmount = settledAmount;
        instr.externalReference = externalReference;

        totalConfirmedAmount += settledAmount;

        emit InstructionConfirmed(instructionId, externalReference, settledAmount, block.timestamp);
        emit ReconciliationRecordCreated(instructionId, reconciliationHash);

        return true;
    }

    /**
     * @dev Mark an instruction as failed — called by partner or admin.
     */
    function markInstructionFailed(bytes32 instructionId, string calldata reason) external {
        SettlementInstruction storage instr = instructions[instructionId];
        if (instr.instructionId == bytes32(0)) revert InstructionNotFound(instructionId);
        require(
            msg.sender == admin || msg.sender == address(settlementPartner),
            "DIBS: unauthorized"
        );
        if (instr.status != InstructionStatus.Pending) revert InstructionNotPending(instructionId);

        instr.status = InstructionStatus.Failed;
        emit InstructionFailed(instructionId, reason);
    }

    // ─── Admin Functions ───────────────────────────────────

    /**
     * @dev Cancel a pending instruction.
     */
    function cancelInstruction(bytes32 instructionId) external onlyAdmin {
        SettlementInstruction storage instr = instructions[instructionId];
        if (instr.instructionId == bytes32(0)) revert InstructionNotFound(instructionId);
        if (instr.status != InstructionStatus.Pending) revert InstructionNotPending(instructionId);

        instr.status = InstructionStatus.Cancelled;
        emit InstructionCancelled(instructionId);
    }

    /**
     * @dev Expire timed-out instructions. Callable by anyone.
     */
    function expireInstruction(bytes32 instructionId) external {
        SettlementInstruction storage instr = instructions[instructionId];
        if (instr.instructionId == bytes32(0)) revert InstructionNotFound(instructionId);
        if (instr.status != InstructionStatus.Pending) return;
        require(block.timestamp > instr.submittedAt + instructionTimeout, "DIBS: not yet expired");

        instr.status = InstructionStatus.Expired;
        emit InstructionExpired(instructionId);
    }

    function setInstructionTimeout(uint256 seconds_) external onlyAdmin {
        instructionTimeout = seconds_;
        emit SettlementTimeoutUpdated(seconds_);
    }

    // ─── Confirmation Indexing ─────────────────────────────

    /**
     * @dev Get all confirmed instructions (for reconciliation).
     */
    function getConfirmedInstructions() external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < instructionIds.length; i++) {
            if (instructions[instructionIds[i]].status == InstructionStatus.Confirmed) {
                count++;
            }
        }

        bytes32[] memory confirmed = new bytes32[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < instructionIds.length; i++) {
            if (instructions[instructionIds[i]].status == InstructionStatus.Confirmed) {
                confirmed[idx++] = instructionIds[i];
            }
        }
        return confirmed;
    }

    /**
     * @dev Get instruction status and details.
     */
    function getInstruction(bytes32 instructionId) external view returns (SettlementInstruction memory) {
        return instructions[instructionId];
    }

    function getInstructionCount() external view returns (uint256) {
        return instructionIds.length;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "DIBS: zero address");
        admin = newAdmin;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORACLE ADAPTER — Price Feed Freshness & Multi-Oracle Aggregation
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title OracleAdapter
 * @dev Adapter for oracle price feeds with freshness validation,
 *      multi-oracle aggregation, and failure simulation hooks.
 */
contract OracleAdapter is ReentrancyGuard {
    // ─── Config ────────────────────────────────────────────
    address public admin;

    // ─── Oracle Registry ───────────────────────────────────
    struct OracleConfig {
        IOracle oracle;
        uint8 weight;               // weight in aggregation (1-10)
        uint256 maxStalenessSeconds; // max acceptable age
        bool active;
        bool simulationFailed;       // simulated failure flag for testing
    }

    mapping(address => OracleConfig) public oracles;  // oracle address => config
    address[] public oracleList;

    // ─── Aggregation ──────────────────────────────────────
    enum AggregationMode {
        Median,      // middle value (most robust)
        WeightedAvg,  // weight-weighted average
        Min           // most conservative (lowest price)
    }

    AggregationMode public aggregationMode;

    // ─── Stale Data ────────────────────────────────────────
    mapping(address => bool) public staleFlags;  // oracle => is stale

    // ─── Events ────────────────────────────────────────────
    event OracleRegistered(address indexed oracle, uint8 weight, uint256 maxStaleness);
    event OracleRemoved(address indexed oracle);
    event PriceAggregated(uint256 price, AggregationMode mode, uint256 oracleCount);
    event StaleDataFlagged(address indexed oracle, uint256 age, uint256 maxAge);
    event StaleDataCleared(address indexed oracle);
    event OracleFailureSimulated(address indexed oracle, bool failed);
    event AggregationModeUpdated(AggregationMode newMode);

    // ─── Errors ────────────────────────────────────────────
    error NoActiveOracles();
    error OracleStale(address oracle, uint256 age, uint256 maxAge);
    error InvalidWeight(uint8 weight);
    error OracleNotRegistered(address oracle);
    error Unauthorized(address caller);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        _;
    }

    // ─── Constructor ───────────────────────────────────────
    constructor() {
        admin = msg.sender;
        aggregationMode = AggregationMode.Median;
    }

    // ─── Oracle Registration ───────────────────────────────

    /**
     * @dev Register a price oracle with weight and staleness config.
     */
    function registerOracle(
        address oracle,
        uint8 weight,
        uint256 maxStalenessSeconds
    ) external onlyAdmin {
        require(oracle != address(0), "DIBS: zero address");
        if (weight == 0 || weight > 10) revert InvalidWeight(weight);
        require(maxStalenessSeconds > 0, "DIBS: zero staleness");

        if (!oracles[oracle].active) {
            oracleList.push(oracle);
        }

        oracles[oracle] = OracleConfig({
            oracle: IOracle(oracle),
            weight: weight,
            maxStalenessSeconds: maxStalenessSeconds,
            active: true,
            simulationFailed: false
        });

        emit OracleRegistered(oracle, weight, maxStalenessSeconds);
    }

    /**
     * @dev Remove an oracle from the registry.
     */
    function removeOracle(address oracle) external onlyAdmin {
        if (!oracles[oracle].active) revert OracleNotRegistered(oracle);
        oracles[oracle].active = false;
        staleFlags[oracle] = false;
        emit OracleRemoved(oracle);
    }

    // ─── Freshness Checks ──────────────────────────────────

    /**
     * @dev Check freshness of a single oracle (non-reverting).
     */
    function checkFreshness(address oracle) public returns (bool fresh, uint256 age) {
        OracleConfig storage config = oracles[oracle];
        if (!config.active) return (false, 0);

        (, , , uint256 updatedAt, ) = config.oracle.latestRoundData();
        age = block.timestamp - updatedAt;

        if (age > config.maxStalenessSeconds) {
            staleFlags[oracle] = true;
            emit StaleDataFlagged(oracle, age, config.maxStalenessSeconds);
            return (false, age);
        }

        if (staleFlags[oracle]) {
            staleFlags[oracle] = false;
            emit StaleDataCleared(oracle);
        }

        return (true, age);
    }

    /**
     * @dev Check freshness of all registered oracles. Returns count of fresh oracles.
     */
    function checkAllFreshness() external returns (uint256 freshCount, uint256 staleCount) {
        for (uint256 i = 0; i < oracleList.length; i++) {
            address oracle = oracleList[i];
            if (!oracles[oracle].active) continue;

            (bool fresh,) = checkFreshness(oracle);
            if (fresh) {
                freshCount++;
            } else {
                staleCount++;
            }
        }
    }

    /**
     * @dev Clear stale flag for an oracle (admin override).
     */
    function clearStaleFlag(address oracle) external onlyAdmin {
        staleFlags[oracle] = false;
        emit StaleDataCleared(oracle);
    }

    // ─── Multi-Oracle Price Aggregation ───────────────────

    /**
     * @dev Aggregate prices from all active, fresh oracles.
     *      Uses the configured aggregation mode (Median, WeightedAvg, or Min).
     * @return price Aggregated price in oracle decimals
     * @return oracleCount Number of oracles used in aggregation
     */
    function aggregatePrice() external nonReentrant returns (uint256 price, uint256 oracleCount) {
        uint256[] memory prices = new uint256[](oracleList.length);
        uint256[] memory weights = new uint256[](oracleList.length);
        oracleCount = 0;
        uint256 totalWeight = 0;

        for (uint256 i = 0; i < oracleList.length; i++) {
            address oracleAddr = oracleList[i];
            OracleConfig storage config = oracles[oracleAddr];
            if (!config.active || config.simulationFailed) continue;
            if (staleFlags[oracleAddr]) continue;

            (, int256 answer, , uint256 updatedAt, ) = config.oracle.latestRoundData();
            if (answer <= 0) continue;

            uint256 age = block.timestamp - updatedAt;
            if (age > config.maxStalenessSeconds) {
                staleFlags[oracleAddr] = true;
                emit StaleDataFlagged(oracleAddr, age, config.maxStalenessSeconds);
                continue;
            }

            prices[oracleCount] = uint256(answer);
            weights[oracleCount] = config.weight;
            totalWeight += config.weight;
            oracleCount++;
        }

        if (oracleCount == 0) revert NoActiveOracles();

        if (aggregationMode == AggregationMode.Median) {
            price = _median(prices, oracleCount);
        } else if (aggregationMode == AggregationMode.WeightedAvg) {
            require(totalWeight > 0, "DIBS: zero weight");
            uint256 weightedSum = 0;
            for (uint256 i = 0; i < oracleCount; i++) {
                weightedSum += prices[i] * weights[i];
            }
            price = weightedSum / totalWeight;
        } else {
            // Min — most conservative
            price = prices[0];
            for (uint256 i = 1; i < oracleCount; i++) {
                if (prices[i] < price) price = prices[i];
            }
        }

        emit PriceAggregated(price, aggregationMode, oracleCount);
    }

    // ─── Oracle Failure Simulation ─────────────────────────

    /**
     * @dev Simulate oracle failure for testing. When set, oracle is excluded
     *      from aggregation as if it returned no data.
     */
    function simulateOracleFailure(address oracle, bool failed) external onlyAdmin {
        if (!oracles[oracle].active) revert OracleNotRegistered(oracle);
        oracles[oracle].simulationFailed = failed;
        emit OracleFailureSimulated(oracle, failed);
    }

    // ─── Configuration ─────────────────────────────────────

    function setAggregationMode(AggregationMode mode) external onlyAdmin {
        aggregationMode = mode;
        emit AggregationModeUpdated(mode);
    }

    // ─── Internal ──────────────────────────────────────────

    /**
     * @dev Compute median of an array (simple sort + pick middle).
     */
    function _median(uint256[] memory values, uint256 count) internal pure returns (uint256) {
        if (count == 1) return values[0];

        // Simple insertion sort (count is small — few oracles)
        for (uint256 i = 1; i < count; i++) {
            uint256 key = values[i];
            uint256 j = i;
            while (j > 0 && values[j - 1] > key) {
                values[j] = values[j - 1];
                j--;
            }
            values[j] = key;
        }

        if (count % 2 == 0) {
            return (values[count / 2 - 1] + values[count / 2]) / 2;
        } else {
            return values[count / 2];
        }
    }

    // ─── Admin ─────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "DIBS: zero address");
        admin = newAdmin;
    }

    function getOracleCount() external view returns (uint256) {
        return oracleList.length;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WITHDRAWAL QUEUE ROUTER — Capital Preservation Mode Queue Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title WithdrawalQueueRouter
 * @dev Routes withdrawal requests through queue during Capital Preservation Mode.
 *
 *      Priority Ordering:
 *      1. Smallest withdrawals first (retail-friendly, minimizes large redemptions)
 *      2. FIFO within same size tier
 *      3. LP/provider withdrawals deprioritized (institutional last)
 *
 *      Liquidity Test Gating:
 *      Queue processing requires liquidityTestsPassed == true.
 *      If tests fail, queue is frozen until resolved.
 */
contract WithdrawalQueueRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Config ────────────────────────────────────────────
    ISentinelVault public immutable sentinel;
    address public admin;

    // ─── Queue State ───────────────────────────────────────
    struct QueuedWithdrawal {
        address user;
        uint256 assets;
        uint256 shares;
        uint256 requestedAt;
        uint256 priority;       // lower = higher priority
        bool processed;
        bool isLP;              // LP/institutional flag
    }

    QueuedWithdrawal[] public queue;
    uint256 public totalQueued;
    uint256 public maxBatchSize;
    uint256 public smallWithdrawalThreshold;  // below this = priority tier 1

    // ─── Events ────────────────────────────────────────────
    event WithdrawalQueued(address indexed user, uint256 assets, uint256 shares, uint256 priority, uint256 queueIndex);
    event WithdrawalProcessed(address indexed user, uint256 assets, uint256 shares, uint256 queueIndex);
    event QueueBatchProcessed(uint256 processedCount, uint256 totalAssets, uint256 remaining);
    event QueueFrozenEvent(string reason);
    event QueueUnfrozen();
    event QueuePublished(uint256 totalPending, uint256 totalAssets);

    // ─── Errors ────────────────────────────────────────────
    error QueueFrozen(string reason);
    error NotInPreservationMode();
    error InsufficientShares(uint256 requested, uint256 available);
    error Unauthorized(address caller);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        _;
    }

    // ─── Constructor ───────────────────────────────────────
    constructor(address sentinel_) {
        require(sentinel_ != address(0), "DIBS: zero address");
        sentinel = ISentinelVault(sentinel_);
        admin = msg.sender;
        maxBatchSize = 10;
        smallWithdrawalThreshold = 1000e18; // 1000 tokens (configurable)
    }

    // ─── Queue Management ──────────────────────────────────

    /**
     * @dev Queue a withdrawal request during preservation mode.
     * @param assets Amount of assets to withdraw
     * @param shares Corresponding shares to burn
     * @param isLP Whether the requester is an LP/institutional (affects priority)
     */
    function queueWithdrawal(
        uint256 assets,
        uint256 shares,
        bool isLP
    ) external nonReentrant returns (uint256 queueIndex) {
        require(assets > 0 && shares > 0, "DIBS: zero amount");

        // Priority: 1 = small retail, 2 = large retail, 3 = LP/institutional
        uint256 priority;
        if (isLP) {
            priority = 3;
        } else if (assets <= smallWithdrawalThreshold) {
            priority = 1;
        } else {
            priority = 2;
        }

        queueIndex = queue.length;
        queue.push(QueuedWithdrawal({
            user: msg.sender,
            assets: assets,
            shares: shares,
            requestedAt: block.timestamp,
            priority: priority,
            processed: false,
            isLP: isLP
        }));

        totalQueued += assets;

        emit WithdrawalQueued(msg.sender, assets, shares, priority, queueIndex);
        emit QueuePublished(queue.length - _countProcessed(), totalQueued);
    }

    /**
     * @dev Process the next batch of queued withdrawals.
     *      Requires liquidity tests to be passed.
     *      Processes in priority order (1 → 2 → 3), FIFO within each tier.
     * @return processedCount Number of withdrawals processed
     * @return totalAssetsProcessed Total assets processed in this batch
     */
    function processNextBatch() external nonReentrant returns (uint256 processedCount, uint256 totalAssetsProcessed) {
        // ── Liquidity Test Gating ──
        if (!sentinel.liquidityTestsPassed()) {
            emit QueueFrozenEvent("Liquidity tests not passed");
            revert QueueFrozen("Liquidity tests not passed");
        }

        uint256 toProcess = maxBatchSize;
        uint256[] memory indices = _getPriorityBatch(toProcess);

        for (uint256 i = 0; i < indices.length; i++) {
            uint256 idx = indices[i];
            QueuedWithdrawal storage w = queue[idx];
            if (w.processed) continue;

            w.processed = true;
            totalQueued -= w.assets;
            totalAssetsProcessed += w.assets;
            processedCount++;

            emit WithdrawalProcessed(w.user, w.assets, w.shares, idx);
        }

        emit QueueBatchProcessed(processedCount, totalAssetsProcessed, queue.length - _countProcessed());
        emit QueuePublished(queue.length - _countProcessed(), totalQueued);
    }

    // ─── Redemption Priority Ordering ──────────────────────

    /**
     * @dev Get the next batch of indices to process, ordered by priority.
     *      Returns up to `maxCount` indices of unprocessed withdrawals,
     *      sorted by priority (1 first, then 2, then 3), FIFO within each tier.
     */
    function _getPriorityBatch(uint256 maxCount) internal view returns (uint256[] memory) {
        uint256[] memory result = new uint256[](maxCount);
        uint256 found = 0;

        // Process priority 1 (small retail) first
        found = _fillByPriority(result, found, maxCount, 1);
        if (found < maxCount) found = _fillByPriority(result, found, maxCount, 2);
        if (found < maxCount) found = _fillByPriority(result, found, maxCount, 3);

        // Trim to actual size
        uint256[] memory trimmed = new uint256[](found);
        for (uint256 i = 0; i < found; i++) {
            trimmed[i] = result[i];
        }
        return trimmed;
    }

    function _fillByPriority(
        uint256[] memory result,
        uint256 found,
        uint256 maxCount,
        uint256 priority
    ) internal view returns (uint256) {
        for (uint256 i = 0; i < queue.length && found < maxCount; i++) {
            if (!queue[i].processed && queue[i].priority == priority) {
                result[found] = i;
                found++;
            }
        }
        return found;
    }

    // ─── Queue State Publishing ───────────────────────────

    /**
     * @dev Publish current queue state for off-chain monitoring.
     */
    function publishQueueState() external returns (uint256 pendingCount, uint256 pendingAssets) {
        pendingCount = queue.length - _countProcessed();
        pendingAssets = totalQueued;
        emit QueuePublished(pendingCount, pendingAssets);
    }

    /**
     * @dev Get all pending (unprocessed) withdrawals.
     */
    function getPendingWithdrawals() external view returns (uint256[] memory indices) {
        uint256 count = 0;
        for (uint256 i = 0; i < queue.length; i++) {
            if (!queue[i].processed) count++;
        }

        indices = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < queue.length; i++) {
            if (!queue[i].processed) {
                indices[idx++] = i;
            }
        }
    }

    /**
     * @dev Get queue position info for a specific index.
     */
    function getQueueEntry(uint256 index) external view returns (QueuedWithdrawal memory) {
        return queue[index];
    }

    // ─── Admin ─────────────────────────────────────────────

    function setMaxBatchSize(uint256 size) external onlyAdmin {
        require(size > 0, "DIBS: zero size");
        maxBatchSize = size;
    }

    function setSmallWithdrawalThreshold(uint256 threshold) external onlyAdmin {
        smallWithdrawalThreshold = threshold;
    }

    function getQueueLength() external view returns (uint256) {
        return queue.length;
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "DIBS: zero address");
        admin = newAdmin;
    }

    // ─── Internal ──────────────────────────────────────────

    function _countProcessed() internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < queue.length; i++) {
            if (queue[i].processed) count++;
        }
        return count;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// YIELD DIVERSION ROUTER — Capital Preservation Mode Yield Routing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @title YieldDiversionRouter
 * @dev Routes yield to reserve rebuilding during Capital Preservation Mode.
 *      Does NOT route all yield into freely redeemable Catalyst vault.
 *      Routes to: segregated reserve, non-distributable reserve shares,
 *      locked recapitalization balance, contract-enforced retained earnings.
 *
 *      Reserve Release Gating:
 *      1. JuniorRatio >= MinJuniorRatio (ratio restoration)
 *      2. Liquidity tests passed
 *      3. Reserve shortfall addressed
 *      All three must be true before reserve can be released.
 */
contract YieldDiversionRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Config ────────────────────────────────────────────
    address public admin;
    IERC20 public immutable asset;

    // ─── Destination Vaults ────────────────────────────────
    IDIBSVault public sentinelVault;
    IDIBSVault public catalystVault;

    // ─── Routing State ─────────────────────────────────────
    enum YieldRoute {
        Normal,               // yield → Catalyst holders (normal distribution)
        SegregatedReserve,    // yield → Sentinel's segregated reserve
        LockedRecapitalization, // yield → locked recap balance
        RetainedEarnings      // yield → protocol retained earnings
    }

    YieldRoute public currentRoute;
    uint256 public totalRoutedToReserve;
    uint256 public totalRoutedToRecap;
    uint256 public totalRetainedEarnings;

    // ─── Reserve Rebuild Constraints ──────────────────────
    uint256 public reserveTargetAmount;       // target reserve level
    uint256 public reserveRebuildRateBps;      // % of yield to reserve (e.g., 8000 = 80%)
    bool public reserveRebuildComplete;

    // ─── Events ────────────────────────────────────────────
    event YieldRouted(YieldRoute indexed route, uint256 amount, address indexed destination);
    event ReserveRebuildProgress(uint256 currentReserve, uint256 target, bool complete);
    event ReserveReleased(uint256 amount, address indexed recipient);
    event ReserveReleaseBlockedEvent(string reason);
    event RouteChanged(YieldRoute newRoute, string reason);
    event ReserveTargetUpdated(uint256 newTarget);
    event ReserveRebuildRateUpdated(uint256 newRateBps);

    // ─── Errors ────────────────────────────────────────────
    error ZeroAmount();
    error ZeroAddress();
    error ReserveReleaseBlocked(string reason);
    error Unauthorized(address caller);
    error InvalidRate(uint256 rateBps);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized(msg.sender);
        _;
    }

    // ─── Constructor ───────────────────────────────────────
    constructor(address asset_) {
        if (asset_ == address(0)) revert ZeroAddress();
        asset = IERC20(asset_);
        admin = msg.sender;
        currentRoute = YieldRoute.Normal;
        reserveRebuildRateBps = 8000; // 80% default
    }

    // ─── Vault Configuration ───────────────────────────────

    /**
     * @dev Set the Sentinel and Catalyst vault addresses for routing.
     */
    function setVaults(address sentinel, address catalyst) external onlyAdmin {
        if (sentinel == address(0) || catalyst == address(0)) revert ZeroAddress();
        sentinelVault = IDIBSVault(sentinel);
        catalystVault = IDIBSVault(catalyst);
    }

    // ─── Yield Routing Logic ──────────────────────────────

    /**
     * @dev Route yield based on current Capital Preservation Mode state.
     *      During preservation mode, yield is diverted to reserve rebuilding.
     *      The reserveRebuildRateBps determines the split:
     *        - reserveRebuildRateBps % → segregated reserve
     *        - remainder → retained earnings or locked recapitalization
     *
     * @param amount Total yield to route
     * @param toRecapitalization If true, non-reserve portion goes to locked recap;
     *                           if false, goes to retained earnings
     */
    function routeYield(
        uint256 amount,
        bool toRecapitalization
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Transfer yield from caller to this router
        asset.safeTransferFrom(msg.sender, address(this), amount);

        if (currentRoute == YieldRoute.Normal) {
            // Normal: distribute to Catalyst vault (standard yield distribution)
            asset.safeIncreaseAllowance(address(catalystVault), amount);
            catalystVault.depositToReserve(amount);
            emit YieldRouted(YieldRoute.Normal, amount, address(catalystVault));
            return;
        }

        // Preservation mode routing
        uint256 toReserve = (amount * reserveRebuildRateBps) / 10000;
        uint256 remainder = amount - toReserve;

        // Route reserve portion to Sentinel's segregated reserve
        if (toReserve > 0) {
            asset.safeIncreaseAllowance(address(sentinelVault), toReserve);
            sentinelVault.depositToReserve(toReserve);
            totalRoutedToReserve += toReserve;
            emit YieldRouted(YieldRoute.SegregatedReserve, toReserve, address(sentinelVault));
        }

        // Route remainder
        if (remainder > 0) {
            if (toRecapitalization) {
                // Lock in recapitalization balance (not freely redeemable)
                totalRoutedToRecap += remainder;
                emit YieldRouted(YieldRoute.LockedRecapitalization, remainder, address(sentinelVault));
            } else {
                // Retain as protocol earnings
                totalRetainedEarnings += remainder;
                emit YieldRouted(YieldRoute.RetainedEarnings, remainder, address(this));
            }
        }

        // Check if reserve target is met
        _checkReserveRebuildProgress();
    }

    // ─── Reserve Rebuild Constraint Enforcement ───────────

    /**
     * @dev Check if reserve has reached its target.
     *      Emits progress event and marks complete if target met.
     */
    function _checkReserveRebuildProgress() internal {
        if (address(sentinelVault) == address(0)) return;  // vaults not set yet
        uint256 currentReserve = sentinelVault.segregatedReserve();

        if (currentReserve >= reserveTargetAmount) {
            if (!reserveRebuildComplete) {
                reserveRebuildComplete = true;
                emit ReserveRebuildProgress(currentReserve, reserveTargetAmount, true);
            }
        } else {
            emit ReserveRebuildProgress(currentReserve, reserveTargetAmount, false);
        }
    }

    /**
     * @dev Check if reserve can be released. All three conditions must be met:
     *      1. Preservation mode NOT active
     *      2. JuniorRatio >= MinJuniorRatio (via canReleaseReserve on vault)
     *      3. Reserve rebuild complete
     */
    function canReleaseReserve() public view returns (bool) {
        if (address(sentinelVault) == address(0)) return false;
        if (sentinelVault.preservationModeActive()) return false;
        if (!sentinelVault.canReleaseReserve()) return false;
        if (!reserveRebuildComplete) return false;
        return true;
    }

    /**
     * @dev Release reserve to a recipient. Gated by all three conditions.
     */
    function releaseReserve(uint256 amount, address recipient) external onlyAdmin nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (!canReleaseReserve()) {
            string memory reason;
            if (sentinelVault.preservationModeActive()) {
                reason = "Preservation mode active";
            } else if (!sentinelVault.canReleaseReserve()) {
                reason = "Ratio below minimum or liquidity tests failed";
            } else {
                reason = "Reserve rebuild not complete";
            }
            emit ReserveReleaseBlockedEvent(reason);
            revert ReserveReleaseBlocked(reason);
        }

        // Release via the vault's own release mechanism
        sentinelVault.releaseReserve(amount, recipient);
        emit ReserveReleased(amount, recipient);
    }

    // ─── Route Management ──────────────────────────────────

    /**
     * @dev Change the current yield route. Called when preservation mode
     *      is triggered or lifted.
     * @param newRoute The new yield routing destination
     * @param reason Human-readable reason for the change
     */
    function setRoute(YieldRoute newRoute, string calldata reason) external onlyAdmin {
        currentRoute = newRoute;
        emit RouteChanged(newRoute, reason);

        // When switching to Normal, mark rebuild as needing re-check
        if (newRoute == YieldRoute.Normal) {
            reserveRebuildComplete = false;
        }
    }

    /**
     * @dev Update reserve target amount.
     */
    function setReserveTarget(uint256 target) external onlyAdmin {
        reserveTargetAmount = target;
        emit ReserveTargetUpdated(target);
        _checkReserveRebuildProgress();
    }

    /**
     * @dev Update the % of yield directed to reserve rebuilding.
     */
    function setReserveRebuildRate(uint256 rateBps) external onlyAdmin {
        if (rateBps > 10000) revert InvalidRate(rateBps);
        reserveRebuildRateBps = rateBps;
        emit ReserveRebuildRateUpdated(rateBps);
    }

    // ─── View Functions ────────────────────────────────────

    function getRoutingStats() external view returns (
        uint256 _totalRoutedToReserve,
        uint256 _totalRoutedToRecap,
        uint256 _totalRetainedEarnings,
        uint256 _currentReserve,
        bool _rebuildComplete,
        YieldRoute _route
    ) {
        return (
            totalRoutedToReserve,
            totalRoutedToRecap,
            totalRetainedEarnings,
            sentinelVault.segregatedReserve(),
            reserveRebuildComplete,
            currentRoute
        );
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }
}
