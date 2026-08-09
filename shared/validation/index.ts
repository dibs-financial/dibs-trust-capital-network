/**
 * DIBS Shared — Validation Rules
 *
 * Pure validation functions for all DIBS domain objects.
 * Used by backend API middleware, frontend forms, and evidence-gating workflows.
 */

import { capitalRequestSchema, evidenceObjectSchema, covenantDefinitionSchema, collateralRecordSchema, trancheStateSchema } from '../schemas';
import { CapitalRequest, EvidenceObject, CovenantState } from '../types';

// === Release Preconditions ===

export interface ReleasePreconditionContext {
  drawBudgetRemaining: number;
  collateralSatisfied: boolean;
  covenantSatisfied: boolean;
  activeHold: boolean;
  fraudBlock: boolean;
  sanctionsBlock: boolean;
  kycBlock: boolean;
  settlementVerified: boolean;
  reconciliationException: boolean;
  releaseWindowOpen: boolean;
  policyVersionCurrent: boolean;
  signaturesValid: boolean;
}

export function validateReleasePreconditions(
  request: CapitalRequest,
  context: ReleasePreconditionContext
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (!request) {
    failures.push('REQUEST_NOT_FOUND');
    return { passed: false, failures };
  }

  if (context.drawBudgetRemaining < request.requestedAmount) {
    failures.push('REQUEST_EXCEEDS_DRAW_BUDGET');
  }
  if (!context.collateralSatisfied) {
    failures.push('COLLATERAL_CONDITIONS_NOT_SATISFIED');
  }
  if (!context.covenantSatisfied) {
    failures.push('COVENANT_CONDITIONS_NOT_SATISFIED');
  }
  if (context.activeHold) {
    failures.push('ACTIVE_HOLD_EXISTS');
  }
  if (context.fraudBlock || context.sanctionsBlock || context.kycBlock) {
    failures.push('COUNTERPARTY_BLOCK_ACTIVE');
  }
  if (!context.settlementVerified) {
    failures.push('SETTLEMENT_ACCOUNT_NOT_VERIFIED');
  }
  if (context.reconciliationException) {
    failures.push('UNRESOLVED_RECONCILIATION_EXCEPTION');
  }
  if (!context.releaseWindowOpen) {
    failures.push('RELEASE_WINDOW_NOT_OPEN');
  }
  if (!context.policyVersionCurrent) {
    failures.push('POLICY_VERSION_STALE');
  }
  if (!context.signaturesValid) {
    failures.push('AUTHORIZATION_SIGNATURES_INVALID');
  }

  return { passed: failures.length === 0, failures };
}

// === Evidence Validation ===

export interface EvidenceValidationResult {
  valid: boolean;
  flags: string[];
}

export function validateEvidencePresence(evidence: EvidenceObject[]): boolean {
  return evidence.length > 0;
}

export function validateEvidenceFreshness(evidence: EvidenceObject[], maxAgeDays: number): boolean {
  const now = Date.now();
  return evidence.every(e => {
    const submissionDate = new Date(e.submissionTimestamp).getTime();
    const ageDays = (now - submissionDate) / (1000 * 60 * 60 * 24);
    return ageDays <= maxAgeDays;
  });
}

export function validateEvidenceExpiration(evidence: EvidenceObject[]): EvidenceValidationResult {
  const flags: string[] = [];
  const now = new Date();

  evidence.forEach(e => {
    if (e.validationStatus === 'expired') {
      flags.push(`EVIDENCE_EXPIRED:${e.evidenceId}`);
    }
    if (e.expirationDate && new Date(e.expirationDate) < now) {
      flags.push(`EVIDENCE_EXPIRATION_BREACHED:${e.evidenceId}`);
    }
  });

  return { valid: flags.length === 0, flags };
}

export function flagEvidenceConflicts(evidence: EvidenceObject[]): string[] {
  const flags: string[] = [];

  // Duplicate invoice detection
  const hashCounts = new Map<string, number>();
  evidence.forEach(e => {
    hashCounts.set(e.documentHash, (hashCounts.get(e.documentHash) || 0) + 1);
  });
  hashCounts.forEach((count, hash) => {
    if (count > 1) flags.push(`DUPLICATE_DOCUMENT_HASH:${hash}`);
  });

  // Flagged evidence
  evidence.forEach(e => {
    if (e.validationStatus === 'flagged') {
      flags.push(`EVIDENCE_FLAGGED:${e.evidenceId}`);
      e.flags.forEach(f => flags.push(`EVIDENCE_FLAG:${e.evidenceId}:${f}`));
    }
  });

  return flags;
}

// === Covenant State Validation ===

export function validateCovenantTransition(
  from: CovenantState,
  to: CovenantState,
  hasSignedWaiver: boolean
): { valid: boolean; error?: string } {
  if (from === 'breached' && to === 'waived' && !hasSignedWaiver) {
    return { valid: false, error: 'SIGNED_WAIVER_REQUIRED_TO_CHANGE_BREACH_STATE' };
  }

  const validTransitions: Record<CovenantState, CovenantState[]> = {
    compliant: ['warning', 'breached'],
    warning: ['compliant', 'breached'],
    breached: ['cure_period', 'waived', 'default'],
    cure_period: ['compliant', 'breached', 'default'],
    waived: ['compliant', 'breached'],
    default: [],
  };

  if (!validTransitions[from].includes(to)) {
    return { valid: false, error: `INVALID_COVENANT_TRANSITION: ${from} -> ${to}` };
  }

  return { valid: true };
}

// === Collateral Risk Flags ===

export interface CollateralRiskFlags {
  flags: string[];
  requiresManualReview: boolean;
}

export function evaluateCollateralRisk(collateral: {
  appraisalValue: number;
  municipalValuation: number;
  valuationDate: string;
  insuranceStatus: string;
  titleStatus: string;
  uccFilings: boolean;
  taxLiens: boolean;
  mechanicsLiens: boolean;
  ltvMetric: number;
  maxLTV: number;
}): CollateralRiskFlags {
  const flags: string[] = [];
  let requiresManualReview = false;

  // Appraisal vs municipal valuation variance
  if (collateral.municipalValuation > 0) {
    const variance = Math.abs(collateral.appraisalValue - collateral.municipalValuation) / collateral.municipalValuation;
    if (variance > 0.15) {
      flags.push('APPRAISAL_MUNICIPAL_VARIANCE_HIGH');
      requiresManualReview = true;
    }
  }

  // Stale appraisal
  const valuationAge = (Date.now() - new Date(collateral.valuationDate).getTime()) / (1000 * 60 * 60 * 24);
  if (valuationAge > 365) {
    flags.push('STALE_APPRAISAL');
  }

  // New liens
  if (collateral.uccFilings) flags.push('UCC_FILING_DETECTED');
  if (collateral.taxLiens) flags.push('TAX_LIEN_DETECTED');
  if (collateral.mechanicsLiens) flags.push('MECHANICS_LIEN_DETECTED');

  // Title defect
  if (collateral.titleStatus !== 'clear') {
    flags.push('TITLE_DEFECT');
    requiresManualReview = true;
  }

  // Insurance lapse
  if (collateral.insuranceStatus !== 'active') {
    flags.push('INSURANCE_LAPSE');
  }

  // LTV exceeded
  if (collateral.ltvMetric > collateral.maxLTV) {
    flags.push('LTV_EXCEEDS_POLICY');
  }

  return { flags, requiresManualReview };
}

// === Authorization Validation ===

export function validateAuthorization(
  authorization: {
    authorizerIdentity: string;
    authorizationRole: string;
    signedPayloadHash: string;
    authorizationExpiry: string;
    revocationState: string;
  },
  requiredRole: string
): { valid: boolean; failures: string[] } {
  const failures: string[] = [];

  if (authorization.revocationState !== 'active') {
    failures.push('AUTHORIZATION_NOT_ACTIVE');
  }
  if (authorization.authorizationRole !== requiredRole) {
    failures.push('AUTHORIZATION_ROLE_MISMATCH');
  }
  if (!authorization.signedPayloadHash) {
    failures.push('SIGNED_PAYLOAD_REQUIRED');
  }
  if (new Date(authorization.authorizationExpiry) < new Date()) {
    failures.push('AUTHORIZATION_EXPIRED');
  }

  return { valid: failures.length === 0, failures };
}
