# packages/quantum-lab — PARKED / offline / nonbinding

Research harness for the DIBS Quantum Optimization Lab. It is a scenario engine, not a capital engine.

- It is not wired into Autopilot. `backend/` and `shared/` must not import from this package, and this package must not import from them. `tests/quantum-lab` enforces both directions.
- No output of this package can create a `DrawRequest`, waiver, policy change, or settlement instruction.
- It takes no customer documents, keys, or PII, and makes no network calls.

| Folder | Status |
| :-- | :-- |
| `qubo/` | QUBO compiler, `draw-window/v1`: `FrozenScenario + PenaltyPolicy → (Q, symbol table, compile report)` |
| `validators/` | Independent validator, `validator/v1`: `qubo_artifact + bitstring + frozen book → signed ValidationReport` |
| `classical/`, `qaoa/`, `experiments/` | Not started |

Specs: [`docs/quantum-lab/`](../../docs/quantum-lab/). Tests: `npx jest tests/quantum-lab`.

## `qubo/` — what v1 encodes

- Draw-window assignment: bits $x_{i,t}$, plus deferral $z_i$, with one-hot cardinality.
- Pruning: no bit when a draw's amount exceeds the window cap or the window is not eligible.
- Tranche precedence: forbidden window pairs penalized when both draws are scheduled.
- Window liquidity cap: pairwise couplings when they are provably exact for that window, otherwise binary slack in gcd units, bounded by `max_slack_bits_per_window`.
- Same-window concentration: pairwise $c_{ij}$.
- Penalty floor $P_c > \Delta E_{\max}/v_{\min}^2$, with $\Delta E_{\max}$ bounded conservatively by $\sum$ of absolute objective coefficients.

Not in v1, and refused with `REQUIRES_REMODELING` if requested: reserve bands, SPV allocation $y_s$, and anything above degree 2.

## `validators/` — what v1 checks

The validator binds the artifact, freeze and bitstring and refuses to decode on any mismatch (`REQUIRES_REMODELING`). It then:

- decodes the bitstring, drops slack ancillas and rebuilds the schedule
- re-applies the pre-filter to every draw that got a bit
- replays the book in integer minor units (BigInt) and runs: budget, liquidity, reserve (confirmed draws only), LTV in bps, concentration caps, tranche order, payee, hold and settlement route
- runs the declared stress set: inspection slip, confirmation lag, inflow delay, collateral haircut, extra hold on the largest SPV
- signs the report with Ed25519

It never uses Q energy as a predicate. It takes a **frozen book**: the compiler's `FrozenScenario` plus the data the compiler never sees (draw eligibility facts, SPV collateral, cash ladder, concentration caps, stresses).
