# Architecture Decision Records

Track A decisions for `dibs-trust-capital-network`.

Format: number, title, status, date, context, options, decision, consequences.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-dibs-is-the-control-plane.md) | DIBS is the control plane, not a bank | Accepted |
| [0002](0002-draw-request-is-the-aggregate.md) | DrawRequest is the capital aggregate | Accepted |
| [0003](0003-append-only-hashed-event-store.md) | Append-only SHA-256 event store | Accepted |
| [0004](0004-integer-minor-units.md) | Money is integer minor units | Accepted |
| [0005](0005-tenant-from-server-context.md) | Tenant comes from server context | Accepted |
| [0006](0006-segregation-of-duties.md) | Segregation of duties on approve vs instruct | Accepted |
| [0007](0007-policy-and-evidence-locks.md) | Policy version and evidence manifest lock at submit | Accepted |
| [0008](0008-settlement-is-recorded.md) | Settlement is recorded, not executed | Accepted |
| [0009](0009-park-non-mvp-surface.md) | Park non-MVP surface | Accepted |

New architecture change requires a new ADR or an update that marks the old one Superseded.
