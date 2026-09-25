/**
 * DIBS Quantum Lab — independent validator types.
 *
 * PARKED / offline research. The validator emits a signed report. It does not
 * write Autopilot state, and its report is not an input of CreateDrawRequest,
 * ApproveDraw, CreateWaiver or CreateSettlementInstruction.
 * Spec: docs/quantum-lab/DIBS-Independent-Validator-Logic.md
 */

import { KeyObject } from 'crypto';
import { FrozenScenario, PenaltyPolicy, QuboArtifact } from '../qubo/types';

export const VALIDATOR_VERSION = 'validator/v1';
export const SUPPORTED_ENCODINGS = ['draw-window/v1'];
export const SUPPORTED_SCHEMAS = ['qlab.qubo_artifact.v1'];

// ---------------------------------------------------------------------------
// Frozen book: the compiler IR plus everything the compiler never saw
// ---------------------------------------------------------------------------

/** Pre-filter facts on the freeze, for every draw in the book (including ones pre-filter removed). */
export interface DrawStatus {
  hold_open: boolean;
  payee_verified: boolean;
  sanctions_clear: boolean;
  kyc_current: boolean;
  docs_current: boolean;
  settlement_route_live: boolean;
}

export interface SpvCollateral {
  outstanding_debt_minor: number;
  eligible_collateral_minor: number;
  policy_ltv_bps: number;
}

/** One cash-ladder period, keyed by window id. All integer minor units. */
export interface CashPeriod {
  committed_inflows_minor: number;
  /** SETTLEMENT_CONFIRMED amounts only. */
  confirmed_facility_draws_minor: number;
  /** Instruction register. Recorded, never counted as cash. */
  instructed_unconfirmed_minor: number;
  scheduled_outflows_minor: number;
  /** Closing cash for the period must not fall below this. */
  required_reserve_minor: number;
}

export interface CashLadder {
  opening_cash_minor: number;
  periods: Record<string, CashPeriod>;
}

export interface ConcentrationCap {
  dimension: 'spv' | 'sponsor';
  key: string;
  existing_exposure_minor: number;
  max_exposure_minor: number;
}

export type StressSpec =
  /** Scheduled draws slip k windows later; past the horizon they defer. */
  | { name: string; kind: 'INSPECTION_SLIP'; slip_windows: number; draw_ids?: string[] }
  /** Confirmed facility draws arrive k periods later; past the horizon they never count. */
  | { name: string; kind: 'CONFIRMATION_LAG'; lag_windows: number }
  /** Eligible collateral cut by haircut_bps. */
  | { name: string; kind: 'COLLATERAL_HAIRCUT'; haircut_bps: number; spv_ids?: string[] }
  /** Committed inflows arrive k periods later; past the horizon they never arrive. */
  | { name: string; kind: 'INFLOW_DELAY'; delay_windows: number }
  /** A hold lands on the SPV with the most scheduled exposure; its draws defer. */
  | { name: string; kind: 'ADDITIONAL_HOLD'; target: 'LARGEST_SPV' };

export interface FrozenBook {
  locked_policy_version: string;
  locked_evidence_manifest_hash: string;
  /** The IR exactly as it was handed to the compiler. */
  scenario: FrozenScenario;
  draw_status: Record<string, DrawStatus>;
  /** Omitted ⇒ LTV is not in this catalog (SKIP). */
  spvs?: Record<string, SpvCollateral>;
  /** Omitted ⇒ liquidity and reserve are not in this catalog (SKIP). */
  cash_ladder?: CashLadder;
  /** Omitted or empty ⇒ concentration caps are not in this catalog (SKIP). */
  concentration_caps?: ConcentrationCap[];
  /** The declared stress set. */
  stresses: StressSpec[];
}

/** MIP result on the same freeze. Its canonical hash is pinned on the artifact. */
export interface ClassicalBaseline {
  baseline_id: string;
  objective_minor: number;
  /** draw id → window id, or null when deferred. */
  assignment: Record<string, string | null>;
}

export interface ValidationRequest {
  experiment_id: string;
  artifact: QuboArtifact;
  bitstring: { encoding: 'bits' | 'spins'; values: number[] };
  book: FrozenBook;
  /** The penalty policy body; its id and hash must match the artifact. */
  penalty_policy: PenaltyPolicy;
  classical_baseline?: ClassicalBaseline;
  /** Research acceptance bar on gap to the baseline; exceeding it rejects the candidate. */
  max_gap_bps?: number;
  /** When set, the artifact must carry a valid compiler signature under this key. */
  compiler_public_key?: KeyObject;
  /** UTC, ISO-8601 with Z. Supplied by the caller so the report is reproducible. */
  occurred_at: string;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type Verdict = 'CANDIDATE_VALIDATED' | 'REJECTED' | 'REQUIRES_REMODELING';
export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';

/** Integer values are decimal strings so no float touches a verdict. */
export interface Check {
  code: string;
  status: CheckStatus;
  subject?: string;
  measured?: string;
  limit?: string;
  unit?: 'minor' | 'bps' | 'count' | 'bits';
  note?: string;
}

export interface ScheduledEntry {
  draw_id: string;
  /** More than one window only when one-hot is broken. */
  windows: string[];
  deferred: boolean;
  amount_minor: string;
}

export interface StressResult {
  name: string;
  kind: StressSpec['kind'];
  status: 'PASS' | 'FAIL' | 'NOT_RUN';
  failed_checks: Check[];
  note?: string;
}

export interface ValidationReport {
  kind: 'DIBS_QLAB_VALIDATION_REPORT';
  experiment_id: string;
  validator_version: string;
  occurred_at: string;
  verdict: Verdict;
  /** Codes that decided the verdict. */
  verdict_reasons: string[];
  scenario_freeze_hash: string;
  qubo_artifact_id: string;
  compile_artifact_hash: string;
  symbol_table_hash: string;
  penalty_policy_id: string;
  locked_policy_version: string;
  locked_evidence_manifest_hash: string;
  bitstring: { encoding: 'bits' | 'spins'; values: number[] };
  decoded_x: Array<0 | 1> | null;
  ancillas_dropped: string[];
  /** Domain objects only. Null unless every draw decodes to exactly one choice. */
  decoded_schedule: ScheduledEntry[] | null;
  classical_baseline_objective_minor: string | null;
  candidate_economic_objective_minor: string | null;
  gap_bps: string | null;
  /** Diagnostic only. Never a predicate, never money. */
  q_energy: number | null;
  checks: Check[];
  stress: StressResult[];
  payload_hash: string;
  signature_algorithm: 'Ed25519';
  signature_key_id: string;
  signature: string;
}
