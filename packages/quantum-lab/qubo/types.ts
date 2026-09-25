/**
 * DIBS Quantum Lab — QUBO compiler types.
 *
 * PARKED / offline research only. Nothing in this package may be imported by
 * Autopilot (backend/, shared/) and nothing here may import from them.
 * Spec: docs/quantum-lab/DIBS-QUBO-Compiler-Mechanics.md
 */

export const ENCODING_VERSION = 'draw-window/v1';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One draw that already survived pre-filter (legal / KYC / sanctions / docs / holds / payee / route). */
export interface FrozenDraw {
  id: string;
  /** Integer minor units. Never a float. */
  amount_minor: number;
  spv_id: string;
  sponsor_id: string;
  tranche: number;
  /** Window ids this draw may land in. */
  window_eligibility: string[];
  /** u_i — value of funding this draw in the horizon (integer cost units). */
  utility: number;
  /** δ_i — cost of leaving this draw unscheduled (integer cost units). */
  deferral_cost: number;
  /** d_{i,t} — delay / idle-cash cost by window id (integer cost units). Missing = 0. */
  delay_cost?: Record<string, number>;
}

export interface FrozenWindow {
  id: string;
  /** L_t from the classical cash ladder, integer minor units. */
  liquidity_cap_minor: number;
}

/** `before` must land in a strictly earlier window than `after` when both are scheduled. */
export interface PrecedencePair {
  before: string;
  after: string;
}

/** c_ij — same-window crowding / concentration weight (integer cost units, ≥ 0). */
export interface ConcentrationPair {
  left: string;
  right: string;
  weight: number;
}

/**
 * Frozen, de-identified intermediate representation. Array order of `windows`
 * is time order. Unknown fields are refused, so PII, evidence bytes and legal
 * flags cannot ride along.
 */
export interface FrozenScenario {
  scenario_id: string;
  policy_version_frozen: string;
  manifest_hash_frozen: string;
  encoding_version: string;
  penalty_policy_id: string;
  draws: FrozenDraw[];
  windows: FrozenWindow[];
  precedence: PrecedencePair[];
  concentration_pairs: ConcentrationPair[];
  classical_baseline_ref?: string;
}

/** Versioned penalty policy. Pinned on the artifact; changing it requires a new compile. */
export interface PenaltyPolicy {
  penalty_policy_id: string;
  penalties: {
    /** One window or defer, per draw. */
    cardinality: number;
    /** Tranche order, forbidden window pairs. */
    precedence: number;
    /** Window liquidity cap (pair-prune coupling or slack). */
    budget: number;
  };
  /** Upper bound on binary-slack bits for a single window cap. */
  max_slack_bits_per_window: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type SymbolKind = 'x' | 'z' | 'slack';

export interface SymbolEntry {
  index: number;
  name: string;
  kind: SymbolKind;
  draw_id?: string;
  window_id?: string;
  /** Slack only: bit position b, weight 2^b in window amount units. */
  bit?: number;
}

/** Off-diagonal entry of a symmetric matrix: M[i][j] = M[j][i] = value, i < j. */
export type SymEntry = [number, number, number];

export interface ConstraintRecord {
  id: string;
  kind: 'cardinality' | 'precedence' | 'budget_pair' | 'budget_slack';
  penalty: number;
  /** Conservative bound on economic gain from violating any constraint. */
  delta_e_max: number;
  /** Smallest nonzero value of g_c. Every v1 encoding has integer g_c, so 1. */
  v_min: number;
  bits: number[];
}

export interface PrunedVariable {
  variable: string;
  draw_id: string;
  window_id: string;
  reason: 'AMOUNT_EXCEEDS_WINDOW_CAP' | 'WINDOW_NOT_ELIGIBLE';
}

export interface QuboArtifact {
  kind: 'DIBS_QLAB_QUBO_ARTIFACT';
  qubo_artifact_id: string;
  scenario_id: string;
  policy_version_frozen: string;
  manifest_hash_frozen: string;
  encoding_version: string;
  penalty_policy_id: string;
  q_layout: 'symmetric_xTQx';
  spin_map: 'z=1-2x';
  n: number;
  symbol_table: SymbolEntry[];
  /** E(x) = Σ diag[i]·x_i + Σ_{i<j} 2·Q_ij·x_i·x_j + E0, in integer cost units. */
  Q: { diag: number[]; offdiag: SymEntry[] };
  E0: number;
  ising: { h: number[]; J: SymEntry[]; offset: number };
  scale_factors: {
    /** Divide Q, E0, h, J, offset by this for an O(1) solver input. Energy is not money. */
    energy_scale: number;
    /** Per slack-encoded window: minor units per slack step (gcd of amounts and cap). */
    slack_unit_minor_by_window: Record<string, number>;
  };
  constraints: ConstraintRecord[];
  pruned_variables: PrunedVariable[];
  /** Constraint classes deliberately not encoded — enforced by pre-filter and validator. */
  refused_constraints: string[];
  report: {
    bits: number;
    bits_by_kind: Record<SymbolKind, number>;
    nonzero_offdiag: number;
    density: number;
    bandwidth: number;
    delta_e_max: number;
    budget_encoding_by_window: Record<string, 'none' | 'pair_prune' | 'slack'>;
  };
  classical_baseline_ref: string | null;
  artifact_hash: string;
}

export type RefusalCode =
  | 'UNKNOWN_FIELD'
  | 'LEGAL_FLAG_IN_IR'
  | 'RESERVE_BANDS_NOT_IN_ENCODING'
  | 'ENCODING_VERSION_MISMATCH'
  | 'PENALTY_POLICY_MISMATCH'
  | 'LIVE_POLICY_VERSION'
  | 'MISSING_FIELD'
  | 'NON_INTEGER_MONEY'
  | 'NON_INTEGER_WEIGHT'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_REFERENCE'
  | 'INVALID_PAIR'
  | 'INVALID_PENALTY_POLICY'
  | 'PENALTY_BELOW_FLOOR'
  | 'SLACK_BITS_EXCEED_POLICY'
  | 'NUMERIC_RANGE';

export interface Refusal {
  code: RefusalCode;
  message: string;
  path?: string;
}

export type CompileResult =
  | { status: 'COMPILED'; artifact: QuboArtifact }
  | { status: 'REQUIRES_REMODELING'; refusals: Refusal[] };
