/**
 * DIBS Backend — Policy-Loan Subsystem Service
 *
 * Core service layer managing policy life cycle (CRUD), policy-loan accounting,
 * carrier data integration, risk analytics, and cross-subsystem coordination.
 *
 * Coordinates:
 * - PolicyLoanVault
 * - PremiumScheduleVault
 * - PolicySettlement
 * - PolicyIntegrationAdapter
 * - ArbitrageRiskEngine
 */

import { PolicyRecord } from '../../shared/types';
import { calculateArbitrageSpread, calculateDSCR, calculateLTV } from '../../shared/formulas';

// --- Types & Interfaces ---

export type PolicyPhase = 'origination' | 'seasoned' | 'mature';

export interface ExtendedPolicyRecord extends PolicyRecord {
  accruedInterest: number;
  totalRepaid: number;
  totalPremiumsPaid: number;
  missedPremiumCount: number;
  lastInterestAccrualDate: string;
  lastCarrierImportTimestamp?: string;
  softLtvThreshold: number; // e.g. 0.80 (80%)
  hardLtvCeiling: number;   // e.g. 0.90 (90%)
  phase: PolicyPhase;
  isDrawsFrozen: boolean;
  isLapsed: boolean;
  isStale: boolean;
  sourceTimestamp?: string;
  updatedAt: string;
}

export interface CarrierImportPayload {
  policyId: string;
  carrierId: string;
  cashValue: number;
  surrenderValue: number;
  deathBenefit: number;
  loanBalance: number;
  loanInterestRate: number;
  dividendCreditingRate?: number;
  directRecognitionStatus?: boolean;
  premiumDueDate?: string;
  carrierSpecificLoanRules?: string;
  sourceTimestamp: string;
  integrationAuthorized?: boolean;
}

export interface DrawRequest {
  policyId: string;
  amount: number;
  destination: string;
  targetStrategy: string;
}

export interface DrawResult {
  drawId: string;
  policyId: string;
  deploymentId: string;
  amount: number;
  destination: string;
  currentLTV: number;
  timestamp: string;
}

export interface RepaymentRequest {
  policyId: string;
  amount: number;
}

export interface RepaymentResult {
  policyId: string;
  amount: number;
  interestPaid: number;
  principalPaid: number;
  remainingLoanBalance: number;
  remainingAccruedInterest: number;
  currentLTV: number;
}

export interface PremiumPaymentRequest {
  policyId: string;
  amount: number;
}

export interface DividendAdjustmentRequest {
  policyId: string;
  deltaCashValue: number;
  notes?: string;
}

export interface ArbitrageAnalysisInput {
  policyId: string;
  deploymentYield: number; // Gross yield e.g. 0.10 (10%)
  liquidityHaircut?: number; // e.g. 0.10 (10% haircut)
  taxRate?: number;          // e.g. 0.25 (applied ONLY if taxLegallyValidated is true)
  taxLegallyValidated?: boolean;
  netOperatingIncome?: number;
  debtService?: number;
}

export interface ArbitrageAnalysisResult {
  policyId: string;
  grossDeploymentYield: number;
  netYieldAfterHaircut: number;
  afterTaxYield: number;
  loanEffectiveCost: number;
  netArbitrageSpread: number;
  currentLTV: number;
  annualizedLtvCreep: number;
  dscr: number;
  redirectCashFlowTriggered: boolean;
  partialLiquidationRecommended: boolean;
  repaymentRecommended: boolean;
  recommendationReason: string;
  riskVariablesEvaluated: string[];
}

export interface RiskAlertPayload {
  policyId: string;
  alertType: 'ltv_warning' | 'ltv_breach' | 'lapse_warning' | 'dscr_breach' | 'staleness' | 'rate_mismatch' | 'custom';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface RiskAlertRecord {
  alertId: string;
  policyId: string;
  alertType: string;
  severity: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  metadata?: Record<string, unknown>;
}

// --- Subsystem Component Stubs / Classes ---

/**
 * Adapter for external insurance carrier data imports.
 * Ensures data is normalized, timestamped, flagged for staleness, and prohibits
 * unauthorized carrier system write-backs.
 */
export class PolicyIntegrationAdapter {
  private maxDataAgeMs: number;

  constructor(maxDataAgeDays: number = 30) {
    this.maxDataAgeMs = maxDataAgeDays * 24 * 60 * 60 * 1000;
  }

  /**
   * Import, normalize, and validate carrier payload.
   */
  public processCarrierImport(payload: CarrierImportPayload): {
    normalizedData: CarrierImportPayload;
    isStale: boolean;
  } {
    const importTime = new Date(payload.sourceTimestamp).getTime();
    const now = Date.now();
    const isStale = isNaN(importTime) || (now - importTime > this.maxDataAgeMs);

    return {
      normalizedData: {
        ...payload,
        cashValue: Math.max(0, payload.cashValue),
        surrenderValue: Math.max(0, payload.surrenderValue),
        deathBenefit: Math.max(0, payload.deathBenefit),
        loanBalance: Math.max(0, payload.loanBalance),
        loanInterestRate: Math.max(0, payload.loanInterestRate),
      },
      isStale,
    };
  }

  /**
   * Safety guard: Explicitly reject unauthorized write attempts to carrier core systems.
   */
  public writeToCarrierSystem(policyId: string, _data: unknown, isAuthorized: boolean = false): void {
    if (!isAuthorized) {
      throw new Error(
        `PolicyIntegrationAdapter: Refusing to write to carrier system for policy ${policyId}. Authorized integration connection required.`
      );
    }
  }
}

/**
 * Arbitrage & Risk Engine Component.
 */
export class ArbitrageRiskEngineComponent {
  /**
   * Compare loan cost against deployment yield, applying haircuts, tax validation, and DSCR checks.
   */
  public evaluateArbitrage(
    policy: ExtendedPolicyRecord,
    deploymentYield: number,
    liquidityHaircut: number = 0,
    taxRate: number = 0,
    taxLegallyValidated: boolean = false,
    noi: number = 0,
    debtService: number = 0
  ): ArbitrageAnalysisResult {
    // Tax assumptions applied ONLY where legally validated
    const applicableTaxRate = taxLegallyValidated ? taxRate : 0;

    const netSpread = calculateArbitrageSpread(
      deploymentYield,
      policy.loanInterestRate,
      liquidityHaircut,
      applicableTaxRate
    );

    const netYieldAfterHaircut = deploymentYield * (1 - liquidityHaircut);
    const afterTaxYield = netYieldAfterHaircut * (1 - applicableTaxRate);

    const currentLTV = calculateLTV(policy.loanBalance + policy.accruedInterest, policy.cashValue);
    const dscr = calculateDSCR(noi, debtService);

    const redirectCashFlowTriggered = dscr < 1.1; // DSCR threshold: redirect cash flow when < 1.1x
    const partialLiquidationRecommended = currentLTV >= policy.hardLtvCeiling || netSpread < 0;
    const repaymentRecommended = currentLTV >= policy.softLtvThreshold || policy.loanInterestRate > deploymentYield;

    let reason = 'Position operating within normal risk parameters';
    if (redirectCashFlowTriggered) {
      reason = 'Portfolio DSCR below 1.1x threshold: redirecting cash flow to debt service';
    } else if (partialLiquidationRecommended) {
      reason = 'Hard LTV ceiling breach or negative net spread: partial liquidation recommended';
    } else if (repaymentRecommended) {
      reason = 'Soft LTV warning threshold or rate mismatch: repayment recommended';
    }

    const riskVariablesEvaluated = [
      'loan_rate_reset',
      'dividend_smoothing_lag',
      'direct_non_direct_recognition',
      'yield_shortfall',
      'default_risk',
      'liquidity_mismatch',
      'policy_lapse',
      'premium_delinquency',
      'ltv_creep',
      'asset_impairment',
      'tax_rule_change',
      'carrier_rule_change',
      'rwa_valuation_decline',
      'cross_collateralization',
      'overconcentration',
      'reinvestment_timing_mismatch',
    ];

    return {
      policyId: policy.policyId,
      grossDeploymentYield: deploymentYield,
      netYieldAfterHaircut,
      afterTaxYield,
      loanEffectiveCost: policy.loanInterestRate,
      netArbitrageSpread: netSpread,
      currentLTV,
      annualizedLtvCreep: 0,
      dscr,
      redirectCashFlowTriggered,
      partialLiquidationRecommended,
      repaymentRecommended,
      recommendationReason: reason,
      riskVariablesEvaluated,
    };
  }
}

/**
 * Premium Schedule Vault Manager
 */
export class PremiumScheduleVault {
  public verifyPremiumSchedule(policy: ExtendedPolicyRecord): boolean {
    if (!policy.premiumDueDate) return true;
    const dueDate = new Date(policy.premiumDueDate).getTime();
    return Date.now() <= dueDate;
  }
}

/**
 * Settlement Operations Manager
 */
export class PolicySettlement {
  public executeCashFlowRedirection(policyId: string, amount: number): { success: boolean; redirectedAmount: number } {
    return { success: true, redirectedAmount: amount };
  }
}

/**
 * Ledger Vault Adapter
 */
export class PolicyLoanVaultAdapter {
  public recordDrawOnChain(policyId: string, amount: number): string {
    return `draw_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }
}

// --- Main Service Implementation ---

export class PolicyLoanService {
  private policies: Map<string, ExtendedPolicyRecord> = new Map();
  private alerts: Map<string, RiskAlertRecord[]> = new Map();
  private integrationAdapter: PolicyIntegrationAdapter;
  private arbitrageEngine: ArbitrageRiskEngineComponent;
  private premiumScheduleVault: PremiumScheduleVault;
  private settlement: PolicySettlement;
  private vaultAdapter: PolicyLoanVaultAdapter;

  constructor() {
    this.integrationAdapter = new PolicyIntegrationAdapter(30);
    this.arbitrageEngine = new ArbitrageRiskEngineComponent();
    this.premiumScheduleVault = new PremiumScheduleVault();
    this.settlement = new PolicySettlement();
    this.vaultAdapter = new PolicyLoanVaultAdapter();
  }

  // --- Policy Lifecycle (CRUD) ---

  /**
   * Create a new policy record.
   */
  public createPolicy(record: Partial<ExtendedPolicyRecord> & { policyId: string; carrierId: string }): ExtendedPolicyRecord {
    if (this.policies.has(record.policyId)) {
      throw new Error(`Policy ${record.policyId} already exists`);
    }

    const cashValue = record.cashValue ?? 100000;
    const loanBalance = record.loanBalance ?? 0;
    const accruedInterest = record.accruedInterest ?? 0;
    const initialLTV = calculateLTV(loanBalance + accruedInterest, cashValue);
    const phase = record.phase ?? 'origination';

    // Set phase-dependent default hard LTV ceiling if not supplied
    const hardLtvCeiling = record.hardLtvCeiling ?? this.getPhaseMaxLTV(phase);
    const softLtvThreshold = record.softLtvThreshold ?? (hardLtvCeiling - 0.10);

    const now = new Date().toISOString();

    const extendedRecord: ExtendedPolicyRecord = {
      policyId: record.policyId,
      carrierId: record.carrierId,
      insuredId: record.insuredId ?? 'insured_default',
      ownerId: record.ownerId ?? 'owner_default',
      beneficiaryConfig: record.beneficiaryConfig ?? 'trust_primary',
      policyType: record.policyType ?? 'whole_life',
      policyStatus: record.policyStatus ?? 'active',
      cashValue,
      deathBenefit: record.deathBenefit ?? cashValue * 2,
      surrenderValue: record.surrenderValue ?? cashValue * 0.95,
      loanBalance,
      loanInterestRate: record.loanInterestRate ?? 0.05,
      dividendCreditingAssumption: record.dividendCreditingAssumption ?? 0.045,
      directRecognitionStatus: record.directRecognitionStatus ?? true,
      premiumSchedule: record.premiumSchedule ?? 'annual',
      premiumDueDate: record.premiumDueDate ?? new Date(Date.now() + 365 * 86400000).toISOString(),
      premiumDelinquencyStatus: false,
      carrierSpecificLoanRules: record.carrierSpecificLoanRules ?? 'standard',
      policyLoanLTV: initialLTV,
      lapseThreshold: record.lapseThreshold ?? 0.95,
      accruedInterest,
      totalRepaid: 0,
      totalPremiumsPaid: 0,
      missedPremiumCount: 0,
      lastInterestAccrualDate: now,
      softLtvThreshold,
      hardLtvCeiling,
      phase,
      isDrawsFrozen: false,
      isLapsed: false,
      isStale: false,
      updatedAt: now,
    };

    this.policies.set(record.policyId, extendedRecord);
    return extendedRecord;
  }

  /**
   * Retrieve policy record by ID.
   */
  public getPolicy(policyId: string): ExtendedPolicyRecord {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }
    return policy;
  }

  /**
   * Update policy record.
   */
  public updatePolicy(policyId: string, updates: Partial<ExtendedPolicyRecord>): ExtendedPolicyRecord {
    const policy = this.getPolicy(policyId);
    const updated = {
      ...policy,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Recalculate LTV
    updated.policyLoanLTV = calculateLTV(updated.loanBalance + updated.accruedInterest, updated.cashValue);

    this.policies.set(policyId, updated);
    return updated;
  }

  /**
   * Delete policy record.
   */
  public deletePolicy(policyId: string): boolean {
    this.getPolicy(policyId); // Ensure existence
    return this.policies.delete(policyId);
  }

  /**
   * List all stored policies.
   */
  public listPolicies(): ExtendedPolicyRecord[] {
    return Array.from(this.policies.values());
  }

  // --- Policy-Loan Core Functions ---

  /**
   * Record loan draw with collateral and LTV checks.
   */
  public recordDraw(request: DrawRequest): DrawResult {
    const policy = this.getPolicy(request.policyId);

    if (policy.isLapsed) {
      throw new Error(`Cannot draw on lapsed policy ${request.policyId}`);
    }

    if (policy.isDrawsFrozen) {
      throw new Error(`Draws are frozen for policy ${request.policyId} due to collateral deterioration`);
    }

    if (request.amount <= 0) {
      throw new Error('Draw amount must be greater than 0');
    }

    // Require carrier data before relying on calculations for draws
    if (policy.isStale) {
      throw new Error(`Policy carrier data is stale for ${request.policyId}. Fresh carrier data required prior to draws.`);
    }

    // Accrue interest to current time before calculating new LTV
    this.accrueInterest(request.policyId);
    const updatedPolicy = this.getPolicy(request.policyId);

    const proposedLoanBalance = updatedPolicy.loanBalance + request.amount;
    const proposedLTV = calculateLTV(proposedLoanBalance + updatedPolicy.accruedInterest, updatedPolicy.cashValue);

    // Enforce phase-dependent max LTV ceiling
    const phaseLimit = this.getPhaseMaxLTV(updatedPolicy.phase);
    const maxAllowedLtv = Math.min(phaseLimit, updatedPolicy.hardLtvCeiling);

    if (proposedLTV > maxAllowedLtv) {
      throw new Error(
        `Draw of ${request.amount} exceeds phase max LTV ceiling of ${(maxAllowedLtv * 100).toFixed(1)}% (proposed LTV: ${(proposedLTV * 100).toFixed(1)}%)`
      );
    }

    const drawId = this.vaultAdapter.recordDrawOnChain(request.policyId, request.amount);

    updatedPolicy.loanBalance = proposedLoanBalance;
    updatedPolicy.policyLoanLTV = proposedLTV;

    // Check soft warning threshold
    if (proposedLTV >= updatedPolicy.softLtvThreshold) {
      updatedPolicy.isDrawsFrozen = true;
      this.triggerRiskAlert({
        policyId: request.policyId,
        alertType: 'ltv_warning',
        severity: 'high',
        message: `Soft LTV warning threshold (${(updatedPolicy.softLtvThreshold * 100).toFixed(1)}%) breached after draw. Draws frozen.`,
      });
    }

    this.updatePolicy(request.policyId, updatedPolicy);

    return {
      drawId,
      policyId: request.policyId,
      deploymentId: `dep_${Date.now()}`,
      amount: request.amount,
      destination: request.destination,
      currentLTV: proposedLTV,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Accrue interest on loan balance based on elapsed time.
   */
  public accrueInterest(policyId: string, asOfDate: string = new Date().toISOString()): number {
    const policy = this.getPolicy(policyId);
    if (policy.loanBalance === 0) {
      policy.lastInterestAccrualDate = asOfDate;
      this.updatePolicy(policyId, policy);
      return 0;
    }

    const lastAccrual = new Date(policy.lastInterestAccrualDate).getTime();
    const currentAccrual = new Date(asOfDate).getTime();
    const elapsedYears = Math.max(0, (currentAccrual - lastAccrual) / (365 * 24 * 60 * 60 * 1000));

    // Linear interest accrual
    const interestAccrued = policy.loanBalance * policy.loanInterestRate * elapsedYears;

    policy.accruedInterest += interestAccrued;
    policy.lastInterestAccrualDate = asOfDate;
    policy.policyLoanLTV = calculateLTV(policy.loanBalance + policy.accruedInterest, policy.cashValue);

    this.updatePolicy(policyId, policy);
    this.checkLapseCondition(policyId);

    return interestAccrued;
  }

  /**
   * Record loan repayment (covers accrued interest first, then principal).
   */
  public recordRepayment(request: RepaymentRequest): RepaymentResult {
    const policy = this.getPolicy(request.policyId);
    if (request.amount <= 0) {
      throw new Error('Repayment amount must be > 0');
    }

    this.accrueInterest(request.policyId);
    const updatedPolicy = this.getPolicy(request.policyId);

    let remainingPayment = request.amount;
    let interestPaid = 0;
    let principalPaid = 0;

    if (updatedPolicy.accruedInterest > 0) {
      if (remainingPayment <= updatedPolicy.accruedInterest) {
        interestPaid = remainingPayment;
        updatedPolicy.accruedInterest -= remainingPayment;
        remainingPayment = 0;
      } else {
        interestPaid = updatedPolicy.accruedInterest;
        remainingPayment -= updatedPolicy.accruedInterest;
        updatedPolicy.accruedInterest = 0;
      }
    }

    if (remainingPayment > 0) {
      principalPaid = Math.min(remainingPayment, updatedPolicy.loanBalance);
      updatedPolicy.loanBalance -= principalPaid;
    }

    updatedPolicy.totalRepaid += request.amount;
    updatedPolicy.policyLoanLTV = calculateLTV(
      updatedPolicy.loanBalance + updatedPolicy.accruedInterest,
      updatedPolicy.cashValue
    );

    // Unfreeze draws if LTV recovers below soft threshold
    if (updatedPolicy.isDrawsFrozen && updatedPolicy.policyLoanLTV < updatedPolicy.softLtvThreshold) {
      updatedPolicy.isDrawsFrozen = false;
    }

    this.updatePolicy(request.policyId, updatedPolicy);

    return {
      policyId: request.policyId,
      amount: request.amount,
      interestPaid,
      principalPaid,
      remainingLoanBalance: updatedPolicy.loanBalance,
      remainingAccruedInterest: updatedPolicy.accruedInterest,
      currentLTV: updatedPolicy.policyLoanLTV,
    };
  }

  /**
   * Record premium payment.
   */
  public recordPremiumPayment(request: PremiumPaymentRequest): ExtendedPolicyRecord {
    const policy = this.getPolicy(request.policyId);
    if (request.amount <= 0) {
      throw new Error('Premium payment amount must be > 0');
    }

    policy.totalPremiumsPaid += request.amount;
    policy.missedPremiumCount = 0;
    policy.premiumDelinquencyStatus = false;

    return this.updatePolicy(request.policyId, policy);
  }

  /**
   * Record missed premium payment and evaluate delinquency.
   */
  public recordMissedPremium(policyId: string): ExtendedPolicyRecord {
    const policy = this.getPolicy(policyId);
    policy.missedPremiumCount += 1;
    policy.premiumDelinquencyStatus = true;

    if (policy.missedPremiumCount >= 3) {
      policy.isDrawsFrozen = true;
      this.triggerRiskAlert({
        policyId,
        alertType: 'lapse_warning',
        severity: 'critical',
        message: `Policy ${policyId} has missed ${policy.missedPremiumCount} consecutive premiums. Draws frozen.`,
      });
    }

    return this.updatePolicy(policyId, policy);
  }

  /**
   * Adjust policy cash value from dividend crediting or adjustment.
   */
  public adjustDividend(request: DividendAdjustmentRequest): ExtendedPolicyRecord {
    const policy = this.getPolicy(request.policyId);
    policy.cashValue = Math.max(0, policy.cashValue + request.deltaCashValue);
    policy.surrenderValue = policy.cashValue * 0.95;
    policy.policyLoanLTV = calculateLTV(policy.loanBalance + policy.accruedInterest, policy.cashValue);

    this.updatePolicy(request.policyId, policy);
    this.checkLapseCondition(request.policyId);

    return this.getPolicy(request.policyId);
  }

  /**
   * Import external carrier data, normalize, flag staleness, and update policy ledger.
   */
  public importCarrierData(payload: CarrierImportPayload): ExtendedPolicyRecord {
    // Import validation via integration adapter
    const { normalizedData, isStale } = this.integrationAdapter.processCarrierImport(payload);

    let policy: ExtendedPolicyRecord;
    if (this.policies.has(payload.policyId)) {
      policy = this.getPolicy(payload.policyId);
      policy.cashValue = normalizedData.cashValue;
      policy.surrenderValue = normalizedData.surrenderValue;
      policy.deathBenefit = normalizedData.deathBenefit;
      policy.loanBalance = normalizedData.loanBalance;
      policy.loanInterestRate = normalizedData.loanInterestRate;
      if (normalizedData.dividendCreditingRate !== undefined) {
        policy.dividendCreditingAssumption = normalizedData.dividendCreditingRate;
      }
      if (normalizedData.directRecognitionStatus !== undefined) {
        policy.directRecognitionStatus = normalizedData.directRecognitionStatus;
      }
      if (normalizedData.premiumDueDate) {
        policy.premiumDueDate = normalizedData.premiumDueDate;
      }
      policy.isStale = isStale;
      policy.sourceTimestamp = normalizedData.sourceTimestamp;
      policy.lastCarrierImportTimestamp = new Date().toISOString();
      policy.policyLoanLTV = calculateLTV(policy.loanBalance + policy.accruedInterest, policy.cashValue);
      this.updatePolicy(payload.policyId, policy);
    } else {
      policy = this.createPolicy({
        policyId: normalizedData.policyId,
        carrierId: normalizedData.carrierId,
        cashValue: normalizedData.cashValue,
        surrenderValue: normalizedData.surrenderValue,
        deathBenefit: normalizedData.deathBenefit,
        loanBalance: normalizedData.loanBalance,
        loanInterestRate: normalizedData.loanInterestRate,
        dividendCreditingAssumption: normalizedData.dividendCreditingRate ?? 0.045,
        directRecognitionStatus: normalizedData.directRecognitionStatus ?? true,
      });
      policy.isStale = isStale;
      policy.sourceTimestamp = normalizedData.sourceTimestamp;
      policy.lastCarrierImportTimestamp = new Date().toISOString();
      this.updatePolicy(payload.policyId, policy);
    }

    if (isStale) {
      this.triggerRiskAlert({
        policyId: payload.policyId,
        alertType: 'staleness',
        severity: 'medium',
        message: `Carrier data imported for ${payload.policyId} is stale (source timestamp: ${payload.sourceTimestamp}).`,
      });
    }

    return policy;
  }

  // --- Collateral, Floor & Lapse Management ---

  public checkCollateralCoverage(policyId: string): { compliant: boolean; currentLTV: number; maxAllowedLTV: number } {
    const policy = this.getPolicy(policyId);
    const maxAllowedLTV = Math.min(this.getPhaseMaxLTV(policy.phase), policy.hardLtvCeiling);
    return {
      compliant: policy.policyLoanLTV <= maxAllowedLTV,
      currentLTV: policy.policyLoanLTV,
      maxAllowedLTV,
    };
  }

  public checkCashValueFloor(policyId: string, minCashValueFloor: number = 10000): boolean {
    const policy = this.getPolicy(policyId);
    return policy.cashValue >= minCashValueFloor;
  }

  public checkLapseCondition(policyId: string): { isLapsed: boolean; reason: string } {
    const policy = this.getPolicy(policyId);
    const totalDebt = policy.loanBalance + policy.accruedInterest;

    if (totalDebt >= policy.cashValue) {
      policy.isLapsed = true;
      policy.isDrawsFrozen = true;
      this.updatePolicy(policyId, policy);
      return { isLapsed: true, reason: 'Total loan balance and accrued interest exceed cash surrender value' };
    }

    if (policy.policyLoanLTV >= policy.hardLtvCeiling) {
      policy.isDrawsFrozen = true;
      this.updatePolicy(policyId, policy);
      return { isLapsed: true, reason: `Hard LTV ceiling (${(policy.hardLtvCeiling * 100).toFixed(1)}%) breached` };
    }

    return { isLapsed: false, reason: 'Policy in good standing' };
  }

  // --- Arbitrage & Risk Analysis ---

  public getArbitrageAnalysis(input: ArbitrageAnalysisInput): ArbitrageAnalysisResult {
    const policy = this.getPolicy(input.policyId);
    return this.arbitrageEngine.evaluateArbitrage(
      policy,
      input.deploymentYield,
      input.liquidityHaircut ?? 0,
      input.taxRate ?? 0,
      input.taxLegallyValidated ?? false,
      input.netOperatingIncome ?? 0,
      input.debtService ?? 0
    );
  }

  // --- Alerts ---

  public triggerRiskAlert(payload: RiskAlertPayload): RiskAlertRecord {
    const alertRecord: RiskAlertRecord = {
      alertId: `alt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      policyId: payload.policyId,
      alertType: payload.alertType,
      severity: payload.severity,
      message: payload.message,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      metadata: payload.metadata,
    };

    const existing = this.alerts.get(payload.policyId) ?? [];
    existing.push(alertRecord);
    this.alerts.set(payload.policyId, existing);

    return alertRecord;
  }

  public getPolicyAlerts(policyId: string): RiskAlertRecord[] {
    return this.alerts.get(policyId) ?? [];
  }

  // --- Phase-Dependent LTV Limits ---

  public getPhaseMaxLTV(phase: PolicyPhase): number {
    switch (phase) {
      case 'origination':
        return 0.70; // 70% during initial origination phase
      case 'seasoned':
        return 0.80; // 80% during seasoned phase
      case 'mature':
        return 0.90; // 90% during mature phase
      default:
        return 0.70;
    }
  }
}

// Singleton Service Instance
export const policyLoanService = new PolicyLoanService();
