# QUBO Compiler Mechanics — DIBS Quantum Lab

**Status:** Architecture explanation. Offline research path only. The compiler does not touch Autopilot write paths.

The compiler is the step between a **frozen scenario** and a **matrix a solver can sample**. It does not decide a schedule. It does not certify money. Those are the classical baseline and the independent validator.

```text
frozen IR
  → pre-filter (legal / KYC / holds)
  → name binary variables
  → compile objective
  → compile constraints (penalty / slack / one-hot)
  → reduce degree > 2
  → calibrate P_c
  → scale / normalize
  → assemble Q
  → map Ising
  → emit versioned artifact
```

---

## 1. Target form

A QUBO is an unconstrained problem over bits \(x\in\{0,1\}^n\):

$$
\min_x\; E(x)=x^{\top}Qx+c^{\top}x+E_0
$$

Because \(x_i^2=x_i\), linear terms fold onto the diagonal. The compiler emits one **symmetric** matrix \(Q\) and a constant \(E_0\):

$$
E(x)=x^{\top}Qx+E_0
$$

Frozen convention: for a pairwise monomial with coefficient \(\alpha\) on \(x_ix_j\) (\(i\neq j\)), store \(Q_{ij}=Q_{ji}=\alpha/2\), so that the two off-diagonal contributions reconstruct \(\alpha x_ix_j\). For a squared linear form \(P(a^{\top}x-b)^2\), that means \(Q_{ij}=Q_{ji}=P\,a_ia_j\).

Do not mix this with an upper-triangle store where \(Q_{ij}\) already holds the full \(\alpha\). The artifact records `q_layout = symmetric_xTQx`.

QAOA does not eat \(Q\) directly. It eats an Ising Hamiltonian on spins \(z_i\in\{-1,+1\}\). Frozen map:

$$
z_i=1-2x_i\qquad\Longleftrightarrow\qquad x_i=\frac{1-z_i}{2}
$$

so \(x=0\mapsto z=+1\) and \(x=1\mapsto z=-1\). Do not mix with \(x=(1+z)/2\) in the same artifact.

Substitute, collect \(\sum_i h_i z_i+\sum_{i<j}J_{ij}z_iz_j\), and the cost Hamiltonian is

$$
H_C=\sum_i h_i Z_i+\sum_{i<j}J_{ij}Z_iZ_j
$$

plus an ignored global energy shift. The compiler’s last job is this substitution, with enough metadata that the validator can decode a measured bitstring back into \(x\), not \(z\). Mixer \(H_M\) is not the compiler’s job on the default penalty-X path.

---

## 2. Inputs the compiler is allowed to see

A frozen, de-identified intermediate representation. Not live Autopilot tables.

```text
scenario_id
policy_version_frozen
manifest_hash_frozen
draws[]          # only candidates that survived pre-filter
  id, amount_minor, spv_id, sponsor_id, tranche, window_eligibility[]
windows[]
  id, liquidity_cap_minor
precedence[]     # (before, after)
concentration_pairs[]
  left, right, weight
reserve_bands[]  # optional one-hot levels
soft_weights[]   # delay, idle cash, smoothness
penalty_policy_id
encoding_version
```

Amounts are integer minor units. The compiler may *scale* them for numeric stability. It may not change their meaning. The validator always replays on the unscaled integers.

Pre-filter happens **before** this IR is accepted:

```text
sanctions hit          → no variable
KYC/AML stale          → no variable
docs missing/expired   → no variable
open hold              → no variable
unverified payee       → no variable
settlement route dead  → no variable
```

If a draw is not legally instructable, it has no bit. The compiler must refuse to invent one.

---

## 3. Variable construction

Every decision the model is allowed to make becomes one or more bits.

| Business object | Encoding | Bits |
|---|---|---|
| Draw \(i\) in window \(t\) | \(x_{i,t}\) | \(\lvert I\rvert\cdot\lvert T\rvert\) |
| Draw deferred | \(z_i\) slack window, or extra \(t=\bot\) | \(\lvert I\rvert\) |
| SPV / sponsor slice | \(y_s\) | \(\lvert S\rvert\) |
| Reserve band \(k\) | one-hot \(r_k\) | \(K\) |
| Integer slack \(s\in\{0,\ldots,S_{\max}\}\) | binary expansion | \(\lceil\log_2(S_{\max}+1)\rceil\) |
| Integer amount slice | binary expansion | same |

Naming is part of the artifact. A bitstring with no symbol table is not decodable, and therefore not valid lab output.

Cardinality patterns to prefer:

- *At most one window per draw:* \(\sum_t x_{i,t}+z_i=1\)
- *Exactly one reserve band:* \(\sum_k r_k=1\)
- *Integer slack:* \(s=\sum_{b=0}^{B-1}2^b s_b\)

Binary expansion of a large slack is the usual bit explosion. If \(S_{\max}\) is the full window cap in cents, you have just spent 20 bits on one inequality. The compiler should cap slacks at the residual capacity after pre-placing known confirmed outflows, or encode the inequality as a penalty on the raw overflow instead of an explicit slack.

---

## 4. Objective compilation

Start with the economic piece only.

Draw-window example:

$$
E_{\text{economic}}=-\sum_{i,t}u_ix_{i,t}+\sum_{i,t}d_{i,t}x_{i,t}+\sum_i\delta_iz_i
$$

- \(u_i\) — value of funding \(i\) this horizon (unused commitment cost avoided)
- \(d_{i,t}\) — delay / idle-cash cost of putting \(i\) in \(t\)
- \(\delta_i\) — cost of leaving \(i\) unscheduled

These are linear. They become diagonal entries of \(Q\):

$$
Q_{x_{i,t},x_{i,t}} \mathrel{+}= -u_i+d_{i,t}
$$

Concentration is already quadratic and needs no gadget:

$$
E_{\text{conc}}=\sum_t\sum_{i<j}c_{ij}x_{i,t}x_{j,t}
$$

$$
Q_{x_{i,t},x_{j,t}} \mathrel{+}= c_{ij}
$$

That pairwise term is why this problem is a QUBO at all. Linear scheduling plus linear caps is an MIP; the compiler exists because concentration and crowding couple pairs.

Soft preferences (smooth weekly volume, inspector load) land in \(\sum_s w_s f_s(x)\) with small \(w_s\). They must not be large enough to overpower a hard penalty. That is a calibration problem, not a modeling preference.

---

## 5. Constraint compilation

QUBO has no native constraints. Every constraint is either:

1. **Deleted** — pre-filter, variable pruning, infeasible-pair removal
2. **Embedded** — the mixer / initial state only prepares feasible subspace (XY, Dicke). Research option. Not the default compiler path.
3. **Penalized** — add \(P\cdot g(x)\) with \(g(x)=0\) on the feasible set and \(g(x)\ge v_{\min}^2>0\) off it

Default DIBS compiler path is (1) then (3). The validator is the backstop for (3) being leaky.

### Equality: \(a^{\top}x=b\)

$$
g(x)=(a^{\top}x-b)^2=x^{\top}(aa^{\top})x-2b\,a^{\top}x+b^2
$$

This expands to a dense quadratic block among the variables that share the equality. One-hot is the special case \(a=\mathbf{1}\), \(b=1\):

$$
g_{\text{card},i}(x)=\Bigl(\sum_t x_{i,t}+z_i-1\Bigr)^2
$$

Expansion for three windows plus deferral:

$$
\begin{aligned}
g
&= \sum_t x_{i,t}+\sum_{t<t'}2x_{i,t}x_{i,t'}
 + 2z_i\sum_t x_{i,t}+z_i
 -2\sum_t x_{i,t}-2z_i+1
\end{aligned}
$$

After \(x^2=x\): diagonal gets \(1-2= -1\) on each bit, every pair gets \(+2\), constant \(+1\). Multiply by \(P_{\text{card}}\) and add into \(Q\).

### Inequality: \(a^{\top}x\le b\)

Two encodings.

**Overflow penalty, no slack.** Let \(v=\max(0,a^{\top}x-b)\). Directly \(v^2\) is not polynomial in the bits. The polynomial stand-in is \((a^{\top}x-b)^2\) *only if* \(a^{\top}x\ge b\) is the side you want to punish and undershoot is free — which it is not, for a cap. The honest polynomial for a one-sided cap without slack is not \((a^{\top}x-b)^2\); that also punishes undershoot. Use slack, or use a penalty that is quadratic in the positive part via extra bits.

**Slack.** Introduce integer \(s\ge 0\) with \(a^{\top}x+s=b\), then square:

$$
g_{\text{bud},t}=\Bigl(\sum_i a_i x_{i,t}+s_t-L_t\Bigr)^2
$$

\(s_t=\sum_b 2^b s_{t,b}\). This is exact when \(s_t\) can reach every residual. It is the bit-costly option.

**Prune.** If \(a_i>L_t\), delete \(x_{i,t}\) from the variable set. D1 at \(\$400{,}000\) cannot sit in a \(\$350{,}000\) window. That is compilation, not search.

### Precedence: draw \(i\) before draw \(j\)

Do not encode “time indices” as integers on qubits. Enumerate forbidden pairs and penalize them:

$$
g_{\text{tr}}=\sum_{t'\ge t}x_{j,t}\,x_{i,t'}
\quad\text{(j in the same window as i, or an earlier one)}
$$

Each forbidden pair is already quadratic. \(P_{\text{tr}}\) on those \(Q\) entries. If both may be deferred, do not penalize \((z_i,z_j)\).

### Hard legal constraints

Not compiled. If they appear in the IR, the compiler **rejects the job** with `REQUIRES_REMODELING`. Putting a sanctions bit into \(Q\) with a large \(P\) is how a mis-scaled energy “discovers” that violating sanctions is cheaper than delaying a draw.

---

## 6. Degree reduction

A product of three or more bits is a PUBO/HOBO, not a QUBO. Rosenberg reduction:

$$
x_a x_b x_c \;\;=\;\; x_w x_c + P_w(x_w-x_a x_b)^2
$$

with ancilla \(x_w\) meant to equal \(x_a x_b\). The penalty

$$
(x_w-x_a x_b)^2=x_w+x_a x_b-2x_w x_a x_b
$$

still contains a cubic. The standard substitution uses the quadratic identity

$$
x_a x_b = x_w \quad\text{enforced by}\quad P_w(x_a x_b-2x_w x_a-2x_w x_b+3x_w)
$$

(or any of the equivalent quadratizations). Each reduction adds an ancilla and a penalty that must itself sit above \(\Delta E_{\max}\). Nested reductions are how a “small” scheduling model quietly becomes a large one.

DIBS default: keep the IR quadratic. Precedence as pairwise forbidden pairs, concentration as pairwise \(c_{ij}\), cardinality as squared one-hots. If a model needs a cubic, the compiler should refuse and ask for a rewrite before it starts minting ancillas.

---

## 7. Penalty calibration

Complete Scaffold rule:

$$
P_c>\frac{\Delta E_{\max}}{v_{\min}^{2}}
$$

- \(\Delta E_{\max}\) — best economic improvement available by violating \(c\)
- \(v_{\min}\) — smallest nonzero value \(g_c\) can take in the encoding

For a one-hot, \(v_{\min}^2=1\) (two bits on, or none on). For a budget in minor units without scaling, \(v_{\min}\) is one cent and \(P_c\) becomes enormous next to \(u_i\) in dollars. That is why the compiler scales.

Procedure the spec already names:

```text
Normalize objectives
Solve small instances exactly (MIP)
Test a penalty grid
Measure feasibility rate
Measure gap to classical optimum
Run ±10%, ±25%, ±50% sensitivity
Rescale for the target simulator
Freeze a versioned penalty policy
```

A penalty policy is an artifact: `penalty_policy_id` pinned on the QUBO. Changing \(P_c\) after a run without a new compile is a silent model change and is forbidden.

If the grid cannot find a region where the validator feasibility rate is > 0 and the accepted gap is finite, the output is `REQUIRES_REMODELING`, not a bitstring.

---

## 8. Scaling and numeric hygiene

Three different numbers exist for the same amount:

| Layer | Unit | Who trusts it |
|---|---|---|
| Frozen IR | integer minor units | validator, Autopilot |
| Compiler working copy | scaled rationals / fixed-point | compiler only |
| Q / h / J | dimensionless O(1) | QAOA / annealer |

Typical scale:

$$
\tilde a_i=\frac{a_i}{A},\qquad A=\max_i a_i
$$

Budget cap becomes \(\tilde L_t=L_t/A\). Economic weights are divided by \(\max\lvert u_i\rvert\) so \(E_{\text{economic}}\) lives in roughly \([-1,1]\) before penalties. Penalties are then set in *that* unit system.

The artifact stores \(A\), the rounding mode, and the inverse map. QAOA energy is not money. Reading \(\langle H_C\rangle\) as dollars is a defect.

No IEEE float is the source of truth for a validator verdict. Compiler floats are an internal convenience and must be reconstructed from stored scale factors.

---

## 9. Assembling \(Q\)

Pseudocode of the actual mechanics:

```text
allocate n bits, symbol table Σ
Q ← 0_{n×n}, E0 ← 0

for each linear objective term w · x_p:
    Q[p,p] += w

for each pairwise objective term w · x_p x_q:    # p < q
    Q[p,q] += w/2
    Q[q,p] += w/2

for each constraint c with polynomial g_c and penalty P_c:
    expand g_c
    fold linear → diagonal
    fold pairs → Q[p,q]
    E0 += P_c * constant term of g_c

symmetrize if the solver wants Q+Qᵀ
record encoding_version, penalty_policy_id, scale A
emit Q, E0, Σ, Ising (h, J)
```

Sparsity matters. A global liquidity equality over all \(x_{i,t}\) densifies a block of size \(\lvert I\rvert\cdot\lvert T\rvert\). Local one-hots densify only the 4×4 block of a single draw. Report both density and bandwidth in the artifact; they dominate simulator cost, not the headline bit count.

---

## 10. Worked fragment — one draw, two windows

Draw D1, amount \(a=400\), windows \(T_1,T_2\) with caps \(500\) and \(350\). Delay costs \(d_1=0\), \(d_2=5\). Utility \(u=10\). Deferral cost \(\delta=8\).

**Prune.** \(400>350\), so \(x_{1,2}\) does not exist.

Bits: \(x_{1,1},\;z_1\).

Objective:

$$
E_{\text{economic}}=-10\,x_{1,1}+8z_1
$$

Cardinality \(x_{1,1}+z_1=1\):

$$
g=(x_{1,1}+z_1-1)^2= -x_{1,1}-z_1+2x_{1,1}z_1+1
$$

Budget on \(T_1\): \(400x_{1,1}\le 500\). After prune this is automatic. No slack bits.

Take \(P_{\text{card}}=20\) (larger than \(\Delta E_{\max}\approx 10+8\)). Symmetric \(Q\), \(E=x^{\top}Qx+E_0\):

$$
\begin{aligned}
Q_{x,x} &= -10 + 20(-1) = -30 \\
Q_{z,z} &= 8 + 20(-1) = -12 \\
Q_{x,z}=Q_{z,x} &= 20 \\
E_0 &= 20
\end{aligned}
$$

Check (\(E=Q_{xx}x+Q_{zz}z+2Q_{xz}xz+E_0\)):

| \(x,z\) | meaning | \(E\) | feasible? |
|---|---|---|---|
| 1,0 | schedule T1 | \(-30+20=-10\) | yes |
| 0,1 | defer | \(-12+20=8\) | yes |
| 1,1 | both | \(-30-12+40+20=18\) | no |
| 0,0 | neither | \(20\) | no |

Feasible states are the two lowest energies. That is what “the penalty worked” looks like on a matrix. The validator still recomputes \(400\le 500\) on the decoded schedule; it does not trust \(-10\).

Add a second eligible draw D3 at \(300\) into the same \(T_1\) and the budget is no longer automatic. Then either slack-expand \(s_1\) or put an overflow penalty on \(x_{1,1}x_{3,1}\). Pair D1+D3 in \(T_1\) is \(700>500\), so the compiler can also *prune the pair* by adding a forbidding coupling rather than a slack integer. Pair-pruning is cheaper than binary slacks and should be the first budget tactic.

### Numeric slack compile (2 draws, 1 window)

Variables \(x_1,x_2\) plus slack \(s=s_0+2s_1\in\{0,1,2,3\}\). Minimize \(-5x_1-3x_2\) subject to \(4x_1+3x_2\le 5\), i.e.

$$
4x_1+3x_2+s_0+2s_1=5,\qquad P=20
$$

(\(\Delta E_{\max}=8\), \(v_{\min}=1\), floor \(P>8\); \(20\) is safe.) Symmetric \(Q\) for bit order \((x_1,x_2,s_0,s_1)\):

$$
Q=\begin{bmatrix}
-485 & 240 & 80 & 160\\
240 & -423 & 60 & 120\\
80 & 60 & -180 & 40\\
160 & 120 & 40 & -320
\end{bmatrix},\qquad E_0=500
$$

Ground state \((1,0,1,0)\): \(E=-5\), used \(=4\), feasible. Next feasible \((0,1,0,1)\): \(E=-3\). Both-on infeasible: \(E=72\). The economic gain of \(3\) from taking \(x_2\) cannot buy the budget break. Slack bits are compiler ancillas, not DIBS domain objects.

---

## 11. What the compiler emits

A versioned artifact, not a schedule:

```text
qubo_artifact_id
scenario_id                  # frozen snapshot
encoding_version
penalty_policy_id
symbol_table                 # bit index → (draw, window, slack band, …)
Q                            # sparse
E0
scale_factors
ising_h, ising_J
pruned_variables             # why x_{1,2} does not exist
refused_constraints          # legal bits that were not encoded
classical_baseline_ref       # MIP energy / assignment
hash(artifact)
```

This artifact is an input to `QAOA_RUN` and to the validator. It is not an input type of `CreateDrawRequest`.

---

## 12. What the compiler must refuse

```text
a variable for a hold-blocked / unverified / sanctioned draw
a sanctions or KYC flag as a penalized bit
live policyVersion (must use the frozen id)
IEEE-float money as the recorded amount
PII, evidence bytes, tenant keys
an output type that Autopilot can consume as an approval
degree > 2 without an explicit rewrite request
P_c below the calibrated floor
a re-compile that silently edits penalty_policy_id
```

Refusal is `REQUIRES_REMODELING`. It is not “put a bigger penalty on it.”

---

## 13. Compiler vs solver vs validator

| Stage | Question | Source of truth |
|---|---|---|
| Compiler | Is this model a well-formed QUBO? | IR + encoding version |
| Solver (MIP / anneal / QAOA) | Which bitstring is cheap in \(E(x)\)? | \(Q\) |
| Validator | Is that bitstring legal in the real book? | original minor units, LTV, reserve, tranche, compliance |

Cheap in \(Q\) and legal in the book are different predicates. The whole point of the compiler’s isolation is that the second predicate cannot be optimized away.
