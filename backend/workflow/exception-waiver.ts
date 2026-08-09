/**
 * DIBS Backend — Exception and Waiver Workflow Service
 *
 * Implements the governance workflow for exceptions and policy waivers.
 *
 * Requirements:
 * - Exception record: exceptionId, requestId, exceptionType, exceptionReason,
 *   exceptionTimestamp, exceptionStatus, escalatedTo.
 * - Exception types: evidence_insufficient, covenant_breach, collateral_impairment,
 *   policy_threshold_breach, missing_approval, authorization_expired, settlement_failure,
 *   reconciliation_exception.
 * - Exception status transitions: open -> under_review | escalated | resolved | denied.
 * - Waiver record: waiverId, exceptionId, waiverScope, waiverAmount, waiverDuration,
 *   waiverConditions, signedWaiverHash, authorizerId, authorizerRole, waiverStatus, followUpConditions.
 * - Waiver status transitions: requested -> approved | denied | expired | revoked.
 * - Enforce required signed waiver hash for approval.
 * - Track post-approval follow-up conditions and due dates.
 * - Enhanced approval requirements for high-risk exception types (collateral impairment, covenant breaches, policy threshold breaches).
 * - Integration with EventStore for audit logging.
 */

import { EventStore, EventType } from '../audit/event-store';

/**
 * Supported exception classification categories.
 */
export type ExceptionType =
  | 'evidence_insufficient'
  | 'covenant_breach'
  | 'collateral_impairment'
  | 'policy_threshold_breach'
  | 'missing_approval'
  | 'authorization_expired'
  | 'settlement_failure'
  | 'reconciliation_exception';

/**
 * Valid states for exception records.
 */
export type ExceptionStatus = 'open' | 'under_review' | 'escalated' | 'resolved' | 'denied';

/**
 * Exception Record structure.
 */
export interface ExceptionRecord {
  exceptionId: string;
  requestId: string;
  projectId?: string;
  exceptionType: ExceptionType;
  exceptionReason: string;
  exceptionTimestamp: string;
  exceptionStatus: ExceptionStatus;
  escalatedTo?: string;
  createdBy: string;
  tenantId?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}

/**
 * Valid states for waiver records.
 */
export type WaiverStatus = 'requested' | 'approved' | 'denied' | 'expired' | 'revoked';

/**
 * Post-waiver follow-up condition tracking structure.
 */
export interface FollowUpCondition {
  conditionId: string;
  description: string;
  dueDate: string; // ISO-8601 date string
  status: 'pending' | 'satisfied' | 'overdue' | 'waived';
  satisfiedAt?: string;
  satisfiedBy?: string;
  notes?: string;
}

/**
 * Waiver Record structure.
 */
export interface WaiverRecord {
  waiverId: string;
  exceptionId: string;
  projectId?: string;
  waiverScope: string;
  waiverAmount?: number;
  waiverDuration: number | string; // Duration in days or date string
  waiverConditions: string[];
  signedWaiverHash: string; // Required for approval
  authorizerId?: string;
  authorizerRole?: string;
  waiverStatus: WaiverStatus;
  followUpConditions: FollowUpCondition[];
  requestedBy: string;
  requestedAt: string;
  decisionAt?: string;
  decisionNotes?: string;
  tenantId?: string;
}

/**
 * Parameters for creating an exception record.
 */
export interface CreateExceptionParams {
  requestId: string;
  projectId?: string;
  exceptionType: ExceptionType;
  exceptionReason: string;
  createdBy: string;
  tenantId?: string;
}

/**
 * Parameters for requesting a waiver.
 */
export interface RequestWaiverParams {
  exceptionId: string;
  projectId?: string;
  waiverScope: string;
  waiverAmount?: number;
  waiverDuration: number | string;
  waiverConditions?: string[];
  followUpConditions?: Array<{ description: string; dueDate: string }>;
  requestedBy: string;
  tenantId?: string;
}

/**
 * Parameters for approving a waiver.
 */
export interface ApproveWaiverParams {
  waiverId: string;
  authorizerId: string;
  authorizerRole: string;
  signedWaiverHash: string; // Mandatory non-empty string
  decisionNotes?: string;
}

/**
 * High-severity exception types that enforce enhanced approval authority.
 */
const ENHANCED_APPROVAL_EXCEPTION_TYPES: ExceptionType[] = [
  'collateral_impairment',
  'covenant_breach',
  'policy_threshold_breach',
];

/**
 * Authorized roles that meet enhanced approval criteria.
 */
const ENHANCED_AUTHORIZER_ROLES: string[] = [
  'chief_credit_officer',
  'risk_officer',
  'investment_committee',
  'managing_director',
  'admin',
  'senior_approver',
];

/**
 * Exception and Waiver Management Service.
 */
export class ExceptionWaiverService {
  private exceptions: Map<string, ExceptionRecord> = new Map();
  private waivers: Map<string, WaiverRecord> = new Map();
  private eventStore: EventStore;

  constructor(eventStore?: EventStore) {
    this.eventStore = eventStore || new EventStore();
  }

  /**
   * Create a new exception record.
   */
  async createException(params: CreateExceptionParams): Promise<ExceptionRecord> {
    if (!params.requestId || !params.exceptionType || !params.exceptionReason) {
      throw new Error('MISSING_REQUIRED_FIELDS: requestId, exceptionType, and exceptionReason are required.');
    }

    const exceptionId = `exc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const record: ExceptionRecord = {
      exceptionId,
      requestId: params.requestId,
      projectId: params.projectId,
      exceptionType: params.exceptionType,
      exceptionReason: params.exceptionReason,
      exceptionTimestamp: new Date().toISOString(),
      exceptionStatus: 'open',
      createdBy: params.createdBy,
      tenantId: params.tenantId || 'default_tenant',
    };

    this.exceptions.set(exceptionId, record);

    // Emit event depending on exception type
    let eventType: EventType = EventType.SETTLEMENT_EXCEPTION;
    if (params.exceptionType === 'covenant_breach') eventType = EventType.COVENANT_BREACHED;
    if (params.exceptionType === 'evidence_insufficient') eventType = EventType.EVIDENCE_FLAGGED;

    await this.eventStore.append({
      eventType,
      actorId: params.createdBy,
      actorRole: 'operator',
      tenantId: record.tenantId!,
      payloadHash: exceptionId,
      policyVersion: '1.0.0',
      metadata: {
        exceptionId,
        requestId: params.requestId,
        exceptionType: params.exceptionType,
        exceptionReason: params.exceptionReason,
      },
    });

    return record;
  }

  /**
   * Retrieve exception record by ID.
   */
  getException(exceptionId: string): ExceptionRecord | undefined {
    return this.exceptions.get(exceptionId);
  }

  /**
   * Escalate an exception to a higher governing role or committee.
   */
  async escalateException(
    exceptionId: string,
    escalatedTo: string,
    actorId: string,
    reason?: string
  ): Promise<ExceptionRecord> {
    const record = this.exceptions.get(exceptionId);
    if (!record) {
      throw new Error(`EXCEPTION_NOT_FOUND: Exception ${exceptionId} does not exist.`);
    }

    if (record.exceptionStatus === 'resolved' || record.exceptionStatus === 'denied') {
      throw new Error(`INVALID_TRANSITION: Cannot escalate exception in state ${record.exceptionStatus}.`);
    }

    const updated: ExceptionRecord = {
      ...record,
      exceptionStatus: 'escalated',
      escalatedTo,
      resolutionNotes: reason || record.resolutionNotes,
    };

    this.exceptions.set(exceptionId, updated);

    await this.eventStore.append({
      eventType: EventType.CAPITAL_REQUEST_ESCALATED,
      actorId,
      actorRole: 'escalation_handler',
      tenantId: updated.tenantId!,
      payloadHash: exceptionId,
      policyVersion: '1.0.0',
      metadata: {
        exceptionId,
        requestId: updated.requestId,
        escalatedTo,
        reason,
      },
    });

    return updated;
  }

  /**
   * Request a policy waiver for an active exception.
   */
  async requestWaiver(params: RequestWaiverParams): Promise<WaiverRecord> {
    const exception = this.exceptions.get(params.exceptionId);
    if (!exception) {
      throw new Error(`EXCEPTION_NOT_FOUND: Cannot request waiver for non-existent exception ${params.exceptionId}.`);
    }

    if (exception.exceptionStatus === 'resolved' || exception.exceptionStatus === 'denied') {
      throw new Error(`INVALID_EXCEPTION_STATE: Cannot request waiver for exception in state '${exception.exceptionStatus}'.`);
    }

    const waiverId = `wav_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const followUpConditions: FollowUpCondition[] = (params.followUpConditions || []).map((cond, idx) => ({
      conditionId: `cond_${Date.now()}_${idx}`,
      description: cond.description,
      dueDate: cond.dueDate,
      status: 'pending',
    }));

    const waiver: WaiverRecord = {
      waiverId,
      exceptionId: params.exceptionId,
      projectId: params.projectId || exception.projectId,
      waiverScope: params.waiverScope,
      waiverAmount: params.waiverAmount,
      waiverDuration: params.waiverDuration,
      waiverConditions: params.waiverConditions || [],
      signedWaiverHash: '', // Must be set upon approval
      waiverStatus: 'requested',
      followUpConditions,
      requestedBy: params.requestedBy,
      requestedAt: new Date().toISOString(),
      tenantId: params.tenantId || exception.tenantId,
    };

    this.waivers.set(waiverId, waiver);

    // Transition exception state to under_review
    exception.exceptionStatus = 'under_review';
    this.exceptions.set(exception.exceptionId, exception);

    return waiver;
  }

  /**
   * Retrieve a waiver record by ID.
   */
  getWaiver(waiverId: string): WaiverRecord | undefined {
    return this.waivers.get(waiverId);
  }

  /**
   * List waivers for a specific project.
   */
  listWaiversByProject(projectId: string): WaiverRecord[] {
    return Array.from(this.waivers.values()).filter(w => w.projectId === projectId);
  }

  /**
   * Approve a requested waiver.
   *
   * Security & Compliance Enforcements:
   * - Requires a valid signed waiver hash (`signedWaiverHash`).
   * - Enforces enhanced authorizer role check for high-risk exceptions.
   */
  async approveWaiver(params: ApproveWaiverParams): Promise<{ waiver: WaiverRecord; exception: ExceptionRecord }> {
    const waiver = this.waivers.get(params.waiverId);
    if (!waiver) {
      throw new Error(`WAIVER_NOT_FOUND: Waiver ${params.waiverId} does not exist.`);
    }

    if (waiver.waiverStatus !== 'requested') {
      throw new Error(`INVALID_WAIVER_STATE: Cannot approve waiver in state '${waiver.waiverStatus}'.`);
    }

    // REQUIREMENT: Validate signedWaiverHash presence
    if (!params.signedWaiverHash || typeof params.signedWaiverHash !== 'string' || params.signedWaiverHash.trim() === '') {
      throw new Error('SIGNED_WAIVER_HASH_REQUIRED: A valid signed waiver hash is required to approve a waiver.');
    }

    const exception = this.exceptions.get(waiver.exceptionId);
    if (!exception) {
      throw new Error(`EXCEPTION_NOT_FOUND: Associated exception ${waiver.exceptionId} does not exist.`);
    }

    // ENHANCED APPROVAL REQUIREMENT check
    const requiresEnhancedApproval =
      ENHANCED_APPROVAL_EXCEPTION_TYPES.includes(exception.exceptionType) ||
      (waiver.waiverAmount && waiver.waiverAmount > 500000);

    if (requiresEnhancedApproval) {
      const normalizedRole = params.authorizerRole.toLowerCase();
      if (!ENHANCED_AUTHORIZER_ROLES.includes(normalizedRole)) {
        throw new Error(
          `ENHANCED_APPROVAL_REQUIRED: Exception type '${exception.exceptionType}' or amount requires an elevated authorizer role (${ENHANCED_AUTHORIZER_ROLES.join(
            ', '
          )}). Provided role: '${params.authorizerRole}'.`
        );
      }
    }

    const decisionTime = new Date().toISOString();

    const updatedWaiver: WaiverRecord = {
      ...waiver,
      waiverStatus: 'approved',
      signedWaiverHash: params.signedWaiverHash,
      authorizerId: params.authorizerId,
      authorizerRole: params.authorizerRole,
      decisionAt: decisionTime,
      decisionNotes: params.decisionNotes,
    };

    const updatedException: ExceptionRecord = {
      ...exception,
      exceptionStatus: 'resolved',
      resolvedAt: decisionTime,
      resolutionNotes: `Waiver ${waiver.waiverId} approved by ${params.authorizerId} (${params.authorizerRole}). Notes: ${
        params.decisionNotes || 'None'
      }`,
    };

    this.waivers.set(params.waiverId, updatedWaiver);
    this.exceptions.set(exception.exceptionId, updatedException);

    // Emit COVENANT_WAIVED or release audit event
    await this.eventStore.append({
      eventType: EventType.COVENANT_WAIVED,
      actorId: params.authorizerId,
      actorRole: params.authorizerRole,
      tenantId: updatedWaiver.tenantId!,
      payloadHash: params.signedWaiverHash,
      policyVersion: '1.0.0',
      metadata: {
        waiverId: waiver.waiverId,
        exceptionId: exception.exceptionId,
        waiverScope: waiver.waiverScope,
        waiverAmount: waiver.waiverAmount,
        signedWaiverHash: params.signedWaiverHash,
        followUpConditionCount: waiver.followUpConditions.length,
      },
    });

    return { waiver: updatedWaiver, exception: updatedException };
  }

  /**
   * Deny a requested waiver.
   */
  async denyWaiver(
    waiverId: string,
    authorizerId: string,
    authorizerRole: string,
    decisionNotes?: string
  ): Promise<WaiverRecord> {
    const waiver = this.waivers.get(waiverId);
    if (!waiver) {
      throw new Error(`WAIVER_NOT_FOUND: Waiver ${waiverId} does not exist.`);
    }

    if (waiver.waiverStatus !== 'requested') {
      throw new Error(`INVALID_WAIVER_STATE: Cannot deny waiver in state '${waiver.waiverStatus}'.`);
    }

    const decisionTime = new Date().toISOString();

    const updatedWaiver: WaiverRecord = {
      ...waiver,
      waiverStatus: 'denied',
      authorizerId,
      authorizerRole,
      decisionAt: decisionTime,
      decisionNotes,
    };

    this.waivers.set(waiverId, updatedWaiver);

    const exception = this.exceptions.get(waiver.exceptionId);
    if (exception) {
      exception.exceptionStatus = 'denied';
      exception.resolutionNotes = `Waiver denied by ${authorizerId}. Notes: ${decisionNotes || 'None'}`;
      this.exceptions.set(exception.exceptionId, exception);
    }

    return updatedWaiver;
  }

  /**
   * Mark a post-approval follow-up condition as satisfied.
   */
  async satisfyFollowUpCondition(
    waiverId: string,
    conditionId: string,
    actorId: string,
    notes?: string
  ): Promise<WaiverRecord> {
    const waiver = this.waivers.get(waiverId);
    if (!waiver) {
      throw new Error(`WAIVER_NOT_FOUND: Waiver ${waiverId} does not exist.`);
    }

    const condition = waiver.followUpConditions.find(c => c.conditionId === conditionId);
    if (!condition) {
      throw new Error(`CONDITION_NOT_FOUND: Follow-up condition ${conditionId} not found on waiver ${waiverId}.`);
    }

    condition.status = 'satisfied';
    condition.satisfiedAt = new Date().toISOString();
    condition.satisfiedBy = actorId;
    if (notes) condition.notes = notes;

    this.waivers.set(waiverId, waiver);
    return waiver;
  }

  /**
   * Audit and mark overdue follow-up conditions.
   */
  checkOverdueFollowUpConditions(now = new Date()): WaiverRecord[] {
    const updatedWaivers: WaiverRecord[] = [];

    for (const waiver of this.waivers.values()) {
      if (waiver.waiverStatus !== 'approved') continue;

      let modified = false;
      for (const cond of waiver.followUpConditions) {
        if (cond.status === 'pending' && new Date(cond.dueDate) < now) {
          cond.status = 'overdue';
          modified = true;
        }
      }

      if (modified) {
        this.waivers.set(waiver.waiverId, waiver);
        updatedWaivers.push(waiver);
      }
    }

    return updatedWaivers;
  }
}

// Singleton instance for convenience
export const exceptionWaiverService = new ExceptionWaiverService();
