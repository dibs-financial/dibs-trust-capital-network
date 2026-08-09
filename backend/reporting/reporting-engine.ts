/**
 * DIBS Backend — Enterprise Reporting Engine
 *
 * Report types: draw_summary, covenant_status, collateral_health, tranche_nav,
 * reserve_health, covenant_breach_log, capital_request_log, settlement_reconciliation,
 * trust_signal_summary, policy_compliance_audit
 *
 * Report parameters: tenantId, dateRange, entityScope, projectScope, assetScope
 * Export formats: JSON (default), CSV (tabular reports)
 */

import { EventStore, ImmutableEvent } from '../audit/event-store';
import { VRDCTAdapter } from '../adapters/vrdct-adapter';

export type ReportType =
  | 'draw_summary'
  | 'covenant_status'
  | 'collateral_health'
  | 'tranche_nav'
  | 'reserve_health'
  | 'covenant_breach_log'
  | 'capital_request_log'
  | 'settlement_reconciliation'
  | 'trust_signal_summary'
  | 'policy_compliance_audit';

export interface ReportParams {
  tenantId: string;
  dateFrom?: string;
  dateTo?: string;
  entityScope?: string;
  projectScope?: string;
  assetScope?: string;
  format?: 'json' | 'csv';
}

export interface Report {
  reportId: string;
  reportType: ReportType;
  generatedAt: string;
  params: ReportParams;
  data: Record<string, unknown>[];
  summary: Record<string, unknown>;
}

export class ReportingEngine {
  constructor(
    private eventStore: EventStore,
    private vrdctAdapter?: VRDCTAdapter
  ) {}

  /**
   * Generate a report by type.
   */
  async generateReport(type: ReportType, params: ReportParams): Promise<Report> {
    switch (type) {
      case 'draw_summary':
        return this.generateDrawSummary(params);
      case 'covenant_status':
        return this.generateCovenantStatus(params);
      case 'collateral_health':
        return this.generateCollateralHealth(params);
      case 'tranche_nav':
        return this.generateTrancheNAV(params);
      case 'reserve_health':
        return this.generateReserveHealth(params);
      case 'covenant_breach_log':
        return this.generateCovenantBreachLog(params);
      case 'capital_request_log':
        return this.generateCapitalRequestLog(params);
      case 'settlement_reconciliation':
        return this.generateSettlementReconciliation(params);
      case 'trust_signal_summary':
        return this.generateTrustSignalSummary(params);
      case 'policy_compliance_audit':
        return this.generatePolicyComplianceAudit(params);
      default:
        throw new Error(`UNKNOWN_REPORT_TYPE: ${type}`);
    }
  }

  /**
   * Draw Summary — aggregate capital request and release data.
   */
  private async generateDrawSummary(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const capitalEvents = events.filter(e =>
      e.eventType.startsWith('CAPITAL_REQUEST') || e.eventType.startsWith('RELEASE')
    );

    const approved = capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_APPROVED').length;
    const held = capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_HELD').length;
    const rejected = capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_REJECTED').length;

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'draw_summary',
      generatedAt: new Date().toISOString(),
      params,
      data: capitalEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType })),
      summary: { total: capitalEvents.length, approved, held, rejected },
    };
  }

  /**
   * Covenant Status — current covenant states and warnings.
   */
  private async generateCovenantStatus(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const covenantEvents = events.filter(e => e.eventType.startsWith('COVENANT'));

    const compliant = covenantEvents.filter(e => e.eventType === 'COVENANT_COMPLIANT').length;
    const warnings = covenantEvents.filter(e => e.eventType === 'COVENANT_WARNING').length;
    const breached = covenantEvents.filter(e => e.eventType === 'COVENANT_BREACHED').length;

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'covenant_status',
      generatedAt: new Date().toISOString(),
      params,
      data: covenantEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType })),
      summary: { total: covenantEvents.length, compliant, warnings, breached },
    };
  }

  /**
   * Collateral Health — collateral flags and risk indicators.
   */
  private async generateCollateralHealth(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const collateralEvents = events.filter(e => e.eventType.startsWith('COLLATERAL'));

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'collateral_health',
      generatedAt: new Date().toISOString(),
      params,
      data: collateralEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType })),
      summary: { totalFlags: collateralEvents.length },
    };
  }

  /**
   * Tranche NAV — Sentinel/Catalyst NAV, junior ratio, preservation mode state.
   */
  private async generateTrancheNAV(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const trancheEvents = events.filter(e =>
      e.eventType.startsWith('CAPITAL_PRESERVATION') ||
      e.eventType.startsWith('RESERVE') ||
      e.eventType.startsWith('DISTRIBUTION') ||
      e.eventType.startsWith('RECAPITALIZATION')
    );

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'tranche_nav',
      generatedAt: new Date().toISOString(),
      params,
      data: trancheEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType })),
      summary: { totalEvents: trancheEvents.length },
    };
  }

  /**
   * Reserve Health — reserve balance, shortfall, release history.
   */
  private async generateReserveHealth(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const reserveEvents = events.filter(e => e.eventType.startsWith('RESERVE'));

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'reserve_health',
      generatedAt: new Date().toISOString(),
      params,
      data: reserveEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType })),
      summary: { totalReleases: reserveEvents.length },
    };
  }

  /**
   * Covenant Breach Log — all breach events with cure tracking.
   */
  private async generateCovenantBreachLog(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const breachEvents = events.filter(e =>
      e.eventType === 'COVENANT_BREACHED' ||
      e.eventType === 'COVENANT_CURE_ENTERED' ||
      e.eventType === 'COVENANT_DEFAULT' ||
      e.eventType === 'COVENANT_WAIVED'
    );

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'covenant_breach_log',
      generatedAt: new Date().toISOString(),
      params,
      data: breachEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType })),
      summary: {
        breaches: breachEvents.filter(e => e.eventType === 'COVENANT_BREACHED').length,
        cures: breachEvents.filter(e => e.eventType === 'COVENANT_CURE_ENTERED').length,
        defaults: breachEvents.filter(e => e.eventType === 'COVENANT_DEFAULT').length,
        waivers: breachEvents.filter(e => e.eventType === 'COVENANT_WAIVED').length,
      },
    };
  }

  /**
   * Capital Request Log — full audit trail of all capital requests.
   */
  private async generateCapitalRequestLog(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const requestEvents = events.filter(e => e.eventType.startsWith('CAPITAL_REQUEST'));

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'capital_request_log',
      generatedAt: new Date().toISOString(),
      params,
      data: requestEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType, actorId: e.actorId, actorRole: e.actorRole })),
      summary: { total: requestEvents.length },
    };
  }

  /**
   * Settlement Reconciliation — settlement instructions and match status.
   */
  private async generateSettlementReconciliation(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const settlementEvents = events.filter(e => e.eventType.startsWith('SETTLEMENT'));

    const sent = settlementEvents.filter(e => e.eventType === 'SETTLEMENT_INSTRUCTION_SENT').length;
    const confirmed = settlementEvents.filter(e => e.eventType === 'SETTLEMENT_CONFIRMED').length;
    const exceptions = settlementEvents.filter(e => e.eventType === 'SETTLEMENT_EXCEPTION').length;

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'settlement_reconciliation',
      generatedAt: new Date().toISOString(),
      params,
      data: settlementEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType })),
      summary: { sent, confirmed, exceptions, matchRate: sent > 0 ? confirmed / sent : 0 },
    };
  }

  /**
   * Trust Signal Summary — VRDCT trust scores and adverse actions.
   */
  private async generateTrustSignalSummary(params: ReportParams): Promise<Report> {
    if (!this.vrdctAdapter) {
      return {
        reportId: `rpt_${Date.now()}`,
        reportType: 'trust_signal_summary',
        generatedAt: new Date().toISOString(),
        params,
        data: [],
        summary: { error: 'VRDCT adapter not configured' },
      };
    }

    // TODO: Aggregate trust scores across all entities for tenant
    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'trust_signal_summary',
      generatedAt: new Date().toISOString(),
      params,
      data: [],
      summary: { totalEntities: 0, pendingAdverseNotices: 0 },
    };
  }

  /**
   * Policy Compliance Audit — authorization events and policy version tracking.
   */
  private async generatePolicyComplianceAudit(params: ReportParams): Promise<Report> {
    const events = await this.eventStore.getByTenant(params.tenantId);
    const authEvents = events.filter(e =>
      e.eventType.startsWith('AUTHORIZATION') ||
      e.eventType.startsWith('EMERGENCY')
    );

    return {
      reportId: `rpt_${Date.now()}`,
      reportType: 'policy_compliance_audit',
      generatedAt: new Date().toISOString(),
      params,
      data: authEvents.map(e => ({ ...e.metadata, timestamp: e.timestamp, eventType: e.eventType, actorId: e.actorId, actorRole: e.actorRole, policyVersion: e.policyVersion })),
      summary: { totalEvents: authEvents.length },
    };
  }

  /**
   * Real-time dashboard data — aggregate for WebSocket telemetry.
   */
  async getDashboardData(tenantId: string): Promise<{
    capitalRequests: number;
    covenants: number;
    collateralFlags: number;
    trancheEvents: number;
    settlementEvents: number;
    authorizationEvents: number;
    recentEvents: ImmutableEvent[];
  }> {
    const events = await this.eventStore.getByTenant(tenantId, 0, 100);

    return {
      capitalRequests: events.filter(e => e.eventType.startsWith('CAPITAL_REQUEST')).length,
      covenants: events.filter(e => e.eventType.startsWith('COVENANT')).length,
      collateralFlags: events.filter(e => e.eventType.startsWith('COLLATERAL')).length,
      trancheEvents: events.filter(e =>
        e.eventType.startsWith('CAPITAL_PRESERVATION') ||
        e.eventType.startsWith('RESERVE') ||
        e.eventType.startsWith('DISTRIBUTION')
      ).length,
      settlementEvents: events.filter(e => e.eventType.startsWith('SETTLEMENT')).length,
      authorizationEvents: events.filter(e => e.eventType.startsWith('AUTHORIZATION')).length,
      recentEvents: events.slice(0, 20),
    };
  }

  /**
   * Export report data as CSV (for tabular reports).
   */
  exportCSV(report: Report): string {
    if (report.data.length === 0) return '';

    const headers = Object.keys(report.data[0]);
    const rows = report.data.map(row =>
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
  }
}
