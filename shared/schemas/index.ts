/**
 * DIBS Shared — JSON Schemas
 *
 * Validation schemas for all DIBS entities. Used by backend, frontend, and contract ABIs.
 */

export const capitalRequestSchema = {
  type: 'object',
  required: ['requestId', 'borrowerOrSponsorId', 'projectId', 'requestedAmount', 'requestedPaymentDate', 'paymentDestination', 'drawCategory', 'currentState', 'tenantId'],
  properties: {
    requestId: { type: 'string', format: 'uuid' },
    borrowerOrSponsorId: { type: 'string' },
    projectId: { type: 'string' },
    spvId: { type: 'string' },
    requestedAmount: { type: 'number', minimum: 0 },
    requestedPaymentDate: { type: 'string', format: 'date-time' },
    paymentDestination: { type: 'string' },
    drawCategory: { type: 'string' },
    supportingInvoiceSet: { type: 'array', items: { type: 'string' } },
    milestoneId: { type: 'string' },
    covenantDependencies: { type: 'array', items: { type: 'string' } },
    collateralDependencies: { type: 'array', items: { type: 'string' } },
    requiredApproverList: { type: 'array', items: { type: 'string' } },
    currentState: {
      type: 'string',
      enum: ['pending', 'evidence_submission', 'validation', 'approval', 'approved_for_release', 'held', 'rejected', 'escalated', 'settled', 'settlement_exception'],
    },
    policyVersion: { type: 'string' },
    tenantId: { type: 'string' },
  },
} as const;

export const evidenceObjectSchema = {
  type: 'object',
  required: ['evidenceId', 'evidenceClass', 'documentHash', 'issuerIdentity', 'projectAssociation', 'submissionTimestamp', 'validationStatus'],
  properties: {
    evidenceId: { type: 'string', format: 'uuid' },
    evidenceClass: {
      type: 'string',
      enum: [
        'construction_photo', 'inspection_report', 'invoice', 'contract', 'change_order',
        'lien_waiver', 'title_update', 'insurance_verification', 'borrower_representation',
        'vendor_validation', 'appraisal', 'draw_budget_reconciliation', 'bank_account_validation',
        'collateral_value_documentation', 'covenant_compliance_attestation',
        'third_party_inspection', 'authorized_signatory_verification', 'kyc_documentation',
      ],
    },
    documentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    issuerIdentity: { type: 'string' },
    projectAssociation: { type: 'string' },
    milestoneAssociation: { type: 'string' },
    submissionTimestamp: { type: 'string', format: 'date-time' },
    expirationDate: { type: 'string', format: 'date-time' },
    validationStatus: {
      type: 'string',
      enum: ['pending', 'validated', 'flagged', 'expired'],
    },
    flags: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const covenantDefinitionSchema = {
  type: 'object',
  required: ['covenantId', 'category', 'threshold', 'tolerance', 'evaluationCadence', 'cureDeadlineDays', 'tenantId'],
  properties: {
    covenantId: { type: 'string', format: 'uuid' },
    category: {
      type: 'string',
      enum: [
        'loan_to_value', 'debt_service_coverage_ratio', 'debt_yield', 'minimum_liquidity',
        'construction_budget_variance', 'completion_date_variance', 'interest_reserve_sufficiency',
        'insurance_coverage', 'property_tax_status', 'lien_status', 'title_status',
        'occupancy_threshold', 'revenue_threshold', 'sponsor_net_worth', 'guarantor_liquidity',
        'collateral_concentration', 'portfolio_leverage', 'policy_loan_collateral_coverage',
        'asset_valuation_freshness', 'reporting_cadence', 'restricted_payment_limitation',
        'distribution_lockup', 'refinance_restriction', 'cross_default',
      ],
    },
    threshold: { type: 'number' },
    tolerance: { type: 'number', minimum: 0, maximum: 100 },
    evaluationCadence: {
      type: 'string',
      enum: ['continuous', 'daily', 'weekly', 'monthly', 'quarterly'],
    },
    cureDeadlineDays: { type: 'integer', minimum: 1 },
    tenantId: { type: 'string' },
  },
} as const;

export const collateralRecordSchema = {
  type: 'object',
  required: ['assetId', 'assetType', 'jurisdiction', 'lienTier', 'titleStatus', 'ownershipEntity', 'appraisalValue', 'valuationDate', 'ltvMetric', 'debtBalance'],
  properties: {
    assetId: { type: 'string' },
    assetType: { type: 'string' },
    jurisdiction: { type: 'string' },
    lienTier: { type: 'integer', minimum: 1, maximum: 3 },
    titleStatus: { type: 'string' },
    ownershipEntity: { type: 'string' },
    appraisalValue: { type: 'number', minimum: 0 },
    municipalValuation: { type: 'number', minimum: 0 },
    valuationDate: { type: 'string', format: 'date' },
    valuationProvider: { type: 'string' },
    ltvMetric: { type: 'number', minimum: 0, maximum: 1 },
    debtBalance: { type: 'number', minimum: 0 },
    seniorLiens: { type: 'number', minimum: 0 },
    juniorLiens: { type: 'number', minimum: 0 },
    uccFilings: { type: 'boolean' },
    taxLiens: { type: 'boolean' },
    mechanicsLiens: { type: 'boolean' },
    insuranceStatus: { type: 'string' },
    hazardExposure: { type: 'string' },
    occupancyStatus: { type: 'string' },
    projectCompletionStatus: { type: 'string' },
    requiredRemediationStatus: { type: 'string' },
  },
} as const;

export const trancheStateSchema = {
  type: 'object',
  required: ['navSentinel', 'navCatalyst', 'juniorRatio', 'minJuniorRatio', 'capitalPreservationMode', 'reserveBalance'],
  properties: {
    navSentinel: { type: 'number', minimum: 0 },
    navCatalyst: { type: 'number', minimum: 0 },
    juniorRatio: { type: 'number', minimum: 0, maximum: 1 },
    minJuniorRatio: { type: 'number', minimum: 0, maximum: 1 },
    capitalPreservationMode: { type: 'boolean' },
    reserveBalance: { type: 'number', minimum: 0 },
    reserveShortfall: { type: 'number', minimum: 0 },
    withdrawalQueueLength: { type: 'integer', minimum: 0 },
    liquidityState: { type: 'string', enum: ['healthy', 'constrained', 'restricted'] },
    strategyHealth: { type: 'string', enum: ['normal', 'degraded', 'critical'] },
    oracleState: { type: 'string', enum: ['fresh', 'stale', 'failed'] },
  },
} as const;
