/**
 * DIBS Shared — Event Definitions
 *
 * Canonical event types for the immutable audit log.
 * Every capital-state change requires an immutable audit event.
 * No silent data synchronization.
 */

export type EventType =
  // Capital authorization
  | 'CAPITAL_REQUEST_CREATED'
  | 'CAPITAL_REQUEST_APPROVED'
  | 'CAPITAL_REQUEST_HELD'
  | 'CAPITAL_REQUEST_REJECTED'
  | 'CAPITAL_REQUEST_ESCALATED'
  // Evidence
  | 'EVIDENCE_SUBMITTED'
  | 'EVIDENCE_VALIDATED'
  | 'EVIDENCE_FLAGGED'
  | 'EVIDENCE_EXPIRED'
  // Release
  | 'RELEASE_AUTHORIZED'
  | 'RELEASE_HOLD'
  | 'RELEASE_REJECTED'
  | 'SETTLEMENT_INSTRUCTION_SENT'
  | 'SETTLEMENT_CONFIRMED'
  | 'SETTLEMENT_EXCEPTION'
  // Covenant
  | 'COVENANT_COMPLIANT'
  | 'COVENANT_WARNING'
  | 'COVENANT_BREACHED'
  | 'COVENANT_CURE_ENTERED'
  | 'COVENANT_WAIVED'
  | 'COVENANT_DEFAULT'
  // Collateral
  | 'COLLATERAL_FLAGGED'
  | 'COLLATERAL_REINSPECT_REQUIRED'
  // Tranche
  | 'CAPITAL_PRESERVATION_TRIGGERED'
  | 'CAPITAL_PRESERVATION_LIFTED'
  | 'RESERVE_RELEASED'
  | 'DISTRIBUTION_SUSPENDED'
  | 'RECAPITALIZATION_EXECUTED'
  // Authorization
  | 'AUTHORIZATION_REVOKED'
  | 'AUTHORIZATION_EXPIRED'
  // Emergency
  | 'EMERGENCY_PAUSE'
  | 'EMERGENCY_UNPAUSE';

export interface EventDefinition {
  type: EventType;
  category: 'authorization' | 'evidence' | 'release' | 'covenant' | 'collateral' | 'tranche' | 'emergency';
  requiresImmutableLog: true;
  requiresHashChain: true;
  requiredFields: string[];
}

export const EVENT_DEFINITIONS: Record<EventType, EventDefinition> = {
  CAPITAL_REQUEST_CREATED: {
    type: 'CAPITAL_REQUEST_CREATED',
    category: 'authorization',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'borrowerOrSponsorId', 'projectId', 'requestedAmount', 'tenantId'],
  },
  CAPITAL_REQUEST_APPROVED: {
    type: 'CAPITAL_REQUEST_APPROVED',
    category: 'authorization',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'approverId', 'approverRole', 'signedPayloadHash', 'policyVersion'],
  },
  CAPITAL_REQUEST_HELD: {
    type: 'CAPITAL_REQUEST_HELD',
    category: 'authorization',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'holdReason', 'actorId'],
  },
  CAPITAL_REQUEST_REJECTED: {
    type: 'CAPITAL_REQUEST_REJECTED',
    category: 'authorization',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'failureReason', 'actorId'],
  },
  CAPITAL_REQUEST_ESCALATED: {
    type: 'CAPITAL_REQUEST_ESCALATED',
    category: 'authorization',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'escalationTarget', 'actorId'],
  },
  EVIDENCE_SUBMITTED: {
    type: 'EVIDENCE_SUBMITTED',
    category: 'evidence',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['evidenceId', 'evidenceClass', 'documentHash', 'projectAssociation'],
  },
  EVIDENCE_VALIDATED: {
    type: 'EVIDENCE_VALIDATED',
    category: 'evidence',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['evidenceId', 'validatorId', 'validationTimestamp'],
  },
  EVIDENCE_FLAGGED: {
    type: 'EVIDENCE_FLAGGED',
    category: 'evidence',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['evidenceId', 'flagType', 'flagDescription'],
  },
  EVIDENCE_EXPIRED: {
    type: 'EVIDENCE_EXPIRED',
    category: 'evidence',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['evidenceId', 'expirationDate'],
  },
  RELEASE_AUTHORIZED: {
    type: 'RELEASE_AUTHORIZED',
    category: 'release',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'releaseAmount', 'paymentDestination', 'policyVersion'],
  },
  RELEASE_HOLD: {
    type: 'RELEASE_HOLD',
    category: 'release',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'holdReason'],
  },
  RELEASE_REJECTED: {
    type: 'RELEASE_REJECTED',
    category: 'release',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'rejectionReason'],
  },
  SETTLEMENT_INSTRUCTION_SENT: {
    type: 'SETTLEMENT_INSTRUCTION_SENT',
    category: 'release',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'settlementPartner', 'instructionHash'],
  },
  SETTLEMENT_CONFIRMED: {
    type: 'SETTLEMENT_CONFIRMED',
    category: 'release',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'settlementPartner', 'confirmationHash', 'amount'],
  },
  SETTLEMENT_EXCEPTION: {
    type: 'SETTLEMENT_EXCEPTION',
    category: 'release',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['requestId', 'exceptionType', 'exceptionDescription'],
  },
  COVENANT_COMPLIANT: {
    type: 'COVENANT_COMPLIANT',
    category: 'covenant',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['covenantId', 'measuredValue', 'threshold', 'calculationVersion'],
  },
  COVENANT_WARNING: {
    type: 'COVENANT_WARNING',
    category: 'covenant',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['covenantId', 'measuredValue', 'threshold', 'warningBoundary'],
  },
  COVENANT_BREACHED: {
    type: 'COVENANT_BREACHED',
    category: 'covenant',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['covenantId', 'measuredValue', 'threshold', 'cureDeadline'],
  },
  COVENANT_CURE_ENTERED: {
    type: 'COVENANT_CURE_ENTERED',
    category: 'covenant',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['covenantId', 'cureDeadline', 'requiredCureEvidence'],
  },
  COVENANT_WAIVED: {
    type: 'COVENANT_WAIVED',
    category: 'covenant',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['covenantId', 'waiverScope', 'waiverDuration', 'signedWaiverHash', 'authorizerId'],
  },
  COVENANT_DEFAULT: {
    type: 'COVENANT_DEFAULT',
    category: 'covenant',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['covenantId', 'enforcementAction', 'actorId'],
  },
  COLLATERAL_FLAGGED: {
    type: 'COLLATERAL_FLAGGED',
    category: 'collateral',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['assetId', 'flagType', 'flagDescription'],
  },
  COLLATERAL_REINSPECT_REQUIRED: {
    type: 'COLLATERAL_REINSPECT_REQUIRED',
    category: 'collateral',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['assetId', 'reason', 'milestoneConflict'],
  },
  CAPITAL_PRESERVATION_TRIGGERED: {
    type: 'CAPITAL_PRESERVATION_TRIGGERED',
    category: 'tranche',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['juniorRatio', 'minJuniorRatio', 'reserveShortfall', 'liquidityState'],
  },
  CAPITAL_PRESERVATION_LIFTED: {
    type: 'CAPITAL_PRESERVATION_LIFTED',
    category: 'tranche',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['juniorRatio', 'minJuniorRatio', 'liquidityTestsPassed'],
  },
  RESERVE_RELEASED: {
    type: 'RESERVE_RELEASED',
    category: 'tranche',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['releaseAmount', 'juniorRatio', 'minJuniorRatio', 'liquidityTestsPassed'],
  },
  DISTRIBUTION_SUSPENDED: {
    type: 'DISTRIBUTION_SUSPENDED',
    category: 'tranche',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['trancheClass', 'reason', 'juniorRatio'],
  },
  RECAPITALIZATION_EXECUTED: {
    type: 'RECAPITALIZATION_EXECUTED',
    category: 'tranche',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['catalystNav', 'pricing', 'dilutionFactor'],
  },
  AUTHORIZATION_REVOKED: {
    type: 'AUTHORIZATION_REVOKED',
    category: 'authorization',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['authorizationId', 'revokedBy', 'reason'],
  },
  AUTHORIZATION_EXPIRED: {
    type: 'AUTHORIZATION_EXPIRED',
    category: 'authorization',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['authorizationId', 'expiryDate'],
  },
  EMERGENCY_PAUSE: {
    type: 'EMERGENCY_PAUSE',
    category: 'emergency',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['pauseScope', 'emergencyRole', 'timestamp'],
  },
  EMERGENCY_UNPAUSE: {
    type: 'EMERGENCY_UNPAUSE',
    category: 'emergency',
    requiresImmutableLog: true,
    requiresHashChain: true,
    requiredFields: ['unpauseScope', 'adminId', 'postIncidentReviewRequired'],
  },
};
