/**
 * DIBS Tests — VRDCT Trust Signals
 */

import { VRDCTAdapter, isProtectedClassProxy, generateReasonCodes, VRDCTSignal } from '../../backend/adapters/vrdct-adapter';
import { EventStore } from '../../backend/audit/event-store';

describe('VRDCT Trust Adapter', () => {
  let adapter: VRDCTAdapter;

  beforeEach(() => {
    const eventStore = new EventStore();
    adapter = new VRDCTAdapter(eventStore);
  });

  describe('Signal Recording', () => {
    it('records a valid consented signal', async () => {
      const signal = await adapter.recordSignal({
        category: 'counterparty',
        signalType: 'identity_verification',
        entityId: 'entity_1',
        value: 95,
        normalizedScore: 95,
        dataSource: 'KYC_PROVIDER',
        consentStatus: true,
        refreshDate: new Date().toISOString(),
        calculationVersion: 'v1.0.0',
        isAdverse: false,
      });

      expect(signal.signalId).toBeDefined();
      expect(signal.reasonCodes).toContain('COMPLIANT: Signal within acceptable parameters');
    });

    it('rejects non-consented signals', async () => {
      await expect(
        adapter.recordSignal({
          category: 'counterparty',
          signalType: 'dispute_frequency',
          entityId: 'entity_1',
          value: 80,
          normalizedScore: 80,
          dataSource: 'INTERNAL',
          consentStatus: false,
          refreshDate: new Date().toISOString(),
          calculationVersion: 'v1.0.0',
          isAdverse: false,
        })
      ).rejects.toThrow('NON_CONSENTED_INPUT');
    });

    it('generates adverse reason codes for low scores', async () => {
      const signal = await adapter.recordSignal({
        category: 'counterparty',
        signalType: 'covenant_breach_history',
        entityId: 'entity_1',
        value: 20,
        normalizedScore: 20,
        dataSource: 'COVENANT_ENGINE',
        consentStatus: true,
        refreshDate: new Date().toISOString(),
        calculationVersion: 'v1.0.0',
        isAdverse: true,
      });

      expect(signal.reasonCodes).toContain('LOW_SCORE: covenant_breach_history score below 30');
      expect(signal.reasonCodes).toContain('ADVERSE: covenant_breach_history indicates adverse behavior');
      expect(signal.requiresHumanReview).toBe(true);
    });
  });

  describe('Protected Class Proxy Detection', () => {
    it('rejects signals containing zip_code', () => {
      const signal: VRDCTSignal = {
        signalId: 'sig_1',
        category: 'counterparty',
        signalType: 'payment_account_stability',
        entityId: 'entity_1',
        value: 50,
        normalizedScore: 50,
        dataSource: 'INTERNAL:zip_code_lookup',
        consentStatus: true,
        refreshDate: new Date().toISOString(),
        calculationVersion: 'v1.0.0',
        reasonCodes: [],
        isAdverse: false,
        requiresHumanReview: false,
      };

      expect(isProtectedClassProxy(signal)).toBe(true);
    });

    it('accepts signals without protected class proxies', () => {
      const signal: VRDCTSignal = {
        signalId: 'sig_2',
        category: 'counterparty',
        signalType: 'invoice_consistency',
        entityId: 'entity_1',
        value: 85,
        normalizedScore: 85,
        dataSource: 'INVOICE_VALIDATOR',
        consentStatus: true,
        refreshDate: new Date().toISOString(),
        calculationVersion: 'v1.0.0',
        reasonCodes: [],
        isAdverse: false,
        requiresHumanReview: false,
      };

      expect(isProtectedClassProxy(signal)).toBe(false);
    });
  });

  describe('Trust Score Calculation', () => {
    it('calculates weighted score from counterparty and project signals', async () => {
      await adapter.recordSignal({
        category: 'counterparty',
        signalType: 'identity_verification',
        entityId: 'entity_1',
        value: 90,
        normalizedScore: 90,
        dataSource: 'KYC_PROVIDER',
        consentStatus: true,
        refreshDate: new Date().toISOString(),
        calculationVersion: 'v1.0.0',
        isAdverse: false,
      });

      await adapter.recordSignal({
        category: 'project',
        signalType: 'budget_adherence',
        entityId: 'entity_1',
        value: 80,
        normalizedScore: 80,
        dataSource: 'BUDGET_ENGINE',
        consentStatus: true,
        refreshDate: new Date().toISOString(),
        calculationVersion: 'v1.0.0',
        isAdverse: false,
      });

      const score = adapter.calculateTrustScore('entity_1', 0.4);
      expect(score.counterpartyScore).toBe(90);
      expect(score.projectScore).toBe(80);
      expect(score.overallScore).toBeCloseTo(86, 0);
      expect(score.signalCount).toBe(2);
    });

    it('returns 50 for entity with no signals', () => {
      const score = adapter.calculateTrustScore('unknown_entity');
      expect(score.overallScore).toBe(50);
      expect(score.signalCount).toBe(0);
    });
  });

  describe('Adverse Action', () => {
    it('creates adverse action notice for material adverse signals', async () => {
      await adapter.recordSignal({
        category: 'counterparty',
        signalType: 'fraud_alert_history',
        entityId: 'entity_1',
        value: 15,
        normalizedScore: 15,
        dataSource: 'FRAUD_DETECTOR',
        consentStatus: true,
        refreshDate: new Date().toISOString(),
        calculationVersion: 'v1.0.0',
        isAdverse: true,
      });

      const notices = adapter.getPendingAdverseNotices('entity_1');
      expect(notices.length).toBe(1);
      expect(notices[0].humanReviewRequired).toBe(true);
    });

    it('resolves adverse action notice after human review', async () => {
      await adapter.recordSignal({
        category: 'counterparty',
        signalType: 'sanctions_compliance_exceptions',
        entityId: 'entity_1',
        value: 10,
        normalizedScore: 10,
        dataSource: 'SANCTIONS_SCREENING',
        consentStatus: true,
        refreshDate: new Date().toISOString(),
        calculationVersion: 'v1.0.0',
        isAdverse: true,
      });

      const notices = adapter.getPendingAdverseNotices('entity_1');
      const noticeId = notices[0].noticeId;

      const resolved = adapter.resolveAdverseAction(noticeId, 'reviewer_1', 'cleared', 'False positive — entity cleared by manual KYC');
      expect(resolved.reviewStatus).toBe('cleared');
      expect(resolved.reviewerId).toBe('reviewer_1');
    });
  });
});
