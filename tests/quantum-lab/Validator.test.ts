/**
 * Independent validator (validator/v1) — PARKED / offline research.
 * Spec: docs/quantum-lab/DIBS-Independent-Validator-Logic.md
 */

import { generateKeyPairSync, KeyObject } from 'crypto';
import {
  artifactIdFromHash,
  artifactPayloadHash,
  canonicalHash,
  CompileOptions,
  compileQubo,
  FrozenScenario,
  PenaltyPolicy,
  qPayloadHash,
  QuboArtifact,
  signArtifact,
} from '../../packages/quantum-lab/qubo';
import {
  ClassicalBaseline,
  FrozenBook,
  StressSpec,
  ValidationReport,
  ValidationRequest,
  validateCandidate,
  verifyReport,
} from '../../packages/quantum-lab/validators';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const SIGNER = { key_id: 'qlab-validator-test', private_key: privateKey };

const POLICY: PenaltyPolicy = {
  penalty_policy_id: 'pp-val-v1',
  penalties: { cardinality: 100, precedence: 100, budget: 100 },
  max_slack_bits_per_window: 8,
};

const OK = { hold_open: false, payee_verified: true, sanctions_clear: true, kyc_current: true, docs_current: true, settlement_route_live: true };

function scenario(overrides: Partial<FrozenScenario> = {}): FrozenScenario {
  return {
    scenario_id: 'scn-val-001',
    policy_version_frozen: 'policy-2026.09.19',
    manifest_hash_frozen: 'sha256:freeze',
    encoding_version: 'draw-window/v1',
    penalty_policy_id: POLICY.penalty_policy_id,
    draws: [
      { id: 'D1', amount_minor: 180, spv_id: 'S', sponsor_id: 'SP1', tranche: 1, window_eligibility: ['W1'], utility: 5, deferral_cost: 0 },
      { id: 'D2', amount_minor: 150, spv_id: 'S', sponsor_id: 'SP1', tranche: 1, window_eligibility: ['W1'], utility: 3, deferral_cost: 0 },
    ],
    windows: [{ id: 'W1', liquidity_cap_minor: 300 }],
    precedence: [],
    concentration_pairs: [],
    ...overrides,
  };
}

function book(s: FrozenScenario, overrides: Partial<FrozenBook> = {}): FrozenBook {
  const status: FrozenBook['draw_status'] = {};
  for (const d of s.draws) status[d.id] = { ...OK };
  return {
    locked_policy_version: s.policy_version_frozen,
    locked_evidence_manifest_hash: s.manifest_hash_frozen,
    scenario: s,
    draw_status: status,
    stresses: [],
    ...overrides,
  };
}

const OPTS: CompileOptions = { created_at: '2026-09-25T06:00:00Z', idempotency_key: 'compile-val-1' };

/** MIP on the §6 toy: fund D1 only, J = −5. */
const BASELINE: ClassicalBaseline = { baseline_id: 'mip-toy-1', objective_minor: -5, assignment: { D1: 'W1', D2: null } };
const PINNED: CompileOptions = { ...OPTS, classical_baseline: { id: BASELINE.baseline_id, hash: canonicalHash(BASELINE) } };

function compile(s: FrozenScenario, p: PenaltyPolicy = POLICY, o: CompileOptions = OPTS): QuboArtifact {
  const r = compileQubo(s, p, o);
  if (r.status !== 'COMPILED') throw new Error(JSON.stringify(r.refusals));
  return r.artifact;
}

/** Bitstring with exactly the named symbols on. */
function bits(a: QuboArtifact, on: string[]): Array<0 | 1> {
  const x = new Array(a.n).fill(0) as Array<0 | 1>;
  for (const name of on) {
    const s = a.symbols.find((sym) => sym.name === name);
    if (!s) throw new Error(`no symbol ${name}`);
    x[s.index] = 1;
  }
  return x;
}

function run(a: QuboArtifact, b: FrozenBook, x: number[], extra: Partial<ValidationRequest> = {}): ValidationReport {
  return validateCandidate(
    {
      experiment_id: 'exp-001',
      artifact: a,
      bitstring: { encoding: 'bits', values: x },
      book: b,
      penalty_policy: POLICY,
      occurred_at: '2026-09-25T07:00:00Z',
      ...extra,
    },
    SIGNER,
  );
}

function check(r: ValidationReport, code: string, subject?: string) {
  return r.checks.find((c) => c.code === code && (subject === undefined || c.subject === subject));
}

/** Re-sign an artifact after tampering, the way a buggy compiler would. */
function reseal(a: QuboArtifact): QuboArtifact {
  const body = {
    ...a,
    symbol_table_hash: canonicalHash(a.symbols),
    compile_report_hash: canonicalHash(a.compile_report),
    q_payload_hash: qPayloadHash(a),
  };
  const h = artifactPayloadHash(body);
  return { ...body, payload_hash: h, qubo_artifact_id: artifactIdFromHash(h) };
}

describe('spec §6 worked toy — 180 + 150 against a 300 cap', () => {
  const s = scenario();
  const a = compile(s);
  const cashLadder = {
    opening_cash_minor: 1_000,
    periods: { W1: { committed_inflows_minor: 0, confirmed_facility_draws_minor: 0, instructed_unconfirmed_minor: 0, scheduled_outflows_minor: 0, required_reserve_minor: 100 } },
  };
  const b = book(s, { cash_ladder: cashLadder });

  it('A — legal: CANDIDATE_VALIDATED, replay −5, budget 180 ≤ 300, tranche SKIP', () => {
    const pinned = compile(s, POLICY, PINNED);
    const r = run(pinned, b, bits(pinned, ['x[D1,W1]', 'z[D2]']), { classical_baseline: BASELINE });
    expect(r.verdict).toBe('CANDIDATE_VALIDATED');
    expect(check(r, 'BUDGET_EXCEEDED', 'W1')).toMatchObject({ status: 'PASS', measured: '180', limit: '300', unit: 'minor' });
    expect(check(r, 'RESERVE_BREACH', 'W1')?.status).toBe('PASS');
    expect(check(r, 'TRANCHE_ORDER_VIOLATION')?.status).toBe('SKIP');
    expect(r.candidate_economic_objective_minor).toBe('-5');
    expect(r.gap_bps).toBe('0');
    expect(r.decoded_schedule).toEqual([
      { draw_id: 'D1', windows: ['W1'], deferred: false, amount_minor: '180' },
      { draw_id: 'D2', windows: [], deferred: true, amount_minor: '150' },
    ]);
  });

  it('B — Q-cheap, book-illegal: REJECTED on BUDGET_EXCEEDED 330 > 300', () => {
    const r = run(a, b, bits(a, ['x[D1,W1]', 'x[D2,W1]']));
    expect(r.verdict).toBe('REJECTED');
    expect(r.verdict_reasons).toContain('BUDGET_EXCEEDED');
    expect(check(r, 'BUDGET_EXCEEDED', 'W1')).toMatchObject({ status: 'FAIL', measured: '330', limit: '300' });
    expect(r.candidate_economic_objective_minor).toBe('-8');
  });

  it('C — compiler bug: a held draw got a bit → REQUIRES_REMODELING', () => {
    // A pre-filter bug let D4 into the IR without its flags; the freeze marks it HELD.
    const buggy = scenario({
      draws: [
        ...scenario().draws,
        { id: 'D4', amount_minor: 50, spv_id: 'S', sponsor_id: 'SP1', tranche: 1, window_eligibility: ['W1'], utility: 4, deferral_cost: 0 },
      ],
    });
    const a4 = compile(buggy);
    const b4 = book(buggy);
    b4.draw_status.D4 = { ...OK, hold_open: true };
    const r = run(a4, b4, bits(a4, ['x[D1,W1]', 'z[D2]', 'x[D4,W1]']));
    expect(r.verdict).toBe('REQUIRES_REMODELING');
    expect(check(r, 'INELIGIBLE_BIT_ALLOCATED')).toMatchObject({ status: 'FAIL', subject: 'D4' });
    expect(check(r, 'LEGAL_OR_COMPLIANCE_PRESENT')).toMatchObject({ status: 'FAIL', subject: 'D4' });
    expect(check(r, 'OPEN_HOLD_PRESENT', 'D4')?.status).toBe('FAIL');
  });

  it('D — Q never saw LTV: fund-both fits a 400 cap but breaches 7000 bps', () => {
    const s400 = scenario({ windows: [{ id: 'W1', liquidity_cap_minor: 400 }] });
    const a400 = compile(s400);
    const b400 = book(s400, { spvs: { S: { outstanding_debt_minor: 50, eligible_collateral_minor: 500, policy_ltv_bps: 7_000 } } });
    const r = run(a400, b400, bits(a400, ['x[D1,W1]', 'x[D2,W1]']));
    expect(r.verdict).toBe('REJECTED');
    expect(check(r, 'BUDGET_EXCEEDED', 'W1')).toMatchObject({ status: 'PASS', measured: '330', limit: '400' });
    expect(check(r, 'LTV_BREACH', 'S')).toMatchObject({ status: 'FAIL', measured: '7600', limit: '7000', unit: 'bps' });
    // The matrix ranks this as its optimum; the validator ignores that.
    expect(r.q_energy).toBe(-8);
  });
});

describe('pass 0 — bind (fail closed, no decode)', () => {
  const s = scenario();
  const a = compile(s);
  const x = bits(a, ['x[D1,W1]', 'z[D2]']);

  const cases: Array<[string, () => ValidationReport, string]> = [
    ['different freeze, same scenario_id', () => {
      const s2 = scenario();
      s2.draws[0].amount_minor = 181;
      return run(a, book(s2), x);
    }, 'BIND_SCENARIO_FREEZE_HASH'],
    ['tampered Q', () => run({ ...a, Q_diag: a.Q_diag.map((v) => v - 1) }, book(s), x), 'BIND_Q_PAYLOAD_HASH'],
    ['tampered symbol table', () => run({ ...a, symbols: [...a.symbols].reverse() }, book(s), x), 'BIND_SYMBOL_TABLE_HASH'],
    ['tampered compile report', () => run({ ...a, compile_report: { ...a.compile_report, warnings: ['x'] } }, book(s), x), 'BIND_COMPILE_REPORT_HASH'],
    ['undeclared penalty policy', () => run(a, book(s), x, { penalty_policy: { ...POLICY, penalty_policy_id: 'pp-other' } }), 'BIND_PENALTY_POLICY'],
    ['same penalty policy id, different body', () => run(a, book(s), x, { penalty_policy: { ...POLICY, penalties: { ...POLICY.penalties, budget: 99 } } }), 'BIND_PENALTY_POLICY'],
    ['baseline not the pinned one', () => run(a, book(s), x, { classical_baseline: BASELINE }), 'BIND_CLASSICAL_BASELINE'],
    ['unknown schema version', () => run(reseal({ ...a, schema_version: 'qlab.qubo_artifact.v2' as 'qlab.qubo_artifact.v1' }), book(s), x), 'BIND_ARTIFACT_LITERALS'],
    ['a field named approved', () => run(reseal({ ...a, approved: true } as QuboArtifact), book(s), x), 'FORBIDDEN_FIELD'],
    ['Ising cache disagrees with Q', () => run(reseal({ ...a, h: a.h.map((v, i) => (i === 0 ? v + 1 : v)) }), book(s), x), 'ISING_MISMATCH'],
    ['LTV missing from uncompiled_hard', () => run(reseal({ ...a, uncompiled_hard: a.uncompiled_hard.filter((u) => u.code !== 'LTV') }), book(s), x), 'HARD_CONSTRAINT_UNACCOUNTED'],
    ['compiler key given, artifact unsigned', () => run(a, book(s), x, { compiler_public_key: publicKey }), 'BIND_ARTIFACT_SIGNATURE'],
    ['policy version not the locked one', () => run(a, book(s, { locked_policy_version: 'policy-2026.10.01' }), x), 'BIND_LOCKED_POLICY_VERSION'],
    ['evidence manifest not the locked one', () => run(a, book(s, { locked_evidence_manifest_hash: 'sha256:other' }), x), 'BIND_EVIDENCE_MANIFEST_HASH'],
    ['legal flag inside the IR', () => {
      const s2 = scenario();
      Object.assign(s2.draws[0], { hold_open: false });
      return run(a, book(s2), x);
    }, 'BIND_IR_GATE'],
    ['draw with no eligibility facts', () => {
      const b = book(s);
      delete b.draw_status.D2;
      return run(a, b, x);
    }, 'BOOK_INCOMPLETE'],
    ['float money in the cash ladder', () => run(a, book(s, {
      cash_ladder: { opening_cash_minor: 10.5, periods: { W1: { committed_inflows_minor: 0, confirmed_facility_draws_minor: 0, instructed_unconfirmed_minor: 0, scheduled_outflows_minor: 0, required_reserve_minor: 0 } } },
    }), x), 'MONEY_SCALE_MISMATCH'],
    ['declared stress with no data to run on', () => run(a, book(s, { stresses: [{ name: 'lag', kind: 'CONFIRMATION_LAG', lag_windows: 1 }] }), x), 'STRESS_NOT_EVALUABLE'],
    ['local-time timestamp', () => run(a, book(s), x, { occurred_at: '2026-09-25T07:00:00-04:00' }), 'BIND_REQUEST'],
  ];

  it.each(cases)('%s → REQUIRES_REMODELING', (_label, make, code) => {
    const r = make();
    expect(r.verdict).toBe('REQUIRES_REMODELING');
    expect(r.verdict_reasons).toContain(code);
    expect(r.decoded_x).toBeNull();
    expect(r.decoded_schedule).toBeNull();
  });
});

describe('artifact signature and pre-filter record', () => {
  const s = scenario();
  const a = compile(s);
  const x = bits(a, ['x[D1,W1]', 'z[D2]']);

  it('accepts a compiler-signed artifact under the compiler key, and not under another', () => {
    const compilerKeys = generateKeyPairSync('ed25519');
    const signed = signArtifact(a, 'qlab-compiler-test', compilerKeys.privateKey);
    expect(run(signed, book(s), x, { compiler_public_key: compilerKeys.publicKey }).verdict).toBe('CANDIDATE_VALIDATED');
    expect(run(signed, book(s), x, { compiler_public_key: publicKey }).verdict_reasons).toContain('BIND_ARTIFACT_SIGNATURE');
  });

  it('a bit for a draw the compile report says was pre-filtered → REQUIRES_REMODELING', () => {
    const lying = reseal({ ...a, compile_report: { ...a.compile_report, prefiltered_draws: [{ draw_id: 'D2', reason: 'hold' }] } });
    const r = run(lying, book(s), x);
    expect(r.verdict).toBe('REQUIRES_REMODELING');
    expect(check(r, 'INELIGIBLE_BIT_ALLOCATED')).toMatchObject({ status: 'FAIL', subject: 'D2' });
  });
});

describe('pass 1–3 — decode, ancillas, reconstruction', () => {
  const s = scenario();
  const a = compile(s);
  const b = book(s);

  it('wrong length → REJECTED, nothing decoded', () => {
    const r = run(a, b, [1, 0]);
    expect(r.verdict).toBe('REJECTED');
    expect(check(r, 'BITSTRING_LENGTH_MISMATCH')).toMatchObject({ status: 'FAIL', measured: '2', limit: String(a.n) });
    expect(r.decoded_x).toBeNull();
  });

  it('spins decode with x = (1 − z)/2 to the same result as bits', () => {
    const x = bits(a, ['x[D1,W1]', 'z[D2]']);
    const viaBits = run(a, b, x);
    const viaSpins = run(a, b, x.map((v) => (v ? -1 : 1)), { bitstring: { encoding: 'spins', values: x.map((v) => (v ? -1 : 1)) } });
    expect(viaSpins.decoded_x).toEqual(x);
    expect(viaSpins.verdict).toBe(viaBits.verdict);
    expect(viaSpins.decoded_schedule).toEqual(viaBits.decoded_schedule);
  });

  it('one-hot break → REJECTED, and later checks still run', () => {
    const r = run(a, b, bits(a, ['x[D1,W1]', 'z[D1]', 'z[D2]']));
    expect(r.verdict).toBe('REJECTED');
    expect(check(r, 'ONE_HOT_VIOLATION', 'D1')).toMatchObject({ status: 'FAIL', measured: '2' });
    expect(check(r, 'BUDGET_EXCEEDED', 'W1')?.status).toBe('PASS');
    expect(r.decoded_schedule).toBeNull();
  });

  it('no choice for a draw → CARDINALITY_VIOLATION', () => {
    const r = run(a, b, bits(a, ['x[D1,W1]']));
    expect(r.verdict).toBe('REJECTED');
    expect(check(r, 'CARDINALITY_VIOLATION', 'D2')?.status).toBe('FAIL');
  });

  describe('slack ancillas', () => {
    // Pairwise 200+200 ≤ 500 but 600 > 500 for all three, so the compiler used slack.
    const ss = scenario({
      draws: ['A', 'B', 'C'].map((id, i) => ({
        id, amount_minor: 200, spv_id: 'S', sponsor_id: 'SP', tranche: 1, window_eligibility: ['W1'], utility: 5 + i, deferral_cost: 1,
      })),
      windows: [{ id: 'W1', liquidity_cap_minor: 500 }],
    });
    const sa = compile(ss);

    it('are dropped: a legal schedule validates whatever the slack bits say', () => {
      // A and B scheduled (400 ≤ 500); slack bits deliberately wrong, so E(x) carries a penalty.
      const x = bits(sa, ['x[A,W1]', 'x[B,W1]', 'z[C]', 's[W1,b0]', 's[W1,b1]', 's[W1,b2]']);
      const r = run(sa, book(ss), x);
      expect(r.verdict).toBe('CANDIDATE_VALIDATED');
      expect(r.ancillas_dropped).toEqual(['s[W1,b0]', 's[W1,b1]', 's[W1,b2]']);
      expect(r.decoded_schedule!.map((e) => e.draw_id)).toEqual(['A', 'B', 'C']);
      expect(r.q_energy!).toBeGreaterThan(Number(r.candidate_economic_objective_minor));
    });

    it('too narrow for the residual → SLACK_RANGE_INSUFFICIENT → REQUIRES_REMODELING', () => {
      // A compiler that claimed 50-unit steps (10 needed) but kept 3 bits (reach 7).
      const narrow = reseal({ ...sa, slack_groups: sa.slack_groups.map((g) => ({ ...g, unit_minor: 50 })), scale: { ...sa.scale, amount_divisor: 50 } });
      const r = run(narrow, book(ss), bits(narrow, ['x[A,W1]', 'z[B]', 'z[C]']));
      expect(r.verdict).toBe('REQUIRES_REMODELING');
      expect(check(r, 'SLACK_RANGE_INSUFFICIENT', 'budget[W1]')).toMatchObject({ status: 'FAIL', measured: '7', limit: '10' });
    });
  });
});

describe('pass 5–6 — cash ladder, concentration, tranche, payee', () => {
  it('counts confirmed draws only; instructed-unconfirmed never covers the reserve', () => {
    const s = scenario();
    const a = compile(s);
    const period = { committed_inflows_minor: 0, confirmed_facility_draws_minor: 0, instructed_unconfirmed_minor: 1_000, scheduled_outflows_minor: 0, required_reserve_minor: 50 };
    const b = book(s, { cash_ladder: { opening_cash_minor: 200, periods: { W1: period } } });
    const r = run(a, b, bits(a, ['x[D1,W1]', 'z[D2]']));
    // 200 − 180 = 20 < 50, despite 1,000 instructed.
    expect(check(r, 'RESERVE_BREACH', 'W1')).toMatchObject({ status: 'FAIL', measured: '20', limit: '50' });
    expect(r.verdict).toBe('REJECTED');
  });

  it('checks concentration caps, tranche order and payee from the freeze, not from Q', () => {
    const s = scenario({
      windows: [{ id: 'W1', liquidity_cap_minor: 300 }, { id: 'W2', liquidity_cap_minor: 300 }],
      draws: scenario().draws.map((d) => ({ ...d, window_eligibility: ['W1', 'W2'] })),
      precedence: [{ before: 'D1', after: 'D2' }],
    });
    const a = compile(s);
    const b = book(s, { concentration_caps: [{ dimension: 'sponsor', key: 'SP1', existing_exposure_minor: 100, max_exposure_minor: 400 }] });
    b.draw_status.D2 = { ...OK, payee_verified: false };
    const r = run(a, b, bits(a, ['x[D1,W1]', 'x[D2,W2]']));
    expect(check(r, 'TRANCHE_ORDER_VIOLATION', 'D1<D2')?.status).toBe('PASS');
    expect(check(r, 'CONCENTRATION_BREACH', 'sponsor:SP1')).toMatchObject({ status: 'FAIL', measured: '430', limit: '400' });
    expect(check(r, 'UNVERIFIED_PAYEE', 'D2')?.status).toBe('FAIL');
    // A payee problem on a draw that was given a bit is also a toolchain problem.
    expect(r.verdict).toBe('REQUIRES_REMODELING');
  });
});

describe('pass 7 — declared stress set', () => {
  // D1 (180) fits W1 (cap 300) but not W2 (cap 100).
  const s = scenario({
    windows: [{ id: 'W1', liquidity_cap_minor: 300 }, { id: 'W2', liquidity_cap_minor: 100 }],
    draws: scenario().draws.map((d) => ({ ...d, window_eligibility: ['W1', 'W2'] })),
  });
  const a = compile(s);
  const x = bits(a, ['x[D1,W1]', 'z[D2]']);
  const zero = { committed_inflows_minor: 0, confirmed_facility_draws_minor: 0, instructed_unconfirmed_minor: 0, scheduled_outflows_minor: 0, required_reserve_minor: 0 };
  const ladder = {
    opening_cash_minor: 0,
    periods: { W1: { ...zero, confirmed_facility_draws_minor: 150, committed_inflows_minor: 50, required_reserve_minor: 10 }, W2: { ...zero } },
  };
  const spvs = { S: { outstanding_debt_minor: 100, eligible_collateral_minor: 500, policy_ltv_bps: 7_000 } };
  const withStress = (st: StressSpec) => book(s, { cash_ladder: ladder, spvs, stresses: [st] });

  it('baseline passes with no stresses', () => {
    expect(run(a, book(s, { cash_ladder: ladder, spvs }), x).verdict).toBe('CANDIDATE_VALIDATED');
  });

  const cases: Array<[StressSpec, 'PASS' | 'FAIL', string]> = [
    [{ name: 'inspection +1', kind: 'INSPECTION_SLIP', slip_windows: 1 }, 'FAIL', 'BUDGET_EXCEEDED'],
    [{ name: 'inspection +2 (past horizon, defers)', kind: 'INSPECTION_SLIP', slip_windows: 2 }, 'PASS', ''],
    [{ name: 'confirmation lag', kind: 'CONFIRMATION_LAG', lag_windows: 1 }, 'FAIL', 'LIQUIDITY_SHORT'],
    [{ name: 'inflow delay', kind: 'INFLOW_DELAY', delay_windows: 1 }, 'FAIL', 'RESERVE_BREACH'],
    [{ name: 'collateral −30%', kind: 'COLLATERAL_HAIRCUT', haircut_bps: 3_000 }, 'FAIL', 'LTV_BREACH'],
    [{ name: 'collateral −5%', kind: 'COLLATERAL_HAIRCUT', haircut_bps: 500 }, 'PASS', ''],
    [{ name: 'hold on largest SPV', kind: 'ADDITIONAL_HOLD', target: 'LARGEST_SPV' }, 'PASS', ''],
  ];

  it.each(cases)('%o → %s', (st: StressSpec, expected: 'PASS' | 'FAIL', failingCode: string) => {
    const r = run(a, withStress(st), x);
    expect(r.stress[0].status).toBe(expected);
    if (expected === 'FAIL') {
      expect(r.verdict).toBe('REJECTED');
      expect(r.verdict_reasons).toEqual(['STRESS_FAIL']);
      expect(r.stress[0].failed_checks.map((c) => c.code)).toContain(failingCode);
    } else {
      expect(r.verdict).toBe('CANDIDATE_VALIDATED');
    }
  });
});

describe('pass 8 — gap to the classical baseline', () => {
  const s = scenario();
  const a = compile(s, POLICY, PINNED);
  it('is metadata unless a bar is declared; a declared bar rejects', () => {
    const deferAll = bits(a, ['z[D1]', 'z[D2]']);
    const free = run(a, book(s), deferAll, { classical_baseline: BASELINE });
    expect(free.verdict).toBe('CANDIDATE_VALIDATED');
    expect(free.gap_bps).toBe('10000');
    const barred = run(a, book(s), deferAll, { classical_baseline: BASELINE, max_gap_bps: 500 });
    expect(barred.verdict).toBe('REJECTED');
    expect(check(barred, 'GAP_EXCEEDED')).toMatchObject({ status: 'FAIL', measured: '10000', limit: '500' });
  });
});

describe('pass 9 — signed report', () => {
  const s = scenario();
  const a = compile(s);
  const r = run(a, book(s), bits(a, ['x[D1,W1]', 'z[D2]']));

  it('verifies with the validator public key', () => {
    expect(r.signature_algorithm).toBe('Ed25519');
    expect(verifyReport(r, publicKey)).toBe(true);
  });

  it('fails verification if any field is edited', () => {
    expect(verifyReport({ ...r, verdict: 'REJECTED' }, publicKey)).toBe(false);
    expect(verifyReport({ ...r, q_energy: -1_000 }, publicKey)).toBe(false);
  });

  it('fails verification under a different key', () => {
    const other = generateKeyPairSync('ed25519').publicKey as KeyObject;
    expect(verifyReport(r, other)).toBe(false);
  });

  it('refuses a non-Ed25519 signing key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(() => validateCandidate(
      { experiment_id: 'e', artifact: a, bitstring: { encoding: 'bits', values: [0, 0, 0, 0] }, book: book(s), penalty_policy: POLICY, occurred_at: '2026-09-25T07:00:00Z' },
      { key_id: 'rsa', private_key: rsa },
    )).toThrow('Ed25519');
  });

  it('keeps every money figure as an integer string and is not shaped like a draw', () => {
    for (const c of r.checks) {
      for (const v of [c.measured, c.limit]) if (v !== undefined) expect(v).toMatch(/^-?\d+$/);
    }
    expect(r.kind).toBe('DIBS_QLAB_VALIDATION_REPORT');
    for (const k of ['amount_approved_minor', 'payee_bank_account_id', 'draw_request_id', 'settlement_reference', 'approval_binding_hash']) {
      expect(r).not.toHaveProperty(k);
    }
  });
});

describe('independence — validator and brute-force agree on every bitstring of the memo toy', () => {
  jest.setTimeout(60_000);
  it('validates exactly the feasible schedules among all 4096 bitstrings', () => {
    const delay = { T1: 0, T2: 1, T3: 2 };
    const all = ['T1', 'T2', 'T3'];
    const toy = scenario({
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
    });
    const a = compile(toy);
    const b = book(toy);
    let validated = 0;
    for (let m = 0; m < 2 ** a.n; m++) {
      const x = Array.from({ length: a.n }, (_, i) => (m >> i) & 1);
      const r = run(a, b, x);
      expect(r.verdict).not.toBe('REQUIRES_REMODELING');
      // Independent feasibility: one choice per draw, caps, tranche order.
      const place = new Map<string, string | null>();
      let ok = true;
      for (const d of toy.draws) {
        const on = a.symbols.filter((sy) => sy.draw_id === d.id && x[sy.index] === 1);
        if (on.length !== 1) ok = false;
        else place.set(d.id, on[0].kind === 'deferral' ? null : on[0].window_id!);
      }
      if (ok) {
        for (const w of toy.windows) {
          const used = toy.draws.filter((d) => place.get(d.id) === w.id).reduce((t, d) => t + d.amount_minor, 0);
          if (used > w.liquidity_cap_minor) ok = false;
        }
        const w1 = place.get('D1');
        const w2 = place.get('D2');
        if (w1 && w2 && all.indexOf(w2) <= all.indexOf(w1)) ok = false;
      }
      expect(r.verdict).toBe(ok ? 'CANDIDATE_VALIDATED' : 'REJECTED');
      if (ok) validated++;
    }
    expect(validated).toBeGreaterThan(0);
  });
});
