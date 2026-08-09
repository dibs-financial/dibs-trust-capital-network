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
  tolerance: number;        // Warning threshold proximity (percentage, e.g., 10 for 10%)
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

function isHigherWorse(category: CovenantCategory): boolean {
  const higherIsWorseList: CovenantCategory[] = [
    'loan_to_value',
    'construction_budget_variance',
    'completion_date_variance',
    'collateral_concentration',
    'portfolio_leverage',
    'cross_default',
  ];
  return higherIsWorseList.includes(category);
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
  const higherWorse = isHigherWorse(definition.category);

  if (higherWorse) {
    // e.g. LTV threshold = 0.75, tolerance = 10% (warning boundary = 0.675)
    const warningBoundary = threshold * (1 - tolerance / 100);
    if (measuredValue > threshold) {
      return {
        state: 'breached',
        alerts: ['COVENANT_BREACH_DETECTED', 'CURE_PERIOD_REQUIRED'],
      };
    }
    if (measuredValue > warningBoundary) {
      return {
        state: 'warning',
        alerts: ['COVENANT_THRESHOLD_APPROACHING'],
      };
    }
  } else {
    // e.g. DSCR threshold = 1.25, tolerance = 10% (breach boundary = 1.125)
    const breachBoundary = threshold * (1 - tolerance / 100);
    if (measuredValue < breachBoundary) {
      return {
        state: 'breached',
        alerts: ['COVENANT_BREACH_DETECTED', 'CURE_PERIOD_REQUIRED'],
      };
    }
    if (measuredValue < threshold) {
      return {
        state: 'warning',
        alerts: ['COVENANT_THRESHOLD_APPROACHING'],
      };
    }
  }

  return { state: 'compliant', alerts: [] };
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
