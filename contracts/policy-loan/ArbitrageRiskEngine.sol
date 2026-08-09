// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Policy Loan Subsystem
// ArbitrageRiskEngine: On-chain Risk Evaluation & Spread Analytics
pragma solidity ^0.8.24;

/**
 * @title ArbitrageRiskEngine
 * @notice Evaluates policy-loan arbitrage spreads, liquidity haircuts, LTV creep,
 *         rate mismatch, cash-value declines, and portfolio DSCR thresholds (1.1x trigger).
 */
contract ArbitrageRiskEngine {
    // --- Constants ---
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant DSCR_THRESHOLD_BPS = 11000; // 1.10x DSCR threshold
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // --- Structs ---
    struct RiskEvaluationResult {
        bytes32 policyId;
        int256 netSpreadBps;                  // Net spread after liquidity haircut and tax
        uint256 netYieldBps;                   // Realizable yield after haircut
        uint256 currentLtvBps;                 // Current LTV in BPS
        uint256 annualizedLtvCreepBps;         // Annualized LTV increase rate
        uint256 dscrBps;                       // Debt Service Coverage Ratio in BPS (11000 = 1.1x)
        bool operatesCreep;                    // True if LTV creep exceeds warning rate
        bool rateMismatch;                     // True if loan cost exceeds gross deployment yield
        bool cashValueDeclined;                // True if cash value dropped
        bool redirectCashFlow;                 // True if DSCR < 1.1x trigger
        bool partialLiquidationRecommended;    // True if LTV hard ceiling or negative spread breach
        bool repaymentRecommended;             // True if soft LTV or rate mismatch breach
        string recommendationReason;           // Human readable trigger description
    }

    // --- Events ---
    event ArbitrageSpreadEvaluated(
        bytes32 indexed policyId,
        int256 netSpreadBps,
        uint256 netYieldBps,
        uint256 loanCostBps
    );
    event CashFlowRedirectTriggered(
        bytes32 indexed policyId,
        uint256 dscrBps,
        uint256 thresholdBps
    );
    event LiquidationRecommendationTriggered(
        bytes32 indexed policyId,
        uint256 currentLtvBps,
        string reason
    );
    event RepaymentRecommendationTriggered(
        bytes32 indexed policyId,
        uint256 currentLtvBps,
        string reason
    );
    event LtvCreepDetected(
        bytes32 indexed policyId,
        uint256 annualizedCreepBps
    );

    // --- Pure Calculation Functions ---

    /**
     * @notice Calculate realizable net spread between deployment yield and loan cost.
     * @param deploymentYieldBps Expected gross annual deployment yield in BPS
     * @param loanCostBps Annual policy loan interest rate in BPS
     * @param liquidityHaircutBps Haircut percentage applied to yield (e.g. 1000 = 10% haircut)
     * @param taxRateBps Tax rate assumption in BPS (0 if tax free / legally validated)
     */
    function calculateSpread(
        uint256 deploymentYieldBps,
        uint256 loanCostBps,
        uint256 liquidityHaircutBps,
        uint256 taxRateBps
    ) public pure returns (int256 netSpreadBps, uint256 netYieldBps) {
        require(liquidityHaircutBps <= BPS_DENOMINATOR, "ArbitrageRiskEngine: haircut > 100%");
        require(taxRateBps <= BPS_DENOMINATOR, "ArbitrageRiskEngine: tax rate > 100%");

        // Net Yield = GrossYield * (1 - Haircut)
        netYieldBps = (deploymentYieldBps * (BPS_DENOMINATOR - liquidityHaircutBps)) / BPS_DENOMINATOR;
        
        // After Tax Yield = NetYield * (1 - TaxRate)
        uint256 afterTaxYieldBps = (netYieldBps * (BPS_DENOMINATOR - taxRateBps)) / BPS_DENOMINATOR;

        // Net Spread = After Tax Yield - Loan Cost
        netSpreadBps = int256(afterTaxYieldBps) - int256(loanCostBps);
    }

    /**
     * @notice Monitor LTV creep over time.
     */
    function monitorLtvCreep(
        uint256 currentLtvBps,
        uint256 previousLtvBps,
        uint256 timeElapsedSeconds
    ) public pure returns (bool operatesCreep, uint256 annualizedCreepBps) {
        if (timeElapsedSeconds == 0 || currentLtvBps <= previousLtvBps) {
            return (false, 0);
        }

        uint256 ltvDelta = currentLtvBps - previousLtvBps;
        annualizedCreepBps = (ltvDelta * SECONDS_PER_YEAR) / timeElapsedSeconds;

        // Trigger creep warning if annualized LTV increase rate > 2.00% (200 BPS)
        operatesCreep = annualizedCreepBps >= 200;
    }

    /**
     * @notice Evaluate DSCR and test 1.1x redirection trigger.
     */
    function evaluateDSCR(uint256 netOperatingIncome, uint256 debtService)
        public
        pure
        returns (uint256 dscrBps, bool shouldRedirectCashFlow)
    {
        if (debtService == 0) {
            return (999999, false); // Infinite coverage
        }

        dscrBps = (netOperatingIncome * BPS_DENOMINATOR) / debtService;
        shouldRedirectCashFlow = dscrBps < DSCR_THRESHOLD_BPS; // DSCR < 1.10x
    }

    /**
     * @notice Monitor cash surrender value decline.
     */
    function monitorCashValueDecline(uint256 initialCashValue, uint256 currentCashValue)
        public
        pure
        returns (bool hasDeclined, uint256 declineBps)
    {
        if (currentCashValue >= initialCashValue || initialCashValue == 0) {
            return (false, 0);
        }
        uint256 drop = initialCashValue - currentCashValue;
        declineBps = (drop * BPS_DENOMINATOR) / initialCashValue;
        hasDeclined = declineBps > 0;
    }

    // --- State-Modifying Risk Assessment ---

    /**
     * @notice Full comprehensive risk evaluation for a policy position.
     */
    function evaluatePolicyRisk(
        bytes32 policyId,
        uint256 currentLtvBps,
        uint256 previousLtvBps,
        uint256 timeElapsedSeconds,
        uint256 deploymentYieldBps,
        uint256 loanCostBps,
        uint256 liquidityHaircutBps,
        uint256 taxRateBps,
        uint256 netOperatingIncome,
        uint256 debtService,
        uint256 initialCashValue,
        uint256 currentCashValue,
        uint256 softWarningLtvBps,
        uint256 hardCeilingLtvBps
    ) external returns (RiskEvaluationResult memory result) {
        (int256 netSpreadBps, uint256 netYieldBps) = calculateSpread(
            deploymentYieldBps,
            loanCostBps,
            liquidityHaircutBps,
            taxRateBps
        );

        (bool operatesCreep, uint256 annualizedCreepBps) = monitorLtvCreep(
            currentLtvBps,
            previousLtvBps,
            timeElapsedSeconds
        );

        (uint256 dscrBps, bool redirectCashFlow) = evaluateDSCR(netOperatingIncome, debtService);

        (bool cashValueDeclined, ) = monitorCashValueDecline(initialCashValue, currentCashValue);

        bool rateMismatch = loanCostBps > deploymentYieldBps;

        bool partialLiquidationRecommended = (currentLtvBps >= hardCeilingLtvBps) || (netSpreadBps < 0);
        bool repaymentRecommended = (currentLtvBps >= softWarningLtvBps) || rateMismatch || operatesCreep;

        string memory reason = "Policy compliant";
        if (redirectCashFlow) {
            reason = "DSCR below 1.1x: redirecting cash flow to debt service";
            emit CashFlowRedirectTriggered(policyId, dscrBps, DSCR_THRESHOLD_BPS);
        } else if (partialLiquidationRecommended) {
            reason = "Hard LTV breach or negative net spread: partial liquidation recommended";
            emit LiquidationRecommendationTriggered(policyId, currentLtvBps, reason);
        } else if (repaymentRecommended) {
            reason = "Soft LTV warning threshold, rate mismatch, or LTV creep breach: repayment recommended";
            emit RepaymentRecommendationTriggered(policyId, currentLtvBps, reason);
        }

        if (operatesCreep) {
            emit LtvCreepDetected(policyId, annualizedCreepBps);
        }

        emit ArbitrageSpreadEvaluated(policyId, netSpreadBps, netYieldBps, loanCostBps);

        result = RiskEvaluationResult({
            policyId: policyId,
            netSpreadBps: netSpreadBps,
            netYieldBps: netYieldBps,
            currentLtvBps: currentLtvBps,
            annualizedLtvCreepBps: annualizedCreepBps,
            dscrBps: dscrBps,
            operatesCreep: operatesCreep,
            rateMismatch: rateMismatch,
            cashValueDeclined: cashValueDeclined,
            redirectCashFlow: redirectCashFlow,
            partialLiquidationRecommended: partialLiquidationRecommended,
            repaymentRecommended: repaymentRecommended,
            recommendationReason: reason
        });
    }
}
