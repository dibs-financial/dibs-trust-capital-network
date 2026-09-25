# packages/quantum-lab — PARKED / offline / nonbinding

Research harness for the DIBS Quantum Optimization Lab. It is a scenario engine, not a capital engine.

- It is not wired into Autopilot. `backend/` and `shared/` must not import from this package, and this package must not import from them. `tests/quantum-lab` enforces both directions.
- No output of this package can create a `DrawRequest`, waiver, policy change, or settlement instruction.
- It takes no customer documents, keys, or PII, and makes no network calls.

| Folder | Status |
| :-- | :-- |
| `qubo/` | QUBO compiler, `draw-window/v1`: `FrozenScenario + PenaltyPolicy → (Q, symbol table, compile report)` |
| `classical/`, `qaoa/`, `validators/`, `experiments/` | Not started |

Specs: [`docs/quantum-lab/`](../../docs/quantum-lab/). Tests: `npx jest tests/quantum-lab`.

## `qubo/` — what v1 encodes

- Draw-window assignment: bits $x_{i,t}$, plus deferral $z_i$, with one-hot cardinality.
- Pruning: no bit when a draw's amount exceeds the window cap or the window is not eligible.
- Tranche precedence: forbidden window pairs penalized when both draws are scheduled.
- Window liquidity cap: pairwise couplings when they are provably exact for that window, otherwise binary slack in gcd units, bounded by `max_slack_bits_per_window`.
- Same-window concentration: pairwise $c_{ij}$.
- Penalty floor $P_c > \Delta E_{\max}/v_{\min}^2$, with $\Delta E_{\max}$ bounded conservatively by $\sum$ of absolute objective coefficients.

Not in v1, and refused with `REQUIRES_REMODELING` if requested: reserve bands, SPV allocation $y_s$, and anything above degree 2.
