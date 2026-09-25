# DIBS Quantum Optimization Lab — Exploration

**Status:** Research exploration. Offline, nonbinding, isolated from settlement. Not a product claim and not Sprint 0–6 work.

**Canonical source:** `DIBS-Complete-Scaffold.md` §23, aligned to the tightened Master Scaffold.

---

## 1. What this lab is

The Quantum Optimization Lab is a **scenario engine**, not a capital engine.

It takes a frozen, de-identified snapshot of portfolio state and searches for better *schedules and allocations* than a human spreadsheet. It returns a **candidate** plus a signed validator report. A human may later promote a validated pattern into a *versioned policy simulation*. Nothing in that path can create a `DrawRequest`, waive a covenant, change policy, or write a settlement instruction.

```text
De-identified scenario
  → Data freeze
  → Classical MIP baseline
  → QUBO compiler
  → QAOA simulator or approved research run
  → Independent validator (full-precision money)
  → Human review
  → Versioned policy simulation
  → Limited pilot only if approved
```

Live Autopilot remains the only write path to capital state. QLab never receives customer documents, keys, or raw PII, and never talks to a payment partner.

That isolation is the product. The math is secondary.

---

## 2. Why it exists at all

DIBS Capital Autopilot decides *whether a single draw may be instructed*. That is a policy + evidence + approval problem. It is not an optimization problem.

The lab is for the *portfolio-shaped* questions that sit around Autopilot:

| Question | Autopilot answers? | Lab candidate? |
|---|---|---|
| May this draw be instructed today? | Yes — policy, evidence, SoD, payee | No |
| Which approved-eligible draws should land in which week given liquidity? | No | Draw scheduling |
| How much reserve should this book hold across the next τ periods? | Rule check only | Reserve sizing (discretized) |
| Are we too concentrated in one sponsor / MSA / SPV? | Covenant breach / hold | Concentration balancing |
| How should committed capital sit across SPVs under LTV and tranche order? | No | SPV / portfolio allocation |
| What breaks if inspections slip two weeks? | Exception after the fact | Stress sequencing |

Autopilot is the gate. The lab is a map of gates that have not been reached yet.

---

## 3. Repo reality

There is no runnable Quantum Lab in the live monorepo. `packages/quantum-lab/{classical,qubo,qaoa,validators,experiments}` is a scaffold path. The Implementation Plan parks QLab and PQC explicitly. Sprints 0–6 do not open this folder.

A first lender book in the Core Thesis range — roughly `$25M–$500M` committed, `10–100` draws per month — is classically small. Twelve draws × four windows × two SPVs is still about 100 binaries. A MIP solver (HiGHS, CBC, Gurobi) proves those schedules. Published 2025–26 portfolio-QAOA bake-offs still show MIP solving thousand-asset books to optimality in seconds while QAOA/annealing stall around a few dozen assets. QAOA will not beat that baseline at DIBS pilot size.

The near-term value of the lab is forcing a **formal objective and constraint model of capital operations**, then measuring whether a quantum heuristic is even in the conversation.

QLab is optimization research. PQC (ML-KEM / ML-DSA) is cryptography. They share a word and nothing else. Neither is a draw-path dependency.

Do not staff this ahead of Autopilot.

---

## 4. Problem classes, ranked

Hard legal and compliance facts are **not** decision variables. KYC/AML fails, sanctions hits, missing executed docs, unverified payees, and open holds are stripped *before* QUBO compilation. They never become soft penalties.

### High QUBO fit

**Draw-window assignment.** Binary `x_{i,t} = 1` if eligible draw `i` is placed in window `t`. Quadratic terms appear from pairwise crowding (same payee, same inspector, same SPV cash week) and from concentration.

**Concentration / multi-SPV allocation.** Binary or integer-encoded slices `y_s`. Pairwise `y_s y_{s'}` is the natural QUBO term. This is the cleanest quantum-shaped DIBS problem.

### Medium fit, after discretization

**Reserve bands.** Continuous reserve sizing is a linear/stochastic program. Discretize into `K` one-hot bands `r_k` and QAOA can search the band. Keep the continuous ladder classical.

**Operational sequencing.** Inspection → evidence freeze → approval → instruction order across many deals. Cardinality and precedence map to QUBO; due-date slip is better as a classical dispatch model first.

### Poor first tool

**Stochastic liquidity forecasting.** Keep as a cash ladder / Monte Carlo. Feed its *outputs* (window liquidity caps) into the QUBO. Do not put a forecast model on a QPU.

**Single-draw underwriting.** That is Autopilot. The lab must not score a live draw.

---

## 5. Energy model

The spec energy is:

$$
E(x)=E_{\text{economic}}(x)+\sum_{c\in H}P_c\,g_c(x)+\sum_{s\in S}w_s\,f_s(x)
$$

- $E_{\text{economic}}$ — idle cash cost, delay cost, unused commitment, inspect/admin load
- $H$ — hard operational constraints compiled as penalties (liquidity cap, LTV, reserve, tranche order, cardinality, max exposure)
- $S$ — soft preferences (smooth weekly volume, inspector travel, sponsor fairness)
- $P_c$ — penalty large enough that violating $c$ cannot be “bought” by economic gain

Penalty floor:

$$
P_c>\frac{\Delta E_{\max}}{v_{\min}^{2}}
$$

where $\Delta E_{\max}$ is the best economic improvement available from violating $c$, and $v_{\min}$ is the smallest nonzero violation in the encoding.

Legal, KYC/AML, sanctions, and missing-document disqualifiers are **excluded from $x$**. They are not members of $H$. If a draw is not legally instructable, it has no bit.

---

## 6. Three DIBS-native QUBO sketches

Money in the compiler is integer minor units. The validator re-checks on original full-precision figures. Confirmed draws only count as cash; instructed-but-unconfirmed stays on the instruction register.

### A. Draw-window assignment

Sets:

- $I$ — draws that already pass Autopilot eligibility in the frozen snapshot (verified payee, no hold, docs current)
- $T$ — scheduling windows
- $a_i$ — requested amount of draw $i$
- $L_t$ — window liquidity cap from the classical cash ladder
- $\mathcal{P}$ — precedence pairs $(i,j)$ (tranche order, inspection-before-pay)

Decision variable: $x_{i,t}\in\{0,1\}$.

Assignment (exactly one window, or deferred):

$$
\sum_{t\in T}x_{i,t}+z_i=1\qquad\forall i\in I
$$

$z_i=1$ means “leave unscheduled.” Deferral has a cost in $E_{\text{economic}}$, not a compliance pass.

Liquidity:

$$
\sum_{i\in I}a_i\,x_{i,t}\le L_t\qquad\forall t\in T
$$

Precedence: if $i$ must precede $j$,

$$
\sum_{t}t\,x_{j,t}-\sum_{t}t\,x_{i,t}\ge 1
$$

when both are scheduled. Encode with pairwise penalties on invalid $(t,t')$ pairs.

Concentration / crowding (quadratic, the QUBO-native piece):

$$
E_{\text{conc}}=\sum_{t}\sum_{i<j}c_{ij}\,x_{i,t}x_{j,t}
$$

$c_{ij}$ is high when $i$ and $j$ share a sponsor, MSA, inspector, or payee.

Economic term (example):

$$
E_{\text{economic}}=\sum_{i,t}d_{i,t}x_{i,t}+\sum_{i}\delta_i z_i
$$

$d_{i,t}$ is delay-plus-idle cost of putting $i$ in $t$; $\delta_i$ is the cost of deferral.

**Compiler rule:** a draw on `HELD`, `REQUIRES_INFORMATION`, failed sanctions, or unverified payee never receives an $x_{i,t}$.

### B. Concentration / SPV allocation

Variable $y_s\in\{0,1\}$ (or binary expansion of a slice count) for “this SPV/sponsor takes incremental exposure in the frozen horizon.”

$$
E= -\sum_s u_s y_s + \lambda\sum_{s\neq s'} \kappa_{ss'} y_s y_{s'} + \sum_s P_{\text{exp}}\,\mathbf{1}[e_s y_s > E_s^{\max}]
$$

- $u_s$ — utility of funding $s$ (servicing quality, remaining budget, milestone readiness)
- $\kappa_{ss'}$ — correlation / shared-risk weight (same sponsor, same submarket, same GC)
- $E_s^{\max}$ — policy max exposure

This is Markowitz-shaped and actually uses the quadratic term. It is the first experiment worth compiling.

### C. Reserve band

Do not put continuous cash on qubits. Choose one band:

$$
\sum_{k=1}^{K}r_k=1,\qquad r_k\in\{0,1\}
$$

Band $k$ means “hold reserve $R_k$.” Closing cash in the frozen ladder must satisfy

$$
\text{ClosingCash}_{\tau}(x)\;\ge\;\sum_k R_k r_k
$$

and, as in Autopilot,

$$
\text{ClosingCash}_{\tau}
=
\text{OpeningCash}_{\tau}
+\text{CommittedInflows}_{\tau}
+\text{ApprovedFacilityDraws}_{\tau}
-\text{ScheduledOutflows}_{\tau}
-\text{RequiredReserves}_{\tau}
$$

`ApprovedFacilityDraws` counts **settlement-confirmed** amounts only. Instructed-but-unconfirmed draws stay off this equation.

---

## 7. QAOA, kept in its box

QAOA is a variational circuit that prepares

$$
\lvert\psi(\boldsymbol{\gamma},\boldsymbol{\beta})\rangle
=
\Biggl(\prod_{p=1}^{P}e^{-i\beta_p H_M}e^{-i\gamma_p H_C}\Biggr)\lvert+\rangle^{\otimes n}
$$

and a classical optimizer tunes $(\boldsymbol{\gamma},\boldsymbol{\beta})$ to lower $\langle H_C\rangle$. $H_C$ is the Ising image of the QUBO. $H_M$ is usually $\sum_i X_i$. For cardinality constraints (exactly-$k$ windows, one-hot reserve bands), a constraint-preserving mixer (XY / Dicke-initialized) is the research option named in the Autopilot quantum scaffold. That is an experiment choice, not a production dependency.

Practical limits that matter for DIBS:

- NISQ QAOA is a heuristic. Feasible-rate collapse is common once penalties and $n$ grow.
- Penalty miss-calibration produces “cheap” infeasible bitstrings. That is why the validator exists.
- Depth $P>1$ often gets worse on hardware, not better. A first run is $P=1$ on a simulator.
- Warm-start from the classical optimum is optional and empirically mixed. Record it; do not assume it helps.

Future research, not a spec requirement: constraint-preserving XY mixers and Dicke-state initialization on *local* $k$-hot blocks (one window per draw, one reserve band). The single global liquidity inequality stays an X-mixer plus penalty — Trotterized XY degrades on one all-to-all constraint. Do not make mixer choice a production dependency.

The lab may use a **classical QUBO heuristic** (simulated annealing, tabu, parallel tempering) as a third baseline next to MIP and QAOA. If annealing already matches MIP, QAOA has nothing to prove.

---

## 8. Independent validator

The validator is the real control. It does not trust the energy $E(x)$.

```text
Candidate bitstring
  → Decode to a schedule / allocation
  → Reload original full-precision scenario (not the QUBO scaling)
  → Recalculate budgets, retainage, liquidity
  → Recalculate LTV
  → Recalculate reserves (confirmed draws only)
  → Check concentration and tranche order
  → Check legal / KYC / sanctions / document currency
  → Run the declared stress set
  → Sign the result
```

Rules:

- Fixed-point decimal arithmetic for money, rates, and percentages. No IEEE floats in the verdict.
- Any failed hard constraint **rejects** the candidate. No “almost.”
- A rejected candidate cannot be forwarded to human review as a schedule. It can only be forwarded as a modeling defect (`REQUIRES_REMODELING`).
- The validator binary is versioned. The QAOA binary cannot patch it.

This is the same invariant as Autopilot, pointed at a research artifact instead of a draw: no capital-shaped recommendation without policy, evidence-grade inputs, authorization (human gate), and an immutable event.

---

## 9. Experiment state machine

```text
DRAFT_SCENARIO
  → DATA_FROZEN
  → CLASSICAL_BASELINE_COMPLETE
  → QUBO_COMPILED
  → QAOA_RUN_COMPLETE
  → CANDIDATE_VALIDATED
  → REVIEW_PACKET_ISSUED
  → MULTI_ROLE_REVIEW
  → APPROVED_FOR_SIMULATION
  → POLICY_SIMULATION_COMPLETE
  → APPROVED_LIMITED_PILOT
  → PILOT_MONITORED
  → EVALUATION_COMPLETE
  → PROMOTED_TO_VERSIONED_POLICY
```

Failure states: `REQUIRES_REMODELING`, `REJECTED`, `AUTO_SUSPENDED`, `ROLLED_BACK`.

`PROMOTED_TO_VERSIONED_POLICY` means “this allocation rule may be simulated against future frozen books.” It does not mean “Autopilot now auto-approves matching draws.” Promotion into live policy is a separate RiskOwner / LenderAdmin change with its own audit event, outside the lab.

---

## 10. Worked toy (draw-window)

Frozen book. Four requested draws, three weeks. Opening cash is not used here; window caps already come from the classical ladder.

| Draw | Amount | SPV | Notes |
|---|---|---|---|
| D1 | $400{,}000$ | A | Eligible |
| D2 | $250{,}000$ | A | Must follow D1 (tranche) |
| D3 | $300{,}000$ | B | Eligible |
| D4 | $200{,}000$ | A | Open hold — **excluded before compile** |

Window caps: $T_1=\$500{,}000$, $T_2=\$450{,}000$, $T_3=\$600{,}000$.

Decision bits: $x_{i,t}$ for $i\in\{1,2,3\}$, $t\in\{1,2,3\}$, plus deferral $z_i$. That is 12 bits, not 16. D4 has no bit.

Infeasible examples the validator must kill even if $E(x)$ looks good:

- D1 and D3 both in $T_1$ ($700{,}000>500{,}000$)
- D2 in $T_1$ and D1 in $T_2$ (tranche order)
- Any schedule that treats D4 as fundable

A classical MIP finds the feasible set instantly. QAOA on 12 bits is a unit test of the compiler and validator, not a quantum-advantage claim. That is the correct first experiment.

---

## 11. What a first offline experiment should measure

Use one frozen synthetic book. No customer data. No QPU required.

Compare three solvers on the same QUBO and the same validator:

1. Exact MIP on the original constraint model (ground truth)
2. Classical QUBO heuristic
3. QAOA $P=1$ simulator, then $P=2$ if $P=1$ is feasible

Record, and only these:

| Metric | Meaning |
|---|---|
| Feasibility rate | Share of sampled bitstrings the validator accepts |
| Gap to MIP | $(E_{\text{cand}}-E_{\text{MIP}})/\lvert E_{\text{MIP}}\rvert$ on accepted candidates only |
| Penalty sensitivity | Feasibility rate under $P_c$ scaled $\pm 10\%$, $\pm 25\%$, $\pm 50\%$ |
| Encoding size | Bits, density of $Q$, slack/one-hot overhead |
| Wall time | Compiler + solver + validator, separately |
| False-feasible count | Bitstrings cheap in $E(x)$ that fail full-precision checks — this is the defect that matters |

Pass criteria for the *lab*, not for production:

- Validator rejects 100% of hard-constraint violations
- Penalty grid produces a region with feasibility rate $>0$ and gap reported
- No experiment artifact can be posted to `/v1/draw-requests` or `/v1/settlement-instructions`

Fail the experiment if any code path writes Autopilot state.

---

## 12. What must never happen

```text
QAOA bitstring → DrawRequest
QAOA bitstring → covenant waiver
QAOA bitstring → policy mutation
QAOA bitstring → settlement instruction
Customer documents / keys / PII → quantum provider
Live policyVersion read inside the QUBO (use the frozen snapshot)
Float money inside the validator
Unparking this folder in Sprints 0–6
```

If DIBS and a partner disagree on a live deal, Autopilot holds. The lab is not a tie-breaker.

---

## 13. Honest conclusion

The Quantum Optimization Lab is a **constraint-formalization and research harness** wrapped around Autopilot’s already-strong control model. Its best DIBS targets are combinatorial: draw-window assignment, sponsor/SPV concentration, discretized reserve bands.

It is not a reason to delay the draw desk. It is not a liquidity oracle. It is not cheaper than Gurobi on a 100-draw book. It becomes interesting only after Autopilot is running real deals and the frozen-book constraint model is boringly correct.

Build Autopilot. Keep this folder parked. When a frozen book exists, compile sketch A, run the three-solver bake-off, and let the validator do the talking.
