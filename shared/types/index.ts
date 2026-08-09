/**
 * DIBS Shared — Core Type Definitions
 *
 * Shared types used across contracts, backend, and frontend.
 * All types must be versioned.
 */

// === Capital Authorization ===
export type CapitalRequestState =
  | 'pending'
  | 'evidence_submission'
  | 'validation'
  | 'approval'
  | 'approved_for_release'
  | 'held'
  | 'rejected'
  | 'escalated'
  | 'settled'
  | 'settlement_exception';

export interface CapitalRequest {
  requestId: string;
  borrowerOrSponsorId: string;
  projectId: string;
  spvId: string;
  requestedAmount: number;
  requestedPaymentDate: string;
  paymentDestination: string;
  drawCategory: string;
  supportingInvoiceSet: string[];
  milestoneId: string;
  covenantDependencies: string[];
  collateralDependencies: string[];
  requiredApproverList: string[];
  currentState: CapitalRequestState;
  policyVersion: string;
  tenantId: string;
}

// === Authorization ===
export interface AuthorizationRecord {
  authorizerIdentity: string;
  authorizationRole: string;
  authorizationTimestamp: string;
  signedPayloadHash: string;
  applicablePolicyVersion: string;
  decisionType: 'approve' | 'hold' | 'reject' | 'escalate';
  decisionRationale: string;
  scopeOfAuthorization: string;
  authorizationExpiry: string;
  revocationState: 'active' | 'revoked' | 'expired';
}

// === Evidence ===
export type EvidenceClass =
  | 'construction_photo'
  | 'inspection_report'
  | 'invoice'
  | 'contract'
  | 'change_order'
  | 'lien_waiver'
  | 'title_update'
  | 'insurance_verification'
  | 'borrower_representation'
  | 'vendor_validation'
  | 'appraisal'
  | 'draw_budget_reconciliation'
  | 'bank_account_validation'
  | 'collateral_value_documentation'
  | 'covenant_compliance_attestation'
  | 'third_party_inspection'
  | 'authorized_signatory_verification'
  | 'kyc_documentation';

export interface EvidenceObject {
  evidenceId: string;
  evidenceClass: EvidenceClass;
  documentHash: string;
  issuerIdentity: string;
  projectAssociation: string;
  milestoneAssociation: string;
  submissionTimestamp: string;
  expirationDate: string;
  validationStatus: 'pending' | 'validated' | 'flagged' | 'expired';
  flags: string[];
}

// === Covenant ===
export type CovenantState = 'compliant' | 'warning' | 'breached' | 'cure_period' | 'waived' | 'default';

export type CovenantCategory =
  | 'loan_to_value'
  | 'debt_service_coverage_ratio'
  | 'debt_yield'
  | 'minimum_liquidity'
  | 'construction_budget_variance'
  | 'completion_date_variance'
  | 'interest_reserve_sufficiency'
  | 'insurance_coverage'
  | 'property_tax_status'
  | 'lien_status'
  | 'title_status'
  | 'occupancy_threshold'
  | 'revenue_threshold'
  | 'sponsor_net_worth'
  | 'guarantor_liquidity'
  | 'collateral_concentration'
  | 'portfolio_leverage'
  | 'policy_loan_collateral_coverage'
  | 'asset_valuation_freshness'
  | 'reporting_cadence'
  | 'restricted_payment_limitation'
  | 'distribution_lockup'
  | 'refinance_restriction'
  | 'cross_default';

// === Collateral ===
export interface CollateralRecord {
  assetId: string;
  assetType: string;
  jurisdiction: string;
  lienTier: number;
  titleStatus: string;
  ownershipEntity: string;
  appraisalValue: number;
  municipalValuation: number;
  valuationDate: string;
  valuationProvider: string;
  ltvMetric: number;
  debtBalance: number;
  seniorLiens: number;
  juniorLiens: number;
  uccFilings: boolean;
  taxLiens: boolean;
  mechanicsLiens: boolean;
  insuranceStatus: string;
  hazardExposure: string;
  occupancyStatus: string;
  projectCompletionStatus: string;
  requiredRemediationStatus: string;
}

// === Tranche ===
export type TrancheClass = 'sentinel' | 'catalyst';

export interface TrancheState {
  navSentinel: number;
  navCatalyst: number;
  juniorRatio: number;
  minJuniorRatio: number;
  capitalPreservationMode: boolean;
  reserveBalance: number;
  reserveShortfall: number;
  withdrawalQueueLength: number;
  liquidityState: 'healthy' | 'constrained' | 'restricted';
  strategyHealth: 'normal' | 'degraded' | 'critical';
  oracleState: 'fresh' | 'stale' | 'failed';
}

// === Policy Loan ===
export interface PolicyRecord {
  policyId: string;
  carrierId: string;
  insuredId: string;
  ownerId: string;
  beneficiaryConfig: string;
  policyType: string;
  policyStatus: string;
  cashValue: number;
  deathBenefit: number;
  surrenderValue: number;
  loanBalance: number;
  loanInterestRate: number;
  dividendCreditingAssumption: number;
  directRecognitionStatus: boolean;
  premiumSchedule: string;
  premiumDueDate: string;
  premiumDelinquencyStatus: boolean;
  carrierSpecificLoanRules: string;
  policyLoanLTV: number;
  lapseThreshold: number;
}

// === Trust Signals (VRDCT) ===
export interface TrustSignal {
  signalId: string;
  signalType: 'counterparty' | 'project';
  signalName: string;
  value: number;
  dataSource: string;
  consentStatus: boolean;
  refreshDate: string;
  calculationVersion: string;
  reasonCodes: string[];
}
