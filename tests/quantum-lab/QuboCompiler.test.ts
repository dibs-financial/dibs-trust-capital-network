/**
 * QUBO compiler (draw-window/v1) — PARKED / offline research.
 * Spec: docs/quantum-lab/DIBS-QUBO-Compiler-Mechanics.md
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  bitsToSpins,
  compileQubo,
  FrozenScenario,
  isingEnergy,
  PenaltyPolicy,
  QuboArtifact,
  quboEnergy,
} from '../../packages/quantum-lab/qubo';
import { QuboBuilder } from '../../packages/quantum-lab/qubo/compiler';

const POLICY: PenaltyPolicy = {
  penalty_policy_id: 'pp-toy-v1',
  penalties: { cardinality: 100, precedence: 100, budget: 100 },
  max_slack_bits_per_window: 8,
};

function base(overrides: Partial<FrozenScenario> = {}): FrozenScenario {
  return {
    scenario_id: 'scn-toy-001',
    policy_version_frozen: 'policy-2026.09.19',
    manifest_hash_frozen: 'sha256:toy',
    encoding_version: 'draw-window/v1',
    penalty_policy_id: POLICY.penalty_policy_id,
    draws: [],
    windows: [],
    precedence: [],
    concentration_pairs: [],
    ...overrides,
  };
}

/** Memo §10 toy: D1, D2 (after D1), D3. D4 was on hold and is not in the IR. */
function toyScenario(): FrozenScenario {
  const delay = { T1: 0, T2: 1, T3: 2 };
  const all = ['T1', 'T2', 'T3'];
  return base({
    draws: [
      { id: 'D1', amount_minor: 40_000_000, spv_id: 'A', sponsor_id: 'S1', tranche: 1, window_eligibility: all, utility: 10, deferral_cost: 4, delay_cost: delay },
      { id: 'D2', amount_minor: 25_000_000, spv_id: 'A', sponsor_id: 'S1', tranche: 2, window_eligibility: all, utility: 6, deferral_cost: 3, delay_cost: delay },
      { id: 'D3', amount_minor: 30_000_000, spv_id: 'B', sponsor_id: 'S2', tranche: 1, window_eligibility: all, utility: 8, deferral_cost: 5, delay_cost: delay },
    ],
    windows: [
      { id: 'T1', liquidity_cap_minor: 50_000_000 },
      { id: 'T2', liquidity_cap_minor: 45_000_000 },
      { id: 'T3', liquidity_cap_minor: 60_000_000 },
    ],
    precedence: [{ before: 'D1', after: 'D2' }],
    concentration_pairs: [{ left: 'D1', right: 'D2', weight: 3 }],
  });
}

function compiled(s: FrozenScenario, p: PenaltyPolicy = POLICY): QuboArtifact {
  const r = compileQubo(s, p);
  if (r.status !== 'COMPILED') throw new Error(JSON.stringify(r.refusals));
  return r.artifact;
}

function refusalCodes(s: FrozenScenario, p: PenaltyPolicy = POLICY): string[] {
  const r = compileQubo(s, p);
  if (r.status !== 'REQUIRES_REMODELING') throw new Error('expected refusal');
  return r.refusals.map((x) => x.code);
}

function* allBitstrings(n: number): Generator<Array<0 | 1>> {
  for (let m = 0; m < 2 ** n; m++) {
    yield Array.from({ length: n }, (_, i) => ((m >> i) & 1) as 0 | 1);
  }
}

/**
 * Independent re-check against the original model (full-precision minor units),
 * mirroring what the validator does. Slack bits are ignored: they are compiler
 * ancillas, not DIBS objects. Returns the economic energy, or null if infeasible.
 */
function originalModel(s: FrozenScenario, a: QuboArtifact, x: ReadonlyArray<0 | 1>): number | null {
  const placed = new Map<string, string | null>();
  for (const d of s.draws) {
    const on = a.symbol_table.filter((sym) => sym.draw_id === d.id && x[sym.index] === 1);
    if (on.length !== 1) return null;
    placed.set(d.id, on[0].kind === 'z' ? null : on[0].window_id!);
  }
  const pos = new Map(s.windows.map((w, i) => [w.id, i]));
  for (const w of s.windows) {
    const used = s.draws.filter((d) => placed.get(d.id) === w.id).reduce((t, d) => t + d.amount_minor, 0);
    if (used > w.liquidity_cap_minor) return null;
  }
  for (const p of s.precedence) {
    const b = placed.get(p.before);
    const af = placed.get(p.after);
    if (b && af && pos.get(af)! <= pos.get(b)!) return null;
  }
  let e = 0;
  for (const d of s.draws) {
    const w = placed.get(d.id);
    e += w ? -d.utility + (d.delay_cost?.[w] ?? 0) : d.deferral_cost;
  }
  for (const c of s.concentration_pairs) {
    const w = placed.get(c.left);
    if (w && w === placed.get(c.right)) e += c.weight;
  }
  return e;
}

/** Brute force: min QUBO energy over feasible and infeasible states, and the true optimum. */
function landscape(s: FrozenScenario, a: QuboArtifact) {
  let minFeasibleQ = Infinity;
  let minInfeasibleQ = Infinity;
  let trueOptimum = Infinity;
  let ground: Array<0 | 1> = [];
  let groundE = Infinity;
  for (const x of allBitstrings(a.n)) {
    const e = quboEnergy(a, x);
    const econ = originalModel(s, a, x);
    if (econ === null) minInfeasibleQ = Math.min(minInfeasibleQ, e);
    else {
      minFeasibleQ = Math.min(minFeasibleQ, e);
      trueOptimum = Math.min(trueOptimum, econ);
    }
    if (e < groundE) {
      groundE = e;
      ground = x;
    }
  }
  return { minFeasibleQ, minInfeasibleQ, trueOptimum, ground, groundE };
}

describe('Mechanics §10 worked fragment — one draw, two windows', () => {
  const scenario = base({
    draws: [
      { id: 'D1', amount_minor: 400, spv_id: 'A', sponsor_id: 'S1', tranche: 1, window_eligibility: ['T1', 'T2'], utility: 10, deferral_cost: 8, delay_cost: { T1: 0, T2: 5 } },
    ],
    windows: [
      { id: 'T1', liquidity_cap_minor: 500 },
      { id: 'T2', liquidity_cap_minor: 350 },
    ],
  });
  const policy: PenaltyPolicy = { ...POLICY, penalties: { cardinality: 20, precedence: 20, budget: 20 } };

  it('prunes x[D1,T2] and reproduces the spec matrix exactly', () => {
    const a = compiled(scenario, policy);
    expect(a.symbol_table.map((s) => s.name)).toEqual(['x[D1,T1]', 'z[D1]']);
    expect(a.pruned_variables).toEqual([
      { variable: 'x[D1,T2]', draw_id: 'D1', window_id: 'T2', reason: 'AMOUNT_EXCEEDS_WINDOW_CAP' },
    ]);
    expect(a.Q.diag).toEqual([-30, -12]);
    expect(a.Q.offdiag).toEqual([[0, 1, 20]]);
    expect(a.E0).toBe(20);
    expect(a.report.delta_e_max).toBe(18);
    expect(a.report.budget_encoding_by_window).toEqual({ T1: 'none', T2: 'none' });
  });

  it('matches the spec energy table', () => {
    const a = compiled(scenario, policy);
    expect(quboEnergy(a, [1, 0])).toBe(-10);
    expect(quboEnergy(a, [0, 1])).toBe(8);
    expect(quboEnergy(a, [1, 1])).toBe(18);
    expect(quboEnergy(a, [0, 0])).toBe(20);
  });
});

describe('Mechanics §10 numeric slack compile — squared-linear expansion', () => {
  it('reproduces the spec 4×4 symmetric Q and E0', () => {
    const qb = new QuboBuilder();
    const [x1, x2, s0, s1] = [qb.addBit(), qb.addBit(), qb.addBit(), qb.addBit()];
    qb.addLinear(x1, -5);
    qb.addLinear(x2, -3);
    qb.addSquaredLinear([[x1, 4], [x2, 3], [s0, 1], [s1, 2]], 5, 20);
    expect(qb.diag).toEqual([-485, -423, -180, -320]);
    expect(qb.offdiag()).toEqual([
      [0, 1, 240],
      [0, 2, 80],
      [0, 3, 160],
      [1, 2, 60],
      [1, 3, 120],
      [2, 3, 40],
    ]);
    expect(qb.E0).toBe(500);
  });
});

describe('Memo §10 toy — 3 eligible draws × 3 windows, D4 excluded before compile', () => {
  const s = toyScenario();
  const a = compiled(s);

  it('has 12 bits, not 16, and no slack', () => {
    expect(a.n).toBe(12);
    expect(a.report.bits_by_kind).toEqual({ x: 9, z: 3, slack: 0 });
    expect(a.symbol_table.some((sym) => sym.draw_id === 'D4')).toBe(false);
    expect(a.report.budget_encoding_by_window).toEqual({ T1: 'pair_prune', T2: 'pair_prune', T3: 'pair_prune' });
  });

  it('ground state is feasible and equals the true constrained optimum', () => {
    const l = landscape(s, a);
    expect(originalModel(s, a, l.ground)).not.toBeNull();
    expect(l.groundE).toBe(l.trueOptimum);
    expect(l.minFeasibleQ).toBe(l.trueOptimum);
    // No infeasible bitstring can buy its way under the optimum.
    expect(l.minInfeasibleQ).toBeGreaterThan(l.trueOptimum);
  });

  it('feasible states carry zero penalty: E(x) equals the economic energy', () => {
    for (const x of allBitstrings(a.n)) {
      const econ = originalModel(s, a, x);
      if (econ !== null) expect(quboEnergy(a, x)).toBe(econ);
    }
  });

  it('kills the memo’s named infeasible schedules', () => {
    const bit = (name: string) => a.symbol_table.find((sym) => sym.name === name)!.index;
    const make = (names: string[]) => {
      const x = new Array(a.n).fill(0) as Array<0 | 1>;
      names.forEach((nm) => (x[bit(nm)] = 1));
      return x;
    };
    // D1 and D3 both in T1 (700k > 500k)
    const d1d3 = make(['x[D1,T1]', 'x[D3,T1]', 'z[D2]']);
    // D2 in T1 and D1 in T2 (tranche order)
    const order = make(['x[D2,T1]', 'x[D1,T2]', 'z[D3]']);
    const l = landscape(s, a);
    for (const x of [d1d3, order]) {
      expect(originalModel(s, a, x)).toBeNull();
      expect(quboEnergy(a, x)).toBeGreaterThan(l.trueOptimum);
    }
  });

  it('Ising map z = 1 − 2x preserves every energy', () => {
    for (const x of allBitstrings(a.n)) {
      expect(isingEnergy(a, bitsToSpins(x))).toBe(quboEnergy(a, x));
    }
  });
});

describe('budget that pair couplings cannot express falls back to slack', () => {
  // 200+200 ≤ 500 for every pair, but 600 > 500 for all three.
  const s = base({
    draws: ['A', 'B', 'C'].map((id, i) => ({
      id,
      amount_minor: 20_000,
      spv_id: `spv-${id}`,
      sponsor_id: `sp-${id}`,
      tranche: 1,
      window_eligibility: ['W1'],
      utility: 5 + i,
      deferral_cost: 1,
    })),
    windows: [{ id: 'W1', liquidity_cap_minor: 50_000 }],
  });

  it('uses gcd units so slack stays small: 500/100 → 3 bits', () => {
    const a = compiled(s);
    expect(a.report.budget_encoding_by_window).toEqual({ W1: 'slack' });
    expect(a.scale_factors.slack_unit_minor_by_window).toEqual({ W1: 10_000 });
    expect(a.report.bits_by_kind).toEqual({ x: 3, z: 3, slack: 3 });
  });

  it('ground state is feasible and optimal; infeasible states sit above it', () => {
    const a = compiled(s);
    const l = landscape(s, a);
    expect(originalModel(s, a, l.ground)).not.toBeNull();
    expect(l.groundE).toBe(l.trueOptimum);
    expect(l.minInfeasibleQ).toBeGreaterThan(l.trueOptimum);
  });

  it('refuses when slack would exceed the policy bit budget', () => {
    expect(refusalCodes(s, { ...POLICY, max_slack_bits_per_window: 2 })).toEqual(['SLACK_BITS_EXCEED_POLICY']);
  });
});

describe('refusals — REQUIRES_REMODELING, never a bigger penalty', () => {
  it('refuses a hold-blocked draw that reached the IR', () => {
    const s = toyScenario();
    (s.draws as unknown as Array<Record<string, unknown>>).push({
      id: 'D4', amount_minor: 20_000_000, spv_id: 'A', sponsor_id: 'S1', tranche: 1,
      window_eligibility: ['T1'], utility: 1, deferral_cost: 1, hold_open: true,
    });
    expect(refusalCodes(s)).toEqual(['LEGAL_FLAG_IN_IR']);
  });

  it('refuses a sanctions flag and a KYC status as fields', () => {
    const s = toyScenario();
    Object.assign(s.draws[0], { sanctions_hit: false, kyc_status: 'CURRENT' });
    expect(refusalCodes(s)).toEqual(['LEGAL_FLAG_IN_IR', 'LEGAL_FLAG_IN_IR']);
  });

  it('refuses PII or any unknown field', () => {
    const s = toyScenario();
    Object.assign(s.draws[0], { borrower_name: 'Jane Doe' });
    expect(refusalCodes(s)).toEqual(['UNKNOWN_FIELD']);
  });

  it('refuses float money', () => {
    const s = toyScenario();
    s.draws[0].amount_minor = 40_000_000.5;
    expect(refusalCodes(s)).toEqual(['NON_INTEGER_MONEY']);
  });

  it('refuses a live policy pointer', () => {
    expect(refusalCodes({ ...toyScenario(), policy_version_frozen: 'latest' })).toEqual(['LIVE_POLICY_VERSION']);
  });

  it('refuses a penalty at or below the floor', () => {
    // ΔE_max for the toy is 84.
    const low: PenaltyPolicy = { ...POLICY, penalties: { cardinality: 84, precedence: 100, budget: 100 } };
    expect(refusalCodes(toyScenario(), low)).toEqual(['PENALTY_BELOW_FLOOR']);
    const ok: PenaltyPolicy = { ...POLICY, penalties: { cardinality: 85, precedence: 85, budget: 85 } };
    expect(compileQubo(toyScenario(), ok).status).toBe('COMPILED');
  });

  it('refuses a scenario pinned to a different penalty policy', () => {
    expect(refusalCodes(toyScenario(), { ...POLICY, penalty_policy_id: 'pp-other' })).toEqual(['PENALTY_POLICY_MISMATCH']);
  });

  it('refuses precedence on a draw that pre-filter removed', () => {
    const s = toyScenario();
    s.precedence.push({ before: 'D4', after: 'D3' });
    expect(refusalCodes(s)).toEqual(['UNKNOWN_REFERENCE']);
  });

  it('refuses reserve bands, which are not in draw-window/v1', () => {
    const s = { ...toyScenario(), reserve_bands: [] } as unknown as FrozenScenario;
    expect(refusalCodes(s)).toEqual(['RESERVE_BANDS_NOT_IN_ENCODING']);
  });

  it('refuses an encoding version it does not implement', () => {
    expect(refusalCodes({ ...toyScenario(), encoding_version: 'draw-window/v2' })).toEqual(['ENCODING_VERSION_MISMATCH']);
  });
});

describe('artifact', () => {
  it('is deterministic: input order does not change the hash', () => {
    const a = compiled(toyScenario());
    const shuffled = toyScenario();
    shuffled.draws.reverse();
    expect(compiled(shuffled).artifact_hash).toBe(a.artifact_hash);
    expect(a.qubo_artifact_id).toBe(`qubo_${a.artifact_hash.slice(0, 16)}`);
  });

  it('pins the penalty policy: a changed penalty is a different artifact', () => {
    const a = compiled(toyScenario());
    const b = compiled(toyScenario(), { ...POLICY, penalties: { ...POLICY.penalties, budget: 101 } });
    expect(b.artifact_hash).not.toBe(a.artifact_hash);
  });

  it('carries frozen provenance and is not shaped like a draw or settlement', () => {
    const a = compiled(toyScenario());
    expect(a).toMatchObject({
      kind: 'DIBS_QLAB_QUBO_ARTIFACT',
      scenario_id: 'scn-toy-001',
      policy_version_frozen: 'policy-2026.09.19',
      penalty_policy_id: 'pp-toy-v1',
      q_layout: 'symmetric_xTQx',
      spin_map: 'z=1-2x',
    });
    for (const k of ['status', 'amount_approved_minor', 'payee_bank_account_id', 'draw_request_id', 'settlement_reference']) {
      expect(a).not.toHaveProperty(k);
    }
    expect(a.refused_constraints).toContain('sanctions');
  });
});

describe('isolation from Autopilot', () => {
  const root = path.resolve(__dirname, '../..');
  const tsFiles = (dir: string): string[] =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? tsFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : [],
        )
      : [];
  const importsOf = (file: string) =>
    [...fs.readFileSync(file, 'utf8').matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

  it('quantum-lab imports nothing from backend/ or shared/', () => {
    for (const f of tsFiles(path.join(root, 'packages/quantum-lab'))) {
      for (const spec of importsOf(f)) {
        expect(spec).not.toMatch(/^@backend|^@shared|backend\/|shared\//);
      }
    }
  });

  it('backend/ and shared/ import nothing from quantum-lab', () => {
    for (const f of [...tsFiles(path.join(root, 'backend')), ...tsFiles(path.join(root, 'shared'))]) {
      for (const spec of importsOf(f)) expect(spec).not.toMatch(/quantum-lab/);
    }
  });
});
