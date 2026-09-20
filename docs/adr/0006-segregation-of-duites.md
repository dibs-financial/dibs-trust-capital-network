# ADR-0006: Segregation of duties on approve vs instruct

- Status: Accepted
- Date: 2026-09-19
- Deciders: Track A

## Context

A single actor who requests, approves, and instructs can release funds to themselves. The prototype had one approver role.

## Options

1. One role can do every transition.
2. Split requester, approver, and instructor. Same person cannot hold two of those on one draw.
3. Maker-checker only (two people, any roles).

## Decision

Option 2.

- Requester cannot approve.
- Approver cannot be the settlement instructor.
- TreasuryOwner instructs. CreditCommittee / designated approvers approve.
- Approval binding hash records who approved what.

A draw that cannot be approved because the only other user is the instructor is a staffing problem, not a reason to drop SoD.

## Consequences

- Good: Autopilot cannot self-deal through the happy path.
- Bad: two-person shops need an out-of-band waiver path, which is a later ADR.
- Bad: role headers (x-dibs-role) are still client-set until RBAC is session-bound.
