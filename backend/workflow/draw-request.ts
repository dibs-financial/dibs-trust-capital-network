/**
 * DIBS Capital Autopilot — DrawRequest state machine
 *
 * Canonical aggregate for Track A. Replaces CapitalRequest.
 * Spec: docs/architecture/DIBS-Domain-State-Event-Model.md
 *
 * Money is integer minor units. Tenant comes from the session, not this module.
 * No template literals — GitHub web editor corrupts dollar-brace.
 */

import type { AuditLog } from '../audit/event-store';
import { EventType } from '../audit/event-store';

export type DrawRequestState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'SETTLEMENT_INSTRUCTED'
  | 'SETTLEMENT_CONFIRMED'
  | 'RECONCILED'
  | 'CLOSED'
  | 'REQUIRES_INFORMATION'
  | 'HELD'
  | 'ESCALATED'
  | 'SETTLEMENT_FAILED'
  | 'RECONCILIATION_EXCEPTION'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface DrawRequest {
  id: string;
  tenantId: string;
  dealId: string;
  spvId: string;
  seriesId: string | null;
  requestNumber: string;
  status: DrawRequestState;
  requestedByUserId: string;
  payeeCounterpartyId: string;
  payeeBankAccountId: string;
  amountRequestedMinor: bigint;
  amountApprovedMinor: bigint | null;
  currency: string;
  budgetLineIds: string[];
  requestedAt: string;
  submittedAt: string | null;
  lockedPolicyVersion: string | null;
  lockedEvidenceManifestHash: string | null;
  approvalBindingHash: string | null;
  policyEvaluationId: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalContext {
  manifestComplete: boolean;
  manifestItemExpiredOrUnverified: boolean;
  remainingBudgetMinor: bigint;
  eligibleThisDrawMinor: bigint;
  retainageApplied: boolean;
  covenantStatus: 'CURRENT' | 'WATCH' | 'BREACHED' | 'CURE_PERIOD';
  waiverCoversBreach: boolean;
  loanInBalancePasses: boolean;
  deficiencyDepositConfirmed: boolean;
  requiredApprovalsRecorded: boolean;
  approversDistinctFromRequester: boolean;
  noApproverIsInstructor: boolean;
  openHold: boolean;
  payeeVerified: boolean;
  sanctionsFresh: boolean;
  settlementRouteValid: boolean;
  policyVersionMatchesLock: boolean;
  manifestHashMatchesLock: boolean;
}

export const ALLOWED_TRANSITIONS: Record<DrawRequestState, DrawRequestState[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: [
    'REQUIRES_INFORMATION',
    'HELD',
    'ESCALATED',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
  ],
  REQUIRES_INFORMATION: ['UNDER_REVIEW'],
  HELD: ['UNDER_REVIEW'],
  ESCALATED: ['UNDER_REVIEW'],
  APPROVED: ['UNDER_REVIEW', 'HELD', 'CANCELLED', 'SETTLEMENT_INSTRUCTED'],
  SETTLEMENT_INSTRUCTED: ['SETTLEMENT_CONFIRMED', 'SETTLEMENT_FAILED'],
  SETTLEMENT_FAILED: ['SETTLEMENT_INSTRUCTED', 'CANCELLED', 'RECONCILIATION_EXCEPTION'],
  SETTLEMENT_CONFIRMED: ['RECONCILED', 'RECONCILIATION_EXCEPTION'],
  RECONCILIATION_EXCEPTION: ['RECONCILED'],
  RECONCILED: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

const EVENT_FOR_TARGET: Partial<Record<DrawRequestState, EventType>> = {
  SUBMITTED: EventType.DRAW_SUBMITTED,
  UNDER_REVIEW: EventType.DRAW_POLICY_EVALUATED,
  REQUIRES_INFORMATION: EventType.DRAW_REQUIRES_INFORMATION,
  HELD: EventType.DRAW_HELD,
  ESCALATED: EventType.DRAW_ESCALATED,
  APPROVED: EventType.DRAW_APPROVED,
  REJECTED: EventType.DRAW_REJECTED,
  CANCELLED: EventType.DRAW_CANCELLED,
  EXPIRED: EventType.DRAW_EXPIRED,
  SETTLEMENT_INSTRUCTED: EventType.DRAW_SETTLEMENT_INSTRUCTED,
  SETTLEMENT_CONFIRMED: EventType.DRAW_SETTLEMENT_CONFIRMED,
  SETTLEMENT_FAILED: EventType.DRAW_SETTLEMENT_FAILED,
  RECONCILED: EventType.DRAW_RECONCILED,
  RECONCILIATION_EXCEPTION: EventType.DRAW_RECONCILIATION_BREAK,
  CLOSED: EventType.DRAW_CLOSED,
};

export function approvalFailures(
  draw: DrawRequest,
  ctx: ApprovalContext
): string[] {
  const failures: string[] = [];
  if (!ctx.manifestComplete) failures.push('MANIFEST_INCOMPLETE');
  if (ctx.manifestItemExpiredOrUnverified) failures.push('MANIFEST_ITEM_INVALID');
  if (
    draw.amountApprovedMinor === null ||
    draw.amountApprovedMinor > draw.amountRequestedMinor
  ) {
    failures.push('APPROVED_AMOUNT_INVALID');
  }
  if (
    draw.amountApprovedMinor !== null &&
    draw.amountApprovedMinor > ctx.eligibleThisDrawMinor
  ) {
    failures.push('EXCEEDS_ELIGIBLE_THIS_DRAW');
  }
  if (
    draw.amountApprovedMinor !== null &&
    draw.amountApprovedMinor > ctx.remainingBudgetMinor
  ) {
    failures.push('EXCEEDS_REMAINING_BUDGET');
  }
  if (!ctx.retainageApplied) failures.push('RETAINAGE_NOT_APPLIED');
  if (
    (ctx.covenantStatus === 'BREACHED' || ctx.covenantStatus === 'CURE_PERIOD') &&
    !ctx.waiverCoversBreach
  ) {
    failures.push('COVENANT_BLOCKS');
  }
  if (!ctx.loanInBalancePasses && !ctx.deficiencyDepositConfirmed) {
    failures.push('LOAN_IN_BALANCE_FAIL');
  }
  if (!ctx.requiredApprovalsRecorded) failures.push('APPROVALS_INCOMPLETE');
  if (!ctx.approversDistinctFromRequester) failures.push('SELF_APPROVAL');
  if (!ctx.noApproverIsInstructor) failures.push('APPROVER_IS_INSTRUCTOR');
  if (ctx.openHold) failures.push('OPEN_HOLD');
  if (!ctx.payeeVerified) failures.push('PAYEE_NOT_VERIFIED');
  if (!ctx.sanctionsFresh) failures.push('SANCTIONS_STALE');
  if (!ctx.settlementRouteValid) failures.push('SETTLEMENT_ROUTE_INVALID');
  if (!ctx.policyVersionMatchesLock) failures.push('POLICY_LOCK_MISMATCH');
  if (!ctx.manifestHashMatchesLock) failures.push('MANIFEST_LOCK_MISMATCH');
  return failures;
}

export function canEnterApproved(draw: DrawRequest, ctx: ApprovalContext): boolean {
  return approvalFailures(draw, ctx).length === 0;
}

export async function transitionDraw(
  draw: DrawRequest,
  target: DrawRequestState,
  eventStore: AuditLog,
  actor: { id: string; type: 'USER' | 'SYSTEM' | 'PARTNER' | 'SUPER_AGENT'; role: string },
  extras?: {
    approvalContext?: ApprovalContext;
    fundsMovedEvidence?: boolean;
    instructionExists?: boolean;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
    correlationId?: string;
  }
): Promise<DrawRequest> {
  const allowed = ALLOWED_TRANSITIONS[draw.status];
  if (!allowed.includes(target)) {
    throw new Error('Invalid transition: ' + draw.status + ' -> ' + target);
  }

  if (target === 'APPROVED') {
    if (!extras || !extras.approvalContext) {
      throw new Error('APPROVED requires approvalContext');
    }
    const failures = approvalFailures(draw, extras.approvalContext);
    if (failures.length > 0) {
      throw new Error('Approval blocked: ' + failures.join(','));
    }
  }

  if (target === 'CANCELLED' && draw.status === 'SETTLEMENT_FAILED') {
    if (extras && extras.fundsMovedEvidence) {
      throw new Error(
        'Cannot cancel after funds-moved evidence; open RECONCILIATION_EXCEPTION'
      );
    }
  }

  if (target === 'CANCELLED' && draw.status === 'APPROVED' && extras && extras.instructionExists) {
    throw new Error('Cannot cancel APPROVED after instruction exists');
  }

  const now = new Date().toISOString();
  const eventType = EVENT_FOR_TARGET[target] ?? EventType.DRAW_POLICY_EVALUATED;
  const idempotencyKey =
    (extras && extras.idempotencyKey) || [draw.id, draw.status, target].join(':');
  const correlationId = (extras && extras.correlationId) || draw.id;
  const payload = (extras && extras.payload) || { status: target };

  await eventStore.append({
    tenantId: draw.tenantId,
    aggregateType: 'DRAW_REQUEST',
    aggregateId: draw.id,
    eventType: eventType,
    actorType: actor.type,
    actorId: actor.id,
    actorRole: actor.role,
    stateBefore: draw.status,
    stateAfter: target,
    policyVersion: draw.lockedPolicyVersion || '',
    correlationId: correlationId,
    idempotencyKey: idempotencyKey,
    evidenceManifestHash: draw.lockedEvidenceManifestHash || '',
    payload: payload,
  });

  return {
    ...draw,
    status: target,
    updatedAt: now,
    submittedAt: target === 'SUBMITTED' && !draw.submittedAt ? now : draw.submittedAt,
  };
}

/** Prototype names. Remove after backend/api/index.ts is updated. */
export type CapitalRequestState = DrawRequestState;
export type CapitalRequest = DrawRequest;
export type CapitalPolicy = Record<string, unknown>;

export function validateReleasePreconditions(
  draw: DrawRequest,
  _policy: CapitalPolicy,
  ctx: ApprovalContext
): string[] {
  return approvalFailures(draw, ctx);
}

export async function transitionState(
  draw: DrawRequest,
  target: DrawRequestState,
  eventStore: AuditLog,
  actor: { id: string; role: string }
): Promise<DrawRequest> {
  return transitionDraw(draw, target, eventStore, {
    id: actor.id,
    type: 'USER',
    role: actor.role,
  });
}
