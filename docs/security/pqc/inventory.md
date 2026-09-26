# Crypto inventory

Living list for P0 of the post-quantum blueprint. Blank means not yet recorded. Do not treat a blank as "not in use."

| Surface | Product / version | Algorithm | Notes |
|---|---|---|---|
| TLS terminator | | | Public API hostname |
| OIDC token signing | | | Privileged roles |
| Object-store SSE | | | Evidence documents |
| Webhook partner signatures | | | Escrow Factory and banks may stay classical through pilot |
| Code signing | | | |
| Audit event hash | SHA-256 chain (designed, not yet the production EventStore) | SHA-256 | `previous_event_hash`, `payload_hash`, `event_hash` |
| Audit signature, classical | | Ed25519 or ECDSA-P256 via KMS, when P0 signatures exist | Not a draw gate |
| Audit signature, post-quantum | | ML-DSA-65, high-value events only, P3 | Nullable until KMS can sign |

Policy id: `dibs-tls-2026.1` is reserved for the P2 handshake metric. It is not active until the terminator records `negotiated_group`.
