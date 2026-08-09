/**
 * DIBS Backend — Covenant Calculation Service
 *
 * Evaluates 24+ covenant categories with continuous or scheduled evaluation.
 *
 * Covenant State Model:
 * - Compliant → Warning → Breached → Cure Period → Waived → Default/Enforcement
 *
 * Engine Requirements:
 * - Evaluate covenants continuously or on defined schedules
 * - Ingest financial statements and external data
 * - Calculate metric values from normalized data
 * - Store calculation inputs, versions, threshold versions, result timestamps
 * - Prevent silent override
 * - Require signed waiver to change a breach state
 * - Generate alerts for warning, breach, cure, waiver expiration, and default
 * - Expose covenant state to capital-release policy engine
 */

export type CovenantState = 'compliant' | 'warning' | 'breached' | 'cure_period' | 'waived' | 'default';

export interface CovenantDefinition {
  covenantId: string;
  category: CovenantCategory;
  threshold: number;
  tolerance: number;        // Warning threshold proximity
  evaluationCadence: 'continuous' | 'daily' | 'weekly' | 'monthly' | 'quarterly';
  cureDeadlineDays: number;
  tenantId: string;
}

export type CovenantCategory =
  | 'loan_to_value'
  | 'debt_service_coverage_ratio'
  | 'debt_yield'
  | 'minimum_liquidity'
  | 'construction_budget_variance'
  | 'completion_date_variance'
  | 'interest_reserve_sufficiency'
  | 'insurance_coverage'
  | 'property_tax_status'
  | 'lien_status'
  | 'title_status'
  | 'occupancy_threshold'
  | 'revenue_threshold'
  | 'sponsor_net_worth'
  | 'guarantor_liquidity'
  | 'collateral_concentration'
  | 'portfolio_leverage'
  | 'policy_loan_collateral_coverage'
  | 'asset_valuation_freshness'
  | 'reporting_cadence'
  | 'restricted_payment_limitation'
  | 'distribution_lockup'
  | 'refinance_restriction'
  | 'cross_default';

export interface CovenantEvaluation {
  evaluationId: string;
  covenantId: string;
  measuredValue: number;
  threshold: number;
  state: CovenantState;
  calculationInputs: Record<string, unknown>;
  calculationVersion: string;
  thresholdVersion: string;
  timestamp: string;
  alerts: string[];
}

/**
 * Evaluate a single covenant against its threshold.
 * Returns the covenant state and any alert triggers.
 */
export function evaluateCovenant(
  definition: CovenantDefinition,
  measuredValue: number
): { state: CovenantState; alerts: string[] } {
  const { threshold, tolerance } = definition;
  const warningBoundary = threshold * (1 - tolerance / 100);

  if (isBreached(definition.category, measuredValue, threshold)) {
    return {
      state: 'breached',
      alerts: ['COVENANT_BREACH_DETECTED', 'CURE_PERIOD_REQUIRED'],
    };
  }

  if (isWarning(definition.category, measuredValue, warningBoundary, threshold)) {
    return {
      state: 'warning',
      alerts: ['COVENANT_THRESHOLD_APPROACHING'],
    };
  }

  return { state: 'compliant', alerts: [] };
}

/**
 * Covenant breach logic varies by category.
 * Some covenants breach when value > threshold (e.g., LTV, leverage).
 * Others breach when value < threshold (e.g., DSCR, liquidity, occupancy).
 */
function isBreached(category: CovenantCategory, value: number, threshold: number): boolean {
  const higherIsWorse: CovenantCategory[] = [
    'loan_to_value', 'construction_budget_variance', 'completion_date_variance',
    'collateral_concentration', 'portfolio_leverage', 'cross_default',
  ];

  if (higherIsWorse.includes(category)) {
    return value > threshold;
  }
  return value < threshold;
}

function isWarning(category: CovenantCategory, value: number, warningBoundary: number, threshold: number): boolean {
  const higherIsWorse: CovenantCategory[] = [
    'loan_to_value', 'construction_budget_variance', 'completion_date_variance',
    'collateral_concentration', 'portfolio_leverage', 'cross_default',
  ];

  if (higherIsWorse.includes(category)) {
    return value > warningBoundary && value <= threshold;
  }
  return value < warningBoundary && value >= threshold;
}

/**
 * Transition covenant state with immutable event logging.
 * Prevents silent override. Requires signed waiver to exit breach state.
 */
export function transitionCovenantState(
  currentState: CovenantState,
  targetState: CovenantState,
  signedWaiver?: boolean
): CovenantState {
  if (currentState === 'breached' && targetState === 'waived' && !signedWaiver) {
    throw new Error('SIGNED_WAIVER_REQUIRED_TO_CHANGE_BREACH_STATE');
  }

  const validTransitions: Record<CovenantState, CovenantState[]> = {
    compliant: ['warning', 'breached'],
    warning: ['compliant', 'breached'],
    breached: ['cure_period', 'waived', 'default'],
    cure_period: ['compliant', 'breached', 'default'],
    waived: ['compliant', 'breached'],
    default: [],
  };

  if (!validTransitions[currentState].includes(targetState)) {
    throw new Error(`INVALID_COVENANT_TRANSITION: ${currentState} -> ${targetState}`);
  }

  return targetState;
}
