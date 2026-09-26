# Post-Quantum Cryptography — Implementation Blueprint

**Status:** Track B implementation blueprint. Not a draw dependency. Not a crypto-library product.

Companion to `DIBS-PQC-Investigation.md`. Official architecture:

```text
PQC (ML-KEM / ML-DSA) is Track B. Do not block Autopilot on it.
```

PQC ≠ QLab. This blueprint never shares a sprint number with Autopilot or with `packages/quantum-lab`.

Do **not** create `packages/pqc` this quarter. PQC lives in:

```text
infra / TLS terminator     X25519MLKEM768
AuditEvent columns         optional ML-DSA-65 on high-value rows
KMS / HSM                  vendor-managed keys
docs/security/pqc          policy + inventory
```

---

## 0. Preconditions

Same as Autopilot security minimum. If these are false, there is nothing to wrap.

```text
[ ] TLS 1.3 on every public endpoint
[ ] OIDC + MFA for privileged roles
[ ] KMS-backed secrets; no keys in git or logs
[ ] AuditEvent hash chain designed (previous_event_hash, payload_hash)
[ ] EventStore persistence plan (Postgres append-only)
[ ] Crypto inventory started (where RSA/ECDSA/ECDH still appear)
```

P0 below *is* that list. Hybrid ML-KEM is P1.

---

## 1. Isolation from Autopilot

```text
approvalFailures()     must not mention TLS group or ML-DSA
DrawRequest states     must not wait on PQC
QLab process           must not implement PQC
partner webhooks       may stay classical through pilot
```

A missing post-quantum primitive is an infra ticket. It is not `HELD`.

---

## 2. Target crypto policy (frozen from the investigation)

```text
kex_preferred          X25519MLKEM768
kex_fallback           X25519
record                 AES-256-GCM
hash                   SHA-256 or SHA-384
audit_hash             SHA-256 chain
audit_sig_classical    Ed25519 or ECDSA-P256 via KMS
audit_sig_pq           ML-DSA-65 on high-value events only
kem_param              ML-KEM-768
dsa_param              ML-DSA-65
implementations        vendor TLS + KMS/HSM
never                  homemade combiner, log KEM CT, block a draw
```

Do not wait for FN-DSA (FIPS 206) or HQC.

---

## 3. Phases (P-numbers, not Autopilot sprints)

### P0 — Classical security that PQC will sit on

**Where:** Autopilot Track A. This is not optional and is not “PQC work.”

```text
TLS 1.3 + AES-256-GCM everywhere
KMS for application secrets
SHA-256 AuditEvent chain in Postgres
append-only; event written before draw row change
no private keys, tokens, or PII in logs
crypto inventory spreadsheet:
  TLS terminator product + version
  OIDC token signing alg
  object-store SSE
  webhook partner algs
  code-signing alg
```

**Exit**

- Inventory exists
- Hash chain verifies in a test
- `curl --tlsv1.3` succeeds on the API hostname

Without P0, P1 is a toggle on a stack you do not understand.

### P1 — Hybrid TLS at the terminator

**Where:** infra, CDN, load balancer, or mesh. **Not** Nest/Fastify.

Preferred order of places to turn it on:

1. Edge / CDN already offering `X25519MLKEM768` (Cloudflare, many current Chrome-facing edges)
2. Managed load balancer TLS policy that lists the named group
3. Sidecar (Envoy / AWS s2n / nginx+OpenSSL 3.5) only if 1–2 cannot

**Do**

```text
prefer X25519MLKEM768
keep X25519 fallback
TLS 1.3 only
record negotiated group in terminator metrics (not in app logs with secrets)
```

**Do not**

```text
terminate TLS inside the API process just to get ML-KEM
write a DIBS KEM
disable fallback and break old partners
put "pq_handshake=false" into approvalFailures()
```

**Exit**

- `openssl s_client -groups X25519MLKEM768` (or equivalent) negotiates hybrid to the public hostname
- Fallback X25519 still works
- No application diff in `backend/workflow/draw-request.ts`

If the current managed terminator cannot offer the group, **wait**. File a vendor ticket. That is the whole of P1 until the platform catches up.

### P2 — Telemetry and crypto-policy id

**Where:** TLS access logs + a small `crypto_policy` row, not a new package.

Record on the connection (terminator or mesh access log):

```text
occurred_at
endpoint
tls_version
negotiated_group          # e.g. X25519MLKEM768
cipher
crypto_policy_id          # dibs-tls-2026.1
```

Never record: keys, KEM ciphertexts, traffic secrets, session tickets, client certs, tokens, payloads, PII.

**Exit**

- One dashboard number: share of handshakes that used `X25519MLKEM768`
- Policy id is pinned so a later change is an explicit version bump

### P3 — Dual-sign high-value audit events

**Where:** EventStore after it is on Postgres. Live code today is hash-only (`payload_hash`, `previous_event_hash`, `event_hash`). Dual-sign columns are added here; they are not required to `RECONCILE`.

Do not invent a parallel ledger. Add nullable columns:

```text
signature_algorithm_pq      nullable  # "ML-DSA-65"
signature_key_id_pq         nullable
signature_pq                nullable  bytea
```

Sign only after the hash chain is real:

```text
APPROVED
SETTLEMENT_INSTRUCTED
SETTLEMENT_CONFIRMED
RECONCILED
waiver approve / expire / revoke
privilege escalation
crypto-policy change
```

Flow:

```text
canonical payload
  → payload_hash
  → KMS classical sign
  → KMS / HSM ML-DSA-65 sign
  → store both
  → verify both on read of those event types
```

If the KMS you already use cannot sign ML-DSA-65, **do not** vendor a second HSM just for P3. Keep classical signatures and reopen P3 when the existing KMS can.

Do not ML-DSA every `Notification`.

**Exit**

- High-value event verifies under both algorithms
- Classical-only events from P0 still verify
- Draw path unchanged
- Missing PQ signature on a *new* high-value event is an ops alert, not a HOLD

### P4 — Partner webhooks (optional, negotiated)

When Escrow Factory (or bank) offers ML-DSA or a composite cert:

```text
add a verifier adapter
keep accepting the current classical signature
never require PQ from a partner that cannot issue it
```

Not a pilot blocker.

---

## 4. What to put in the repo (and what not to)

**Add**

```text
docs/security/pqc/
  README.md                         # this policy + phases
  inventory.md                      # living list of algs in use
infra/tls/
  notes on terminator setting       # not a custom KEM
migrations/
  audit_event_pq_columns.sql        # only when P3 starts
```

**Do not add**

```text
packages/pqc/
packages/pqc/src/mlkem.ts
backend/workflow/pqc-gate.ts
approvalFailures() case "PQ_HANDSHAKE_REQUIRED"
quantum-lab importing ML-KEM
```

Application code in P3 is: two extra columns, a signer called from the existing EventStore append path, a verifier in audit read. That is tens of lines once KMS supports the alg — not a product.

---

## 5. Tests

```text
P0  hash chain verifies; UPDATE/DELETE on audit_event fails
P1  hybrid group negotiates; X25519 fallback still works
    draw-request unit tests unchanged
P2  access log fixture contains negotiated_group and no secrets
P3  high-value event verifies dual-sig
    classical-only historical event still verifies
    approvalFailures() snapshot does not contain PQC codes
```

A PQC merge that changes `ALLOWED_TRANSITIONS` is rejected.

---

## 6. Staffing and sequence

```text
Now     Autopilot EventStore on Postgres (P0, Track A)
When boring   tick X25519MLKEM768 on the edge (P1, infra)
After hash chain is real and KMS can ML-DSA   P3
Never first hire: PQC specialist
Never same sprint as QLab L3
```

Same full-stack engineer can do P1 as a terminator config change. P3 waits on vendor KMS, not on a new person.

---

## 7. Definition of done for “PQC is implemented”

Not “we wrote Kyber.” This:

```text
Public Autopilot hostname prefers X25519MLKEM768
Fallback X25519 still works
Handshake share is visible without secrets
High-value audit rows dual-sign when KMS allows
No draw can be HELD for a missing PQ primitive
packages/pqc still does not exist
```

---

## 8. One-sentence contract

Turn on vendor hybrid TLS when the terminator already speaks it; dual-sign long-lived audit events after the hash chain is real; keep AES-256 and SHA-256; never let a missing ML-KEM or ML-DSA stop a legal draw.
