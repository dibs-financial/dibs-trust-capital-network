/**
 * DIBS Quantum Lab — independent validator (validator/v1).
 *
 *   qubo_artifact + bitstring + frozen book
 *     → bind → decode → drop ancillas → reconstruct → re-apply pre-filter
 *     → replay minor units → hard checks → declared stresses → gap → sign
 *
 * Fail-closed inverse of the compiler. It never trusts Q, E0 or solver energy:
 * every predicate is recomputed from the frozen book in integer minor units.
 * It shares only types, canonical hashing and the IR schema gate with the
 * compiler; decoding and every check are written independently here.
 *
 * Spec: docs/quantum-lab/DIBS-Independent-Validator-Logic.md
 */

import { KeyObject, sign, verify } from 'crypto';
import { quboEnergy } from '../qubo/energy';
import { artifactIdFromHash, artifactPayloadHash, qPayloadHash } from '../qubo/compiler';
import { canonicalHash } from '../qubo/hash';
import { scenarioHash } from '../qubo/scenario';
import { verifyArtifactSignature } from '../qubo/sign';
import { ARTIFACT_VERSION, PenaltyPolicy, QuboArtifact } from '../qubo/types';
import { validateScenario } from '../qubo/validate';
import { Placement, replayChecks, replayObjective } from './replay';
import { runStresses } from './stress';
import {
  Check,
  FrozenBook,
  ScheduledEntry,
  StressResult,
  SUPPORTED_ENCODINGS,
  SUPPORTED_SCHEMAS,
  ValidationReport,
  ValidationRequest,
  VALIDATOR_VERSION,
  Verdict,
} from './types';

export interface ValidatorSigner {
  key_id: string;
  /** Ed25519 private key held by the validator, never a tenant key. */
  private_key: KeyObject;
}

/** Any FAIL on these means the toolchain cannot be trusted on this freeze. */
const REMODEL_CODES = new Set([
  'BIND_IR_GATE',
  'BIND_SCENARIO_FREEZE_HASH',
  'BIND_ARTIFACT_HASH',
  'BIND_SYMBOL_TABLE_HASH',
  'BIND_LOCKED_POLICY_VERSION',
  'BIND_EVIDENCE_MANIFEST_HASH',
  'BIND_PENALTY_POLICY',
  'BIND_ENCODING_VERSION',
  'BIND_REQUEST',
  'BIND_ARTIFACT_LITERALS',
  'BIND_Q_PAYLOAD_HASH',
  'BIND_COMPILE_REPORT_HASH',
  'BIND_ARTIFACT_SIGNATURE',
  'BIND_CLASSICAL_BASELINE',
  'FORBIDDEN_FIELD',
  'Q_MALFORMED',
  'ISING_MISMATCH',
  'HARD_CONSTRAINT_UNACCOUNTED',
  'MONEY_SCALE_MISMATCH',
  'BOOK_INCOMPLETE',
  'STRESS_NOT_EVALUABLE',
  'SYMBOL_TABLE_INCOHERENT',
  'SLACK_RANGE_INSUFFICIENT',
  'ONE_HOT_GROUPS_INCOHERENT',
  'INELIGIBLE_BIT_ALLOCATED',
  'LEGAL_OR_COMPLIANCE_PRESENT',
]);

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const isSafeInt = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v);
const isNonNegInt = (v: unknown): boolean => isSafeInt(v) && (v as number) >= 0;
const isPosInt = (v: unknown): boolean => isSafeInt(v) && (v as number) > 0;

function pass(code: string, extra: Partial<Check> = {}): Check {
  return { code, status: 'PASS', ...extra };
}
function fail(code: string, extra: Partial<Check> = {}): Check {
  return { code, status: 'FAIL', ...extra };
}
function bind(code: string, ok: boolean, note: string): Check {
  return ok ? pass(code) : fail(code, { note });
}

function eligible(st: FrozenBook['draw_status'][string]): boolean {
  return !st.hold_open && st.payee_verified && st.sanctions_clear && st.kyc_current && st.docs_current && st.settlement_route_live;
}

// ---------------------------------------------------------------------------
// Pass 0 — bind
// ---------------------------------------------------------------------------

/** Field names that make an object not a qubo_artifact (schema §8). */
const FORBIDDEN_KEY = /^(approved?|approval|instruct(ed|ion)?|release[ds]?|draw_request_id|settlement_instruction_id|waiver_id|payee_bank_account_id|storage_uri|access_token|api_key|private_key|password|secret)$/i;

function forbiddenKeys(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) value.forEach((v, i) => forbiddenKeys(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(k)) out.push(`${path}.${k}`);
      forbiddenKeys(v, `${path}.${k}`, out);
    }
  }
}

/** Structural soundness of Q, symbols and groups; re-derives the Ising image. */
function artifactShapeChecks(a: QuboArtifact): Check[] {
  const out: Check[] = [];
  const n = a.n;
  const qProblems: string[] = [];
  if (!Number.isSafeInteger(n) || n < 0) qProblems.push('n');
  if (!Array.isArray(a.Q_diag) || a.Q_diag.length !== n) qProblems.push('Q_diag length');
  if (!Array.isArray(a.symbols) || a.symbols.length !== n) qProblems.push('symbols length');
  const seen = new Set<string>();
  for (const e of a.Q_offdiag ?? []) {
    const key = `${e.i},${e.j}`;
    if (!(Number.isSafeInteger(e.i) && Number.isSafeInteger(e.j) && e.i >= 0 && e.i < e.j && e.j < n)) qProblems.push(`entry ${key}`);
    if (seen.has(key)) qProblems.push(`duplicate ${key}`);
    seen.add(key);
  }
  out.push(bind('Q_MALFORMED', qProblems.length === 0, qProblems.join(', ')));
  if (qProblems.length > 0) return out;

  // Ising cache must be the frozen map of Q.
  const h = a.Q_diag.map((q) => -q / 2);
  let shift = a.E0 + a.Q_diag.reduce((t, q) => t + q / 2, 0);
  const J = new Map<string, number>();
  for (const { i, j, q } of a.Q_offdiag) {
    h[i] -= q / 2;
    h[j] -= q / 2;
    J.set(`${i},${j}`, q / 2);
    shift += q / 2;
  }
  const jOk =
    Array.isArray(a.J_sparse) &&
    a.J_sparse.length === J.size &&
    a.J_sparse.every((e) => J.get(`${e.i},${e.j}`) === e.value);
  const hOk = Array.isArray(a.h) && a.h.length === n && a.h.every((v, i) => v === h[i]);
  out.push(bind('ISING_MISMATCH', jOk && hOk && a.energy_shift === shift, 'h / J_sparse / energy_shift do not follow from Q under z = 1 - 2x'));
  return out;
}

function bindChecks(req: ValidationRequest): Check[] {
  const { artifact: a, book } = req;
  const out: Check[] = [];

  out.push(
    bind(
      'BIND_REQUEST',
      typeof req.experiment_id === 'string' && req.experiment_id.length > 0 && typeof req.occurred_at === 'string' && UTC_ISO.test(req.occurred_at),
      'experiment_id required; occurred_at must be UTC ISO-8601 ending in Z',
    ),
  );

  // Schema gate only; penalty-policy pinning is its own bind check below.
  const gate = validateScenario(book.scenario, { penalty_policy_id: book.scenario.penalty_policy_id } as PenaltyPolicy);
  out.push(bind('BIND_IR_GATE', gate.length === 0, gate.map((r) => r.code + (r.path ? '@' + r.path : '')).join(', ')));
  if (gate.length > 0) return out; // the rest assumes a well-shaped scenario

  // Literals a consumer must refuse to reinterpret.
  const literalProblems: string[] = [];
  if (!SUPPORTED_SCHEMAS.includes(a.schema_version)) literalProblems.push(`schema_version ${a.schema_version}`);
  if (a.artifact_version !== ARTIFACT_VERSION) literalProblems.push('artifact_version');
  if (a.q_layout !== 'symmetric_xTQx') literalProblems.push('q_layout');
  if (a.ising_map !== 'z = 1 - 2x') literalProblems.push('ising_map');
  if (a.Q_format !== 'diag_plus_coo') literalProblems.push('Q_format');
  if (a.coefficient_unit !== 'dimensionless') literalProblems.push('coefficient_unit');
  if (a.scale?.reconstructed_unit !== 'minor_units') literalProblems.push('scale.reconstructed_unit');
  out.push(bind('BIND_ARTIFACT_LITERALS', literalProblems.length === 0, literalProblems.join(', ')));
  out.push(bind('BIND_ENCODING_VERSION', SUPPORTED_ENCODINGS.includes(a.encoding_version), `unsupported encoding ${a.encoding_version}`));
  if (literalProblems.length > 0) return out;

  const forbidden: string[] = [];
  forbiddenKeys(a, 'artifact', forbidden);
  out.push(bind('FORBIDDEN_FIELD', forbidden.length === 0, forbidden.join(', ')));

  // Integrity: every hash on the artifact recomputes, and the id follows from the payload.
  const payloadHash = artifactPayloadHash(a);
  out.push(bind('BIND_ARTIFACT_HASH', payloadHash === a.payload_hash && a.qubo_artifact_id === artifactIdFromHash(a.payload_hash), 'artifact content does not match payload_hash / qubo_artifact_id'));
  out.push(bind('BIND_Q_PAYLOAD_HASH', qPayloadHash(a) === a.q_payload_hash, 'Q payload does not match q_payload_hash'));
  out.push(bind('BIND_COMPILE_REPORT_HASH', canonicalHash(a.compile_report) === a.compile_report_hash, 'compile report does not match compile_report_hash'));
  out.push(bind('BIND_SYMBOL_TABLE_HASH', canonicalHash(a.symbols) === a.symbol_table_hash, 'symbol table does not match symbol_table_hash'));
  if (req.compiler_public_key) {
    out.push(bind('BIND_ARTIFACT_SIGNATURE', verifyArtifactSignature(a, req.compiler_public_key), 'artifact is unsigned or its signature does not verify'));
  }

  // Identity against the freeze the validator loaded.
  out.push(
    bind(
      'BIND_SCENARIO_FREEZE_HASH',
      a.scenario_freeze_hash === scenarioHash(book.scenario) && a.scenario_id === book.scenario.scenario_id,
      'artifact was compiled from a different freeze',
    ),
  );
  out.push(
    bind(
      'BIND_LOCKED_POLICY_VERSION',
      a.locked_policy_version === book.locked_policy_version && book.scenario.policy_version_frozen === book.locked_policy_version,
      'policy version is not the one locked on the freeze',
    ),
  );
  out.push(
    bind(
      'BIND_EVIDENCE_MANIFEST_HASH',
      a.locked_evidence_manifest_hash === book.locked_evidence_manifest_hash && book.scenario.manifest_hash_frozen === book.locked_evidence_manifest_hash,
      'evidence manifest hash is not the one locked on the freeze',
    ),
  );
  const pp = req.penalty_policy;
  out.push(
    bind(
      'BIND_PENALTY_POLICY',
      !!pp && a.penalty_policy_id === pp.penalty_policy_id && a.penalty_policy_hash === canonicalHash(pp) && book.scenario.penalty_policy_id === pp.penalty_policy_id,
      'artifact or freeze penalty policy (id or hash) is not the declared one',
    ),
  );
  const base = req.classical_baseline;
  const baseOk = base
    ? a.classical_baseline_id === base.baseline_id && a.classical_baseline_hash === canonicalHash(base)
    : a.classical_baseline_id === null && a.classical_baseline_hash === null;
  out.push(bind('BIND_CLASSICAL_BASELINE', baseOk, 'classical baseline does not match the one pinned on the artifact'));

  out.push(...artifactShapeChecks(a));

  // Every catalogued hard code the validator replays must be accounted for by the compiler.
  const accounted = new Set((a.uncompiled_hard ?? []).map((u) => u.code));
  const missing = (['LTV', 'RESERVE', 'CONCENTRATION', 'LEGAL'] as const).filter((c) => !accounted.has(c));
  out.push(bind('HARD_CONSTRAINT_UNACCOUNTED', missing.length === 0, `not in penalty_terms or uncompiled_hard: ${missing.join(', ')}`));

  // Money path: every book figure an integer, and slack units reconstruct to minor units.
  const moneyProblems: string[] = [];
  const draws = book.scenario.draws;
  if (!isPosInt(a.scale.amount_divisor) || a.scale.objective_divisor !== 1) moneyProblems.push('scale divisors');
  for (const g of a.slack_groups ?? []) {
    const w = g.constraint_id.replace(/^budget\[(.*)\]$/, '$1');
    const win = book.scenario.windows.find((x) => x.id === w);
    const memberAmounts = a.symbols.filter((s) => s.kind === 'decision' && s.window_id === w).map((s) => draws.find((d) => d.id === s.draw_id)?.amount_minor);
    if (
      !isPosInt(g.unit_minor) ||
      !win ||
      win.liquidity_cap_minor % g.unit_minor !== 0 ||
      g.unit_minor % a.scale.amount_divisor !== 0 ||
      memberAmounts.some((m) => m === undefined || m % g.unit_minor !== 0)
    ) {
      moneyProblems.push(`slack unit for ${g.constraint_id}`);
    }
  }
  for (const [id, c] of Object.entries(book.spvs ?? {})) {
    if (!isNonNegInt(c.outstanding_debt_minor) || !isPosInt(c.eligible_collateral_minor) || !isPosInt(c.policy_ltv_bps)) moneyProblems.push(`spv ${id}`);
  }
  if (book.cash_ladder) {
    if (!isSafeInt(book.cash_ladder.opening_cash_minor)) moneyProblems.push('opening cash');
    for (const [w, p] of Object.entries(book.cash_ladder.periods)) {
      const vals = [p.committed_inflows_minor, p.confirmed_facility_draws_minor, p.instructed_unconfirmed_minor, p.scheduled_outflows_minor, p.required_reserve_minor];
      if (!vals.every(isNonNegInt)) moneyProblems.push(`cash period ${w}`);
    }
  }
  for (const c of book.concentration_caps ?? []) {
    if (!isNonNegInt(c.existing_exposure_minor) || !isNonNegInt(c.max_exposure_minor)) moneyProblems.push(`cap ${c.dimension}:${c.key}`);
  }
  if (base && !isSafeInt(base.objective_minor)) moneyProblems.push('baseline objective');
  out.push(bind('MONEY_SCALE_MISMATCH', moneyProblems.length === 0, moneyProblems.join(', ')));

  // Book completeness for every catalogued check.
  const gaps: string[] = [];
  for (const d of draws) {
    const st = book.draw_status?.[d.id];
    const keys: Array<keyof FrozenBook['draw_status'][string]> = ['hold_open', 'payee_verified', 'sanctions_clear', 'kyc_current', 'docs_current', 'settlement_route_live'];
    if (!st || !keys.every((k) => typeof st[k] === 'boolean')) gaps.push(`draw_status ${d.id}`);
    if (book.spvs && !book.spvs[d.spv_id]) gaps.push(`spv ${d.spv_id}`);
  }
  if (book.cash_ladder) {
    for (const w of book.scenario.windows) if (!book.cash_ladder.periods[w.id]) gaps.push(`cash period ${w.id}`);
  }
  out.push(bind('BOOK_INCOMPLETE', gaps.length === 0, gaps.join(', ')));

  // Declared stresses must be well-formed and evaluable on this freeze.
  const stressProblems: string[] = [];
  const names = new Set<string>();
  for (const s of book.stresses ?? []) {
    if (!s.name || names.has(s.name)) stressProblems.push(`name ${s.name}`);
    names.add(s.name);
    const needs =
      s.kind === 'CONFIRMATION_LAG' || s.kind === 'INFLOW_DELAY' ? (book.cash_ladder ? null : 'cash ladder') : s.kind === 'COLLATERAL_HAIRCUT' ? (book.spvs ? null : 'collateral data') : null;
    if (needs) stressProblems.push(`${s.name} needs ${needs}`);
    const k =
      s.kind === 'INSPECTION_SLIP' ? s.slip_windows : s.kind === 'CONFIRMATION_LAG' ? s.lag_windows : s.kind === 'INFLOW_DELAY' ? s.delay_windows : s.kind === 'COLLATERAL_HAIRCUT' ? s.haircut_bps : 1;
    if (!isPosInt(k) || (s.kind === 'COLLATERAL_HAIRCUT' && k > 10_000)) stressProblems.push(`${s.name} parameter`);
  }
  if (!Array.isArray(book.stresses)) stressProblems.push('stresses must be declared (may be empty)');
  out.push(bind('STRESS_NOT_EVALUABLE', stressProblems.length === 0, stressProblems.join(', ')));

  return out;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validateCandidate(req: ValidationRequest, signer: ValidatorSigner): ValidationReport {
  const { artifact: a, book } = req;
  const checks: Check[] = [];
  let decodedX: Array<0 | 1> | null = null;
  let ancillas: string[] = [];
  let schedule: ScheduledEntry[] | null = null;
  let jReplay: bigint | null = null;
  let gapBps: bigint | null = null;
  let qEnergy: number | null = null;
  let stress: StressResult[] = [];

  const bindResult = bindChecks(req);
  checks.push(...bindResult);
  const bound = bindResult.every((c) => c.status === 'PASS');

  if (bound) {
    decodedX = decode(req, checks);
  }
  if (decodedX) {
    const x = decodedX;
    const drawIds = new Set(book.scenario.draws.map((d) => d.id));
    const windowIds = new Set(book.scenario.windows.map((w) => w.id));

    // Symbol table must describe this freeze (dense, in order, known refs, one z per draw).
    const tableProblems: string[] = [];
    a.symbols.forEach((s, i) => {
      if (s.index !== i) tableProblems.push(`index ${i}`);
      if ((s.kind === 'decision' || s.kind === 'deferral') && !drawIds.has(s.draw_id ?? '')) tableProblems.push(`${s.name} draw`);
      if ((s.kind === 'decision' || s.kind === 'slack') && !windowIds.has(s.window_id ?? '')) tableProblems.push(`${s.name} window`);
    });
    for (const id of drawIds) {
      if (a.symbols.filter((s) => s.kind === 'deferral' && s.draw_id === id).length !== 1) tableProblems.push(`z for ${id}`);
    }
    checks.push(bind('SYMBOL_TABLE_INCOHERENT', tableProblems.length === 0, tableProblems.join(', ')));

    // One-hot groups must be exactly each draw's decision + deferral bits.
    const groupProblems: string[] = [];
    for (const id of drawIds) {
      const own = a.symbols.filter((sy) => (sy.kind === 'decision' || sy.kind === 'deferral') && sy.draw_id === id).map((sy) => sy.index).sort((l, r) => l - r);
      const g = a.one_hot_groups.find((og) => og.group_id === `card[${id}]`);
      if (!g || g.cardinality !== 'exactly_one' || [...g.indices].sort((l, r) => l - r).join(',') !== own.join(',')) groupProblems.push(`card[${id}]`);
    }
    checks.push(bind('ONE_HOT_GROUPS_INCOHERENT', groupProblems.length === 0, groupProblems.join(', ')));

    // Pass 2 — slack width, then drop ancillas.
    for (const g of a.slack_groups) {
      const w = g.constraint_id.replace(/^budget\[(.*)\]$/, '$1');
      const cap = book.scenario.windows.find((x2) => x2.id === w)?.liquidity_cap_minor ?? 0;
      const members = g.indices.map((ix) => a.symbols[ix]);
      const weightSum = members.reduce((t, sy) => t + (sy && sy.kind === 'slack' && sy.slack_group === g.group_id && sy.slack_weight ? sy.slack_weight : Number.NaN), 0);
      const reach = BigInt(Number.isSafeInteger(weightSum) && weightSum === g.max_value ? g.max_value : 0);
      const need = BigInt(cap) / BigInt(g.unit_minor);
      const m = { subject: g.constraint_id, measured: reach.toString(), limit: need.toString(), unit: 'count' as const };
      checks.push(reach >= need ? pass('SLACK_RANGE_INSUFFICIENT', m) : fail('SLACK_RANGE_INSUFFICIENT', m));
    }
    ancillas = a.symbols.filter((sy) => sy.kind === 'slack' || sy.kind === 'ancilla').map((sy) => sy.name);

    // Pass 3 — reconstruct, checking cardinality on bits and again on objects.
    const placement: Placement = new Map();
    let wellFormed = true;
    for (const d of [...book.scenario.draws].sort((l, r) => (l.id < r.id ? -1 : 1))) {
      const onX = a.symbols.filter((s) => s.kind === 'decision' && s.draw_id === d.id && x[s.index] === 1);
      const onZ = a.symbols.filter((s) => s.kind === 'deferral' && s.draw_id === d.id && x[s.index] === 1);
      const count = onX.length + onZ.length;
      const m = { subject: d.id, measured: String(count), limit: '1', unit: 'count' as const };
      checks.push(count > 1 ? fail('ONE_HOT_VIOLATION', m) : pass('ONE_HOT_VIOLATION', m));
      checks.push(count === 0 ? fail('CARDINALITY_VIOLATION', m) : pass('CARDINALITY_VIOLATION', m));
      if (count !== 1) wellFormed = false;
      placement.set(d.id, onX.map((s) => s.window_id!));
    }
    const objectOk = book.scenario.draws.every((d) => placement.has(d.id) && placement.get(d.id)!.length <= 1) && placement.size === drawIds.size;
    if (!objectOk) wellFormed = false;
    checks.push(bind('RECONSTRUCTED_CARDINALITY', objectOk, 'reconstructed schedule places a draw more than once'));

    // Pass 4 — re-apply pre-filter; never trust that ineligible draws have no bits.
    const allocated = new Set(a.symbols.filter((s) => s.draw_id).map((s) => s.draw_id!));
    const prefiltered = new Set(a.compile_report.prefiltered_draws.map((p) => p.draw_id));
    const ineligible = [...allocated].filter((id) => prefiltered.has(id) || (book.draw_status[id] && !eligible(book.draw_status[id]))).sort();
    const presentOnes = ineligible.filter((id) => (placement.get(id) ?? []).length > 0);
    checks.push(ineligible.length ? fail('INELIGIBLE_BIT_ALLOCATED', { subject: ineligible.join(','), note: 'compiler allocated bits for a pre-filtered draw' }) : pass('INELIGIBLE_BIT_ALLOCATED'));
    checks.push(presentOnes.length ? fail('LEGAL_OR_COMPLIANCE_PRESENT', { subject: presentOnes.join(',') }) : pass('LEGAL_OR_COMPLIANCE_PRESENT'));

    // Passes 5–6 — replay in minor units and run every hard check.
    checks.push(...replayChecks(placement, book));
    qEnergy = quboEnergy(a, x);

    if (wellFormed) {
      schedule = book.scenario.draws
        .map((d) => ({ draw_id: d.id, windows: placement.get(d.id)!, deferred: placement.get(d.id)!.length === 0, amount_minor: String(d.amount_minor) }))
        .sort((l, r) => (l.draw_id < r.draw_id ? -1 : 1));
      jReplay = replayObjective(placement, book);
    }

    // Pass 7 — declared stresses on derived snapshots.
    stress = runStresses(book, wellFormed ? placement : null);
    for (const s of stress) {
      if (s.status === 'FAIL') checks.push(fail('STRESS_FAIL', { subject: s.name }));
      else if (s.status === 'PASS') checks.push(pass('STRESS_FAIL', { subject: s.name }));
    }

    // Pass 8 — gap to the classical baseline (metadata unless a bar is declared).
    const base = req.classical_baseline;
    if (base && jReplay !== null && isSafeInt(base.objective_minor)) {
      const jMip = BigInt(base.objective_minor);
      const absMip = jMip < 0n ? -jMip : jMip;
      if (absMip > 0n) {
        const num = (jReplay - jMip) * 10_000n;
        gapBps = num >= 0n ? (num + absMip - 1n) / absMip : num / absMip;
        if (req.max_gap_bps !== undefined) {
          const over = num > BigInt(req.max_gap_bps) * absMip;
          const m = { measured: gapBps.toString(), limit: String(req.max_gap_bps), unit: 'bps' as const };
          checks.push(over ? fail('GAP_EXCEEDED', m) : pass('GAP_EXCEEDED', m));
        }
      }
    }
  }

  // Verdict — remodel beats reject beats validate.
  const failed = checks.filter((c) => c.status === 'FAIL');
  const remodel = failed.filter((c) => REMODEL_CODES.has(c.code));
  let verdict: Verdict;
  let reasons: Check[];
  if (!bound || remodel.length > 0) {
    verdict = 'REQUIRES_REMODELING';
    reasons = remodel;
  } else if (failed.length > 0 || !decodedX) {
    verdict = 'REJECTED';
    reasons = failed;
  } else {
    verdict = 'CANDIDATE_VALIDATED';
    reasons = [];
  }

  const payload: Omit<ValidationReport, 'payload_hash' | 'signature'> = {
    kind: 'DIBS_QLAB_VALIDATION_REPORT',
    experiment_id: req.experiment_id,
    validator_version: VALIDATOR_VERSION,
    occurred_at: req.occurred_at,
    verdict,
    verdict_reasons: [...new Set(reasons.map((c) => c.code))].sort(),
    scenario_freeze_hash: scenarioHashSafe(book),
    qubo_artifact_id: a.qubo_artifact_id,
    compile_artifact_hash: a.payload_hash,
    symbol_table_hash: a.symbol_table_hash,
    penalty_policy_id: req.penalty_policy?.penalty_policy_id ?? '',
    locked_policy_version: book.locked_policy_version,
    locked_evidence_manifest_hash: book.locked_evidence_manifest_hash,
    bitstring: req.bitstring,
    decoded_x: decodedX,
    ancillas_dropped: ancillas,
    decoded_schedule: schedule,
    classical_baseline_objective_minor: req.classical_baseline && isSafeInt(req.classical_baseline.objective_minor) ? String(req.classical_baseline.objective_minor) : null,
    candidate_economic_objective_minor: jReplay === null ? null : jReplay.toString(),
    gap_bps: gapBps === null ? null : gapBps.toString(),
    q_energy: qEnergy,
    checks,
    stress,
    signature_algorithm: 'Ed25519',
    signature_key_id: signer.key_id,
  };
  return signPayload(payload, signer);
}

/** Pass 1 — decode. Returns x, or null after recording why it did not decode. */
function decode(req: ValidationRequest, checks: Check[]): Array<0 | 1> | null {
  const { values, encoding } = req.bitstring;
  const n = req.artifact.symbols.length;
  const len = { measured: String(values.length), limit: String(n), unit: 'bits' as const };
  if (values.length !== n || req.artifact.n !== n) {
    checks.push(fail('BITSTRING_LENGTH_MISMATCH', len));
    return null;
  }
  checks.push(pass('BITSTRING_LENGTH_MISMATCH', len));
  const okValue = encoding === 'spins' ? (v: number) => v === 1 || v === -1 : (v: number) => v === 0 || v === 1;
  if (!values.every(okValue)) {
    checks.push(fail('BITSTRING_INVALID_VALUE', { note: `values must be ${encoding === 'spins' ? '±1' : '0/1'}` }));
    return null;
  }
  // Frozen map x = (1 − z)/2.
  const x = values.map((v) => (encoding === 'spins' ? ((1 - v) / 2) as 0 | 1 : (v as 0 | 1)));
  const named = new Set(req.artifact.symbols.map((s) => s.index));
  const unknown = x.map((b, i) => (b === 1 && !named.has(i) ? i : -1)).filter((i) => i >= 0);
  checks.push(unknown.length ? fail('UNKNOWN_SYMBOL', { note: `indices ${unknown.join(',')}` }) : pass('UNKNOWN_SYMBOL'));
  return unknown.length ? null : x;
}

function scenarioHashSafe(book: FrozenBook): string {
  try {
    return scenarioHash(book.scenario);
  } catch {
    return '';
  }
}

function signPayload(payload: Omit<ValidationReport, 'payload_hash' | 'signature'>, signer: ValidatorSigner): ValidationReport {
  if (signer.private_key.asymmetricKeyType !== 'ed25519') throw new Error('Validator key must be Ed25519.');
  const payloadHash = canonicalHash(payload);
  const signature = sign(null, Buffer.from(payloadHash, 'utf8'), signer.private_key).toString('base64');
  return { ...payload, payload_hash: payloadHash, signature };
}

/** Recomputes the payload hash and verifies the Ed25519 signature. */
export function verifyReport(report: ValidationReport, publicKey: KeyObject): boolean {
  const { payload_hash, signature, ...payload } = report;
  if (canonicalHash(payload) !== payload_hash) return false;
  return verify(null, Buffer.from(payload_hash, 'utf8'), publicKey, Buffer.from(signature, 'base64'));
}

