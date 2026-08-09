/**
 * DIBS Backend — VRDCT Trust and Risk-Intelligence Adapter
 *
 * VRDCT acts as the shared trust and risk-intelligence layer for DIBS and Escrow Factory.
 *
 * Constraints:
 * - Does not replace legal underwriting.
 * - Does not make unsupervised lending decisions.
 * - Does not create an unregulated consumer credit score.
 * - Provides consented, minimized, explainable, and reviewable signals.
 *
 * Core Data Loop:
 * Verified behavior → trust signals → workflow access/review intensity →
 * additional verifiable behavior → improved trust record → feedback loop.
 *
 * Trust Score Constraints:
 * - No opaque scoring.
 * - No undisclosed adverse-decision automation.
 * - No non-consented behavioral inputs.
 * - No protected-class proxies.
 * - No sole basis for financing denial.
 * - Require explainable reason codes.
 * - Require human review for material adverse action.
 * - Record data source, consent status, refresh date, calculation version.
 */

import { EventStore } from '../audit/event-store';
import { TrustSignal } from '../../shared/types';

// === Counterparty Signal Types (16) ===
export type CounterpartySignalType =
  | 'identity_verification'
  | 'entity_document_completeness'
  | 'authorized_signatory_consistency'
  | 'payment_account_stability'
  | 'historical_milestone_completion'
  | 'invoice_consistency'
  | 'dispute_frequency'
  | 'waiver_frequency'
  | 'covenant_breach_history'
  | 'cure_period_performance'
  | 'collateral_reporting_timeliness'
  | 'inspection_report_consistency'
  | 'servicing_responsiveness'
  | 'fraud_alert_history'
  | 'sanctions_compliance_exceptions'
  | 'counterparty_block_flags';

// === Project Signal Types (13) ===
export type ProjectSignalType =
  | 'budget_adherence'
  | 'draw_request_frequency'
  | 'draw_request_variance'
  | 'milestone_completion_lag'
  | 'change_order_concentration'
  | 'contractor_performance'
  | 'inspection_discrepancy'
  | 'lien_waiver_timing'
  | 'insurance_compliance'
  | 'collateral_value_movement'
  | 'covenant_stability'
  | 'payment_reconciliation_accuracy'
  | 'documentation_completeness';

export type SignalType = CounterpartySignalType | ProjectSignalType;
export type SignalCategory = 'counterparty' | 'project';

export interface VRDCTSignal {
  signalId: string;
  category: SignalCategory;
  signalType: SignalType;
  entityId: string;
  projectId?: string;
  value: number;
  normalizedScore: number; // 0–100
  dataSource: string;
  consentStatus: boolean;
  refreshDate: string;
  calculationVersion: string;
  reasonCodes: string[];
  isAdverse: boolean;
  requiresHumanReview: boolean;
}

export interface TrustScoreResult {
  entityId: string;
  overallScore: number; // 0–100
  counterpartyScore: number;
  projectScore: number;
  signalCount: number;
  adverseSignals: number;
  reasonCodes: string[];
  requiresHumanReview: boolean;
  dataSources: string[];
  calculationVersion: string;
  calculationTimestamp: string;
}

export interface AdverseActionNotice {
  noticeId: string;
  entityId: string;
  adverseSignals: VRDCTSignal[];
  reasonCodes: string[];
  humanReviewRequired: boolean;
  reviewStatus: 'pending' | 'reviewed' | 'cleared' | 'upheld';
  reviewerId?: string;
  reviewTimestamp?: string;
  reviewNotes?: string;
}

/**
 * Protected-class proxy detection.
 * Rejects signals that could serve as proxies for protected characteristics.
 */
const PROTECTED_CLASS_PROXY_PATTERNS = [
  'race', 'gender', 'age', 'religion', 'national_origin',
  'marital_status', 'sexual_orientation', 'disability',
  'zip_code', 'neighborhood', 'surname',
];

export function isProtectedClassProxy(signal: VRDCTSignal): boolean {
  const signalStr = JSON.stringify(signal).toLowerCase();
  return PROTECTED_CLASS_PROXY_PATTERNS.some(p => signalStr.includes(p));
}

/**
 * Generate explainable reason codes for a trust signal.
 * Every signal must have at least one reason code explaining its evaluation.
 */
export function generateReasonCodes(signal: VRDCTSignal): string[] {
  const codes: string[] = [];

  if (!signal.consentStatus) {
    codes.push('NO_CONSENT: Signal collected without explicit consent');
  }

  if (signal.value < 30) {
    codes.push(`LOW_SCORE: ${signal.signalType} score below 30`);
  }

  if (signal.isAdverse) {
    codes.push(`ADVERSE: ${signal.signalType} indicates adverse behavior`);
  }

  if (signal.requiresHumanReview) {
    codes.push('HUMAN_REVIEW_REQUIRED: Material adverse action threshold reached');
  }

  // Stale data check
  const ageDays = (Date.now() - new Date(signal.refreshDate).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 90) {
    codes.push(`STALE_DATA: Signal not refreshed in ${Math.floor(ageDays)} days`);
  }

  if (codes.length === 0) {
    codes.push('COMPLIANT: Signal within acceptable parameters');
  }

  return codes;
}

export class VRDCTAdapter {
  private signals: Map<string, VRDCTSignal> = new Map();
  private entitySignals: Map<string, Set<string>> = new Map(); // entityId → signal IDs
  private adverseNotices: Map<string, AdverseActionNotice> = new Map();
  private calculationVersion = 'v1.0.0';

  constructor(private eventStore: EventStore) {}

  /**
   * Record a trust signal.
   * Validates consent, rejects protected-class proxies, generates reason codes.
   */
  async recordSignal(signal: Omit<VRDCTSignal, 'signalId' | 'reasonCodes' | 'requiresHumanReview'>): Promise<VRDCTSignal> {
    // Reject non-consented behavioral inputs
    if (!signal.consentStatus) {
      throw new Error('NON_CONSENTED_INPUT: Signal requires explicit consent');
    }

    const signalId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullSignal: VRDCTSignal = {
      ...signal,
      signalId,
      reasonCodes: [],
      requiresHumanReview: signal.isAdverse && signal.normalizedScore < 30,
    };

    // Reject protected-class proxies
    if (isProtectedClassProxy(fullSignal)) {
      throw new Error('PROTECTED_CLASS_PROXY_DETECTED: Signal rejected');
    }

    // Generate explainable reason codes
    fullSignal.reasonCodes = generateReasonCodes(fullSignal);

    this.signals.set(signalId, fullSignal);

    // Index by entity
    if (!this.entitySignals.has(fullSignal.entityId)) {
      this.entitySignals.set(fullSignal.entityId, new Set());
    }
    this.entitySignals.get(fullSignal.entityId)!.add(signalId);

    // Create adverse action notice if human review required
    if (fullSignal.requiresHumanReview) {
      await this.createAdverseActionNotice(fullSignal);
    }

    return fullSignal;
  }

  /**
   * Calculate aggregate trust score for an entity.
   * Uses weighted average of counterparty and project signals.
   * Does NOT create a sole basis for financing denial.
   */
  calculateTrustScore(entityId: string, projectWeight: number = 0.4): TrustScoreResult {
    const signalIds = this.entitySignals.get(entityId) || new Set<string>();
    const entitySignals = Array.from(signalIds)
      .map(id => this.signals.get(id)!)
      .filter(Boolean);

    const counterpartySignals = entitySignals.filter(s => s.category === 'counterparty');
    const projectSignals = entitySignals.filter(s => s.category === 'project');

    const counterpartyScore = counterpartySignals.length > 0
      ? counterpartySignals.reduce((sum, s) => sum + s.normalizedScore, 0) / counterpartySignals.length
      : 50;

    const projectScore = projectSignals.length > 0
      ? projectSignals.reduce((sum, s) => sum + s.normalizedScore, 0) / projectSignals.length
      : 50;

    const overallScore = counterpartySignals.length > 0 && projectSignals.length > 0
      ? counterpartyScore * (1 - projectWeight) + projectScore * projectWeight
      : counterpartySignals.length > 0
        ? counterpartyScore
        : projectSignals.length > 0
          ? projectScore
          : 50;

    const adverseSignals = entitySignals.filter(s => s.isAdverse);
    const allReasonCodes = entitySignals.flatMap(s => s.reasonCodes);
    const dataSources = Array.from(new Set(entitySignals.map(s => s.dataSource)));
    const requiresHumanReview = adverseSignals.some(s => s.requiresHumanReview);

    return {
      entityId,
      overallScore: Math.round(overallScore * 100) / 100,
      counterpartyScore: Math.round(counterpartyScore * 100) / 100,
      projectScore: Math.round(projectScore * 100) / 100,
      signalCount: entitySignals.length,
      adverseSignals: adverseSignals.length,
      reasonCodes: allReasonCodes,
      requiresHumanReview,
      dataSources,
      calculationVersion: this.calculationVersion,
      calculationTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Create an adverse action notice requiring human review.
   * VRDCT must not make undisclosed adverse-decision automation.
   */
  private async createAdverseActionNotice(signal: VRDCTSignal): Promise<AdverseActionNotice> {
    const noticeId = `adv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const notice: AdverseActionNotice = {
      noticeId,
      entityId: signal.entityId,
      adverseSignals: [signal],
      reasonCodes: signal.reasonCodes,
      humanReviewRequired: true,
      reviewStatus: 'pending',
    };

    this.adverseNotices.set(noticeId, notice);
    return notice;
  }

  /**
   * Resolve an adverse action notice with human review.
   */
  resolveAdverseAction(
    noticeId: string,
    reviewerId: string,
    decision: 'cleared' | 'upheld',
    notes: string
  ): AdverseActionNotice {
    const notice = this.adverseNotices.get(noticeId);
    if (!notice) {
      throw new Error(`ADVERSE_NOTICE_NOT_FOUND: ${noticeId}`);
    }

    notice.reviewStatus = decision === 'cleared' ? 'cleared' : 'upheld';
    notice.reviewerId = reviewerId;
    notice.reviewTimestamp = new Date().toISOString();
    notice.reviewNotes = notes;

    return notice;
  }

  /**
   * Get all signals for an entity.
   */
  getEntitySignals(entityId: string): VRDCTSignal[] {
    const signalIds = this.entitySignals.get(entityId) || new Set<string>();
    return Array.from(signalIds).map(id => this.signals.get(id)!).filter(Boolean);
  }

  /**
   * Get pending adverse action notices for an entity.
   */
  getPendingAdverseNotices(entityId: string): AdverseActionNotice[] {
    return Array.from(this.adverseNotices.values())
      .filter(n => n.entityId === entityId && n.reviewStatus === 'pending');
  }

  /**
   * Update calculation version (for versioned trust score history).
   */
  updateCalculationVersion(version: string): void {
    this.calculationVersion = version;
  }
}
