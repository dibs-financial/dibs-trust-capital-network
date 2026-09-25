# `qubo_artifact` Structure — DIBS Quantum Lab

**Status:** Research schema. Not in the official repo. Derived from Complete Scaffold §23 and the compiler / validator contracts already frozen. Offline only. Not an Autopilot write type.

`qubo_artifact` is the compiler’s emit and the validator’s bind object.

```text
FrozenScenario + PenaltyPolicy + EncodingVersion
        → compiler
        → qubo_artifact
        → solver samples bitstrings
        → validator binds artifact + freeze + bitstring
        → ValidatorReport
```

It is a versioned snapshot of *a model*, not a schedule and not cash.

---

## 1. Envelope

```text
qubo_artifact_id            uuid
schema_version              "qlab.qubo_artifact.v1"
artifact_version            "qubo_artifact/v1"
experiment_id               nullable
created_at                  UTC
compiler_version            string
encoding_version            string
idempotency_key             string
q_layout                    "symmetric_xTQx"
ising_map                   "z = 1 - 2x"
payload_hash                hex
signature_key_id            optional
signature                   optional
```

`schema_version` pins this document. `encoding_version` pins how symbols and slacks were built. Changing either requires a new artifact id.

`q_layout` and `ising_map` are literals, not comments. A consumer that disagrees must refuse the file.

---

## 2. Identity bindings (required)

These are how the validator knows it is looking at the same book the compiler saw.

```text
scenario_id
scenario_freeze_hash
locked_policy_version
locked_evidence_manifest_hash
penalty_policy_id
penalty_policy_hash
classical_baseline_id
classical_baseline_hash
symbol_table_hash
```

Bind rule: if any hash disagrees with the freeze the validator loaded, verdict is `REQUIRES_REMODELING`. Do not sample. Do not decode.

No live `policyVersion`. The only policy id on this object is the frozen one.

---

## 3. Symbol table (required)

Ordered list. Bit index `0..n-1` is the only coordinate system \(Q\) and the bitstring share.

```text
n                           integer
symbols[]
  index                     0..n-1
  name                      string          # "x[D1,T1]", "z[D1]", "s[T1,b0]"
  kind                      decision | deferral | slack | ancilla
  role                      draw_window | reserve_band
                            | spv_slice | slack_bit | rosenberg_ancilla
  draw_id                   nullable
  window_id                 nullable
  spv_id                    nullable
  band_id                   nullable
  slack_group               nullable        # "budget[T1]"
  slack_weight              nullable int    # 1, 2, 4, … for binary expansion
```

`kind=decision` or `kind=deferral` objects may appear in a decoded schedule.
`kind=slack` and `kind=ancilla` objects must be dropped before replay.

`symbol_table_hash` is a hash of the canonical JSON of `symbols[]` (sorted by index, no whitespace variance). The validator hashes the table it used and compares.

Groups the compiler tagged, so a later XY-mixer experiment can find them without guessing:

```text
one_hot_groups[]
  group_id
  indices[]                 # exactly-one or at-most-one
  cardinality               "exactly_one" | "at_most_one"

slack_groups[]
  group_id
  constraint_id             # "budget[T1]"
  indices[]
  max_value                 integer         # Σ weight_b
```

If a slack group’s `max_value` cannot cover the residual the equality claimed to enforce, that is a compile defect. The validator reports `SLACK_RANGE_INSUFFICIENT`.

---

## 4. \(Q\) payload (required)

Frozen convention from the compiler memo:

$$
E(x)=x^{\top}Qx+E_0
$$

\(Q\) is real symmetric. For a pairwise monomial \(\alpha\,x_ix_j\) (\(i\neq j\)), \(Q_{ij}=Q_{ji}=\alpha/2\). For \(P(a^{\top}x-b)^2\), \(Q_{ij}=Q_{ji}=P\,a_ia_j\).

```text
n                           same as symbol table
q_layout                    "symmetric_xTQx"
E0                          number
Q_format                    "diag_plus_coo"   # v1 store
Q_diag                      number[n]         # Q_ii
Q_offdiag[]
  i                         int               # i < j
  j                         int
  q                         number            # stored Q_ij = Q_ji
Q_dense                     optional, only if n ≤ 16 and debug=true
scale
  amount_divisor            integer         # A used to scale a_i / L_t
  objective_divisor         number
  rounding                  "nearest_even"
  reconstructed_unit        "minor_units"
coefficient_unit            "dimensionless"
density                     float           # diagnostic
bandwidth                   int             # diagnostic
```

v1 stores the diagonal plus COO off-diagonals with \(i<j\). Implied \(Q_{ji}=q\). Reconstruct a dense matrix only in memory. Do not ship dense \(Q\) except on tiny debug fixtures. Off-diag mismatch (both sides stored and unequal) is `REQUIRES_REMODELING`.

`coefficient_unit` is `dimensionless`. Raw dollars do not live in \(Q\). The validator reconstructs cash from the freeze + domain bits, using `amount_divisor` only to sanity-check that the compiler’s scale inverts.

Do not treat \(Q_{ii}\) as a dollar amount. Do not treat \(E_0\) as cash.

---

## 5. Ising image (optional, but recommended)

Same bits, frozen map:

$$
z_i=1-2x_i\qquad\Longleftrightarrow\qquad x_i=\frac{1-z_i}{2}
$$

```text
ising_map                   "z = 1 - 2x"
h[]                         length n
J_sparse[]
  i
  j                         # i < j
  value
energy_shift                number          # discarded by QAOA, kept for audit
```

If omitted, the solver or a helper derives \((h,J)\) from \(Q\) with the declared map. If present, the validator may re-derive and compare; disagreement is `REQUIRES_REMODELING`.

Mixer Hamiltonian is **not** part of this artifact. Penalty-X vs XY is a run setting, not a compile emit. QAOA parameters \((\gamma,\beta)\), shots, and sampled bitstrings live on the run record, not here.

---

## 6. Compile report (required)

Enough for a human or the validator to see what the compiler refused to encode.

```text
prefiltered_draws[]
  draw_id
  reason                    hold | unverified_payee | sanctions
                            | kyc | docs | settlement_unavailable

pruned_variables[]
  name
  reason                    amount_gt_window | infeasible_pair | domain_empty

pruned_pairs[]
  left_symbol
  right_symbol
  reason                    budget_pair | tranche_forbid

refused_constraints[]
  constraint_id
  reason                    legal_not_compiled | cubic_leftover
                            | uncalibrated_penalty

penalty_terms[]
  constraint_id
  P_c
  v_min2
  delta_E_max
  satisfied_floor           bool            # P_c > ΔE_max / v_min²

fixture
  solved_exactly            bool
  feasibility_rate          nullable
  gap_to_mip                nullable

warnings[]
```

Hard constraints the compiler did **not** put into \(Q\) must be listed so the validator knows to replay them:

```text
uncompiled_hard[]
  code                      LTV | RESERVE | CONCENTRATION | LEGAL
  reason                    validator_only | prefilter
```

LTV and reserve usually live here. Absence of a catalogued hard code from both `penalty_terms` and `uncompiled_hard` is a compile defect.

If `refused_constraints` or `dropped_prefilter` names a draw that later appears as a decision symbol, the validator’s `INELIGIBLE_BIT_ALLOCATED` path fires.

---

## 7. Hashes (required)

Canonical hash input is UTF-8 JSON with sorted keys, no insignificant whitespace, numbers in a fixed decimal form.

```text
scenario_freeze_hash        hash(freeze body)
symbol_table_hash           hash(symbols[])
penalty_policy_hash         hash(penalty policy body)
compile_report_hash         hash(compile_report without this field)
q_payload_hash              hash(n, q_layout, E0, Q terms, scale)
payload_hash                hash(everything except signature fields)
```

`payload_hash` is what a signature covers. Changing one \(Q_{ij}\) by an ulp must change it.

---

## 8. What must be absent

```text
customer PII
evidence bytes or storage URIs
tenant keys, KMS material, access tokens
live (unfrozen) policyVersion
DrawRequest / ApprovalDecision / Waiver / SettlementInstruction types
IEEE-float money used as the recorded amount
a field named approved, instruct, or release
quantum-provider account credentials
```

Presence of any of these makes the object not a `qubo_artifact`. Drop it. Do not hash it into the lab.

---

## 9. Minimal JSON shape

```json
{
  "qubo_artifact_id": "qa_01",
  "schema_version": "qlab.qubo_artifact.v1",
  "artifact_version": "qubo_artifact/v1",
  "created_at": "2026-09-25T06:00:00Z",
  "compiler_version": "qlab-compiler.0.1",
  "encoding_version": "draw-window.v1",
  "q_layout": "symmetric_xTQx",
  "ising_map": "z = 1 - 2x",
  "scenario_id": "scn_toy_2draw",
  "scenario_freeze_hash": "…",
  "locked_policy_version": "pol_7",
  "penalty_policy_id": "pp_20",
  "n": 4,
  "symbols": [
    {"index": 0, "name": "x1", "kind": "decision", "role": "draw_window", "draw_id": "D1"},
    {"index": 1, "name": "x2", "kind": "decision", "role": "draw_window", "draw_id": "D2"},
    {"index": 2, "name": "s0", "kind": "slack", "slack_group": "budget[T1]", "slack_weight": 1},
    {"index": 3, "name": "s1", "kind": "slack", "slack_group": "budget[T1]", "slack_weight": 2}
  ],
  "E0": 500,
  "Q_format": "diag_plus_coo",
  "Q_diag": [-485, -423, -180, -320],
  "Q_offdiag": [
    {"i": 0, "j": 1, "q": 240},
    {"i": 0, "j": 2, "q": 80},
    {"i": 0, "j": 3, "q": 160},
    {"i": 1, "j": 2, "q": 60},
    {"i": 1, "j": 3, "q": 120},
    {"i": 2, "j": 3, "q": 40}
  ],
  "uncompiled_hard": [
    {"code": "LTV", "reason": "validator_only"}
  ],
  "scale": {
    "amount_divisor": 1,
    "objective_divisor": 1,
    "rounding": "nearest_even",
    "reconstructed_unit": "minor_units"
  },
  "coefficient_unit": "dimensionless",
  "compile_report": {
    "prefiltered_draws": [],
    "pruned_variables": [],
    "penalty_terms": [
      {"constraint_id": "budget[T1]", "P_c": 20, "satisfied_floor": true}
    ]
  },
  "payload_hash": "…"
}
```

The numeric values above are the 2-draw slack compile from the compiler memo. They illustrate layout, not a live book.

---

## 10. How other objects use it

| Consumer | Reads | Must not do |
|---|---|---|
| QAOA / annealer / MIP-on-Q | \(Q\), \(E_0\), \(n\), optional \((h,J)\) | invent symbols |
| Independent validator | bindings, symbol table, freeze, domain bits | trust \(E(x)\) as cash |
| Experiment record | artifact id + hash | promote to a draw |
| Autopilot | nothing | ingest this type |

A bitstring produced against artifact \(A\) is meaningless against artifact \(A'\). The validator bind check exists so those cannot be swapped.

---

## 11. Versioning

- Additive optional fields: bump the patch note, keep `qlab.qubo_artifact.v1` if old consumers can ignore them.
- Change to `q_layout`, `ising_map`, symbol `kind` semantics, or hash canon: bump to `v2`. Old validators refuse `v1` files they no longer understand rather than guess.

There is no in-place edit. A new compile produces a new `qubo_artifact_id` and a new `payload_hash`.

---

## 12. One-sentence contract

`qubo_artifact` is a frozen, hash-bound encoding of a QUBO plus the map back to named DIBS bits — enough to sample and enough to replay, never enough to move capital.
