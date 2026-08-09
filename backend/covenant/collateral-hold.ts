/**
 * DIBS Backend — Collateral Hold System
 *
 * Implements collateral hold tracking, hold triggers, automated risk evaluations,
 * hold release workflows, and draw-block enforcement.
 *
 * Requirements:
 * - Collateral hold record structure and status management
 * - Hold triggers: missing evidence, LTV policy breach, title defect, insurance lapse,
 *   lien detected, stale appraisal, appraisal-municipal variance, subordination change,
 *   unapproved refinancing, collateral transfer.
 * - Hold status transitions: active -> released | escalated | converted_to_block
 * - Draw block enforcement when hold is active/blocked
 * - Cure-based release triggers: supplemental collateral, LTV restored, title cured,
 *   insurance renewed, lien resolved.
 * - Integration with EventStore (emitting COLLATERAL_FLAGGED, COLLATERAL_REINSPECT_REQUIRED)
 * - Integration with evaluateCollateralRisk from shared/validation
 */

import { EventStore, EventType } from '../audit/event-store';
import { evaluateCollateralRisk, CollateralRiskFlags } from '../../shared/validation';

/**
 * Enumeration of all supported collateral hold triggers.
 */
export type HoldTrigger =
  | 'missing_collateral_evidence'
  | 'ltv_exceeds_policy'
  | 'title_defect'
  | 'insurance_lapse'
  | 'lien_detected'
  | 'stale_appraisal'
  | 'appraisal_municipal_variance'
  | 'subordination_change'
  | 'unapproved_refinancing'
  | 'collateral_transfer';

/**
 * Valid states for a collateral hold record.
 */
export type HoldStatus = 'active' | 'released' | 'escalated' | 'converted_to_block';

/**
 * Valid conditions required to release an active collateral hold.
 */
export type ReleaseCondition =
  | 'supplemental_collateral_provided'
  | 'ltv_restored'
  | 'title_cured'
  | 'insurance_renewed'
  | 'lien_resolved';

/**
 * Collateral hold record interface matching system specifications.
 */
export interface CollateralHoldRecord {
  holdId: string;
  assetId: string;
  projectId: string;
  requestId?: string;
  holdReason: HoldTrigger | string;
  holdTimestamp: string;
  releaseTimestamp?: string | null;
  holdStatus: HoldStatus;
  triggeredBy: string;
  tenantId?: string;
  releaseCondition?: ReleaseCondition | string;
  releaseNotes?: string;
  releasedBy?: string;
  escalatedTo?: string;
  escalationReason?: string;
}

/**
 * Parameters for creating a new collateral hold record.
 */
export interface CreateHoldParams {
  assetId: string;
  projectId: string;
  requestId?: string;
  holdReason: HoldTrigger | string;
  triggeredBy: string;
  tenantId?: string;
  notes?: string;
}

/**
 * Parameters for releasing an active collateral hold record.
 */
export interface ReleaseHoldParams {
  holdId: string;
  releaseCondition: ReleaseCondition | string;
  releasedBy: string;
  notes?: string;
}

/**
 * Input format for automated collateral risk evaluation.
 */
export interface CollateralEvaluationInput {
  assetId: string;
  projectId: string;
  requestId?: string;
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
  triggeredBy?: string;
  tenantId?: string;
}

/**
 * Collateral Hold Service managing holds and draw-block policies.
 */
export class CollateralHoldService {
  private holds: Map<string, CollateralHoldRecord> = new Map();
  private eventStore: EventStore;

  constructor(eventStore?: EventStore) {
    this.eventStore = eventStore || new EventStore();
  }

  /**
   * Create a new collateral hold record and emit audit events.
   */
  async createHold(params: CreateHoldParams): Promise<CollateralHoldRecord> {
    if (!params.assetId || !params.projectId || !params.holdReason) {
      throw new Error('MISSING_REQUIRED_FIELDS: assetId, projectId, and holdReason are required.');
    }

    const holdId = `hold_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const holdRecord: CollateralHoldRecord = {
      holdId,
      assetId: params.assetId,
      projectId: params.projectId,
      requestId: params.requestId,
      holdReason: params.holdReason,
      holdTimestamp: new Date().toISOString(),
      releaseTimestamp: null,
      holdStatus: 'active',
      triggeredBy: params.triggeredBy,
      tenantId: params.tenantId || 'default_tenant',
      releaseNotes: params.notes,
    };

    this.holds.set(holdId, holdRecord);

    // Emit COLLATERAL_FLAGGED event
    await this.eventStore.append({
      eventType: EventType.COLLATERAL_FLAGGED,
      actorId: params.triggeredBy,
      actorRole: 'system',
      tenantId: holdRecord.tenantId!,
      payloadHash: holdId,
      policyVersion: '1.0.0',
      metadata: {
        holdId,
        assetId: params.assetId,
        projectId: params.projectId,
        requestId: params.requestId,
        holdReason: params.holdReason,
      },
    });

    // Triggers that require physical or legal re-inspection
    const reinspectTriggers: (HoldTrigger | string)[] = [
      'stale_appraisal',
      'appraisal_municipal_variance',
      'title_defect',
      'lien_detected',
      'collateral_transfer',
    ];

    if (reinspectTriggers.includes(params.holdReason)) {
      await this.eventStore.append({
        eventType: EventType.COLLATERAL_REINSPECT_REQUIRED,
        actorId: params.triggeredBy,
        actorRole: 'system',
        tenantId: holdRecord.tenantId!,
        payloadHash: `${holdId}_reinspect`,
        policyVersion: '1.0.0',
        metadata: {
          assetId: params.assetId,
          reason: params.holdReason,
          milestoneConflict: false,
          holdId,
        },
      });
    }

    return holdRecord;
  }

  /**
   * Retrieve a hold by ID.
   */
  getHold(holdId: string): CollateralHoldRecord | undefined {
    return this.holds.get(holdId);
  }

  /**
   * List holds for a specific project.
   */
  getHoldsByProject(projectId: string, statusFilter?: HoldStatus): CollateralHoldRecord[] {
    const records = Array.from(this.holds.values()).filter(h => h.projectId === projectId);
    if (statusFilter) {
      return records.filter(h => h.holdStatus === statusFilter);
    }
    return records;
  }

  /**
   * List holds for a specific asset.
   */
  getHoldsByAsset(assetId: string): CollateralHoldRecord[] {
    return Array.from(this.holds.values()).filter(h => h.assetId === assetId);
  }

  /**
   * Check whether capital draw release is blocked due to active or blocking collateral holds.
   * Draw release is blocked if any hold on the request, project, or asset is active or converted_to_block.
   */
  isDrawBlocked(requestId?: string, projectId?: string, assetId?: string): boolean {
    const activeBlockingStatuses: HoldStatus[] = ['active', 'converted_to_block', 'escalated'];

    return Array.from(this.holds.values()).some(h => {
      if (!activeBlockingStatuses.includes(h.holdStatus)) {
        return false;
      }
      if (requestId && h.requestId === requestId) return true;
      if (projectId && h.projectId === projectId) return true;
      if (assetId && h.assetId === assetId) return true;
      return false;
    });
  }

  /**
   * Release an active or escalated collateral hold when cure condition is met.
   */
  async releaseHold(params: ReleaseHoldParams): Promise<CollateralHoldRecord> {
    const record = this.holds.get(params.holdId);
    if (!record) {
      throw new Error(`HOLD_NOT_FOUND: Hold record with ID ${params.holdId} does not exist.`);
    }

    if (record.holdStatus === 'released') {
      throw new Error(`HOLD_ALREADY_RELEASED: Hold ${params.holdId} has already been released.`);
    }

    const validReleaseConditions: ReleaseCondition[] = [
      'supplemental_collateral_provided',
      'ltv_restored',
      'title_cured',
      'insurance_renewed',
      'lien_resolved',
    ];

    if (!validReleaseConditions.includes(params.releaseCondition as ReleaseCondition)) {
      throw new Error(
        `INVALID_RELEASE_CONDITION: Condition '${params.releaseCondition}' is not a recognized release trigger.`
      );
    }

    const updatedRecord: CollateralHoldRecord = {
      ...record,
      holdStatus: 'released',
      releaseTimestamp: new Date().toISOString(),
      releaseCondition: params.releaseCondition,
      releasedBy: params.releasedBy,
      releaseNotes: params.notes || record.releaseNotes,
    };

    this.holds.set(params.holdId, updatedRecord);

    // Emit RELEASE_HOLD event
    await this.eventStore.append({
      eventType: EventType.RELEASE_HOLD,
      actorId: params.releasedBy,
      actorRole: 'risk_officer',
      tenantId: updatedRecord.tenantId!,
      payloadHash: params.holdId,
      policyVersion: '1.0.0',
      metadata: {
        holdId: params.holdId,
        assetId: updatedRecord.assetId,
        projectId: updatedRecord.projectId,
        requestId: updatedRecord.requestId,
        holdReason: updatedRecord.holdReason,
        releaseCondition: params.releaseCondition,
        notes: params.notes,
      },
    });

    return updatedRecord;
  }

  /**
   * Escalate an active collateral hold for executive or committee review.
   */
  async escalateHold(holdId: string, escalatedTo: string, actorId: string, reason?: string): Promise<CollateralHoldRecord> {
    const record = this.holds.get(holdId);
    if (!record) {
      throw new Error(`HOLD_NOT_FOUND: Hold record with ID ${holdId} does not exist.`);
    }

    if (record.holdStatus === 'released') {
      throw new Error('INVALID_TRANSITION: Cannot escalate a released hold.');
    }

    const updated: CollateralHoldRecord = {
      ...record,
      holdStatus: 'escalated',
      escalatedTo,
      escalationReason: reason,
    };

    this.holds.set(holdId, updated);
    return updated;
  }

  /**
   * Convert a collateral hold to a hard block on draw releases.
   */
  async convertHoldToBlock(holdId: string, actorId: string, reason?: string): Promise<CollateralHoldRecord> {
    const record = this.holds.get(holdId);
    if (!record) {
      throw new Error(`HOLD_NOT_FOUND: Hold record with ID ${holdId} does not exist.`);
    }

    if (record.holdStatus === 'released') {
      throw new Error('INVALID_TRANSITION: Cannot convert a released hold to block.');
    }

    const updated: CollateralHoldRecord = {
      ...record,
      holdStatus: 'converted_to_block',
      escalationReason: reason,
    };

    this.holds.set(holdId, updated);
    return updated;
  }

  /**
   * Evaluate asset risk flags using shared validation rules and create collateral holds for detected issues.
   */
  async evaluateAndCreateHolds(input: CollateralEvaluationInput): Promise<{
    riskResult: CollateralRiskFlags;
    createdHolds: CollateralHoldRecord[];
  }> {
    const riskResult = evaluateCollateralRisk({
      appraisalValue: input.appraisalValue,
      municipalValuation: input.municipalValuation,
      valuationDate: input.valuationDate,
      insuranceStatus: input.insuranceStatus,
      titleStatus: input.titleStatus,
      uccFilings: input.uccFilings,
      taxLiens: input.taxLiens,
      mechanicsLiens: input.mechanicsLiens,
      ltvMetric: input.ltvMetric,
      maxLTV: input.maxLTV,
    });

    const createdHolds: CollateralHoldRecord[] = [];

    // Map risk flags to hold triggers
    const flagTriggerMap: Record<string, HoldTrigger> = {
      APPRAISAL_MUNICIPAL_VARIANCE_HIGH: 'appraisal_municipal_variance',
      STALE_APPRAISAL: 'stale_appraisal',
      UCC_FILING_DETECTED: 'lien_detected',
      TAX_LIEN_DETECTED: 'lien_detected',
      MECHANICS_LIEN_DETECTED: 'lien_detected',
      TITLE_DEFECT: 'title_defect',
      INSURANCE_LAPSE: 'insurance_lapse',
      LTV_EXCEEDS_POLICY: 'ltv_exceeds_policy',
    };

    const existingHolds = this.getHoldsByAsset(input.assetId);

    for (const flag of riskResult.flags) {
      const trigger = flagTriggerMap[flag];
      if (trigger) {
        // Avoid creating duplicate active hold for same asset and trigger
        const duplicateActive = existingHolds.some(
          h => h.holdReason === trigger && (h.holdStatus === 'active' || h.holdStatus === 'escalated')
        );

        if (!duplicateActive) {
          const hold = await this.createHold({
            assetId: input.assetId,
            projectId: input.projectId,
            requestId: input.requestId,
            holdReason: trigger,
            triggeredBy: input.triggeredBy || 'automated_risk_engine',
            tenantId: input.tenantId,
            notes: `Auto-generated from risk flag: ${flag}`,
          });
          createdHolds.push(hold);
        }
      }
    }

    return { riskResult, createdHolds };
  }
}

// Singleton instance for convenience
export const collateralHoldService = new CollateralHoldService();
