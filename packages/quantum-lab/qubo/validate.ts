/**
 * Input gate for the QUBO compiler. Anything that fails here is REQUIRES_REMODELING,
 * never "put a bigger penalty on it".
 */

import {
  ENCODING_VERSION,
  FrozenScenario,
  PenaltyPolicy,
  Refusal,
} from './types';

const SCENARIO_KEYS = new Set([
  'scenario_id',
  'policy_version_frozen',
  'manifest_hash_frozen',
  'encoding_version',
  'penalty_policy_id',
  'draws',
  'windows',
  'precedence',
  'concentration_pairs',
  'classical_baseline_ref',
]);

const DRAW_KEYS = new Set([
  'id',
  'amount_minor',
  'spv_id',
  'sponsor_id',
  'tranche',
  'window_eligibility',
  'utility',
  'deferral_cost',
  'delay_cost',
]);

const WINDOW_KEYS = new Set(['id', 'liquidity_cap_minor']);
const PRECEDENCE_KEYS = new Set(['before', 'after']);
const CONCENTRATION_KEYS = new Set(['left', 'right', 'weight']);

/**
 * Legal / compliance facts. Their presence in the IR means pre-filter did not run
 * or was bypassed. They are never compiled into bits or penalties.
 */
const LEGAL_FLAG_KEYS = new Set([
  'sanctions_hit',
  'sanctions_status',
  'kyc_status',
  'kyc_aml_status',
  'aml_status',
  'docs_status',
  'documents_status',
  'hold_open',
  'holds',
  'hold_reason_code',
  'payee_verified',
  'payee_status',
  'settlement_route',
  'settlement_route_status',
  'compliance',
  'compliance_status',
]);

const LIVE_POLICY_MARKERS = new Set(['live', 'latest', 'current', 'head']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function checkKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  out: Refusal[],
): void {
  for (const key of Object.keys(obj).sort()) {
    if (allowed.has(key)) continue;
    if (LEGAL_FLAG_KEYS.has(key)) {
      out.push({
        code: 'LEGAL_FLAG_IN_IR',
        message: `Legal/compliance field "${key}" is not compilable; the item must be removed by pre-filter.`,
        path: `${path}.${key}`,
      });
    } else if (path === 'scenario' && key === 'reserve_bands') {
      out.push({
        code: 'RESERVE_BANDS_NOT_IN_ENCODING',
        message: `Reserve-band coupling to closing cash is not part of ${ENCODING_VERSION}.`,
        path: `${path}.${key}`,
      });
    } else {
      out.push({
        code: 'UNKNOWN_FIELD',
        message: `Field "${key}" is not part of the frozen IR.`,
        path: `${path}.${key}`,
      });
    }
  }
}

function checkMoney(v: unknown, path: string, out: Refusal[]): void {
  if (!(typeof v === 'number' && Number.isSafeInteger(v) && v > 0)) {
    out.push({
      code: 'NON_INTEGER_MONEY',
      message: 'Money must be a positive safe integer in minor units.',
      path,
    });
  }
}

function checkWeight(v: unknown, path: string, out: Refusal[], nonNegative = false): void {
  if (!(typeof v === 'number' && Number.isSafeInteger(v) && (!nonNegative || v >= 0))) {
    out.push({
      code: 'NON_INTEGER_WEIGHT',
      message: `Weight must be a safe integer${nonNegative ? ' ≥ 0' : ''}.`,
      path,
    });
  }
}

export function validatePenaltyPolicy(policy: PenaltyPolicy): Refusal[] {
  const out: Refusal[] = [];
  if (!isObject(policy) || !nonEmptyString(policy.penalty_policy_id)) {
    return [{ code: 'INVALID_PENALTY_POLICY', message: 'penalty_policy_id is required.' }];
  }
  const p = (policy as PenaltyPolicy).penalties;
  for (const k of ['cardinality', 'precedence', 'budget'] as const) {
    const v = isObject(p) ? p[k] : undefined;
    if (!(typeof v === 'number' && Number.isSafeInteger(v) && v > 0)) {
      out.push({
        code: 'INVALID_PENALTY_POLICY',
        message: `penalties.${k} must be a positive safe integer.`,
        path: `policy.penalties.${k}`,
      });
    }
  }
  const m = policy.max_slack_bits_per_window;
  if (!(Number.isSafeInteger(m) && m >= 0)) {
    out.push({
      code: 'INVALID_PENALTY_POLICY',
      message: 'max_slack_bits_per_window must be a non-negative integer.',
      path: 'policy.max_slack_bits_per_window',
    });
  }
  return out;
}

export function validateScenario(s: FrozenScenario, policy: PenaltyPolicy): Refusal[] {
  const out: Refusal[] = [];
  if (!isObject(s)) {
    return [{ code: 'MISSING_FIELD', message: 'Scenario must be an object.' }];
  }
  checkKeys(s as unknown as Record<string, unknown>, SCENARIO_KEYS, 'scenario', out);

  for (const k of ['scenario_id', 'policy_version_frozen', 'manifest_hash_frozen', 'encoding_version', 'penalty_policy_id'] as const) {
    if (!nonEmptyString(s[k])) {
      out.push({ code: 'MISSING_FIELD', message: `${k} is required.`, path: `scenario.${k}` });
    }
  }
  if (nonEmptyString(s.policy_version_frozen) && LIVE_POLICY_MARKERS.has(s.policy_version_frozen.toLowerCase())) {
    out.push({
      code: 'LIVE_POLICY_VERSION',
      message: 'policy_version_frozen must be a pinned version id, not a live pointer.',
      path: 'scenario.policy_version_frozen',
    });
  }
  if (nonEmptyString(s.encoding_version) && s.encoding_version !== ENCODING_VERSION) {
    out.push({
      code: 'ENCODING_VERSION_MISMATCH',
      message: `Compiler implements ${ENCODING_VERSION}, scenario requests ${s.encoding_version}.`,
      path: 'scenario.encoding_version',
    });
  }
  if (isObject(policy) && s.penalty_policy_id !== policy.penalty_policy_id) {
    out.push({
      code: 'PENALTY_POLICY_MISMATCH',
      message: 'Scenario is pinned to a different penalty_policy_id than the one supplied.',
      path: 'scenario.penalty_policy_id',
    });
  }
  if (s.classical_baseline_ref !== undefined && !nonEmptyString(s.classical_baseline_ref)) {
    out.push({ code: 'MISSING_FIELD', message: 'classical_baseline_ref must be a non-empty string when present.', path: 'scenario.classical_baseline_ref' });
  }

  for (const k of ['draws', 'windows', 'precedence', 'concentration_pairs'] as const) {
    if (!Array.isArray(s[k])) {
      out.push({ code: 'MISSING_FIELD', message: `${k} must be an array.`, path: `scenario.${k}` });
    }
  }
  if (out.some((r) => r.code === 'MISSING_FIELD' && /draws|windows|precedence|concentration_pairs/.test(r.path ?? ''))) {
    return out;
  }

  const windowIds = new Set<string>();
  s.windows.forEach((w, i) => {
    const path = `scenario.windows[${i}]`;
    if (!isObject(w)) {
      out.push({ code: 'MISSING_FIELD', message: 'Window must be an object.', path });
      return;
    }
    checkKeys(w as unknown as Record<string, unknown>, WINDOW_KEYS, path, out);
    if (!nonEmptyString(w.id)) out.push({ code: 'MISSING_FIELD', message: 'id is required.', path: `${path}.id` });
    else if (windowIds.has(w.id)) out.push({ code: 'DUPLICATE_ID', message: `Duplicate window id ${w.id}.`, path });
    else windowIds.add(w.id);
    checkMoney(w.liquidity_cap_minor, `${path}.liquidity_cap_minor`, out);
  });

  const drawIds = new Set<string>();
  s.draws.forEach((d, i) => {
    const path = `scenario.draws[${i}]`;
    if (!isObject(d)) {
      out.push({ code: 'MISSING_FIELD', message: 'Draw must be an object.', path });
      return;
    }
    checkKeys(d as unknown as Record<string, unknown>, DRAW_KEYS, path, out);
    if (!nonEmptyString(d.id)) out.push({ code: 'MISSING_FIELD', message: 'id is required.', path: `${path}.id` });
    else if (drawIds.has(d.id)) out.push({ code: 'DUPLICATE_ID', message: `Duplicate draw id ${d.id}.`, path });
    else drawIds.add(d.id);
    for (const k of ['spv_id', 'sponsor_id'] as const) {
      if (!nonEmptyString(d[k])) out.push({ code: 'MISSING_FIELD', message: `${k} is required.`, path: `${path}.${k}` });
    }
    if (!Number.isSafeInteger(d.tranche)) {
      out.push({ code: 'MISSING_FIELD', message: 'tranche must be an integer.', path: `${path}.tranche` });
    }
    checkMoney(d.amount_minor, `${path}.amount_minor`, out);
    checkWeight(d.utility, `${path}.utility`, out);
    checkWeight(d.deferral_cost, `${path}.deferral_cost`, out);
    if (!Array.isArray(d.window_eligibility)) {
      out.push({ code: 'MISSING_FIELD', message: 'window_eligibility must be an array.', path: `${path}.window_eligibility` });
    } else {
      d.window_eligibility.forEach((w, j) => {
        if (!windowIds.has(w)) {
          out.push({ code: 'UNKNOWN_REFERENCE', message: `Unknown window ${String(w)}.`, path: `${path}.window_eligibility[${j}]` });
        }
      });
    }
    if (d.delay_cost !== undefined) {
      if (!isObject(d.delay_cost)) {
        out.push({ code: 'NON_INTEGER_WEIGHT', message: 'delay_cost must be a map of window id → integer.', path: `${path}.delay_cost` });
      } else {
        for (const [w, v] of Object.entries(d.delay_cost)) {
          if (!windowIds.has(w)) out.push({ code: 'UNKNOWN_REFERENCE', message: `Unknown window ${w}.`, path: `${path}.delay_cost.${w}` });
          checkWeight(v, `${path}.delay_cost.${w}`, out);
        }
      }
    }
  });

  s.precedence.forEach((p, i) => {
    const path = `scenario.precedence[${i}]`;
    if (!isObject(p)) {
      out.push({ code: 'INVALID_PAIR', message: 'Precedence must be an object.', path });
      return;
    }
    checkKeys(p as unknown as Record<string, unknown>, PRECEDENCE_KEYS, path, out);
    for (const k of ['before', 'after'] as const) {
      if (!drawIds.has(p[k])) {
        out.push({
          code: 'UNKNOWN_REFERENCE',
          message: `Precedence references draw ${String(p[k])}, which is not in the frozen IR (excluded by pre-filter or never present).`,
          path: `${path}.${k}`,
        });
      }
    }
    if (p.before === p.after) out.push({ code: 'INVALID_PAIR', message: 'A draw cannot precede itself.', path });
  });

  s.concentration_pairs.forEach((c, i) => {
    const path = `scenario.concentration_pairs[${i}]`;
    if (!isObject(c)) {
      out.push({ code: 'INVALID_PAIR', message: 'Concentration pair must be an object.', path });
      return;
    }
    checkKeys(c as unknown as Record<string, unknown>, CONCENTRATION_KEYS, path, out);
    for (const k of ['left', 'right'] as const) {
      if (!drawIds.has(c[k])) out.push({ code: 'UNKNOWN_REFERENCE', message: `Unknown draw ${String(c[k])}.`, path: `${path}.${k}` });
    }
    if (c.left === c.right) out.push({ code: 'INVALID_PAIR', message: 'Concentration pair needs two different draws.', path });
    checkWeight(c.weight, `${path}.weight`, out, true);
  });

  return out;
}
