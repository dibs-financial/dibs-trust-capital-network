/**
 * DIBS Backend — Advanced Analytics Engine
 *
 * Build Step 18: Advanced analytics for tranche health, risk-adjusted yield,
 * covenant trends, collateral exposure, and policy-loan arbitrage performance.
 *
 * Analytics Categories:
 * 1. Tranche Analytics — NAV trends, junior ratio history, reserve coverage, withdrawal queue metrics
 * 2. Risk-Adjusted Yield — RAYE tracking, yield decomposition, loss attribution
 * 3. Covenant Analytics — breach frequency, cure duration, waiver impact, covenant stability scores
 * 4. Collateral Analytics — LTV distribution, valuation freshness, lien/flag frequency
 * 5. Capital Flow Analytics — draw approval rates, hold/reject patterns, settlement timing
 * 6. Policy-Loan Analytics — spread performance, LTV creep trends, lapse risk indicators
 * 7. VRDCT Analytics — trust score distributions, signal correlations, adverse action rates
 * 8. Portfolio Analytics — concentration, leverage, duration, liquidity
 */

import { EventStore, ImmutableEvent } from '../audit/event-store';
import { calculateJuniorRatio, calculateRAYE, calculateLTV, calculateDSCR } from '../../shared/formulas';

export interface AnalyticsTimeRange {
  from: string;
  to: string;
}

export interface TrancheAnalytics {
  navSentinelTrend: { timestamp: string; value: number }[];
  navCatalystTrend: { timestamp: string; value: number }[];
  juniorRatioTrend: { timestamp: string; value: number }[];
  minJuniorRatio: number;
  preservationModeTriggerCount: number;
  preservationModeDurationHours: number;
  reserveCoverageRatio: number;
  withdrawalQueueDepth: number;
  avgWithdrawalQueueTimeHours: number;
  currentLiquidityState: 'healthy' | 'constrained' | 'restricted';
}

export interface RiskAdjustedYieldAnalytics {
  rayeHistory: { timestamp: string; value: number }[];
  currentRAYE: number;
  avgRAYE: number;
  yieldDecomposition: {
    grossYield: number;
    losses: number;
    fees: number;
    reserveContributions: number;
    operatingCosts: number;
    netYield: number;
  };
  lossAttribution: {
    catalystLosses: number;
    sentinelLosses: number;
    totalRealizedLosses: number;
    lossRecoveryRate: number;
  };
  economicCapitalAtRisk: number;
}

export interface CovenantAnalytics {
  totalCovenants: number;
  breachCount: number;
  breachFrequency: number; // breaches per month
  avgCureDurationDays: number;
  waiverCount: number;
  waiverImpactScore: number;
  covenantStabilityScores: Record<string, number>; // covenantId → stability (0-100)
  mostBreachedCategories: { category: string; count: number }[];
  warningToBreachConversionRate: number;
}

export interface CollateralAnalytics {
  ltvDistribution: { range: string; count: number }[];
  avgLTV: number;
  maxLTV: number;
  staleAppraisalCount: number;
  lienFlagCount: number;
  titleDefectCount: number;
  insuranceLapseCount: number;
  collateralConcentrationByType: { assetType: string; count: number; totalValue: number }[];
  valuationFreshnessAvgDays: number;
}

export interface CapitalFlowAnalytics {
  totalRequests: number;
  approvedCount: number;
  heldCount: number;
  rejectedCount: number;
  escalatedCount: number;
  approvalRate: number;
  holdRate: number;
  rejectRate: number;
  avgTimeToApprovalHours: number;
  avgTimeToSettlementHours: number;
  topHoldReasons: { reason: string; count: number }[];
  topRejectReasons: { reason: string; count: number }[];
  drawCategoryDistribution: { category: string; count: number; totalAmount: number }[];
}

export interface PolicyLoanAnalytics {
  activePolicies: number;
  totalLoanBalance: number;
  totalCashValue: number;
  avgPolicyLTV: number;
  maxPolicyLTV: number;
  avgSpread: number;
  spreadHistory: { timestamp: string; spread: number }[];
  ltvCreepTrend: { timestamp: string; ltv: number }[];
  lapseRiskCount: number;
  premiumDelinquencyCount: number;
  dscrBreaches: number;
  carrierDataStalenessCount: number;
  arbitragePerformance: {
    avgDeploymentYield: number;
    avgLoanCost: number;
    avgNetSpread: number;
    bestSpread: number;
    worstSpread: number;
  };
}

export interface VRDCTAnalytics {
  totalEntities: number;
  avgTrustScore: number;
  trustScoreDistribution: { range: string; count: number }[];
  totalSignals: number;
  adverseSignalCount: number;
  adverseActionRate: number;
  pendingAdverseNotices: number;
  topAdverseSignalTypes: { signalType: string; count: number }[];
  signalRefreshStalenessAvgDays: number;
}

export interface PortfolioAnalytics {
  totalExposure: number;
  concentrationByStrategy: { strategy: string; exposure: number; percentage: number }[];
  concentrationByCollateral: { collateralType: string; exposure: number; percentage: number }[];
  weightedAvgDuration: number;
  weightedAvgLTV: number;
  portfolioDSCR: number;
  liquidityRatio: number;
  leverageRatio: number;
  crossDefaultExposure: number;
}

export interface DashboardSummary {
  tranche: TrancheAnalytics;
  yield: RiskAdjustedYieldAnalytics;
  covenants: CovenantAnalytics;
  collateral: CollateralAnalytics;
  capitalFlow: CapitalFlowAnalytics;
  policyLoan: PolicyLoanAnalytics;
  vrdct: VRDCTAnalytics;
  portfolio: PortfolioAnalytics;
  generatedAt: string;
}

export class AnalyticsEngine {
  constructor(
    private eventStore: EventStore
  ) {}

  /**
   * Generate a full dashboard summary across all analytics categories.
   */
  async generateDashboardSummary(
    tenantId: string,
    timeRange?: AnalyticsTimeRange
  ): Promise<DashboardSummary> {
    const events = await this.eventStore.getByTenant(tenantId, 0, 5000);

    return {
      tranche: this.analyzeTranche(events, timeRange),
      yield: this.analyzeYield(events, timeRange),
      covenants: this.analyzeCovenants(events, timeRange),
      collateral: this.analyzeCollateral(events, timeRange),
      capitalFlow: this.analyzeCapitalFlow(events, timeRange),
      policyLoan: this.analyzePolicyLoan(events, timeRange),
      vrdct: this.analyzeVRDCT(events, timeRange),
      portfolio: this.analyzePortfolio(events, timeRange),
      generatedAt: new Date().toISOString(),
    };
  }

  private analyzeTranche(events: ImmutableEvent[], range?: AnalyticsTimeRange): TrancheAnalytics {
    const trancheEvents = this.filterByRange(events.filter(e =>
      e.eventType.startsWith('CAPITAL_PRESERVATION') ||
      e.eventType.startsWith('RESERVE') ||
      e.eventType.startsWith('DISTRIBUTION') ||
      e.eventType.startsWith('RECAPITALIZATION')
    ), range);

    const preservationTriggers = trancheEvents.filter(e => e.eventType === 'CAPITAL_PRESERVATION_TRIGGERED');
    const preservationLifts = trancheEvents.filter(e => e.eventType === 'CAPITAL_PRESERVATION_LIFTED');

    let preservationDurationHours = 0;
    for (let i = 0; i < preservationTriggers.length; i++) {
      const trigger = preservationTriggers[i];
      const lift = preservationLifts.find(l =>
        new Date(l.timestamp) > new Date(trigger.timestamp)
      );
      if (lift) {
        preservationDurationHours += (new Date(lift.timestamp).getTime() - new Date(trigger.timestamp).getTime()) / (1000 * 60 * 60);
      }
    }

    return {
      navSentinelTrend: [],
      navCatalystTrend: [],
      juniorRatioTrend: [],
      minJuniorRatio: 0.20,
      preservationModeTriggerCount: preservationTriggers.length,
      preservationDurationHours: Math.round(preservationDurationHours * 100) / 100,
      reserveCoverageRatio: 0,
      withdrawalQueueDepth: 0,
      avgWithdrawalQueueTimeHours: 0,
      currentLiquidityState: 'healthy',
    };
  }

  private analyzeYield(events: ImmutableEvent[], range?: AnalyticsTimeRange): RiskAdjustedYieldAnalytics {
    // TODO: Aggregate yield events, calculate RAYE history
    return {
      rayeHistory: [],
      currentRAYE: 0,
      avgRAYE: 0,
      yieldDecomposition: {
        grossYield: 0,
        losses: 0,
        fees: 0,
        reserveContributions: 0,
        operatingCosts: 0,
        netYield: 0,
      },
      lossAttribution: {
        catalystLosses: 0,
        sentinelLosses: 0,
        totalRealizedLosses: 0,
        lossRecoveryRate: 0,
      },
      economicCapitalAtRisk: 0,
    };
  }

  private analyzeCovenants(events: ImmutableEvent[], range?: AnalyticsTimeRange): CovenantAnalytics {
    const covenantEvents = this.filterByRange(events.filter(e => e.eventType.startsWith('COVENANT')), range);

    const breaches = covenantEvents.filter(e => e.eventType === 'COVENANT_BREACHED');
    const cures = covenantEvents.filter(e => e.eventType === 'COVENANT_CURE_ENTERED');
    const waivers = covenantEvents.filter(e => e.eventType === 'COVENANT_WAIVED');
    const warnings = covenantEvents.filter(e => e.eventType === 'COVENANT_WARNING');

    // Category frequency
    const categoryCounts = new Map<string, number>();
    breaches.forEach(e => {
      const cat = (e.metadata as any)?.covenantId || 'unknown';
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    });

    const mostBreached = Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const warningToBreachRate = warnings.length > 0
      ? breaches.length / (warnings.length + breaches.length)
      : 0;

    return {
      totalCovenants: covenantEvents.length,
      breachCount: breaches.length,
      breachFrequency: breaches.length / 12, // Assuming 12 months of data
      avgCureDurationDays: 0, // TODO: Calculate from cure events
      waiverCount: waivers.length,
      waiverImpactScore: 0,
      covenantStabilityScores: {},
      mostBreachedCategories: mostBreached,
      warningToBreachConversionRate: warningToBreachRate,
    };
  }

  private analyzeCollateral(events: ImmutableEvent[], range?: AnalyticsTimeRange): CollateralAnalytics {
    const collateralEvents = this.filterByRange(events.filter(e => e.eventType.startsWith('COLLATERAL')), range);

    const lienFlags = collateralEvents.filter(e =>
      JSON.stringify(e.metadata).toLowerCase().includes('lien')
    ).length;
    const titleFlags = collateralEvents.filter(e =>
      JSON.stringify(e.metadata).toLowerCase().includes('title')
    ).length;
    const insuranceFlags = collateralEvents.filter(e =>
      JSON.stringify(e.metadata).toLowerCase().includes('insurance')
    ).length;

    return {
      ltvDistribution: [],
      avgLTV: 0,
      maxLTV: 0,
      staleAppraisalCount: 0,
      lienFlagCount: lienFlags,
      titleDefectCount: titleFlags,
      insuranceLapseCount: insuranceFlags,
      collateralConcentrationByType: [],
      valuationFreshnessAvgDays: 0,
    };
  }

  private analyzeCapitalFlow(events: ImmutableEvent[], range?: AnalyticsTimeRange): CapitalFlowAnalytics {
    const capitalEvents = this.filterByRange(events.filter(e =>
      e.eventType.startsWith('CAPITAL_REQUEST') || e.eventType.startsWith('RELEASE')
    ), range);

    const approved = capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_APPROVED').length;
    const held = capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_HELD').length;
    const rejected = capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_REJECTED').length;
    const escalated = capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_ESCALATED').length;
    const total = capitalEvents.length || 1;

    // Hold/reject reason aggregation
    const holdReasons = new Map<string, number>();
    capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_HELD').forEach(e => {
      const reason = (e.metadata as any)?.holdReason || 'unknown';
      holdReasons.set(reason, (holdReasons.get(reason) || 0) + 1);
    });

    const rejectReasons = new Map<string, number>();
    capitalEvents.filter(e => e.eventType === 'CAPITAL_REQUEST_REJECTED').forEach(e => {
      const reason = (e.metadata as any)?.failureReason || 'unknown';
      rejectReasons.set(reason, (rejectReasons.get(reason) || 0) + 1);
    });

    // Draw category distribution
    const categoryAmounts = new Map<string, { count: number; totalAmount: number }>();
    capitalEvents.forEach(e => {
      const cat = (e.metadata as any)?.drawCategory || 'unknown';
      const amount = (e.metadata as any)?.amount || 0;
      const existing = categoryAmounts.get(cat) || { count: 0, totalAmount: 0 };
      existing.count++;
      existing.totalAmount += amount;
      categoryAmounts.set(cat, existing);
    });

    return {
      totalRequests: capitalEvents.length,
      approvedCount: approved,
      heldCount: held,
      rejectedCount: rejected,
      escalatedCount: escalated,
      approvalRate: approved / total,
      holdRate: held / total,
      rejectRate: rejected / total,
      avgTimeToApprovalHours: 0, // TODO: Calculate from created → approved timestamps
      avgTimeToSettlementHours: 0, // TODO: Calculate from approved → settled timestamps
      topHoldReasons: Array.from(holdReasons.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      topRejectReasons: Array.from(rejectReasons.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      drawCategoryDistribution: Array.from(categoryAmounts.entries()).map(([category, data]) => ({ category, count: data.count, totalAmount: data.totalAmount })),
    };
  }

  private analyzePolicyLoan(events: ImmutableEvent[], range?: AnalyticsTimeRange): PolicyLoanAnalytics {
    // TODO: Aggregate policy-loan events when policy-loan events are added to the event store
    return {
      activePolicies: 0,
      totalLoanBalance: 0,
      totalCashValue: 0,
      avgPolicyLTV: 0,
      maxPolicyLTV: 0,
      avgSpread: 0,
      spreadHistory: [],
      ltvCreepTrend: [],
      lapseRiskCount: 0,
      premiumDelinquencyCount: 0,
      dscrBreaches: 0,
      carrierDataStalenessCount: 0,
      arbitragePerformance: {
        avgDeploymentYield: 0,
        avgLoanCost: 0,
        avgNetSpread: 0,
        bestSpread: 0,
        worstSpread: 0,
      },
    };
  }

  private analyzeVRDCT(events: ImmutableEvent[], range?: AnalyticsTimeRange): VRDCTAnalytics {
    // TODO: Aggregate VRDCT events when trust signal events are added to the event store
    return {
      totalEntities: 0,
      avgTrustScore: 0,
      trustScoreDistribution: [],
      totalSignals: 0,
      adverseSignalCount: 0,
      adverseActionRate: 0,
      pendingAdverseNotices: 0,
      topAdverseSignalTypes: [],
      signalRefreshStalenessAvgDays: 0,
    };
  }

  private analyzePortfolio(events: ImmutableEvent[], range?: AnalyticsTimeRange): PortfolioAnalytics {
    // TODO: Aggregate portfolio exposure, concentration, duration
    return {
      totalExposure: 0,
      concentrationByStrategy: [],
      concentrationByCollateral: [],
      weightedAvgDuration: 0,
      weightedAvgLTV: 0,
      portfolioDSCR: 0,
      liquidityRatio: 0,
      leverageRatio: 0,
      crossDefaultExposure: 0,
    };
  }

  private filterByRange(events: ImmutableEvent[], range?: AnalyticsTimeRange): ImmutableEvent[] {
    if (!range) return events;
    return events.filter(e => {
      const ts = new Date(e.timestamp);
      return ts >= new Date(range.from) && ts <= new Date(range.to);
    });
  }

  /**
   * Generate a specific analytics report by category.
   */
  async generateAnalytics(
    tenantId: string,
    category: 'tranche' | 'yield' | 'covenants' | 'collateral' | 'capital_flow' | 'policy_loan' | 'vrdct' | 'portfolio',
    timeRange?: AnalyticsTimeRange
  ): Promise<unknown> {
    const events = await this.eventStore.getByTenant(tenantId, 0, 5000);
    const filtered = this.filterByRange(events, timeRange);

    switch (category) {
      case 'tranche': return this.analyzeTranche(filtered, timeRange);
      case 'yield': return this.analyzeYield(filtered, timeRange);
      case 'covenants': return this.analyzeCovenants(filtered, timeRange);
      case 'collateral': return this.analyzeCollateral(filtered, timeRange);
      case 'capital_flow': return this.analyzeCapitalFlow(filtered, timeRange);
      case 'policy_loan': return this.analyzePolicyLoan(filtered, timeRange);
      case 'vrdct': return this.analyzeVRDCT(filtered, timeRange);
      case 'portfolio': return this.analyzePortfolio(filtered, timeRange);
      default: throw new Error(`UNKNOWN_ANALYTICS_CATEGORY: ${category}`);
    }
  }
}
