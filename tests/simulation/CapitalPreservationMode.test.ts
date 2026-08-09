/**
 * DIBS Tests — Capital Preservation Mode Simulation
 *
 * Tests the dynamic capital floor trigger, reserve-rebuild constraints,
 * and withdrawal/distribution restrictions during preservation mode.
 */

import { calculateJuniorRatio, isCapitalPreservationMode, canReleaseReserve } from '../../shared/formulas';

describe('Capital Preservation Mode', () => {
  describe('JuniorRatio calculation', () => {
    it('calculates ratio when both NAVs are positive', () => {
      expect(calculateJuniorRatio(30, 70)).toBe(0.3);
    });

    it('returns 0 when total NAV is 0', () => {
      expect(calculateJuniorRatio(0, 0)).toBe(0);
    });

    it('returns 1 when Sentinel NAV is 0', () => {
      expect(calculateJuniorRatio(100, 0)).toBe(1);
    });
  });

  describe('Capital Preservation trigger', () => {
    it('triggers when junior ratio falls below minimum', () => {
      expect(isCapitalPreservationMode(0.15, 0.20)).toBe(true);
    });

    it('does not trigger when ratio meets minimum', () => {
      expect(isCapitalPreservationMode(0.20, 0.20)).toBe(false);
    });

    it('does not trigger when ratio exceeds minimum', () => {
      expect(isCapitalPreservationMode(0.35, 0.25)).toBe(false);
    });
  });

  describe('Reserve release', () => {
    it('allows release when ratio restored and liquidity tests pass', () => {
      expect(canReleaseReserve(0.25, 0.20, true)).toBe(true);
    });

    it('blocks release when ratio still below minimum', () => {
      expect(canReleaseReserve(0.15, 0.20, true)).toBe(false);
    });

    it('blocks release when liquidity tests fail', () => {
      expect(canReleaseReserve(0.30, 0.20, false)).toBe(false);
    });
  });
});
