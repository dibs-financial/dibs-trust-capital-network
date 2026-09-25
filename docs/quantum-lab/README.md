# DIBS Quantum Optimization Lab — Brief

The Quantum Optimization Lab is a **scenario engine, not a capital engine**. It is parked, offline, nonbinding, and isolated from Autopilot. There is no runnable lab in the live monorepo — only Complete Scaffold §23 and the folder map `packages/quantum-lab/{classical,qubo,qaoa,validators,experiments}`.

Full memo: [DIBS-Quantum-Lab-Optimization-Exploration.md](./DIBS-Quantum-Lab-Optimization-Exploration.md)

## What it is allowed to do

Autopilot answers whether *this* draw may be instructed. The lab answers the portfolio-shaped questions around that gate:

- which eligible draws should land in which week given liquidity
- how to slice scarce facility capacity across SPVs
- whether the book is too concentrated in one sponsor / MSA / GC
- which discrete reserve band to hold
- how a two-week inspection slip rearranges the feasible set

Pipeline, frozen:

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

A validated candidate can become a policy simulation. It cannot become a `DrawRequest`, waiver, or settlement instruction.

Legal / KYC / sanctions / missing docs / open holds are stripped **before** compile. They are not soft penalties QAOA can buy.

## Compiler contract

```text
FrozenScenario + PenaltyPolicy  →  (Q, symbol table, compile report)
```

The compiler is a pure, deterministic function. Same inputs, same outputs, byte for byte. It performs no network calls, does not read live `policyVersion`, and cannot write Autopilot state.

**Inputs**

| Input | Contents |
| :-- | :-- |
| `FrozenScenario` | Snapshot ID and content hash. Draws that already pass Autopilot eligibility, with amounts $a_i$ as integer minor units. Windows $T$ and liquidity caps $L_t$ from the classical cash ladder. Precedence pairs. Crowding / concentration weights $c_{ij}$, $\kappa_{ss'}$. Exposure caps $E_s^{\max}$. Reserve bands $R_k$. Excluded items, each with a reason code. |
| `PenaltyPolicy` | Versioned. $P_c$ for each hard constraint in $H$, and $w_s$ for each soft preference in $S$. |

**Outputs**

| Output | Contents |
| :-- | :-- |
| `Q` | QUBO matrix (upper-triangular) plus constant offset, so $E(x)=x^\top Q x + \text{offset}$. |
| Symbol table | Bit index → decision variable ($x_{i,t}$, $z_i$, $y_s$, $r_k$), with the source draw / SPV / window / band ID. The validator uses it to decode a bitstring back into a schedule. |
| Compile report | Input hashes and the `PenaltyPolicy` version. Bit count, density of $Q$, slack / one-hot overhead. Money scaling factor. Excluded items and reason codes. The penalty-floor check for each $c \in H$. |

**Rules**

- A draw on hold, awaiting information, failing sanctions, or with an unverified payee gets no bit. It appears in the compile report as excluded, never in `Q`.
- If any $P_c$ is below $\Delta E_{\max}/v_{\min}^2$, the compile fails. The compiler does not silently raise the penalty.
- `Q` is advisory input to a solver. The validator never trusts it: it re-checks decoded candidates against the original full-precision `FrozenScenario`.
- Worked toy: 4 requested draws, D4 on hold, 3 windows → 12 bits ($x_{i,t}$ for $i\in\{1,2,3\}$, $t\in\{1,2,3\}$, plus $z_1,z_2,z_3$). D4 is listed in the report as excluded.

## Energy

$$
E(x)=E_{\text{economic}}(x)+\sum_{c\in H}P_c\,g_c(x)+\sum_{s\in S}w_s\,f_s(x)
$$

Penalty floor so a constraint cannot be purchased with economic gain:

$$
P_c>\frac{\Delta E_{\max}}{v_{\min}^{2}}
$$

## The three encodings that actually fit DIBS

**Draw-window assignment** — binary $x_{i,t}=1$ if eligible draw $i$ sits in window $t$. One window or defer. Window liquidity $\sum_i a_i x_{i,t}\le L_t$. Tranche order is pairwise forbidden $(t,t')$. Hold-blocked and unverified-payee draws never get a bit.

**Concentration / SPV allocation** — the only naturally quadratic DIBS problem. Pairwise $y_s y_{s'}$ with shared-sponsor / shared-metro / shared-GC weights. This is the first experiment worth compiling.

**Reserve band** — do not put continuous cash on qubits. One-hot over $K$ discrete policy levels. Closing cash still counts settlement-confirmed draws only, same rule as Autopilot.

## Honest performance envelope

A DIBS pilot book is tens to low hundreds of binaries. CBC/HiGHS proves that class instantly. Published 2025–26 portfolio-QAOA bake-offs still have MIP solving thousand-asset instances to optimality in seconds while QAOA/annealing stall around a few dozen assets. There is no quantum-advantage claim available at this book size.

Near-term value of the lab is forcing a formal objective + constraint model of capital ops, then measuring:

- validator feasibility rate
- gap to MIP on accepted candidates only
- penalty sensitivity at $\pm 10\%$ / $\pm 25\%$ / $\pm 50\%$
- false-feasibles: cheap QUBO bitstrings that fail full-precision LTV / reserve / tranche checks

If the validator is not rejecting 100% of hard violations, the experiment failed — regardless of energy.

## What a first offline run looks like

Synthetic frozen book. No customer data. No QPU.

Four requested draws, three weeks. D4 is on hold, so it is excluded before compile (12 bits, not 16). Window caps \$500k / \$450k / \$600k. D2 must follow D1. MIP is the ground truth. QAOA $P=1$ on a simulator is a compiler-and-validator unit test.

Success is not "beat CBC." Success is: every infeasible bitstring dies at the validator, and any `CANDIDATE_VALIDATED` schedule is within a declared gap of the MIP economic optimum.

## Do not

- Unpark this in Sprints 0–6
- Wire `/v1/quantum-lab` into Autopilot runtime
- Send documents, keys, or PII to a quantum provider
- Confuse QLab (optimization research) with PQC (ML-KEM / ML-DSA). They share a word and nothing else
- Let a bitstring write capital state

Build the draw desk first. When a frozen book exists and the constraint model is boringly correct, compile the concentration QUBO and let the validator do the talking.
