/**
 * DIBS Backend — Evidence-Gating Workflow
 *
 * Enforces evidence preconditions before capital can be released or transitioned.
 * Validates presence of all policy-required evidence classes, checks freshness,
 * detects expiration, aggregates flags, and computes ultimate gating status.
 */

import { CapitalRequest, EvidenceClass, EvidenceObject } from '../../shared/types';
import {
  validateEvidenceFreshness,
  validateEvidenceExpiration,
  flagEvidenceConflicts,
} from '../../shared/validation';
import { ExtendedEvidenceObject, EvidenceIngestionService } from './evidence-ingestion';

/**
 * Result structure produced by the evidence-gating workflow.
 */
export interface EvidenceGatingResult {
  allPresent: boolean;
  allFresh: boolean;
  allValid: boolean;
  missingClasses: EvidenceClass[];
  expiredEvidence: EvidenceObject[];
  flags: string[];
  gatePassed: boolean;
}

/**
 * Configurable policy rules for evidence gating.
 */
export interface EvidenceGatingPolicy {
  policyId?: string;
  policyVersion?: string;
  requiredEvidenceClasses: EvidenceClass[];
  maxAgePerClassDays?: Partial<Record<EvidenceClass, number>>;
  defaultMaxAgeDays?: number;
  strictNoFlags?: boolean;
}

/**
 * Default maximum age (in days) per evidence class if not explicitly overridden.
 */
export const DEFAULT_MAX_AGE_PER_CLASS: Record<EvidenceClass, number> = {
  construction_photo: 30,
  inspection_report: 60,
  invoice: 90,
  contract: 365,
  change_order: 90,
  lien_waiver: 90,
  title_update: 180,
  insurance_verification: 365,
  borrower_representation: 180,
  vendor_validation: 365,
  appraisal: 365,
  draw_budget_reconciliation: 60,
  bank_account_validation: 180,
  collateral_value_documentation: 180,
  covenant_compliance_attestation: 90,
  third_party_inspection: 90,
  authorized_signatory_verification: 365,
  kyc_documentation: 365,
};

/**
 * Evaluates evidence gating conditions against a list of evidence objects and policy rules.
 *
 * @param request Capital request under evaluation
 * @param policy Evidence gating policy specifying required classes and freshness thresholds
 * @param evidenceList Submitted evidence objects associated with the project/request
 * @returns EvidenceGatingResult detailing presence, freshness, validity, flags, and pass/fail state
 */
export function evaluateEvidenceGating(
  request: Partial<CapitalRequest> & { projectId: string; tenantId: string },
  policy: EvidenceGatingPolicy,
  evidenceList: (EvidenceObject | ExtendedEvidenceObject)[]
): EvidenceGatingResult {
  const flags: string[] = [];
  const now = new Date();
  const defaultMaxAge = policy.defaultMaxAgeDays ?? 90;
  const maxAgeMap = policy.maxAgePerClassDays || {};

  // 1. Check Presence of Required Evidence Classes
  const missingClasses: EvidenceClass[] = [];
  const activeValidEvidence = evidenceList.filter(e => {
    if (e.validationStatus === 'expired') return false;
    if (e.expirationDate && new Date(e.expirationDate) < now) return false;
    return true;
  });

  for (const requiredClass of policy.requiredEvidenceClasses) {
    const present = activeValidEvidence.some(e => e.evidenceClass === requiredClass);
    if (!present) {
      missingClasses.push(requiredClass);
      flags.push(`MISSING_EVIDENCE_CLASS:${requiredClass}`);
    }
  }

  const allPresent = missingClasses.length === 0;

  // 2. Check Freshness per Class
  let allFresh = true;
  for (const item of evidenceList) {
    const maxAge = maxAgeMap[item.evidenceClass] ?? DEFAULT_MAX_AGE_PER_CLASS[item.evidenceClass] ?? defaultMaxAge;
    const submissionTime = new Date(item.submissionTimestamp).getTime();
    const ageDays = (now.getTime() - submissionTime) / (1000 * 60 * 60 * 24);

    if (ageDays > maxAge) {
      allFresh = false;
      flags.push(`EVIDENCE_STALE:${item.evidenceId}:${item.evidenceClass}:${Math.floor(ageDays)}d_exceeds_${maxAge}d`);
    }
  }

  // 3. Check Expiration
  const expiredEvidence: EvidenceObject[] = [];
  const expirationReport = validateEvidenceExpiration(evidenceList);
  if (!expirationReport.valid) {
    flags.push(...expirationReport.flags);
  }

  for (const item of evidenceList) {
    const isExpiredStatus = item.validationStatus === 'expired';
    const isPastExpiryDate = Boolean(item.expirationDate && new Date(item.expirationDate) < now);

    if (isExpiredStatus || isPastExpiryDate) {
      if (!expiredEvidence.some(e => e.evidenceId === item.evidenceId)) {
        expiredEvidence.push(item);
      }
      const expiredFlag = `EXPIRED_EVIDENCE:${item.evidenceId}:${item.evidenceClass}`;
      if (!flags.includes(expiredFlag)) {
        flags.push(expiredFlag);
      }
    }
  }

  // 4. Aggregate Flags and Conflict Checks
  const conflictFlags = flagEvidenceConflicts(evidenceList);
  for (const cFlag of conflictFlags) {
    if (!flags.includes(cFlag)) {
      flags.push(cFlag);
    }
  }

  // Aggregate item-level flags from submitted evidence objects
  for (const item of evidenceList) {
    if (item.validationStatus === 'flagged') {
      const flaggedStatusTag = `EVIDENCE_FLAGGED:${item.evidenceId}`;
      if (!flags.includes(flaggedStatusTag)) {
        flags.push(flaggedStatusTag);
      }
    }
    if (Array.isArray(item.flags)) {
      for (const f of item.flags) {
        const itemFlag = `FLAG:${item.evidenceId}:${f}`;
        if (!flags.includes(itemFlag)) {
          flags.push(itemFlag);
        }
      }
    }
  }

  // 5. Evaluate Validity
  const hasExpired = expiredEvidence.length > 0;
  const hasFlaggedItems = evidenceList.some(e => e.validationStatus === 'flagged');
  const allValid = !hasExpired && !hasFlaggedItems;

  // 6. Compute Final Gate Outcome
  const strictNoFlags = policy.strictNoFlags ?? true;
  const gatePassed = strictNoFlags
    ? allPresent && allFresh && allValid && flags.length === 0
    : allPresent && allFresh && allValid;

  return {
    allPresent,
    allFresh,
    allValid,
    missingClasses,
    expiredEvidence,
    flags,
    gatePassed,
  };
}

/**
 * Workflow class coordinating evidence retrieval and gating evaluation.
 */
export class EvidenceGatingWorkflow {
  private evidenceService: EvidenceIngestionService;

  constructor(evidenceService: EvidenceIngestionService) {
    this.evidenceService = evidenceService;
  }

  /**
   * Execute evidence-gating check for a capital request and policy.
   */
  async evaluateGatingForRequest(
    request: Partial<CapitalRequest> & { projectId: string; tenantId: string },
    policy: EvidenceGatingPolicy
  ): Promise<EvidenceGatingResult> {
    const projectEvidence = await this.evidenceService.getEvidenceByProject(
      request.projectId,
      request.tenantId
    );

    return evaluateEvidenceGating(request, policy, projectEvidence);
  }
}
