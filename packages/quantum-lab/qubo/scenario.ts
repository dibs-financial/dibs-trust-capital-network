import { canonicalHash } from './hash';
import { FrozenScenario } from './types';

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order-independent form of a frozen scenario. Windows keep their array order
 * because it is time order; every other list is sorted.
 */
export function normalizeScenario(s: FrozenScenario): FrozenScenario {
  return {
    ...s,
    draws: [...s.draws]
      .map((d) => ({ ...d, window_eligibility: [...d.window_eligibility].sort(cmp) }))
      .sort((a, b) => cmp(a.id, b.id)),
    windows: s.windows.map((w) => ({ ...w })),
    precedence: [...s.precedence].sort((a, b) => cmp(a.before + '|' + a.after, b.before + '|' + b.after)),
    concentration_pairs: [...s.concentration_pairs].sort((a, b) =>
      cmp(a.left + '|' + a.right + '|' + a.weight, b.left + '|' + b.right + '|' + b.weight),
    ),
  };
}

/** Content hash of the frozen scenario, pinned on the artifact and re-checked by the validator. */
export function scenarioHash(s: FrozenScenario): string {
  return canonicalHash(normalizeScenario(s));
}
