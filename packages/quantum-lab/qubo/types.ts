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
// Outputs — qlab.qubo_artifact.v1 (docs/quantum-lab/DIBS-QUBO-Artifact-Structure.md)
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 'qlab.qubo_artifact.v1';
export const ARTIFACT_VERSION = 'qubo_artifact/v1';
export const COMPILER_VERSION = 'qlab-compiler/1';

export type SymbolKind = 'decision' | 'deferral' | 'slack' | 'ancilla';
export type SymbolRole = 'draw_window' | 'reserve_band' | 'spv_slice' | 'slack_bit' | 'rosenberg_ancilla';

/** Every nullable field is always present, so the canonical hash is stable. */
export interface SymbolEntry {
  index: number;
  name: string;
  kind: SymbolKind;
  role: SymbolRole;
  draw_id: string | null;
  window_id: string | null;
  spv_id: string | null;
  band_id: string | null;
  slack_group: string | null;
  slack_weight: number | null;
}

export interface OneHotGroup {
  group_id: string;
  indices: number[];
  cardinality: 'exactly_one' | 'at_most_one';
}

export interface SlackGroup {
  group_id: string;
  constraint_id: string;
  indices: number[];
  /** Σ slack_weight over the group. */
  max_value: number;
  /** Additive: minor units per slack step for this constraint. */
  unit_minor: number;
}

export interface QOffDiag {
  i: number;
  j: number;
  /** Stored Q_ij = Q_ji, i < j. */
  q: number;
}

export interface JEntry {
  i: number;
  j: number;
  value: number;
}

export interface PrefilteredDraw {
  draw_id: string;
  reason: 'hold' | 'unverified_payee' | 'sanctions' | 'kyc' | 'docs' | 'settlement_unavailable';
}

export interface PrunedVariable {
  name: string;
  reason: 'amount_gt_window' | 'infeasible_pair' | 'domain_empty';
}

export interface PrunedPair {
  left_symbol: string;
  right_symbol: string;
  reason: 'budget_pair' | 'tranche_forbid';
}

export interface RefusedConstraint {
  constraint_id: string;
  reason: 'legal_not_compiled' | 'cubic_leftover' | 'uncalibrated_penalty';
}

export interface PenaltyTerm {
  constraint_id: string;
  P_c: number;
  v_min2: number;
  delta_E_max: number;
  satisfied_floor: boolean;
}

export interface UncompiledHard {
  code: 'LTV' | 'RESERVE' | 'CONCENTRATION' | 'LEGAL';
  reason: 'validator_only' | 'prefilter';
}

export interface CompileReport {
  prefiltered_draws: PrefilteredDraw[];
  pruned_variables: PrunedVariable[];
  pruned_pairs: PrunedPair[];
  refused_constraints: RefusedConstraint[];
  penalty_terms: PenaltyTerm[];
  fixture: { solved_exactly: boolean; feasibility_rate: number | null; gap_to_mip: number | null };
  warnings: string[];
  /** Additive diagnostics. */
  diagnostics: {
    bits_by_kind: Record<SymbolKind, number>;
    budget_encoding_by_window: Record<string, 'none' | 'pair_prune' | 'slack'>;
  };
}

export interface QuboArtifact {
  // 1. Envelope
  qubo_artifact_id: string;
  schema_version: typeof SCHEMA_VERSION;
  artifact_version: typeof ARTIFACT_VERSION;
  experiment_id: string | null;
  created_at: string;
  compiler_version: string;
  encoding_version: string;
  idempotency_key: string;
  q_layout: 'symmetric_xTQx';
  ising_map: 'z = 1 - 2x';

  // 2. Identity bindings
  scenario_id: string;
  scenario_freeze_hash: string;
  locked_policy_version: string;
  locked_evidence_manifest_hash: string;
  penalty_policy_id: string;
  penalty_policy_hash: string;
  classical_baseline_id: string | null;
  classical_baseline_hash: string | null;
  symbol_table_hash: string;

  // 3. Symbol table
  n: number;
  symbols: SymbolEntry[];
  one_hot_groups: OneHotGroup[];
  slack_groups: SlackGroup[];

  // 4. Q payload. E(x) = Σ Q_diag[i]·x_i + Σ_{i<j} 2·q·x_i·x_j + E0
  E0: number;
  Q_format: 'diag_plus_coo';
  Q_diag: number[];
  Q_offdiag: QOffDiag[];
  scale: {
    /** gcd of slack units (1 when no slack): minor units per scaled amount step. */
    amount_divisor: number;
    /** Coefficients are exact integers or halves in policy cost units; no division applied. */
    objective_divisor: number;
    rounding: 'nearest_even';
    reconstructed_unit: 'minor_units';
  };
  coefficient_unit: 'dimensionless';
  density: number;
  bandwidth: number;

  // 5. Ising image, same bits, z = 1 − 2x
  h: number[];
  J_sparse: JEntry[];
  energy_shift: number;

  // 6. Compile report
  compile_report: CompileReport;
  compile_report_hash: string;
  uncompiled_hard: UncompiledHard[];

  // 7. Integrity
  q_payload_hash: string;
  payload_hash: string;
  signature_key_id?: string;
  signature?: string;
}

/** Caller-supplied envelope inputs. Nothing here is read from a clock or RNG. */
export interface CompileOptions {
  /** UTC, ISO-8601 ending in Z. */
  created_at: string;
  idempotency_key: string;
  experiment_id?: string | null;
  /** What pre-filter removed before this IR, for the compile report. */
  prefiltered_draws?: PrefilteredDraw[];
  classical_baseline?: { id: string; hash: string };
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
  | 'NUMERIC_RANGE'
  | 'INVALID_OPTIONS';

export interface Refusal {
  code: RefusalCode;
  message: string;
  path?: string;
}

export type CompileResult =
  | { status: 'COMPILED'; artifact: QuboArtifact }
  | { status: 'REQUIRES_REMODELING'; refusals: Refusal[] };
