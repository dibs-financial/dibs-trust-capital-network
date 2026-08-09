/**
 * DIBS Tests — Covenant Engine Unit Tests
 *
 * Tests covenant evaluation, state transitions, breach detection,
 * warning thresholds, and signed-waiver requirements.
 */

import {
  evaluateCovenant,
  transitionCovenantState,
  CovenantDefinition,
} from '../../backend/covenant/covenant-engine';

describe('Covenant Engine', () => {
  const baseDefinition: CovenantDefinition = {
    covenantId: 'cov_1',
    category: 'loan_to_value',
    threshold: 0.75,
    tolerance: 10,
    evaluationCadence: 'monthly',
    cureDeadlineDays: 30,
    tenantId: 'tenant_1',
  };

  describe('evaluateCovenant', () => {
    it('returns compliant when value is within threshold', () => {
      const result = evaluateCovenant(baseDefinition, 0.60);
      expect(result.state).toBe('compliant');
      expect(result.alerts).toHaveLength(0);
    });

    it('returns warning when value approaches threshold', () => {
      const result = evaluateCovenant(baseDefinition, 0.70);
      expect(result.state).toBe('warning');
      expect(result.alerts).toContain('COVENANT_THRESHOLD_APPROACHING');
    });

    it('returns breached when LTV exceeds threshold', () => {
      const result = evaluateCovenant(baseDefinition, 0.80);
      expect(result.state).toBe('breached');
      expect(result.alerts).toContain('COVENANT_BREACH_DETECTED');
    });

    it('returns breached when DSCR falls below threshold (lower-is-worse)', () => {
      const dscrDefinition: CovenantDefinition = {
        ...baseDefinition,
        category: 'debt_service_coverage_ratio',
        threshold: 1.25,
        tolerance: 10,
      };
      const result = evaluateCovenant(dscrDefinition, 1.0);
      expect(result.state).toBe('breached');
    });

    it('returns warning when DSCR approaches threshold from above', () => {
      const dscrDefinition: CovenantDefinition = {
        ...baseDefinition,
        category: 'debt_service_coverage_ratio',
        threshold: 1.25,
        tolerance: 10,
      };
      const result = evaluateCovenant(dscrDefinition, 1.15);
      expect(result.state).toBe('warning');
    });
  });

  describe('transitionCovenantState', () => {
    it('allows compliant to warning transition', () => {
      expect(transitionCovenantState('compliant', 'warning')).toBe('warning');
    });

    it('allows warning to breached transition', () => {
      expect(transitionCovenantState('warning', 'breached')).toBe('breached');
    });

    it('allows breached to cure_period transition', () => {
      expect(transitionCovenantState('breached', 'cure_period')).toBe('cure_period');
    });

    it('requires signed waiver for breached to waived', () => {
      expect(() => transitionCovenantState('breached', 'waived', false)).toThrow(
        'SIGNED_WAIVER_REQUIRED_TO_CHANGE_BREACH_STATE'
      );
    });

    it('allows breached to waived with signed waiver', () => {
      expect(transitionCovenantState('breached', 'waived', true)).toBe('waived');
    });

    it('allows cure_period to compliant (cure successful)', () => {
      expect(transitionCovenantState('cure_period', 'compliant')).toBe('compliant');
    });

    it('allows cure_period to default (cure failed)', () => {
      expect(transitionCovenantState('cure_period', 'default')).toBe('default');
    });

    it('rejects invalid transition from default', () => {
      expect(() => transitionCovenantState('default', 'compliant')).toThrow(
        'INVALID_COVENANT_TRANSITION'
      );
    });

    it('rejects invalid transition from compliant to waived', () => {
      expect(() => transitionCovenantState('compliant', 'waived')).toThrow(
        'INVALID_COVENANT_TRANSITION'
      );
    });
  });
});
