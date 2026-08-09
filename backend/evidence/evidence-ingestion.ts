/**
 * DIBS Backend — Evidence Ingestion Service
 *
 * Full evidence ingestion, validation pipeline, hashing, conflict detection,
 * and immutable event audit log integration for the DIBS Trust Capital Network.
 *
 * Service Responsibilities:
 * - Evidence submission & SHA-256 document hashing
 * - Validation pipeline (presence, type, freshness, issuer, hash, project, milestone, approvals, expiry, exceptions)
 * - Deep conflict detection (duplicate invoices, budget mismatch, destination change, missing lien waiver, expired insurance, collateral drop)
 * - 18 Evidence Class Enum matching shared/types
 * - Append-only immutable event store emission (EVIDENCE_SUBMITTED, EVIDENCE_VALIDATED, EVIDENCE_FLAGGED, EVIDENCE_EXPIRED)
 */

import { createHash } from 'crypto';
import { EventStore, EventType } from '../audit/event-store';
import { EvidenceClass, EvidenceObject } from '../../shared/types';
import {
  validateEvidencePresence,
  validateEvidenceFreshness,
  validateEvidenceExpiration,
  flagEvidenceConflicts,
} from '../../shared/validation';

/**
 * Enum representing all 18 standard Evidence Classes in DIBS.
 */
export enum EvidenceClassEnum {
  CONSTRUCTION_PHOTO = 'construction_photo',
  INSPECTION_REPORT = 'inspection_report',
  INVOICE = 'invoice',
  CONTRACT = 'contract',
  CHANGE_ORDER = 'change_order',
  LIEN_WAIVER = 'lien_waiver',
  TITLE_UPDATE = 'title_update',
  INSURANCE_VERIFICATION = 'insurance_verification',
  BORROWER_REPRESENTATION = 'borrower_representation',
  VENDOR_VALIDATION = 'vendor_validation',
  APPRAISAL = 'appraisal',
  DRAW_BUDGET_RECONCILIATION = 'draw_budget_reconciliation',
  BANK_ACCOUNT_VALIDATION = 'bank_account_validation',
  COLLATERAL_VALUE_DOCUMENTATION = 'collateral_value_documentation',
  COVENANT_COMPLIANCE_ATTESTATION = 'covenant_compliance_attestation',
  THIRD_PARTY_INSPECTION = 'third_party_inspection',
  AUTHORIZED_SIGNATORY_VERIFICATION = 'authorized_signatory_verification',
  KYC_DOCUMENTATION = 'kyc_documentation',
}

/**
 * List of all valid EvidenceClass strings.
 */
export const VALID_EVIDENCE_CLASSES: EvidenceClass[] = Object.values(EvidenceClassEnum) as EvidenceClass[];

/**
 * Extended evidence record storing full ingestion metadata and conflict evaluation fields.
 */
export interface ExtendedEvidenceObject extends EvidenceObject {
  tenantId: string;
  invoiceNumber?: string;
  vendorId?: string;
  amount?: number;
  drawCategory?: string;
  expectedCategory?: string;
  paymentDestination?: string;
  verifiedPaymentDestination?: string;
  appraisalValue?: number;
  minRequiredCollateralValue?: number;
  previousAppraisalValue?: number;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  exceptionStatus?: 'none' | 'pending' | 'waived' | 'active_exception';
  metadata?: Record<string, unknown>;
}

/**
 * Input payload for evidence submission.
 */
export interface EvidenceSubmissionInput {
  evidenceClass: EvidenceClass;
  documentContent?: string | Buffer;
  documentHash?: string;
  issuerIdentity: string;
  projectAssociation: string;
  milestoneAssociation: string;
  tenantId: string;
  expirationDate?: string;
  actorId?: string;
  actorRole?: string;
  policyVersion?: string;

  // Domain attributes for deep conflict detection & validation
  invoiceNumber?: string;
  vendorId?: string;
  amount?: number;
  drawCategory?: string;
  expectedCategory?: string;
  paymentDestination?: string;
  verifiedPaymentDestination?: string;
  appraisalValue?: number;
  minRequiredCollateralValue?: number;
  previousAppraisalValue?: number;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  exceptionStatus?: 'none' | 'pending' | 'waived' | 'active_exception';
  metadata?: Record<string, unknown>;
}

/**
 * Detailed pipeline validation report.
 */
export interface DetailedValidationResult {
  valid: boolean;
  status: 'pending' | 'validated' | 'flagged' | 'expired';
  flags: string[];
  checks: {
    presence: boolean;
    validType: boolean;
    freshness: boolean;
    issuerValid: boolean;
    hashValid: boolean;
    projectValid: boolean;
    milestoneValid: boolean;
    approvalValid: boolean;
    notExpired: boolean;
    noActiveExceptions: boolean;
    noConflicts: boolean;
  };
}

/**
 * Computes a SHA-256 hex digest from string or Buffer content.
 */
export function computeSHA256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Runs specialized domain conflict detection across evidence objects.
 *
 * Conflict Scenarios Handled:
 * 1. Duplicate invoice patterns (duplicate documentHash across invoices, matching invoice number + vendor)
 * 2. Inconsistent budget categories (drawCategory mismatch against expected category)
 * 3. Payment-destination changes (unverified destination vs bank account validation)
 * 4. Missing lien waivers (invoice submitted without corresponding lien waiver)
 * 5. Expired insurance (insurance_verification with past expiration date)
 * 6. Collateral-value deterioration (appraisal drop below previous value or minimum threshold)
 */
export function detectEvidenceConflicts(
  target: ExtendedEvidenceObject,
  existingEvidence: ExtendedEvidenceObject[] = []
): string[] {
  const conflicts: string[] = [];
  const allEvidence = [...existingEvidence, target];

  // 1. Shared validation conflict check
  const sharedFlags = flagEvidenceConflicts(allEvidence);
  for (const flag of sharedFlags) {
    if (!conflicts.includes(flag)) {
      conflicts.push(flag);
    }
  }

  // 2. Duplicate invoice patterns
  if (target.evidenceClass === 'invoice' || target.invoiceNumber) {
    const duplicateInvoice = existingEvidence.find(e =>
      e.evidenceId !== target.evidenceId &&
      e.evidenceClass === 'invoice' &&
      e.invoiceNumber &&
      target.invoiceNumber &&
      e.invoiceNumber.trim().toLowerCase() === target.invoiceNumber.trim().toLowerCase() &&
      e.vendorId === target.vendorId
    );
    if (duplicateInvoice) {
      conflicts.push(`DUPLICATE_INVOICE_NUMBER:${target.invoiceNumber}:${target.vendorId}`);
    }

    const duplicateHashInvoice = existingEvidence.find(e =>
      e.evidenceId !== target.evidenceId &&
      e.documentHash === target.documentHash &&
      (e.evidenceClass === 'invoice' || target.evidenceClass === 'invoice')
    );
    if (duplicateHashInvoice) {
      conflicts.push(`DUPLICATE_INVOICE_HASH:${target.documentHash}`);
    }
  }

  // 3. Inconsistent budget categories
  if (target.drawCategory && target.expectedCategory) {
    if (target.drawCategory.trim().toLowerCase() !== target.expectedCategory.trim().toLowerCase()) {
      conflicts.push(
        `INCONSISTENT_BUDGET_CATEGORY:requested=${target.drawCategory}:expected=${target.expectedCategory}`
      );
    }
  }

  // 4. Payment-destination changes
  if (target.paymentDestination) {
    const bankValidations = existingEvidence.filter(
      e => e.evidenceClass === 'bank_account_validation' && e.validationStatus !== 'expired'
    );
    const verifiedAccount = target.verifiedPaymentDestination || (bankValidations.length > 0 ? bankValidations[0].paymentDestination : undefined);

    if (verifiedAccount && target.paymentDestination !== verifiedAccount) {
      conflicts.push(
        `PAYMENT_DESTINATION_CHANGE:unverified_destination=${target.paymentDestination}:verified=${verifiedAccount}`
      );
    }
  }

  // 5. Missing lien waivers
  if (target.evidenceClass === 'invoice' || target.evidenceClass === 'change_order') {
    const hasLienWaiver = existingEvidence.some(
      e =>
        e.evidenceClass === 'lien_waiver' &&
        e.projectAssociation === target.projectAssociation &&
        e.milestoneAssociation === target.milestoneAssociation &&
        e.validationStatus !== 'expired' &&
        e.validationStatus !== 'flagged'
    );
    if (!hasLienWaiver) {
      conflicts.push(`MISSING_LIEN_WAIVER:milestone=${target.milestoneAssociation}`);
    }
  }

  // 6. Expired insurance
  if (target.evidenceClass === 'insurance_verification') {
    if (target.expirationDate && new Date(target.expirationDate) < new Date()) {
      conflicts.push(`EXPIRED_INSURANCE:${target.evidenceId}`);
    }
  }

  // 7. Collateral-value deterioration
  if (target.evidenceClass === 'appraisal' || target.evidenceClass === 'collateral_value_documentation') {
    if (target.appraisalValue !== undefined) {
      if (target.minRequiredCollateralValue !== undefined && target.appraisalValue < target.minRequiredCollateralValue) {
        conflicts.push(
          `COLLATERAL_VALUE_BELOW_MINIMUM:appraisal=${target.appraisalValue}:min_required=${target.minRequiredCollateralValue}`
        );
      }
      if (target.previousAppraisalValue !== undefined && target.appraisalValue < target.previousAppraisalValue) {
        const dropPct = ((target.previousAppraisalValue - target.appraisalValue) / target.previousAppraisalValue) * 100;
        conflicts.push(
          `COLLATERAL_VALUE_DETERIORATION:previous=${target.previousAppraisalValue}:current=${target.appraisalValue}:drop_pct=${dropPct.toFixed(2)}%`
        );
      }
    }
  }

  return conflicts;
}

/**
 * Runs the full multi-point evidence validation pipeline.
 */
export function validateEvidencePipeline(
  target: ExtendedEvidenceObject,
  existingProjectEvidence: ExtendedEvidenceObject[] = [],
  options: { maxAgeDays?: number } = {}
): DetailedValidationResult {
  const maxAgeDays = options.maxAgeDays ?? 90;
  const flags: string[] = [];

  // Check 1: Presence
  const presenceValid = validateEvidencePresence([target]) && Boolean(target.documentHash) && Boolean(target.evidenceId);
  if (!presenceValid) {
    flags.push('EVIDENCE_MISSING_REQUIRED_FIELDS');
  }

  // Check 2: Type
  const validType = VALID_EVIDENCE_CLASSES.includes(target.evidenceClass);
  if (!validType) {
    flags.push(`INVALID_EVIDENCE_CLASS:${target.evidenceClass}`);
  }

  // Check 3: Freshness
  const freshnessValid = validateEvidenceFreshness([target], maxAgeDays);
  if (!freshnessValid) {
    flags.push(`EVIDENCE_STALE:exceeds_${maxAgeDays}_days`);
  }

  // Check 4: Issuer Identity
  const issuerValid = Boolean(target.issuerIdentity && target.issuerIdentity.trim().length > 0);
  if (!issuerValid) {
    flags.push('INVALID_ISSUER_IDENTITY');
  }

  // Check 5: Document Hashes
  const hashPattern = /^[a-f0-9]{64}$/i;
  const hashValid = hashPattern.test(target.documentHash);
  if (!hashValid) {
    flags.push(`INVALID_DOCUMENT_HASH_FORMAT:${target.documentHash}`);
  }

  // Check 6: Project Association
  const projectValid = Boolean(target.projectAssociation && target.projectAssociation.trim().length > 0);
  if (!projectValid) {
    flags.push('MISSING_PROJECT_ASSOCIATION');
  }

  // Check 7: Milestone Association
  const milestoneValid = Boolean(target.milestoneAssociation && target.milestoneAssociation.trim().length > 0);
  if (!milestoneValid) {
    flags.push('MISSING_MILESTONE_ASSOCIATION');
  }

  // Check 8: Approval Status
  let approvalValid = true;
  if (target.approvalStatus === 'rejected') {
    approvalValid = false;
    flags.push('APPROVAL_REJECTED');
  } else if (target.approvalStatus === 'pending') {
    approvalValid = false;
    flags.push('APPROVAL_PENDING');
  }

  // Check 9: Expiration Dates
  const expirationResult = validateEvidenceExpiration([target]);
  const notExpired = expirationResult.valid && (!target.expirationDate || new Date(target.expirationDate) >= new Date());
  if (!notExpired) {
    flags.push(...expirationResult.flags);
    if (!flags.includes(`EVIDENCE_EXPIRED:${target.evidenceId}`)) {
      flags.push(`EVIDENCE_EXPIRED:${target.evidenceId}`);
    }
  }

  // Check 10: Exception Status
  const noActiveExceptions = target.exceptionStatus !== 'active_exception';
  if (!noActiveExceptions) {
    flags.push(`ACTIVE_EXCEPTION_PRESENT:${target.evidenceId}`);
  }

  // Check 11: Conflicts
  const conflictFlags = detectEvidenceConflicts(target, existingProjectEvidence);
  if (conflictFlags.length > 0) {
    flags.push(...conflictFlags);
  }
  const noConflicts = conflictFlags.length === 0;

  // Determine final status
  let status: 'pending' | 'validated' | 'flagged' | 'expired' = 'validated';
  if (!notExpired) {
    status = 'expired';
  } else if (flags.length > 0) {
    status = 'flagged';
  }

  const valid = status === 'validated' && flags.length === 0;

  return {
    valid,
    status,
    flags,
    checks: {
      presence: presenceValid,
      validType,
      freshness: freshnessValid,
      issuerValid,
      hashValid,
      projectValid,
      milestoneValid,
      approvalValid,
      notExpired,
      noActiveExceptions,
      noConflicts,
    },
  };
}

/**
 * Service class managing evidence storage, validation execution, and audit log events.
 */
export class EvidenceIngestionService {
  private evidenceStore: Map<string, ExtendedEvidenceObject> = new Map();
  private eventStore: EventStore;

  constructor(eventStore?: EventStore) {
    this.eventStore = eventStore || new EventStore();
  }

  /**
   * Submit new evidence object. Computes SHA-256 hash if raw content is supplied,
   * stores evidence, runs validation, and records audit log event.
   */
  async submitEvidence(input: EvidenceSubmissionInput): Promise<ExtendedEvidenceObject> {
    if (!input.tenantId) {
      throw new Error('TENANT_ID_REQUIRED');
    }
    if (!input.evidenceClass || !VALID_EVIDENCE_CLASSES.includes(input.evidenceClass)) {
      throw new Error(`INVALID_EVIDENCE_CLASS: ${input.evidenceClass}`);
    }
    if (!input.projectAssociation) {
      throw new Error('PROJECT_ASSOCIATION_REQUIRED');
    }

    // Compute or verify document hash
    let documentHash = input.documentHash;
    if (input.documentContent) {
      documentHash = computeSHA256(input.documentContent);
    }
    if (!documentHash) {
      throw new Error('DOCUMENT_HASH_OR_CONTENT_REQUIRED');
    }

    const evidenceId = `ev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const submissionTimestamp = new Date().toISOString();

    const initialObject: ExtendedEvidenceObject = {
      evidenceId,
      evidenceClass: input.evidenceClass,
      documentHash,
      issuerIdentity: input.issuerIdentity || 'UNKNOWN_ISSUER',
      projectAssociation: input.projectAssociation,
      milestoneAssociation: input.milestoneAssociation || '',
      submissionTimestamp,
      expirationDate: input.expirationDate || '',
      validationStatus: 'pending',
      flags: [],
      tenantId: input.tenantId,
      invoiceNumber: input.invoiceNumber,
      vendorId: input.vendorId,
      amount: input.amount,
      drawCategory: input.drawCategory,
      expectedCategory: input.expectedCategory,
      paymentDestination: input.paymentDestination,
      verifiedPaymentDestination: input.verifiedPaymentDestination,
      appraisalValue: input.appraisalValue,
      minRequiredCollateralValue: input.minRequiredCollateralValue,
      previousAppraisalValue: input.previousAppraisalValue,
      approvalStatus: input.approvalStatus || 'approved',
      exceptionStatus: input.exceptionStatus || 'none',
      metadata: input.metadata || {},
    };

    // Get existing project evidence for conflict detection
    const existingProjectEvidence = await this.getEvidenceByProject(
      input.projectAssociation,
      input.tenantId
    );

    // Run pipeline
    const validationReport = validateEvidencePipeline(initialObject, existingProjectEvidence);

    const finalObject: ExtendedEvidenceObject = {
      ...initialObject,
      validationStatus: validationReport.status,
      flags: validationReport.flags,
    };

    this.evidenceStore.set(evidenceId, finalObject);

    // Emit EVIDENCE_SUBMITTED event
    await this.eventStore.append({
      eventType: EventType.EVIDENCE_SUBMITTED,
      actorId: input.actorId || 'system',
      actorRole: input.actorRole || 'system',
      tenantId: input.tenantId,
      payloadHash: computeSHA256(JSON.stringify(finalObject)),
      policyVersion: input.policyVersion || 'v1.0',
      metadata: {
        evidenceId: finalObject.evidenceId,
        evidenceClass: finalObject.evidenceClass,
        documentHash: finalObject.documentHash,
        projectAssociation: finalObject.projectAssociation,
        milestoneAssociation: finalObject.milestoneAssociation,
        validationStatus: finalObject.validationStatus,
        flags: finalObject.flags,
      },
    });

    // Emit status specific event if flagged or expired immediately
    if (finalObject.validationStatus === 'flagged') {
      await this.eventStore.append({
        eventType: EventType.EVIDENCE_FLAGGED,
        actorId: input.actorId || 'system',
        actorRole: input.actorRole || 'system',
        tenantId: input.tenantId,
        payloadHash: computeSHA256(JSON.stringify(finalObject.flags)),
        policyVersion: input.policyVersion || 'v1.0',
        metadata: {
          evidenceId: finalObject.evidenceId,
          flags: finalObject.flags,
        },
      });
    } else if (finalObject.validationStatus === 'expired') {
      await this.eventStore.append({
        eventType: EventType.EVIDENCE_EXPIRED,
        actorId: input.actorId || 'system',
        actorRole: input.actorRole || 'system',
        tenantId: input.tenantId,
        payloadHash: computeSHA256(finalObject.expirationDate),
        policyVersion: input.policyVersion || 'v1.0',
        metadata: {
          evidenceId: finalObject.evidenceId,
          expirationDate: finalObject.expirationDate,
        },
      });
    }

    return finalObject;
  }

  /**
   * Retrieve an evidence record by ID, scoped by tenant.
   */
  async getEvidenceById(evidenceId: string, tenantId: string): Promise<ExtendedEvidenceObject | null> {
    const item = this.evidenceStore.get(evidenceId);
    if (!item || item.tenantId !== tenantId) {
      return null;
    }
    return item;
  }

  /**
   * List all evidence records for a project within a tenant.
   */
  async getEvidenceByProject(projectId: string, tenantId: string): Promise<ExtendedEvidenceObject[]> {
    const results: ExtendedEvidenceObject[] = [];
    for (const item of this.evidenceStore.values()) {
      if (item.tenantId === tenantId && item.projectAssociation === projectId) {
        results.push(item);
      }
    }
    return results;
  }

  /**
   * List all flagged evidence records for a project within a tenant.
   */
  async getFlaggedEvidenceByProject(projectId: string, tenantId: string): Promise<ExtendedEvidenceObject[]> {
    const projectItems = await this.getEvidenceByProject(projectId, tenantId);
    return projectItems.filter(e => e.validationStatus === 'flagged' || e.flags.length > 0);
  }

  /**
   * Trigger explicit re-validation for an existing evidence record.
   */
  async validateEvidence(
    evidenceId: string,
    tenantId: string,
    options: { maxAgeDays?: number; actorId?: string; actorRole?: string; policyVersion?: string } = {}
  ): Promise<{ evidence: ExtendedEvidenceObject; report: DetailedValidationResult }> {
    const item = await this.getEvidenceById(evidenceId, tenantId);
    if (!item) {
      throw new Error(`EVIDENCE_NOT_FOUND: ${evidenceId}`);
    }

    const existingProjectEvidence = (await this.getEvidenceByProject(item.projectAssociation, tenantId)).filter(
      e => e.evidenceId !== evidenceId
    );

    const report = validateEvidencePipeline(item, existingProjectEvidence, options);

    const updatedItem: ExtendedEvidenceObject = {
      ...item,
      validationStatus: report.status,
      flags: report.flags,
    };

    this.evidenceStore.set(evidenceId, updatedItem);

    // Emit event based on updated validation state
    const actorId = options.actorId || 'system';
    const actorRole = options.actorRole || 'system';
    const policyVersion = options.policyVersion || 'v1.0';

    if (report.status === 'validated') {
      await this.eventStore.append({
        eventType: EventType.EVIDENCE_VALIDATED,
        actorId,
        actorRole,
        tenantId,
        payloadHash: computeSHA256(JSON.stringify(updatedItem)),
        policyVersion,
        metadata: {
          evidenceId: updatedItem.evidenceId,
          validationStatus: report.status,
        },
      });
    } else if (report.status === 'flagged') {
      await this.eventStore.append({
        eventType: EventType.EVIDENCE_FLAGGED,
        actorId,
        actorRole,
        tenantId,
        payloadHash: computeSHA256(JSON.stringify(report.flags)),
        policyVersion,
        metadata: {
          evidenceId: updatedItem.evidenceId,
          flags: report.flags,
        },
      });
    } else if (report.status === 'expired') {
      await this.eventStore.append({
        eventType: EventType.EVIDENCE_EXPIRED,
        actorId,
        actorRole,
        tenantId,
        payloadHash: computeSHA256(updatedItem.expirationDate || new Date().toISOString()),
        policyVersion,
        metadata: {
          evidenceId: updatedItem.evidenceId,
          expirationDate: updatedItem.expirationDate,
        },
      });
    }

    return { evidence: updatedItem, report };
  }
}

// Export default singleton instance for backend route usage
export const globalEvidenceService = new EvidenceIngestionService();
