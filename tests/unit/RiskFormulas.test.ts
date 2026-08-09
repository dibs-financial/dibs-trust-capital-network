/**
 * DIBS Tests — Risk Formulas
 *
 * Tests all shared financial/risk calculations.
 */

import {
  calculateJuniorRatio,
  isCapitalPreservationMode,
  canReleaseReserve,
  calculateLTV,
  calculateDSCR,
  calculateDebtYield,
  calculateArbitrageSpread,
  calculateRAYE,
  calculateEnterpriseLTV,
  calculateAUMRevenue,
  calculatePostMoney,
  calculateInvestorOwnership,
  calculatePricePerShare,
  calculatePresentValue,
  calculateProbabilityAdjusted,
} from '../../shared/formulas';

describe('Risk Formulas', () => {
  describe('Dynamic Capital Floor', () => {
    it('calculates junior ratio', () => {
      expect(calculateJuniorRatio(25, 75)).toBe(0.25);
    });
  });

  describe('LTV', () => {
    it('calculates LTV', () => {
      expect(calculateLTV(750000, 1000000)).toBe(0.75);
    });
    it('returns Infinity for zero collateral', () => {
      expect(calculateLTV(100, 0)).toBe(Infinity);
    });
  });

  describe('DSCR', () => {
    it('calculates DSCR', () => {
      expect(calculateDSCR(125000, 100000)).toBe(1.25);
    });
  });

  describe('Arbitrage Spread', () => {
    it('calculates positive spread', () => {
      const spread = calculateArbitrageSpread(0.10, 0.04);
      expect(spread).toBeGreaterThan(0);
    });
    it('applies liquidity haircut', () => {
      const spread = calculateArbitrageSpread(0.10, 0.04, 0.20, 0);
      expect(spread).toBeLessThan(calculateArbitrageSpread(0.10, 0.04, 0, 0));
    });
    it('applies tax rate', () => {
      const spread = calculateArbitrageSpread(0.10, 0.04, 0, 0.30);
      expect(spread).toBeLessThan(calculateArbitrageSpread(0.10, 0.04, 0, 0));
    });
  });

  describe('RAYE', () => {
    it('calculates risk-adjusted yield efficiency', () => {
      expect(calculateRAYE(100000, 500000)).toBe(0.2);
    });
    it('returns 0 for zero capital at risk', () => {
      expect(calculateRAYE(100000, 0)).toBe(0);
    });
  });

  describe('Enterprise LTV', () => {
    it('calculates enterprise LTV', () => {
      expect(calculateEnterpriseLTV(55000, 0.75, 0.10)).toBe(412500);
    });
  });

  describe('AUM Revenue', () => {
    it('calculates at 50 bps', () => {
      expect(calculateAUMRevenue(1000000, 0.005)).toBe(5000);
    });
    it('calculates at 40 bps', () => {
      expect(calculateAUMRevenue(1000000, 0.004)).toBe(4000);
    });
  });

  describe('Equity Mechanics', () => {
    it('calculates post-money', () => {
      expect(calculatePostMoney(9000000, 2000000)).toBe(11000000);
    });
    it('calculates investor ownership', () => {
      expect(calculateInvestorOwnership(2000000, 11000000)).toBeCloseTo(0.1818, 4);
    });
    it('calculates price per share', () => {
      expect(calculatePricePerShare(9000000, 10000000)).toBe(0.9);
    });
  });

  describe('DCF', () => {
    it('calculates present value', () => {
      const pv = calculatePresentValue(57400000, 0.50, 5);
      expect(pv).toBeCloseTo(7558848, -1);
    });
    it('applies survival probability', () => {
      const pv = calculatePresentValue(57400000, 0.50, 5);
      const adjusted = calculateProbabilityAdjusted(pv, 0.55);
      expect(adjusted).toBeCloseTo(4157366, -1);
    });
  });
});
