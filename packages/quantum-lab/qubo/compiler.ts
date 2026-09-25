/**
 * DIBS Quantum Lab — QUBO compiler (draw-window/v1), emitting qlab.qubo_artifact.v1.
 *
 *   FrozenScenario + PenaltyPolicy → qubo_artifact (Q, symbol table, compile report)
 *
 * PARKED / offline research. The output is a versioned model for a solver and
 * the independent validator. It is not a schedule, not an approval, and not an
 * input type of any Autopilot command.
 *
 * Specs: docs/quantum-lab/DIBS-QUBO-Compiler-Mechanics.md,
 *        docs/quantum-lab/DIBS-QUBO-Artifact-Structure.md
 *
 *   validate IR → name bits (with pruning) → objective → constraints
 *   (one-hot, precedence pairs, budget pair-prune or slack) → penalty floor
 *   → assemble symmetric Q → Ising image → hash.
 *
 * All IR weights and penalties are integers, so Q holds integers and
 * half-integers, and h / J / energy_shift hold quarter-integers — exact in
 * float64. A range check refuses anything that would lose that exactness.
 */

import { canonicalHash } from './hash';
import { scenarioHash } from './scenario';
import {
  ARTIFACT_VERSION,
  COMPILER_VERSION,
  CompileOptions,
  CompileReport,
  CompileResult,
  ENCODING_VERSION,
  FrozenDraw,
  FrozenScenario,
  JEntry,
  OneHotGroup,
  PenaltyPolicy,
  PenaltyTerm,
  PrunedPair,
  PrunedVariable,
  QOffDiag,
  QuboArtifact,
  Refusal,
  SCHEMA_VERSION,
  SlackGroup,
  SymbolEntry,
  SymbolKind,
} from './types';
import { validatePenaltyPolicy, validateScenario } from './validate';

/** Search budget for proving that pairwise budget couplings are exact for a window. */
const PAIR_PRUNE_SEARCH_LIMIT = 200_000;

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const PREFILTER_REASONS = new Set(['hold', 'unverified_payee', 'sanctions', 'kyc', 'docs', 'settlement_unavailable']);

/** Constraint classes the compiler never encodes. Pre-filter removes them; the validator re-checks them. */
const LEGAL_NOT_COMPILED = [
  'legal_eligibility',
  'kyc_aml',
  'sanctions',
  'executed_documents',
  'open_holds',
  'payee_verification',
  'settlement_route',
];

/** Hard constraints in the validator catalog that v1 never puts into Q. */
const UNCOMPILED_HARD: QuboArtifact['uncompiled_hard'] = [
  { code: 'CONCENTRATION', reason: 'validator_only' },
  { code: 'LEGAL', reason: 'prefilter' },
  { code: 'LTV', reason: 'validator_only' },
  { code: 'RESERVE', reason: 'validator_only' },
];

/** Exported for tests only; not part of the package surface in index.ts. */
export class QuboBuilder {
  readonly diag: number[] = [];
  /** Full pairwise coefficient α for x_p·x_q, keyed "p,q" with p < q. */
  readonly pairs = new Map<string, number>();
  E0 = 0;

  addBit(): number {
    this.diag.push(0);
    return this.diag.length - 1;
  }

  addLinear(p: number, w: number): void {
    this.diag[p] += w;
  }

  addPair(p: number, q: number, alpha: number): void {
    if (p === q) {
      // x² = x
      this.addLinear(p, alpha);
      return;
    }
    const [a, b] = p < q ? [p, q] : [q, p];
    const key = `${a},${b}`;
    this.pairs.set(key, (this.pairs.get(key) ?? 0) + alpha);
  }

  /** Adds P·(Σ w_p x_p − b)² expanded over bits (x² = x). */
  addSquaredLinear(terms: Array<[number, number]>, b: number, P: number): void {
    for (const [p, w] of terms) this.addLinear(p, P * (w * w - 2 * b * w));
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        this.addPair(terms[i][0], terms[j][0], 2 * P * terms[i][1] * terms[j][1]);
      }
    }
    this.E0 += P * b * b;
  }

  /** Symmetric layout: Q_ij = Q_ji = α/2, stored once with i < j. */
  offdiag(): QOffDiag[] {
    const out: QOffDiag[] = [];
    for (const [key, alpha] of this.pairs) {
      if (alpha === 0) continue;
      const [i, j] = key.split(',').map(Number);
      out.push({ i, j, q: alpha / 2 });
    }
    return out.sort((l, r) => l.i - r.i || l.j - r.j);
  }
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Deterministic UUID (RFC 9562 version 8) from the payload hash: same model, same id. */
export function artifactIdFromHash(hash: string): string {
  const variant = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Hash of the Q payload block. */
export function qPayloadHash(a: Pick<QuboArtifact, 'n' | 'q_layout' | 'E0' | 'Q_diag' | 'Q_offdiag' | 'scale'>): string {
  return canonicalHash({ n: a.n, q_layout: a.q_layout, E0: a.E0, Q_diag: a.Q_diag, Q_offdiag: a.Q_offdiag, scale: a.scale });
}

/** Hash of everything except the payload hash, the id derived from it, and signature fields. */
export function artifactPayloadHash(a: QuboArtifact | Omit<QuboArtifact, 'qubo_artifact_id' | 'payload_hash'>): string {
  const { qubo_artifact_id: _id, payload_hash: _ph, signature_key_id: _k, signature: _s, ...body } = a as QuboArtifact;
  return canonicalHash(body);
}

/**
 * True if pairwise couplings on over-cap pairs are exact for this window:
 * no set of ≥ 3 draws is pairwise within the cap but over it in total.
 * Returns null when the search budget runs out (caller falls back to slack).
 */
function pairPruneIsExact(amounts: number[], cap: number): boolean | null {
  const n = amounts.length;
  let nodes = 0;
  const chosen: number[] = [];
  const dfs = (start: number, sum: number): boolean | null => {
    if (++nodes > PAIR_PRUNE_SEARCH_LIMIT) return null;
    if (chosen.length >= 3 && sum > cap) return false;
    for (let k = start; k < n; k++) {
      if (!chosen.every((c) => amounts[c] + amounts[k] <= cap)) continue;
      chosen.push(k);
      const r = dfs(k + 1, sum + amounts[k]);
      chosen.pop();
      if (r !== true) return r;
    }
    return true;
  };
  return dfs(0, 0);
}

function refuse(refusals: Refusal[]): CompileResult {
  return { status: 'REQUIRES_REMODELING', refusals };
}

function validateOptions(o: CompileOptions, draws: FrozenDraw[]): Refusal[] {
  const out: Refusal[] = [];
  if (!o || typeof o.created_at !== 'string' || !UTC_ISO.test(o.created_at)) {
    out.push({ code: 'INVALID_OPTIONS', message: 'created_at must be UTC ISO-8601 ending in Z.', path: 'options.created_at' });
  }
  if (!o || typeof o.idempotency_key !== 'string' || o.idempotency_key.length === 0) {
    out.push({ code: 'INVALID_OPTIONS', message: 'idempotency_key is required.', path: 'options.idempotency_key' });
  }
  const inIr = new Set(draws.map((d) => d.id));
  for (const p of o?.prefiltered_draws ?? []) {
    if (!PREFILTER_REASONS.has(p.reason)) {
      out.push({ code: 'INVALID_OPTIONS', message: `Unknown pre-filter reason ${String(p.reason)}.`, path: 'options.prefiltered_draws' });
    }
    if (inIr.has(p.draw_id)) {
      out.push({ code: 'LEGAL_FLAG_IN_IR', message: `Draw ${p.draw_id} was pre-filtered but is still in the IR.`, path: 'options.prefiltered_draws' });
    }
  }
  const b = o?.classical_baseline;
  if (b && (typeof b.id !== 'string' || !b.id || typeof b.hash !== 'string' || !b.hash)) {
    out.push({ code: 'INVALID_OPTIONS', message: 'classical_baseline needs id and hash.', path: 'options.classical_baseline' });
  }
  return out;
}

export function compileQubo(scenario: FrozenScenario, policy: PenaltyPolicy, options: CompileOptions): CompileResult {
  const inputRefusals = [...validatePenaltyPolicy(policy), ...validateScenario(scenario, policy)];
  if (inputRefusals.length > 0) return refuse(inputRefusals);
  const optionRefusals = validateOptions(options, scenario.draws);
  if (optionRefusals.length > 0) return refuse(optionRefusals);

  const P = policy.penalties;
  const windows = scenario.windows; // array order is time order
  const windowPos = new Map(windows.map((w, i) => [w.id, i]));
  const draws: FrozenDraw[] = [...scenario.draws].sort(byId);

  const qb = new QuboBuilder();
  const symbols: SymbolEntry[] = [];
  const pruned: PrunedVariable[] = [];
  const prunedPairs: PrunedPair[] = [];
  const penaltyTerms: Array<Omit<PenaltyTerm, 'delta_E_max' | 'satisfied_floor'>> = [];
  const oneHot: OneHotGroup[] = [];
  const slackGroups: SlackGroup[] = [];
  const xBit = new Map<string, number>(); // `${draw}|${window}` → bit
  const zBit = new Map<string, number>();

  const newSymbol = (entry: Partial<SymbolEntry> & Pick<SymbolEntry, 'name' | 'kind' | 'role'>): number => {
    const index = qb.addBit();
    symbols.push({
      index,
      draw_id: null,
      window_id: null,
      spv_id: null,
      band_id: null,
      slack_group: null,
      slack_weight: null,
      ...entry,
    });
    return index;
  };
  const nameOf = (i: number) => symbols[i].name;

  // --- Variables: x_{i,t} (pruned where impossible), then z_i -------------------
  for (const d of draws) {
    const eligible = new Set(d.window_eligibility);
    let any = false;
    for (const w of windows) {
      const name = `x[${d.id},${w.id}]`;
      if (!eligible.has(w.id)) continue; // never in the draw's domain
      if (d.amount_minor > w.liquidity_cap_minor) {
        pruned.push({ name, reason: 'amount_gt_window' });
        continue;
      }
      any = true;
      xBit.set(`${d.id}|${w.id}`, newSymbol({ name, kind: 'decision', role: 'draw_window', draw_id: d.id, window_id: w.id, spv_id: d.spv_id }));
    }
    if (!any) pruned.push({ name: `x[${d.id},*]`, reason: 'domain_empty' });
    zBit.set(d.id, newSymbol({ name: `z[${d.id}]`, kind: 'deferral', role: 'draw_window', draw_id: d.id, spv_id: d.spv_id }));
  }

  // --- Objective (economic + concentration) --------------------------------------
  let deltaEMax = 0;
  for (const d of draws) {
    for (const w of windows) {
      const p = xBit.get(`${d.id}|${w.id}`);
      if (p === undefined) continue;
      const coef = -d.utility + (d.delay_cost?.[w.id] ?? 0);
      qb.addLinear(p, coef);
      deltaEMax += Math.abs(coef);
    }
    qb.addLinear(zBit.get(d.id)!, d.deferral_cost);
    deltaEMax += Math.abs(d.deferral_cost);
  }
  const concentration = [...scenario.concentration_pairs].sort((a, b) =>
    a.left + '|' + a.right < b.left + '|' + b.right ? -1 : a.left + '|' + a.right > b.left + '|' + b.right ? 1 : 0,
  );
  for (const c of concentration) {
    if (c.weight === 0) continue;
    for (const w of windows) {
      const p = xBit.get(`${c.left}|${w.id}`);
      const q = xBit.get(`${c.right}|${w.id}`);
      if (p === undefined || q === undefined) continue;
      qb.addPair(p, q, c.weight);
      deltaEMax += c.weight;
    }
  }

  // --- Cardinality: Σ_t x_{i,t} + z_i = 1 ---------------------------------------
  for (const d of draws) {
    const bits = windows.map((w) => xBit.get(`${d.id}|${w.id}`)).filter((b): b is number => b !== undefined);
    bits.push(zBit.get(d.id)!);
    qb.addSquaredLinear(bits.map((b) => [b, 1]), 1, P.cardinality);
    const id = `card[${d.id}]`;
    oneHot.push({ group_id: id, indices: [...bits].sort((a, b) => a - b), cardinality: 'exactly_one' });
    penaltyTerms.push({ constraint_id: id, P_c: P.cardinality, v_min2: 1 });
  }

  // --- Precedence: forbid the after-draw in a window not strictly later ---------
  const precedence = [...scenario.precedence].sort((a, b) =>
    a.before + '|' + a.after < b.before + '|' + b.after ? -1 : a.before + '|' + a.after > b.before + '|' + b.after ? 1 : 0,
  );
  for (const pr of precedence) {
    let used = false;
    for (const tAfter of windows) {
      const pa = xBit.get(`${pr.after}|${tAfter.id}`);
      if (pa === undefined) continue;
      for (const tBefore of windows) {
        const pb = xBit.get(`${pr.before}|${tBefore.id}`);
        if (pb === undefined) continue;
        if (windowPos.get(tAfter.id)! <= windowPos.get(tBefore.id)!) {
          qb.addPair(pa, pb, P.precedence);
          prunedPairs.push({ left_symbol: nameOf(pb), right_symbol: nameOf(pa), reason: 'tranche_forbid' });
          used = true;
        }
      }
    }
    if (used) penaltyTerms.push({ constraint_id: `prec[${pr.before}<${pr.after}]`, P_c: P.precedence, v_min2: 1 });
  }

  // --- Budget: Σ_i a_i x_{i,t} ≤ L_t ---------------------------------------------
  const budgetEncoding: Record<string, 'none' | 'pair_prune' | 'slack'> = {};
  const slackRefusals: Refusal[] = [];
  for (const w of windows) {
    const members = draws
      .map((d) => ({ d, p: xBit.get(`${d.id}|${w.id}`) }))
      .filter((m): m is { d: FrozenDraw; p: number } => m.p !== undefined);
    const cap = w.liquidity_cap_minor;
    const total = members.reduce((s, m) => s + m.d.amount_minor, 0);
    const constraintId = `budget[${w.id}]`;
    if (total <= cap) {
      budgetEncoding[w.id] = 'none';
      continue;
    }
    const exact = pairPruneIsExact(members.map((m) => m.d.amount_minor), cap);
    if (exact === true) {
      budgetEncoding[w.id] = 'pair_prune';
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          if (members[i].d.amount_minor + members[j].d.amount_minor > cap) {
            qb.addPair(members[i].p, members[j].p, P.budget);
            prunedPairs.push({ left_symbol: nameOf(members[i].p), right_symbol: nameOf(members[j].p), reason: 'budget_pair' });
          }
        }
      }
      penaltyTerms.push({ constraint_id: constraintId, P_c: P.budget, v_min2: 1 });
      continue;
    }

    // Slack: Σ (a_i/g) x_i + Σ_b 2^b s_b = L/g, with g = gcd(amounts, cap) so v_min = 1.
    const unit = members.reduce((g, m) => gcd(g, m.d.amount_minor), cap);
    const capUnits = cap / unit;
    const slackBits = capUnits.toString(2).length;
    if (slackBits > policy.max_slack_bits_per_window) {
      slackRefusals.push({
        code: 'SLACK_BITS_EXCEED_POLICY',
        message: `Window ${w.id} needs ${slackBits} slack bits (cap ${capUnits} units of ${unit} minor); policy allows ${policy.max_slack_bits_per_window}.`,
        path: `scenario.windows[${windowPos.get(w.id)}]`,
      });
      continue;
    }
    budgetEncoding[w.id] = 'slack';
    const groupId = `slack[${w.id}]`;
    const terms: Array<[number, number]> = members.map((m) => [m.p, m.d.amount_minor / unit]);
    const slackIdx: number[] = [];
    for (let b = 0; b < slackBits; b++) {
      const s = newSymbol({ name: `s[${w.id},b${b}]`, kind: 'slack', role: 'slack_bit', window_id: w.id, slack_group: groupId, slack_weight: 2 ** b });
      terms.push([s, 2 ** b]);
      slackIdx.push(s);
    }
    qb.addSquaredLinear(terms, capUnits, P.budget);
    slackGroups.push({ group_id: groupId, constraint_id: constraintId, indices: slackIdx, max_value: 2 ** slackBits - 1, unit_minor: unit });
    penaltyTerms.push({ constraint_id: constraintId, P_c: P.budget, v_min2: 1 });
  }
  if (slackRefusals.length > 0) return refuse(slackRefusals);

  // --- Penalty floor: P_c > ΔE_max / v_min² ---------------------------------------
  const terms: PenaltyTerm[] = penaltyTerms.map((t) => ({
    ...t,
    delta_E_max: deltaEMax,
    satisfied_floor: t.P_c > deltaEMax / t.v_min2,
  }));
  // One refusal per constraint kind is enough to act on.
  const floorRefusals = new Map<string, Refusal>();
  for (const t of terms) {
    const kind = t.constraint_id.split('[')[0];
    if (!t.satisfied_floor && !floorRefusals.has(kind)) {
      floorRefusals.set(kind, {
        code: 'PENALTY_BELOW_FLOOR',
        message: `${kind} penalty ${t.P_c} is not above ΔE_max/v_min² = ${deltaEMax / t.v_min2} (first: ${t.constraint_id}).`,
      });
    }
  }
  if (floorRefusals.size > 0) return refuse([...floorRefusals.values()]);

  // --- Assemble -------------------------------------------------------------------
  const Q_diag = qb.diag.slice();
  const Q_offdiag = qb.offdiag();
  const E0 = qb.E0;
  const n = Q_diag.length;

  // Ising, z = 1 − 2x:  h_i = −Q_ii/2 − Σ_j Q_ij/2,  J_ij = Q_ij/2,  shift = E0 + ΣQ_ii/2 + Σ_{i<j} Q_ij/2
  const h = Q_diag.map((q) => -q / 2);
  let energyShift = E0 + Q_diag.reduce((s, q) => s + q / 2, 0);
  const J_sparse: JEntry[] = [];
  for (const { i, j, q } of Q_offdiag) {
    h[i] -= q / 2;
    h[j] -= q / 2;
    J_sparse.push({ i, j, value: q / 2 });
    energyShift += q / 2;
  }

  const exactValues = [
    ...Q_diag,
    ...Q_offdiag.map((e) => e.q * 2),
    E0,
    ...h.map((v) => v * 4),
    ...J_sparse.map((e) => e.value * 4),
    energyShift * 4,
  ];
  if (!exactValues.every((v) => Number.isSafeInteger(v))) {
    return refuse([{ code: 'NUMERIC_RANGE', message: 'Q or Ising coefficients exceed exact float64 range; reduce weights/penalties or remodel.' }]);
  }

  const bitsByKind: Record<SymbolKind, number> = { decision: 0, deferral: 0, slack: 0, ancilla: 0 };
  for (const s of symbols) bitsByKind[s.kind]++;
  const maxPairs = (n * (n - 1)) / 2;

  const compileReport: CompileReport = {
    prefiltered_draws: [...(options.prefiltered_draws ?? [])].sort((a, b) => (a.draw_id < b.draw_id ? -1 : a.draw_id > b.draw_id ? 1 : 0)),
    pruned_variables: pruned,
    pruned_pairs: prunedPairs,
    refused_constraints: LEGAL_NOT_COMPILED.map((c) => ({ constraint_id: c, reason: 'legal_not_compiled' as const })),
    penalty_terms: terms,
    fixture: { solved_exactly: false, feasibility_rate: null, gap_to_mip: null },
    warnings: [],
    diagnostics: { bits_by_kind: bitsByKind, budget_encoding_by_window: budgetEncoding },
  };
  const scale: QuboArtifact['scale'] = {
    amount_divisor: slackGroups.reduce((g, s) => gcd(g, s.unit_minor), 0) || 1,
    objective_divisor: 1,
    rounding: 'nearest_even',
    reconstructed_unit: 'minor_units',
  };

  const body: Omit<QuboArtifact, 'qubo_artifact_id' | 'payload_hash' | 'q_payload_hash'> = {
    schema_version: SCHEMA_VERSION,
    artifact_version: ARTIFACT_VERSION,
    experiment_id: options.experiment_id ?? null,
    created_at: options.created_at,
    compiler_version: COMPILER_VERSION,
    encoding_version: ENCODING_VERSION,
    idempotency_key: options.idempotency_key,
    q_layout: 'symmetric_xTQx',
    ising_map: 'z = 1 - 2x',

    scenario_id: scenario.scenario_id,
    scenario_freeze_hash: scenarioHash(scenario),
    locked_policy_version: scenario.policy_version_frozen,
    locked_evidence_manifest_hash: scenario.manifest_hash_frozen,
    penalty_policy_id: policy.penalty_policy_id,
    penalty_policy_hash: canonicalHash(policy),
    classical_baseline_id: options.classical_baseline?.id ?? null,
    classical_baseline_hash: options.classical_baseline?.hash ?? null,
    symbol_table_hash: canonicalHash(symbols),

    n,
    symbols,
    one_hot_groups: oneHot,
    slack_groups: slackGroups,

    E0,
    Q_format: 'diag_plus_coo',
    Q_diag,
    Q_offdiag,
    scale,
    coefficient_unit: 'dimensionless',
    density: maxPairs === 0 ? 0 : Q_offdiag.length / maxPairs,
    bandwidth: Q_offdiag.reduce((m, e) => Math.max(m, e.j - e.i), 0),

    h,
    J_sparse,
    energy_shift: energyShift,

    compile_report: compileReport,
    compile_report_hash: canonicalHash(compileReport),
    uncompiled_hard: UNCOMPILED_HARD,
  };
  const withQHash = { ...body, q_payload_hash: qPayloadHash(body) };
  const payloadHash = artifactPayloadHash(withQHash);
  return {
    status: 'COMPILED',
    artifact: { qubo_artifact_id: artifactIdFromHash(payloadHash), ...withQHash, payload_hash: payloadHash },
  };
}
