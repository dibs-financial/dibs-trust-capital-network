/**
 * Passes 5–6: replay a schedule on the frozen book in integer minor units and
 * run the hard operational checks. BigInt throughout; no float on this path.
 * Used for the candidate and, unchanged, for every derived stress snapshot.
 */

import { Check, FrozenBook } from './types';

/** draw id → windows it is placed in. Empty array = deferred. */
export type Placement = Map<string, string[]>;

const B = (n: number): bigint => BigInt(n);

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function replayChecks(placement: Placement, book: FrozenBook): Check[] {
  const s = book.scenario;
  const checks: Check[] = [];
  const amount = new Map(s.draws.map((d) => [d.id, B(d.amount_minor)]));
  const drawById = new Map(s.draws.map((d) => [d.id, d]));
  const windowPos = new Map(s.windows.map((w, i) => [w.id, i]));

  const usedByWindow = new Map<string, bigint>(s.windows.map((w) => [w.id, 0n]));
  for (const [id, ws] of placement) {
    for (const w of ws) usedByWindow.set(w, (usedByWindow.get(w) ?? 0n) + amount.get(id)!);
  }
  const scheduled = [...placement.entries()].filter(([, ws]) => ws.length > 0);

  // BUDGET_EXCEEDED — Σ a_i ≤ L_t per window
  for (const w of s.windows) {
    const used = usedByWindow.get(w.id)!;
    checks.push({
      code: 'BUDGET_EXCEEDED',
      status: used > B(w.liquidity_cap_minor) ? 'FAIL' : 'PASS',
      subject: w.id,
      measured: used.toString(),
      limit: String(w.liquidity_cap_minor),
      unit: 'minor',
    });
  }

  // LIQUIDITY_SHORT / RESERVE_BREACH — cash ladder, confirmed draws only
  if (!book.cash_ladder) {
    checks.push({ code: 'LIQUIDITY_SHORT', status: 'SKIP', note: 'no cash ladder in this catalog' });
    checks.push({ code: 'RESERVE_BREACH', status: 'SKIP', note: 'no cash ladder in this catalog' });
  } else {
    let cash = B(book.cash_ladder.opening_cash_minor);
    for (const w of s.windows) {
      const p = book.cash_ladder.periods[w.id];
      cash +=
        B(p.committed_inflows_minor) +
        B(p.confirmed_facility_draws_minor) -
        B(p.scheduled_outflows_minor) -
        usedByWindow.get(w.id)!;
      checks.push({
        code: 'LIQUIDITY_SHORT',
        status: cash < 0n ? 'FAIL' : 'PASS',
        subject: w.id,
        measured: cash.toString(),
        limit: '0',
        unit: 'minor',
      });
      checks.push({
        code: 'RESERVE_BREACH',
        status: cash < B(p.required_reserve_minor) ? 'FAIL' : 'PASS',
        subject: w.id,
        measured: cash.toString(),
        limit: String(p.required_reserve_minor),
        unit: 'minor',
      });
    }
  }

  // LTV_BREACH — (outstanding + scheduled) / eligible collateral ≤ policy, in bps
  if (!book.spvs) {
    checks.push({ code: 'LTV_BREACH', status: 'SKIP', note: 'no collateral data in this catalog' });
  } else {
    const addBySpv = new Map<string, bigint>();
    for (const [id] of scheduled) {
      const spv = drawById.get(id)!.spv_id;
      addBySpv.set(spv, (addBySpv.get(spv) ?? 0n) + amount.get(id)!);
    }
    for (const spvId of Object.keys(book.spvs).sort()) {
      const c = book.spvs[spvId];
      const debt = B(c.outstanding_debt_minor) + (addBySpv.get(spvId) ?? 0n);
      const coll = B(c.eligible_collateral_minor);
      const breach = debt * 10_000n > B(c.policy_ltv_bps) * coll;
      checks.push({
        code: 'LTV_BREACH',
        status: breach ? 'FAIL' : 'PASS',
        subject: spvId,
        // Rounded up so a breach never displays as equal to the limit.
        measured: ceilDiv(debt * 10_000n, coll).toString(),
        limit: String(c.policy_ltv_bps),
        unit: 'bps',
      });
    }
  }

  // CONCENTRATION_BREACH — existing + scheduled exposure ≤ cap
  const caps = book.concentration_caps ?? [];
  if (caps.length === 0) {
    checks.push({ code: 'CONCENTRATION_BREACH', status: 'SKIP', note: 'no concentration caps in this catalog' });
  } else {
    for (const cap of caps) {
      let exposure = B(cap.existing_exposure_minor);
      for (const [id] of scheduled) {
        const d = drawById.get(id)!;
        if ((cap.dimension === 'spv' ? d.spv_id : d.sponsor_id) === cap.key) exposure += amount.get(id)!;
      }
      checks.push({
        code: 'CONCENTRATION_BREACH',
        status: exposure > B(cap.max_exposure_minor) ? 'FAIL' : 'PASS',
        subject: `${cap.dimension}:${cap.key}`,
        measured: exposure.toString(),
        limit: String(cap.max_exposure_minor),
        unit: 'minor',
      });
    }
  }

  // TRANCHE_ORDER_VIOLATION — junior at or before senior, when both scheduled
  if (s.precedence.length === 0) {
    checks.push({ code: 'TRANCHE_ORDER_VIOLATION', status: 'SKIP', note: 'no precedence in this catalog' });
  } else {
    for (const p of s.precedence) {
      const before = placement.get(p.before) ?? [];
      const after = placement.get(p.after) ?? [];
      const bad = after.some((ta) => before.some((tb) => windowPos.get(ta)! <= windowPos.get(tb)!));
      checks.push({ code: 'TRANCHE_ORDER_VIOLATION', status: bad ? 'FAIL' : 'PASS', subject: `${p.before}<${p.after}` });
    }
  }

  // Per scheduled draw, from the freeze: payee, hold, settlement route
  const perDraw: Array<[string, (st: FrozenBook['draw_status'][string]) => boolean]> = [
    ['UNVERIFIED_PAYEE', (st) => !st.payee_verified],
    ['OPEN_HOLD_PRESENT', (st) => st.hold_open],
    ['SETTLEMENT_UNAVAILABLE', (st) => !st.settlement_route_live],
  ];
  for (const [code, failing] of perDraw) {
    if (scheduled.length === 0) {
      checks.push({ code, status: 'PASS', note: 'no scheduled draws' });
      continue;
    }
    for (const [id] of [...scheduled].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      checks.push({ code, status: failing(book.draw_status[id]) ? 'FAIL' : 'PASS', subject: id });
    }
  }

  return checks;
}

/**
 * J_replay = Σ scheduled (−u_i + d_{i,t}) + Σ deferred δ_i, as the validator spec
 * defines it. Concentration weights are not included (the compiler's E_economic
 * does include them). Only for a well-formed placement.
 */
export function replayObjective(placement: Placement, book: FrozenBook): bigint {
  let j = 0n;
  for (const d of book.scenario.draws) {
    const ws = placement.get(d.id) ?? [];
    j += ws.length === 0 ? B(d.deferral_cost) : B(-d.utility) + B(d.delay_cost?.[ws[0]] ?? 0);
  }
  return j;
}
