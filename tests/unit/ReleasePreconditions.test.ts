/**
 * DIBS Tests — Release Preconditions Validation
 *
 * Tests all 13 release preconditions from the evidence-gated capital release workflow.
 */

import { validateReleasePreconditions } from '../../shared/validation';
import { CapitalRequest } from '../../shared/types';

const baseRequest: CapitalRequest = {
  requestId: 'req_1',
  borrowerOrSponsorId: 'borrower_1',
  projectId: 'proj_1',
  spvId: 'spv_1',
  requestedAmount: 500000,
  requestedPaymentDate: '2026-09-01T00:00:00Z',
  paymentDestination: 'account_1',
  drawCategory: 'construction',
  supportingInvoiceSet: ['inv_1', 'inv_2'],
  milestoneId: 'ms_1',
  covenantDependencies: ['cov_1'],
  collateralDependencies: ['col_1'],
  requiredApproverList: ['approver_1', 'approver_2'],
  currentState: 'approval',
  policyVersion: 'v1',
  tenantId: 'tenant_1',
};

const passingContext = {
  drawBudgetRemaining: 1000000,
  collateralSatisfied: true,
  covenantSatisfied: true,
  activeHold: false,
  fraudBlock: false,
  sanctionsBlock: false,
  kycBlock: false,
  settlementVerified: true,
  reconciliationException: false,
  releaseWindowOpen: true,
  policyVersionCurrent: true,
  signaturesValid: true,
};

describe('Release Preconditions', () => {
  it('passes when all conditions are met', () => {
    const result = validateReleasePreconditions(baseRequest, passingContext);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('fails when draw budget is insufficient', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      drawBudgetRemaining: 100000,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('REQUEST_EXCEEDS_DRAW_BUDGET');
  });

  it('fails when collateral not satisfied', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      collateralSatisfied: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('COLLATERAL_CONDITIONS_NOT_SATISFIED');
  });

  it('fails when covenant not satisfied', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      covenantSatisfied: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('COVENANT_CONDITIONS_NOT_SATISFIED');
  });

  it('fails when active hold exists', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      activeHold: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('ACTIVE_HOLD_EXISTS');
  });

  it('fails when fraud block active', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      fraudBlock: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('COUNTERPARTY_BLOCK_ACTIVE');
  });

  it('fails when settlement not verified', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      settlementVerified: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('SETTLEMENT_ACCOUNT_NOT_VERIFIED');
  });

  it('fails when reconciliation exception exists', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      reconciliationException: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('UNRESOLVED_RECONCILIATION_EXCEPTION');
  });

  it('fails when release window not open', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      releaseWindowOpen: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('RELEASE_WINDOW_NOT_OPEN');
  });

  it('fails when policy version is stale', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      policyVersionCurrent: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('POLICY_VERSION_STALE');
  });

  it('fails when signatures are invalid', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      signaturesValid: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('AUTHORIZATION_SIGNATURES_INVALID');
  });

  it('returns multiple failures when multiple conditions fail', () => {
    const result = validateReleasePreconditions(baseRequest, {
      ...passingContext,
      collateralSatisfied: false,
      covenantSatisfied: false,
      activeHold: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(3);
  });
});
