# Independent Validator Logic — DIBS Quantum Lab

**Status:** Architecture explanation. Offline research path only. The validator emits a signed review packet. It does not write Autopilot state.

The compiler asks: *is this a well-formed QUBO?*
The solver asks: *which bitstring is cheap in \(E(x)\)?*
The validator asks: *is that bitstring legal in the frozen book, in real money?*

Those are different predicates. Cheap in \(Q\) is not a pass.

```text
qubo_artifact + bitstring + frozen scenario
  → bind identities
  → decode via symbol table
  → drop ancillas
  → reconstruct domain schedule
  → replay minor-unit cash
  → hard checks
  → declared stress set
  → sign verdict
```

Canonical source: Complete Scaffold §23.4.

---

## 1. Why it exists

Penalty QUBOs leak. A too-small \(P_c\), a rounding scale, a missed forbidden pair, or a slack that cannot reach the residual will all produce bitstrings that look cheap in \(E(x)\) and illegal in the book.

The validator is the fail-closed inverse of the compiler:

- It does not trust \(Q\), \(E_0\), \(\langle H_C\rangle\), or the solver’s “energy.”
- It reloads the **original frozen scenario** in integer minor units.
- It recomputes budget, retainage, liquidity, LTV, reserve, concentration, and tranche order from that snapshot.
- Any hard fail rejects the candidate.
- A validated candidate is a **review packet**, not an authorization.

If DIBS and a partner later disagree on a live deal, Autopilot holds. The lab is not a tie-breaker.

---

## 2. What it is allowed to see

```text
experiment_id
qubo_artifact            # Q, E0, symbol table, scales, hashes
bitstring                # measured x in {0,1}^n, compiler bit order
frozen_scenario          # original minor-unit book
classical_baseline       # MIP assignment + objective, same freeze
penalty_policy_id
locked_policy_version
locked_evidence_manifest_hash
validator_version
```

It is not allowed to see live tenant keys, PII, raw evidence bytes, settlement credentials, or an unfrozen policy version. It never calls a payment partner.

---

## 3. Pass order (fail-closed)

Stop and return `REQUIRES_REMODELING` before decode if the identities do not bind. After bind, run **every** check and collect `checks[]`. Do not hide later failures behind the first one.

### Pass 0 — Bind

All of these must match. One miss and the job does not decode.

```text
artifact.scenario_freeze_hash     == freeze.hash
artifact.symbol_table_hash        == table.hash
artifact.locked_policy_version    == freeze.locked_policy_version
artifact.penalty_policy_id        == declared penalty policy
artifact.encoding_version         == validator-supported version
artifact.money_scale              reconstructible to integer minor units
```

Missing freeze, missing table, cubic leftover, uncalibrated penalty, or a non-fixed-point money path: `REQUIRES_REMODELING`. The IR or compiler is wrong. Do not blame the bitstring.

### Pass 1 — Decode

```text
len(bitstring) == len(symbol_table)
every 1-bit maps to a named symbol
no unknown index
```

Failures: `BITSTRING_LENGTH_MISMATCH`, `UNKNOWN_SYMBOL`.

Map \(z\to x\) only if the solver returned spins. Frozen map is the same as the compiler:

$$
x_i=\frac{1-z_i}{2}\qquad z_i\in\{-1,+1\}
$$

Record both the raw string and the decoded \(x\) in the report. Q-energy may be recomputed as a diagnostic from \(x^{\top}Qx+E_0\). It is never a predicate.

### Pass 2 — Drop ancillas

Slack bits, Rosenberg ancillas, and other compiler-owned variables are **not** domain objects. Drop them after using them only to confirm the slack encoding was wide enough.

If a slack range cannot represent the residual the equality claimed to enforce, that is `SLACK_RANGE_INSUFFICIENT` → `REQUIRES_REMODELING`, not a candidate reject.

### Pass 3 — Reconstruct the schedule

From the remaining bits, build only DIBS objects:

```text
scheduled draws {i → window t}
deferred draws
chosen reserve band
chosen SPV / sponsor slices
```

One-hot / cardinality is checked here on the bits themselves (`ONE_HOT_VIOLATION`, `CARDINALITY_VIOLATION`) and again on the reconstructed objects so a symbol-table bug cannot sneak through.

### Pass 4 — Re-apply pre-filter

Do not trust the compiler’s claim that ineligible draws have no bits.

If any reconstructed draw is hold-blocked, unverified, sanctioned, document-stale, or settlement-unavailable on the frozen snapshot:

- If the compiler **allocated a bit** for it → `INELIGIBLE_BIT_ALLOCATED` / `LEGAL_OR_COMPLIANCE_PRESENT` → `REQUIRES_REMODELING` (compiler bug)
- If the bitstring somehow names it without a symbol → `UNKNOWN_SYMBOL` → `REJECTED`

Legal and compliance disqualifiers were supposed to be excluded before QUBO compile. Seeing them here means the toolchain is wrong, not that QAOA found a clever schedule.

### Pass 5 — Replay money

All cash in integer minor units. Rates and LTV in basis points. No IEEE float on a verdict path.

`ApprovedFacilityDraws` counts **settlement-confirmed** amounts only. Instructed-but-unconfirmed stays on the instruction register and does not satisfy reserve.

For period \(\tau\):

$$
\begin{aligned}
\text{ClosingCash}_{\tau}
&=
\text{OpeningCash}_{\tau}
+\text{CommittedInflows}_{\tau}
+\text{ConfirmedFacilityDraws}_{\tau}
-\text{ScheduledOutflows}_{\tau}
-\text{RequiredReserves}_{\tau}
\end{aligned}
$$

Window budget:

$$
\sum_{i:\,t(i)=t}a_i \le L_t
$$

Retainage, change orders, and already-confirmed draws are taken from the freeze, not from \(Q\) scales.

The economic objective used for gap-to-MIP is this replay, not \(E(x)\):

$$
J_{\text{replay}}=\sum_{i\text{ scheduled}}(-u_i+d_{i,t(i)})+\sum_{i\text{ deferred}}\delta_i
$$

in minor units.

### Pass 6 — Hard operational checks

Each check writes `{code, status, measured, limit, unit}` into `checks[]`.

| Code | Predicate |
|---|---|
| `BUDGET_EXCEEDED` | scheduled amount in window \(t\) \(> L_t\) |
| `LIQUIDITY_SHORT` | closing cash ladder breaks in any \(\tau\) |
| `RESERVE_BREACH` | \(\text{ClosingCash}_{\tau} < R_{\min}\) (or chosen band \(R_k\)) |
| `LTV_BREACH` | \(\text{OutstandingDebt}_s / \text{EligibleCollateral}_s > \text{PolicyLTV}_s\) |
| `CONCENTRATION_BREACH` | pairwise / cap exposure on sponsor, MSA, GC, SPV |
| `TRANCHE_ORDER_VIOLATION` | junior scheduled at or before senior |
| `UNVERIFIED_PAYEE` | reconstructed payee not verified on freeze |
| `OPEN_HOLD_PRESENT` | reconstructed draw has an open hold |
| `SETTLEMENT_UNAVAILABLE` | no live route on freeze |

Hard fail → candidate cannot be `CANDIDATE_VALIDATED`. Status is `FAIL`. Soft preferences (smoothness, inspector travel) are recorded as diagnostics with `SKIP` or a non-blocking note. They do not flip the verdict.

`SKIP` is allowed only when that constraint is **absent from the frozen catalog**. Skipping a catalogued hard check is itself a validator defect.

### Pass 7 — Declared stress set

The freeze names the stresses. Typical set:

```text
inspection slip +14 days
confirmation lag (instructed ≠ confirmed)
collateral haircut
inflow delay
one additional hold on the largest SPV
```

Each stress replays Pass 5–6 on a derived snapshot. `STRESS_FAIL` rejects the candidate. The lab is allowed to search breach-adjacent schedules; it is not allowed to promote one that dies under a named stress.

### Pass 8 — Gap to classical baseline

Optional metadata, not a capital rule:

$$
\text{gap}=\frac{J_{\text{replay}}-J_{\text{MIP}}}{\lvert J_{\text{MIP}}\rvert}
$$

A declared experiment may require \(\text{gap}\le\gamma\) before `CANDIDATE_VALIDATED`. That is a research acceptance bar. It is not an Autopilot approval threshold.

Q-energy is written next to the gap so a human can see “cheap in \(Q\), expensive or illegal in the book.” It still is not a predicate.

### Pass 9 — Sign

Hash the payload. Sign with the validator key. Verdict is one of:

```text
CANDIDATE_VALIDATED
REJECTED
REQUIRES_REMODELING
```

`CANDIDATE_VALIDATED` is an input to `REVIEW_PACKET_ISSUED`. It is not `APPROVED`, not a waiver, and not a settlement instruction.

---

## 4. Verdict meanings

| Verdict | Means | Typical cause |
|---|---|---|
| `CANDIDATE_VALIDATED` | decoded schedule survives full-precision hard checks + stress | solver found something the MIP already knew, or a near-MIP feasible |
| `REJECTED` | IR is coherent; this bitstring is illegal | weak \(P_c\), sampler noise, one-hot break |
| `REQUIRES_REMODELING` | toolchain cannot be trusted on this freeze | hash mismatch, ineligible bit allocated, slack too narrow, uncalibrated penalty |

Do not “fix” a `REQUIRES_REMODELING` by raising \(P_c\) on the same artifact. Recompile. New `penalty_policy_id`. New artifact hash.

Historical reports are append-only. A later run that accepts the same bitstring is a new event, not an edit.

---

## 5. Signed report

```text
experiment_id
scenario_freeze_hash
compile_artifact_hash
penalty_policy_id
locked_policy_version
bitstring
decoded_schedule          # domain objects only; slacks omitted
classical_baseline_objective_minor
candidate_economic_objective_minor    # from replay
q_energy                  # diagnostic only
checks[]                  # code, PASS|FAIL|SKIP, measured, limit, unit
stress[]
verdict
validator_version
occurred_at               # UTC
payload_hash
signature_algorithm
signature_key_id
signature
```

This object’s type is not an input of `CreateDrawRequest`, `ApproveDraw`, `CreateWaiver`, or `CreateSettlementInstruction`. Promotion, if any, is to a versioned **policy simulation** after multi-role review.

---

## 6. Worked toy — same book as the compiler

Two eligible draws, one window. Amounts \(180\) and \(150\). Window cap \(300\). Economic minimize \(-5x_1-3x_2\). Compiler used a slack equality and some \(P_c\).

MIP baseline: schedule only draw 1. Replay objective \(J_{\text{MIP}}=-5\). Used \(=180\le 300\).

### Bitstring A — legal

\(x=(1,0,\ldots)\). Replay: used \(=180\), reserve holds, no tranche issue.

```text
BUDGET_EXCEEDED        PASS   measured=180  limit=300  unit=minor
RESERVE_BREACH         PASS
TRANCHE_ORDER          SKIP   (not in this catalog)
q_energy               -5     diagnostic
J_replay               -5
verdict                CANDIDATE_VALIDATED
```

### Bitstring B — Q-cheap, book-illegal

Both on. A weak \(P_c\) or a scale bug can make \(E(x)\) look attractive. Replay:

$$
180+150=330>300
$$

```text
BUDGET_EXCEEDED        FAIL   measured=330  limit=300  unit=minor
q_energy               -8     or whatever Q said — ignored
J_replay               -8     recorded, not used to pass
verdict                REJECTED
```

That is the validator earning its keep. The solver optimized \(Q\). The validator enforced the cap the book actually has.

### Bitstring C — compiler bug

A third bit decodes as draw D4, which the freeze marks `HELD`.

```text
LEGAL_OR_COMPLIANCE_PRESENT   FAIL
INELIGIBLE_BIT_ALLOCATED      FAIL
verdict                       REQUIRES_REMODELING
```

Do not send this to a human as a schedule. Send it to whoever owns the compiler.

### Bitstring D — \(Q\) never saw LTV

Both draws fit the window. \(Q\) has no LTV term. Solver returns fund-both; \(E(x)\) is the economic optimum.

Replay on the freeze: outstanding debt including both draws over eligible collateral exceeds `PolicyLTV`.

```text
BUDGET_EXCEEDED        PASS   measured=330  limit=400
LTV_BREACH             FAIL   measured=7600 bps  limit=7000 bps
q_energy               -8     diagnostic
verdict                REJECTED
```

Independence is this case. The matrix cannot certify a constraint it was never given. The validator still can.

---

## 7. Arithmetic contract

```text
cash, amounts, budgets, reserves     integer minor units
LTV, rates                           integer basis points
timestamps                           UTC
no IEEE float on verdict arithmetic
ClosingCash uses SETTLEMENT_CONFIRMED inflows only
```

If the only available money path is a float, the validator does not decode. `MONEY_SCALE_MISMATCH` → `REQUIRES_REMODELING`.

---

## 8. What the validator must never do

```text
treat Q-energy as cash or as a pass
auto-reconcile a mismatch
create or approve a DrawRequest
create a waiver
write a settlement instruction
mutate locked_policy_version
load live (unfrozen) book data
send payload to a quantum provider
stop at the first check when later checks would also fail
overwrite a prior report
```

A failed hard constraint blocks the candidate. There is no “almost.”

---

## 9. Where it sits in the experiment machine

```text
QAOA_RUN_COMPLETE
  → validator
      CANDIDATE_VALIDATED → REVIEW_PACKET_ISSUED
      REJECTED            → stays in QAOA_RUN_COMPLETE / recorded reject
      REQUIRES_REMODELING → REQUIRES_REMODELING
```

Human review reads the packet. Multi-role review may approve a **simulation**, not a draw. Autopilot remains the only write path to capital state.

---

## 10. One-sentence contract

Decode the bitstring, throw away the ancillas, replay the schedule on the frozen book in minor units, fail closed on any hard break, sign the packet, and never let \(x^{\top}Qx\) touch a dollar or a draw.
