/**
 * Pass 7: declared stress set. Each stress derives a snapshot (book and/or
 * placement) and replays Passes 5–6 on it unchanged. Any FAIL is STRESS_FAIL.
 */

import { Placement, replayChecks } from './replay';
import { CashLadder, FrozenBook, StressResult, StressSpec } from './types';

const B = (n: number): bigint => BigInt(n);

function shiftLadder(
  ladder: CashLadder,
  windowIds: string[],
  field: 'committed_inflows_minor' | 'confirmed_facility_draws_minor',
  k: number,
): CashLadder {
  const periods: CashLadder['periods'] = {};
  for (const w of windowIds) periods[w] = { ...ladder.periods[w], [field]: 0 };
  windowIds.forEach((w, i) => {
    const target = windowIds[i + k];
    if (target !== undefined) periods[target][field] += ladder.periods[w][field];
    // Past the horizon: never counts.
  });
  return { ...ladder, periods };
}

/** Returns the stressed book and placement, or a reason the stress cannot be evaluated on this freeze. */
function derive(
  spec: StressSpec,
  book: FrozenBook,
  placement: Placement,
): { book: FrozenBook; placement: Placement; note?: string } | { missing: string } {
  const windowIds = book.scenario.windows.map((w) => w.id);
  switch (spec.kind) {
    case 'INSPECTION_SLIP': {
      const only = spec.draw_ids ? new Set(spec.draw_ids) : null;
      const next: Placement = new Map();
      for (const [id, ws] of placement) {
        if (ws.length === 0 || (only && !only.has(id))) {
          next.set(id, ws);
          continue;
        }
        const target = windowIds[windowIds.indexOf(ws[0]) + spec.slip_windows];
        next.set(id, target === undefined ? [] : [target]);
      }
      return { book, placement: next };
    }
    case 'CONFIRMATION_LAG':
      if (!book.cash_ladder) return { missing: 'cash ladder' };
      return {
        book: { ...book, cash_ladder: shiftLadder(book.cash_ladder, windowIds, 'confirmed_facility_draws_minor', spec.lag_windows) },
        placement,
      };
    case 'INFLOW_DELAY':
      if (!book.cash_ladder) return { missing: 'cash ladder' };
      return {
        book: { ...book, cash_ladder: shiftLadder(book.cash_ladder, windowIds, 'committed_inflows_minor', spec.delay_windows) },
        placement,
      };
    case 'COLLATERAL_HAIRCUT': {
      if (!book.spvs) return { missing: 'collateral data' };
      const only = spec.spv_ids ? new Set(spec.spv_ids) : null;
      const spvs: NonNullable<FrozenBook['spvs']> = {};
      for (const [id, c] of Object.entries(book.spvs)) {
        const cut = only && !only.has(id) ? 0n : (B(c.eligible_collateral_minor) * B(spec.haircut_bps)) / 10_000n;
        spvs[id] = { ...c, eligible_collateral_minor: Number(B(c.eligible_collateral_minor) - cut) };
      }
      return { book: { ...book, spvs }, placement };
    }
    case 'ADDITIONAL_HOLD': {
      const drawById = new Map(book.scenario.draws.map((d) => [d.id, d]));
      const bySpv = new Map<string, bigint>();
      for (const [id, ws] of placement) {
        if (ws.length === 0) continue;
        const d = drawById.get(id)!;
        bySpv.set(d.spv_id, (bySpv.get(d.spv_id) ?? 0n) + B(d.amount_minor));
      }
      if (bySpv.size === 0) return { book, placement, note: 'no scheduled exposure' };
      const [largest] = [...bySpv.entries()].sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] > b[1] ? -1 : 1))[0];
      const next: Placement = new Map();
      for (const [id, ws] of placement) next.set(id, drawById.get(id)!.spv_id === largest ? [] : ws);
      return { book, placement: next, note: `hold on ${largest}; its draws defer` };
    }
  }
}

export function runStresses(book: FrozenBook, placement: Placement | null): StressResult[] {
  return book.stresses.map((spec) => {
    if (!placement) {
      return { name: spec.name, kind: spec.kind, status: 'NOT_RUN', failed_checks: [], note: 'schedule did not decode' };
    }
    const d = derive(spec, book, placement);
    if ('missing' in d) {
      return { name: spec.name, kind: spec.kind, status: 'NOT_RUN', failed_checks: [], note: `freeze has no ${d.missing}` };
    }
    const failed = replayChecks(d.placement, d.book).filter((c) => c.status === 'FAIL');
    return {
      name: spec.name,
      kind: spec.kind,
      status: failed.length > 0 ? 'FAIL' : 'PASS',
      failed_checks: failed,
      ...(d.note ? { note: d.note } : {}),
    };
  });
}
