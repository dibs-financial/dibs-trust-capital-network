/**
 * DIBS Tests — Advanced Analytics Engine
 */

import { AnalyticsEngine } from '../../backend/reporting/analytics-engine';
import { EventStore, EventType } from '../../backend/audit/event-store';

describe('Analytics Engine', () => {
  let eventStore: EventStore;
  let analytics: AnalyticsEngine;

  beforeEach(() => {
    eventStore = new EventStore();
    analytics = new AnalyticsEngine(eventStore);
  });

  describe('Dashboard Summary', () => {
    it('generates a complete dashboard summary with all 8 categories', async () => {
      // Seed some events
      await eventStore.append({
        
        
        
        eventType: EventType.CAPITAL_REQUEST_CREATED,
        actorId: 'test',
        actorRole: 'test',
        tenantId: 'tenant_1',
        payloadHash: '0x0',
        policyVersion: 'v1',
        metadata: { requestId: 'req_1', amount: 500000 },
      });

      await eventStore.append({
        
        
        
        eventType: EventType.CAPITAL_REQUEST_APPROVED,
        actorId: 'test',
        actorRole: 'approver',
        tenantId: 'tenant_1',
        payloadHash: '0x1',
        policyVersion: 'v1',
        metadata: { requestId: 'req_1', approverId: 'approver_1' },
      });

      await eventStore.append({
        
        
        
        eventType: EventType.COVENANT_BREACHED,
        actorId: 'system',
        actorRole: 'system',
        tenantId: 'tenant_1',
        payloadHash: '0x2',
        policyVersion: 'v1',
        metadata: { covenantId: 'cov_1', measuredValue: 0.80, threshold: 0.75 },
      });

      const summary = await analytics.generateDashboardSummary('tenant_1');

      expect(summary.tranche).toBeDefined();
      expect(summary.yield).toBeDefined();
      expect(summary.covenants).toBeDefined();
      expect(summary.collateral).toBeDefined();
      expect(summary.capitalFlow).toBeDefined();
      expect(summary.policyLoan).toBeDefined();
      expect(summary.vrdct).toBeDefined();
      expect(summary.portfolio).toBeDefined();
      expect(summary.generatedAt).toBeDefined();
    });
  });

  describe('Capital Flow Analytics', () => {
    it('calculates approval rate from events', async () => {
      await eventStore.append({
          
        eventType: EventType.CAPITAL_REQUEST_CREATED,
        actorId: 'test', actorRole: 'test', tenantId: 'tenant_1',
        payloadHash: '0x0', policyVersion: 'v1', metadata: { requestId: 'r1' },
      });
      await eventStore.append({
          
        eventType: EventType.CAPITAL_REQUEST_APPROVED,
        actorId: 'test', actorRole: 'approver', tenantId: 'tenant_1',
        payloadHash: '0x1', policyVersion: 'v1', metadata: { requestId: 'r1' },
      });
      await eventStore.append({
          
        eventType: EventType.CAPITAL_REQUEST_HELD,
        actorId: 'test', actorRole: 'approver', tenantId: 'tenant_1',
        payloadHash: '0x2', policyVersion: 'v1', metadata: { requestId: 'r2', holdReason: 'MISSING_EVIDENCE' },
      });

      const capitalFlow = await analytics.generateAnalytics('tenant_1', 'capital_flow') as any;

      expect(capitalFlow.totalRequests).toBe(3);
      expect(capitalFlow.approvedCount).toBe(1);
      expect(capitalFlow.heldCount).toBe(1);
      expect(capitalFlow.topHoldReasons).toContainEqual({ reason: 'MISSING_EVIDENCE', count: 1 });
    });
  });

  describe('Covenant Analytics', () => {
    it('counts breaches and calculates breach frequency', async () => {
      for (let i = 0; i < 3; i++) {
        await eventStore.append({
            
          eventType: EventType.COVENANT_BREACHED,
          actorId: 'system', actorRole: 'system', tenantId: 'tenant_1',
          payloadHash: `0x${i}`, policyVersion: 'v1',
          metadata: { covenantId: `cov_${i % 2}`, measuredValue: 0.80, threshold: 0.75 },
        });
      }

      const covenantAnalytics = await analytics.generateAnalytics('tenant_1', 'covenants') as any;

      expect(covenantAnalytics.breachCount).toBe(3);
      expect(covenantAnalytics.mostBreachedCategories.length).toBeGreaterThan(0);
    });
  });

  describe('Tranche Analytics', () => {
    it('counts capital preservation mode triggers', async () => {
      await eventStore.append({
          
        eventType: EventType.CAPITAL_PRESERVATION_TRIGGERED,
        actorId: 'system', actorRole: 'system', tenantId: 'tenant_1',
        payloadHash: '0x0', policyVersion: 'v1', metadata: { juniorRatio: 0.18, minJuniorRatio: 0.20 },
      });

      const trancheAnalytics = await analytics.generateAnalytics('tenant_1', 'tranche') as any;

      expect(trancheAnalytics.preservationModeTriggerCount).toBe(1);
    });
  });
});
