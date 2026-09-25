/**
 * DIBS Quantum Lab — QUBO compiler (draw-window/v1).
 *
 *   FrozenScenario + PenaltyPolicy → (Q, symbol table, compile report)
 *
 * PARKED / offline research. The output is a versioned artifact for a solver and
 * the independent validator. It is not a schedule, not an approval, and not an
 * input type of any Autopilot command.
 *
 * Pipeline (docs/quantum-lab/DIBS-QUBO-Compiler-Mechanics.md):
 *   validate IR → name bits (with pruning) → objective → constraints
 *   (one-hot, precedence pairs, budget pair-prune or slack) → penalty floor
 *   → assemble symmetric Q → Ising map → hash.
 *
 * All IR weights and penalties are integers, so Q holds integers and
 * half-integers, and h / J / offset hold quarter-integers — exact in float64.
 * A range check refuses anything that would lose that exactness.
 */

import { canonicalHash } from './hash';
import {
  CompileResult,
  ConstraintRecord,
  ENCODING_VERSION,
  FrozenDraw,
  FrozenScenario,
  PenaltyPolicy,
  PrunedVariable,
  QuboArtifact,
  Refusal,
  SymEntry,
  SymbolEntry,
  SymbolKind,
} from './types';
import { validatePenaltyPolicy, validateScenario } from './validate';

/** Search budget for proving that pairwise budget couplings are exact for a window. */
const PAIR_PRUNE_SEARCH_LIMIT = 200_000;

/** Constraint classes the compiler never encodes. Pre-filter removes them; the validator re-checks them. */
const REFUSED_CONSTRAINT_CLASSES = [
  'legal_eligibility',
  'kyc_aml',
  'sanctions',
  'executed_documents',
  'open_holds',
  'payee_verification',
  'settlement_route',
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

  /** Symmetric layout: Q_ij = Q_ji = α/2. */
  offdiag(): SymEntry[] {
    const out: SymEntry[] = [];
    for (const [key, alpha] of this.pairs) {
      if (alpha === 0) continue;
      const [p, q] = key.split(',').map(Number);
      out.push([p, q, alpha / 2]);
    }
    return out.sort((l, r) => l[0] - r[0] || l[1] - r[1]);
  }
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
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

export function compileQubo(scenario: FrozenScenario, policy: PenaltyPolicy): CompileResult {
  const inputRefusals = [...validatePenaltyPolicy(policy), ...validateScenario(scenario, policy)];
  if (inputRefusals.length > 0) return refuse(inputRefusals);

  const P = policy.penalties;
  const windows = scenario.windows; // array order is time order
  const windowPos = new Map(windows.map((w, i) => [w.id, i]));
  const draws: FrozenDraw[] = [...scenario.draws].sort(byId);

  const qb = new QuboBuilder();
  const symbols: SymbolEntry[] = [];
  const pruned: PrunedVariable[] = [];
  const constraints: ConstraintRecord[] = [];
  const xBit = new Map<string, number>(); // `${draw}|${window}` → bit
  const zBit = new Map<string, number>();

  const newSymbol = (entry: Omit<SymbolEntry, 'index'>): number => {
    const index = qb.addBit();
    symbols.push({ index, ...entry });
    return index;
  };

  // --- Variables: x_{i,t} (pruned where impossible), then z_i -------------------
  for (const d of draws) {
    const eligible = new Set(d.window_eligibility);
    for (const w of windows) {
      const variable = `x[${d.id},${w.id}]`;
      if (!eligible.has(w.id)) {
        pruned.push({ variable, draw_id: d.id, window_id: w.id, reason: 'WINDOW_NOT_ELIGIBLE' });
      } else if (d.amount_minor > w.liquidity_cap_minor) {
        pruned.push({ variable, draw_id: d.id, window_id: w.id, reason: 'AMOUNT_EXCEEDS_WINDOW_CAP' });
      } else {
        xBit.set(`${d.id}|${w.id}`, newSymbol({ name: variable, kind: 'x', draw_id: d.id, window_id: w.id }));
      }
    }
    zBit.set(d.id, newSymbol({ name: `z[${d.id}]`, kind: 'z', draw_id: d.id }));
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
    const z = zBit.get(d.id)!;
    qb.addLinear(z, d.deferral_cost);
    deltaEMax += Math.abs(d.deferral_cost);
  }
  const concentration = [...scenario.concentration_pairs].sort(
    (a, b) => (a.left + '|' + a.right < b.left + '|' + b.right ? -1 : a.left + '|' + a.right > b.left + '|' + b.right ? 1 : 0),
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
    const bits = windows
      .map((w) => xBit.get(`${d.id}|${w.id}`))
      .filter((b): b is number => b !== undefined);
    bits.push(zBit.get(d.id)!);
    qb.addSquaredLinear(bits.map((b) => [b, 1]), 1, P.cardinality);
    constraints.push({ id: `card[${d.id}]`, kind: 'cardinality', penalty: P.cardinality, delta_e_max: 0, v_min: 1, bits });
  }

  // --- Precedence: forbid after-draw in a window not strictly later than before-draw
  const precedence = [...scenario.precedence].sort((a, b) =>
    a.before + '|' + a.after < b.before + '|' + b.after ? -1 : a.before + '|' + a.after > b.before + '|' + b.after ? 1 : 0,
  );
  for (const pr of precedence) {
    const bits = new Set<number>();
    for (const tAfter of windows) {
      const pa = xBit.get(`${pr.after}|${tAfter.id}`);
      if (pa === undefined) continue;
      for (const tBefore of windows) {
        const pb = xBit.get(`${pr.before}|${tBefore.id}`);
        if (pb === undefined) continue;
        if (windowPos.get(tAfter.id)! <= windowPos.get(tBefore.id)!) {
          qb.addPair(pa, pb, P.precedence);
          bits.add(pa).add(pb);
        }
      }
    }
    if (bits.size > 0) {
      constraints.push({
        id: `prec[${pr.before}<${pr.after}]`,
        kind: 'precedence',
        penalty: P.precedence,
        delta_e_max: 0,
        v_min: 1,
        bits: [...bits].sort((a, b) => a - b),
      });
    }
  }

  // --- Budget: Σ_i a_i x_{i,t} ≤ L_t ---------------------------------------------
  const budgetEncoding: Record<string, 'none' | 'pair_prune' | 'slack'> = {};
  const slackUnits: Record<string, number> = {};
  const slackRefusals: Refusal[] = [];
  for (const w of windows) {
    const members = draws
      .map((d) => ({ d, p: xBit.get(`${d.id}|${w.id}`) }))
      .filter((m): m is { d: FrozenDraw; p: number } => m.p !== undefined);
    const cap = w.liquidity_cap_minor;
    const total = members.reduce((s, m) => s + m.d.amount_minor, 0);
    if (total <= cap) {
      budgetEncoding[w.id] = 'none';
      continue;
    }
    const exact = pairPruneIsExact(members.map((m) => m.d.amount_minor), cap);
    if (exact === true) {
      budgetEncoding[w.id] = 'pair_prune';
      const bits = new Set<number>();
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          if (members[i].d.amount_minor + members[j].d.amount_minor > cap) {
            qb.addPair(members[i].p, members[j].p, P.budget);
            bits.add(members[i].p).add(members[j].p);
          }
        }
      }
      constraints.push({
        id: `budget[${w.id}]`,
        kind: 'budget_pair',
        penalty: P.budget,
        delta_e_max: 0,
        v_min: 1,
        bits: [...bits].sort((a, b) => a - b),
      });
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
    slackUnits[w.id] = unit;
    const terms: Array<[number, number]> = members.map((m) => [m.p, m.d.amount_minor / unit]);
    for (let b = 0; b < slackBits; b++) {
      const s = newSymbol({ name: `s[${w.id},b${b}]`, kind: 'slack', window_id: w.id, bit: b });
      terms.push([s, 2 ** b]);
    }
    qb.addSquaredLinear(terms, capUnits, P.budget);
    constraints.push({
      id: `budget[${w.id}]`,
      kind: 'budget_slack',
      penalty: P.budget,
      delta_e_max: 0,
      v_min: 1,
      bits: terms.map(([p]) => p).sort((a, b) => a - b),
    });
  }
  if (slackRefusals.length > 0) return refuse(slackRefusals);

  // --- Penalty floor: P_c > ΔE_max / v_min² ---------------------------------------
  // One refusal per constraint kind is enough to act on.
  const floorRefusals = new Map<string, Refusal>();
  for (const c of constraints) {
    c.delta_e_max = deltaEMax;
    const floor = deltaEMax / (c.v_min * c.v_min);
    if (!(c.penalty > floor) && !floorRefusals.has(c.kind)) {
      floorRefusals.set(c.kind, {
        code: 'PENALTY_BELOW_FLOOR',
        message: `${c.kind} penalty ${c.penalty} is not above ΔE_max/v_min² = ${floor} (first: ${c.id}).`,
      });
    }
  }
  if (floorRefusals.size > 0) return refuse([...floorRefusals.values()]);

  // --- Assemble -------------------------------------------------------------------
  const diag = qb.diag.slice();
  const offdiag = qb.offdiag();
  const E0 = qb.E0;
  const n = diag.length;

  // Ising, z = 1 − 2x:  h_i = −Q_ii/2 − Σ_j Q_ij/2,  J_ij = Q_ij/2,  offset = E0 + ΣQ_ii/2 + Σ_{i<j} Q_ij/2
  const h = diag.map((q) => -q / 2);
  let offset = E0 + diag.reduce((s, q) => s + q / 2, 0);
  const J: SymEntry[] = [];
  for (const [i, j, v] of offdiag) {
    h[i] -= v / 2;
    h[j] -= v / 2;
    J.push([i, j, v / 2]);
    offset += v / 2;
  }

  const exactValues = [
    ...diag,
    ...offdiag.map((e) => e[2] * 2),
    E0,
    ...h.map((v) => v * 4),
    ...J.map((e) => e[2] * 4),
    offset * 4,
  ];
  if (!exactValues.every((v) => Number.isSafeInteger(v))) {
    return refuse([
      {
        code: 'NUMERIC_RANGE',
        message: 'Q or Ising coefficients exceed exact float64 range; reduce weights/penalties or remodel.',
      },
    ]);
  }

  const energyScale = Math.max(1, ...diag.map(Math.abs), ...offdiag.map((e) => Math.abs(e[2])));
  const bitsByKind: Record<SymbolKind, number> = { x: 0, z: 0, slack: 0 };
  for (const s of symbols) bitsByKind[s.kind]++;
  const maxPairs = (n * (n - 1)) / 2;

  const body: Omit<QuboArtifact, 'qubo_artifact_id' | 'artifact_hash'> = {
    kind: 'DIBS_QLAB_QUBO_ARTIFACT',
    scenario_id: scenario.scenario_id,
    policy_version_frozen: scenario.policy_version_frozen,
    manifest_hash_frozen: scenario.manifest_hash_frozen,
    encoding_version: ENCODING_VERSION,
    penalty_policy_id: policy.penalty_policy_id,
    q_layout: 'symmetric_xTQx',
    spin_map: 'z=1-2x',
    n,
    symbol_table: symbols,
    Q: { diag, offdiag },
    E0,
    ising: { h, J, offset },
    scale_factors: { energy_scale: energyScale, slack_unit_minor_by_window: slackUnits },
    constraints,
    pruned_variables: pruned,
    refused_constraints: REFUSED_CONSTRAINT_CLASSES,
    report: {
      bits: n,
      bits_by_kind: bitsByKind,
      nonzero_offdiag: offdiag.length,
      density: maxPairs === 0 ? 0 : offdiag.length / maxPairs,
      bandwidth: offdiag.reduce((m, [i, j]) => Math.max(m, j - i), 0),
      delta_e_max: deltaEMax,
      budget_encoding_by_window: budgetEncoding,
    },
    classical_baseline_ref: scenario.classical_baseline_ref ?? null,
  };
  const artifactHash = canonicalHash(body);
  return {
    status: 'COMPILED',
    artifact: { ...body, qubo_artifact_id: `qubo_${artifactHash.slice(0, 16)}`, artifact_hash: artifactHash },
  };
}
