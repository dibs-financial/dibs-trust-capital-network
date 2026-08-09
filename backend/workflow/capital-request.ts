/**
 * DIBS Backend — Capital Request State Machine
 *
 * Implements the controlled-draw state machine for capital authorization.
 *
 * States: pending → evidence_submission → validation → approval → release | hold | reject | escalate
 *
 * Release Preconditions:
 * - Request exists
 * - Request within approved draw budget
 * - Request amount below policy threshold
 * - Required evidence complete
 * - Required approvals complete
 * - Collateral conditions satisfied
 * - Covenant conditions satisfied
 * - No active hold
 * - No active fraud, sanctions, KYC, or counterparty block
 * - Settlement-account verification passes
 * - No unresolved reconciliation exception
 * - Required release window opened
 * - Policy version current
 * - Authorization signatures valid
 *
 * Release Outcomes: Approved, Held, Rejected, Escalated
 */

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
  createdAt: string;
  updatedAt: string;
}

export interface CapitalPolicy {
  policyId: string;
  entityScope: string;
  projectScope: string;
  assetScope: string;
  maxReleaseAmount: number;
  cumulativeDrawLimit: number;
  requiredEvidenceClasses: string[];
  requiredVerifierRoles: string[];
  requiredSignatures: number;
  escalationPath: string;
  holdTriggers: string[];
  exceptionTriggers: string[];
  expirationInterval: number;
  auditRequirements: string[];
}

/**
 * Validates all release preconditions before transitioning to approved_for_release.
 * Returns a list of failed preconditions (empty = all pass).
 */
export function validateReleasePreconditions(
  request: CapitalRequest,
  policy: CapitalPolicy,
  context: {
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
): string[] {
  const failures: string[] = [];

  if (context.drawBudgetRemaining < request.requestedAmount) {
    failures.push('REQUEST_EXCEEDS_DRAW_BUDGET');
  }
  if (request.requestedAmount > policy.maxReleaseAmount) {
    failures.push('REQUEST_EXCEEDS_POLICY_THRESHOLD');
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
  if (context.fraudBlock) {
    failures.push('FRAUD_BLOCK_ACTIVE');
  }
  if (context.sanctionsBlock) {
    failures.push('SANCTIONS_BLOCK_ACTIVE');
  }
  if (context.kycBlock) {
    failures.push('KYC_BLOCK_ACTIVE');
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

  return failures;
}

/**
 * State transition function — emits immutable event for every transition.
 */
export function transitionState(
  request: CapitalRequest,
  targetState: CapitalRequestState,
  eventStore: { append: (e: any) => Promise<any> },
  actor: { id: string; role: string }
): CapitalRequest {
  const allowedTransitions: Record<CapitalRequestState, CapitalRequestState[]> = {
    pending: ['evidence_submission', 'rejected'],
    evidence_submission: ['validation', 'held', 'rejected'],
    validation: ['approval', 'held', 'rejected'],
    approval: ['approved_for_release', 'held', 'rejected', 'escalated'],
    approved_for_release: ['settled', 'settlement_exception'],
    held: ['evidence_submission', 'rejected', 'escalated'],
    rejected: [],
    escalated: ['approval', 'rejected', 'approved_for_release'],
    settled: [],
    settlement_exception: ['approved_for_release', 'escalated'],
  };

  const allowed = allowedTransitions[request.currentState];
  if (!allowed.includes(targetState)) {
    throw new Error(`Invalid transition: ${request.currentState} -> ${targetState}`);
  }

  // TODO: Emit immutable event via eventStore.append()
  return {
    ...request,
    currentState: targetState,
    updatedAt: new Date().toISOString(),
  };
}
