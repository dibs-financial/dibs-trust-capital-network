// SPDX-License-Identifier: UNLICENSED
// DIBS Trust Capital Network — Policy Loan Subsystem
// PolicyLoanVault: Ledger & Risk Floor Tracking for Life Insurance Policy-Loans
pragma solidity ^0.8.24;

/**
 * @title PolicyLoanVault
 * @notice Solitary ledger and collateral accounting vault for policy-loan draws, accrued interest,
 *         repayments, premium payments, missed premium tracking, dividend adjustments,
 *         and LTV hard ceiling / soft warning enforcement.
 *
 * Security & Financial Statement:
 * - Tracks debt balances against policy cash surrender value (CSV).
 * - Enforces phase-dependent and absolute hard LTV ceilings to prevent policy lapse.
 * - Links draw proceeds directly to deployment records for end-to-end traceably deployed capital.
 */
contract PolicyLoanVault {
    // --- Constants ---
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant DEFAULT_MAX_MISSED_PREMIUMS = 3;

    // --- Access Control ---
    address public admin;
    address public riskEngine;

    // --- Structs ---

    enum PolicyPhase {
        Origination, // Initial phase (e.g., max LTV 70%)
        Seasoned,    // Mid-life phase (e.g., max LTV 80%)
        Mature       // Fully seasoned (e.g., max LTV 90%)
    }

    struct PolicyLoanState {
        bytes32 policyId;
        uint256 cashValue;                  // Cash Surrender Value (CSV)
        uint256 loanBalance;                // Outstanding loan principal
        uint256 accruedInterest;            // Accumulated unpaid loan interest
        uint256 totalRepaid;                // Lifetime total repaid principal + interest
        uint256 deathBenefit;               // Total face value / death benefit
        uint256 annualInterestRateBps;      // Loan interest rate in BPS (e.g., 500 = 5.00%)
        uint256 lastInterestAccrualTimestamp; // Timestamp of last interest accrual
        uint256 softLtvThresholdBps;        // Soft warning threshold in BPS (e.g., 8000 = 80%)
        uint256 hardLtvCeilingBps;          // Hard ceiling threshold in BPS (e.g., 9000 = 90%)
        uint256 missedPremiumCount;         // Consecutive missed premiums
        uint256 totalPremiumsPaid;          // Total premium payments recorded
        PolicyPhase phase;                  // Policy maturity phase
        bool isLapsed;                      // Lapse state flag
        bool isDrawsFrozen;                 // Freeze new draws on collateral deterioration
        bool exists;                        // Existence check
    }

    struct DrawRecord {
        bytes32 drawId;
        bytes32 policyId;
        bytes32 deploymentId;
        uint256 amount;
        address destination;
        uint256 timestamp;
    }

    struct DeploymentRecord {
        bytes32 deploymentId;
        bytes32 policyId;
        uint256 allocatedAmount;
        string targetStrategy;
        uint256 timestamp;
        bool isActive;
    }

    // --- Mappings ---
    mapping(bytes32 => PolicyLoanState) public policies;
    mapping(bytes32 => DrawRecord) public drawRecords;
    mapping(bytes32 => DeploymentRecord) public deploymentRecords;
    mapping(bytes32 => bytes32[]) public policyDraws;
    mapping(bytes32 => bytes32[]) public policyDeployments;

    // --- Events ---
    event PolicyCreated(
        bytes32 indexed policyId,
        uint256 cashValue,
        uint256 deathBenefit,
        uint256 annualInterestRateBps,
        uint256 softLtvThresholdBps,
        uint256 hardLtvCeilingBps
    );
    event LoanDrawn(
        bytes32 indexed policyId,
        bytes32 indexed drawId,
        bytes32 indexed deploymentId,
        uint256 amount,
        address destination,
        uint256 currentLtvBps
    );
    event InterestAccrued(
        bytes32 indexed policyId,
        uint256 interestAccrued,
        uint256 totalAccruedInterest,
        uint256 newTotalDebt
    );
    event LoanRepaid(
        bytes32 indexed policyId,
        uint256 amount,
        uint256 interestPaid,
        uint256 principalPaid,
        uint256 remainingLoanBalance
    );
    event PremiumPaid(bytes32 indexed policyId, uint256 amount, uint256 totalPremiumsPaid);
    event MissedPremiumRecorded(bytes32 indexed policyId, uint256 totalMissed);
    event DividendAdjusted(
        bytes32 indexed policyId,
        int256 deltaCashValue,
        uint256 newCashValue
    );
    event CashValueUpdated(bytes32 indexed policyId, uint256 oldCashValue, uint256 newCashValue);
    event SoftLtvThresholdBreached(
        bytes32 indexed policyId,
        uint256 currentLtvBps,
        uint256 thresholdBps
    );
    event HardLtvCeilingBreached(
        bytes32 indexed policyId,
        uint256 currentLtvBps,
        uint256 ceilingBps
    );
    event LapseConditionDetected(
        bytes32 indexed policyId,
        uint256 totalDebt,
        uint256 cashValue,
        string reason
    );
    event DrawsFrozen(bytes32 indexed policyId, string reason);
    event DrawsUnfrozen(bytes32 indexed policyId);

    // --- Modifiers ---
    modifier onlyAdmin() {
        require(msg.sender == admin, "PolicyLoanVault: caller is not admin");
        _;
    }

    modifier onlyAuthorized() {
        require(
            msg.sender == admin || msg.sender == riskEngine,
            "PolicyLoanVault: caller not authorized"
        );
        _;
    }

    modifier policyExists(bytes32 policyId) {
        require(policies[policyId].exists, "PolicyLoanVault: policy does not exist");
        _;
    }

    modifier notLapsed(bytes32 policyId) {
        require(!policies[policyId].isLapsed, "PolicyLoanVault: policy is lapsed");
        _;
    }

    // --- Constructor ---
    constructor(address _admin, address _riskEngine) {
        require(_admin != address(0), "PolicyLoanVault: zero admin address");
        admin = _admin;
        riskEngine = _riskEngine;
    }

    // --- Admin Config ---
    function setRiskEngine(address _riskEngine) external onlyAdmin {
        require(_riskEngine != address(0), "PolicyLoanVault: zero risk engine address");
        riskEngine = _riskEngine;
    }

    // --- Core Policy Lifecycle ---

    /**
     * @notice Register a new insurance policy in the vault ledger.
     */
    function createPolicy(
        bytes32 policyId,
        uint256 cashValue,
        uint256 deathBenefit,
        uint256 annualInterestRateBps,
        uint256 softLtvThresholdBps,
        uint256 hardLtvCeilingBps,
        PolicyPhase phase
    ) external onlyAuthorized {
        require(policyId != bytes32(0), "PolicyLoanVault: invalid policy ID");
        require(!policies[policyId].exists, "PolicyLoanVault: policy already exists");
        require(cashValue > 0, "PolicyLoanVault: cash value must be > 0");
        require(hardLtvCeilingBps > softLtvThresholdBps, "PolicyLoanVault: ceiling <= soft threshold");
        require(hardLtvCeilingBps <= BPS_DENOMINATOR, "PolicyLoanVault: ceiling > 100%");

        policies[policyId] = PolicyLoanState({
            policyId: policyId,
            cashValue: cashValue,
            loanBalance: 0,
            accruedInterest: 0,
            totalRepaid: 0,
            deathBenefit: deathBenefit,
            annualInterestRateBps: annualInterestRateBps,
            lastInterestAccrualTimestamp: block.timestamp,
            softLtvThresholdBps: softLtvThresholdBps,
            hardLtvCeilingBps: hardLtvCeilingBps,
            missedPremiumCount: 0,
            totalPremiumsPaid: 0,
            phase: phase,
            isLapsed: false,
            isDrawsFrozen: false,
            exists: true
        });

        emit PolicyCreated(
            policyId,
            cashValue,
            deathBenefit,
            annualInterestRateBps,
            softLtvThresholdBps,
            hardLtvCeilingBps
        );
    }

    /**
     * @notice Record a policy-loan draw and link proceeds to a deployment record.
     */
    function recordDraw(
        bytes32 policyId,
        bytes32 drawId,
        bytes32 deploymentId,
        uint256 amount,
        address destination,
        string calldata targetStrategy
    ) external onlyAuthorized policyExists(policyId) notLapsed(policyId) {
        PolicyLoanState storage p = policies[policyId];
        require(!p.isDrawsFrozen, "PolicyLoanVault: draws are frozen for this policy");
        require(amount > 0, "PolicyLoanVault: draw amount must be > 0");
        require(drawRecords[drawId].timestamp == 0, "PolicyLoanVault: duplicate draw ID");

        // Accrue pending interest prior to draw calculation
        _accrueInterest(policyId);

        uint256 newTotalDebt = p.loanBalance + p.accruedInterest + amount;
        uint256 currentLtvBps = (newTotalDebt * BPS_DENOMINATOR) / p.cashValue;

        // Enforce phase-dependent hard LTV ceiling
        uint256 maxAllowedLtvBps = _getPhaseMaxLtv(p.phase, p.hardLtvCeilingBps);
        require(
            currentLtvBps <= maxAllowedLtvBps,
            "PolicyLoanVault: draw exceeds maximum allowed LTV ceiling"
        );

        p.loanBalance += amount;

        // Store draw record
        drawRecords[drawId] = DrawRecord({
            drawId: drawId,
            policyId: policyId,
            deploymentId: deploymentId,
            amount: amount,
            destination: destination,
            timestamp: block.timestamp
        });
        policyDraws[policyId].push(drawId);

        // Store deployment link
        deploymentRecords[deploymentId] = DeploymentRecord({
            deploymentId: deploymentId,
            policyId: policyId,
            allocatedAmount: amount,
            targetStrategy: targetStrategy,
            timestamp: block.timestamp,
            isActive: true
        });
        policyDeployments[policyId].push(deploymentId);

        emit LoanDrawn(policyId, drawId, deploymentId, amount, destination, currentLtvBps);

        _checkLtvThresholds(policyId, currentLtvBps);
    }

    /**
     * @notice Accrue interest on outstanding policy loan balance based on time elapsed.
     */
    function accrueInterest(bytes32 policyId)
        external
        policyExists(policyId)
        returns (uint256 interestAccrued)
    {
        return _accrueInterest(policyId);
    }

    /**
     * @notice Record loan repayment. Repayments cover accrued interest first, then principal balance.
     */
    function recordRepayment(bytes32 policyId, uint256 amount)
        external
        onlyAuthorized
        policyExists(policyId)
    {
        require(amount > 0, "PolicyLoanVault: repayment amount must be > 0");
        _accrueInterest(policyId);

        PolicyLoanState storage p = policies[policyId];
        uint256 interestPaid = 0;
        uint256 principalPaid = 0;

        if (p.accruedInterest > 0) {
            if (amount <= p.accruedInterest) {
                p.accruedInterest -= amount;
                interestPaid = amount;
            } else {
                interestPaid = p.accruedInterest;
                uint256 remaining = amount - p.accruedInterest;
                p.accruedInterest = 0;
                
                principalPaid = remaining > p.loanBalance ? p.loanBalance : remaining;
                p.loanBalance -= principalPaid;
            }
        } else {
            principalPaid = amount > p.loanBalance ? p.loanBalance : amount;
            p.loanBalance -= principalPaid;
        }

        p.totalRepaid += amount;

        emit LoanRepaid(policyId, amount, interestPaid, principalPaid, p.loanBalance);

        // Unfreeze draws if LTV is restored below soft threshold
        uint256 newLtvBps = calculateLTV(policyId);
        if (p.isDrawsFrozen && newLtvBps < p.softLtvThresholdBps) {
            p.isDrawsFrozen = false;
            emit DrawsUnfrozen(policyId);
        }
    }

    /**
     * @notice Record a policy premium payment.
     */
    function recordPremiumPayment(bytes32 policyId, uint256 amount)
        external
        onlyAuthorized
        policyExists(policyId)
    {
        require(amount > 0, "PolicyLoanVault: premium amount must be > 0");
        PolicyLoanState storage p = policies[policyId];

        p.totalPremiumsPaid += amount;
        p.missedPremiumCount = 0; // Reset consecutive missed counter

        emit PremiumPaid(policyId, amount, p.totalPremiumsPaid);
    }

    /**
     * @notice Record a missed premium payment and evaluate policy lapse risk.
     */
    function recordMissedPremium(bytes32 policyId)
        external
        onlyAuthorized
        policyExists(policyId)
    {
        PolicyLoanState storage p = policies[policyId];
        p.missedPremiumCount += 1;

        emit MissedPremiumRecorded(policyId, p.missedPremiumCount);

        if (p.missedPremiumCount >= DEFAULT_MAX_MISSED_PREMIUMS) {
            _checkAndSetLapse(policyId, "Excessive missed premium payments");
        }
    }

    /**
     * @notice Adjust cash surrender value resulting from policy dividend crediting or adjustments.
     */
    function adjustDividend(bytes32 policyId, int256 deltaCashValue)
        external
        onlyAuthorized
        policyExists(policyId)
    {
        PolicyLoanState storage p = policies[policyId];
        if (deltaCashValue > 0) {
            p.cashValue += uint256(deltaCashValue);
        } else if (deltaCashValue < 0) {
            uint256 absDelta = uint256(-deltaCashValue);
            require(p.cashValue >= absDelta, "PolicyLoanVault: cash value cannot drop below 0");
            p.cashValue -= absDelta;
        }

        emit DividendAdjusted(policyId, deltaCashValue, p.cashValue);

        _accrueInterest(policyId);
        uint256 currentLtvBps = calculateLTV(policyId);
        _checkLtvThresholds(policyId, currentLtvBps);
    }

    /**
     * @notice Update policy cash surrender value (e.g. from carrier data import).
     */
    function updateCashValue(bytes32 policyId, uint256 newCashValue)
        external
        onlyAuthorized
        policyExists(policyId)
    {
        require(newCashValue > 0, "PolicyLoanVault: cash value must be > 0");
        PolicyLoanState storage p = policies[policyId];
        uint256 oldCashValue = p.cashValue;
        p.cashValue = newCashValue;

        emit CashValueUpdated(policyId, oldCashValue, newCashValue);

        uint256 currentLtvBps = calculateLTV(policyId);
        _checkLtvThresholds(policyId, currentLtvBps);
    }

    /**
     * @notice Freeze draws during collateral deterioration or risk alerts.
     */
    function setDrawsFrozen(bytes32 policyId, bool frozen, string calldata reason)
        external
        onlyAuthorized
        policyExists(policyId)
    {
        PolicyLoanState storage p = policies[policyId];
        p.isDrawsFrozen = frozen;
        if (frozen) {
            emit DrawsFrozen(policyId, reason);
        } else {
            emit DrawsUnfrozen(policyId);
        }
    }

    // --- View & Calculation Functions ---

    /**
     * @notice Calculate current policy-loan Loan-to-Value (LTV) ratio in Basis Points (10000 = 100%).
     */
    function calculateLTV(bytes32 policyId)
        public
        view
        policyExists(policyId)
        returns (uint256 ltvBps)
    {
        PolicyLoanState memory p = policies[policyId];
        if (p.cashValue == 0) return BPS_DENOMINATOR * 100; // Infinity representation
        uint256 pendingInterest = _calculatePendingInterest(p);
        uint256 totalDebt = p.loanBalance + p.accruedInterest + pendingInterest;
        return (totalDebt * BPS_DENOMINATOR) / p.cashValue;
    }

    /**
     * @notice Evaluate policy lapse conditions.
     */
    function checkLapseCondition(bytes32 policyId)
        public
        view
        policyExists(policyId)
        returns (bool isLapsed, string memory reason)
    {
        PolicyLoanState memory p = policies[policyId];
        if (p.isLapsed) {
            return (true, "Already marked lapsed");
        }

        uint256 pendingInterest = _calculatePendingInterest(p);
        uint256 totalDebt = p.loanBalance + p.accruedInterest + pendingInterest;

        if (totalDebt >= p.cashValue) {
            return (true, "Total debt exceeds cash value");
        }

        if (p.missedPremiumCount >= DEFAULT_MAX_MISSED_PREMIUMS) {
            return (true, "Missed premium limit exceeded");
        }

        uint256 currentLtvBps = (totalDebt * BPS_DENOMINATOR) / p.cashValue;
        if (currentLtvBps >= p.hardLtvCeilingBps) {
            return (true, "Hard LTV ceiling breached");
        }

        return (false, "Policy compliant");
    }

    function getDrawHistory(bytes32 policyId) external view returns (bytes32[] memory) {
        return policyDraws[policyId];
    }

    function getDeploymentHistory(bytes32 policyId) external view returns (bytes32[] memory) {
        return policyDeployments[policyId];
    }

    // --- Internal Helpers ---

    function _accrueInterest(bytes32 policyId) internal returns (uint256 interestAccrued) {
        PolicyLoanState storage p = policies[policyId];
        if (p.loanBalance == 0) {
            p.lastInterestAccrualTimestamp = block.timestamp;
            return 0;
        }

        interestAccrued = _calculatePendingInterest(p);
        if (interestAccrued > 0) {
            p.accruedInterest += interestAccrued;
            p.lastInterestAccrualTimestamp = block.timestamp;

            emit InterestAccrued(
                policyId,
                interestAccrued,
                p.accruedInterest,
                p.loanBalance + p.accruedInterest
            );
        }
        return interestAccrued;
    }

    function _calculatePendingInterest(PolicyLoanState memory p)
        internal
        view
        returns (uint256)
    {
        if (p.loanBalance == 0 || block.timestamp <= p.lastInterestAccrualTimestamp) {
            return 0;
        }
        uint256 elapsed = block.timestamp - p.lastInterestAccrualTimestamp;
        // Simple linear accrual per second: (Balance * RateBps * Elapsed) / (365d * 10000)
        return (p.loanBalance * p.annualInterestRateBps * elapsed) / (SECONDS_PER_YEAR * BPS_DENOMINATOR);
    }

    function _checkLtvThresholds(bytes32 policyId, uint256 currentLtvBps) internal {
        PolicyLoanState storage p = policies[policyId];

        if (currentLtvBps >= p.hardLtvCeilingBps) {
            p.isDrawsFrozen = true;
            emit HardLtvCeilingBreached(policyId, currentLtvBps, p.hardLtvCeilingBps);
            emit DrawsFrozen(policyId, "Hard LTV ceiling breached");
            _checkAndSetLapse(policyId, "Hard LTV ceiling breached");
        } else if (currentLtvBps >= p.softLtvThresholdBps) {
            p.isDrawsFrozen = true;
            emit SoftLtvThresholdBreached(policyId, currentLtvBps, p.softLtvThresholdBps);
            emit DrawsFrozen(policyId, "Soft LTV warning threshold breached");
        }
    }

    function _checkAndSetLapse(bytes32 policyId, string memory reason) internal {
        PolicyLoanState storage p = policies[policyId];
        if (!p.isLapsed) {
            p.isLapsed = true;
            p.isDrawsFrozen = true;
            emit LapseConditionDetected(
                policyId,
                p.loanBalance + p.accruedInterest,
                p.cashValue,
                reason
            );
        }
    }

    function _getPhaseMaxLtv(PolicyPhase phase, uint256 defaultCeilingBps)
        internal
        pure
        returns (uint256)
    {
        if (phase == PolicyPhase.Origination) {
            return defaultCeilingBps > 7000 ? 7000 : defaultCeilingBps; // Max 70% in origination
        } else if (phase == PolicyPhase.Seasoned) {
            return defaultCeilingBps > 8000 ? 8000 : defaultCeilingBps; // Max 80% in seasoned
        }
        return defaultCeilingBps; // Max per contract setting in mature phase
    }
}
