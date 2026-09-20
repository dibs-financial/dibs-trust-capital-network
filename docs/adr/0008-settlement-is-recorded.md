# ADR-0008: Settlement is recorded, not executed

- Status: Accepted
- Date: 2026-09-19
- Deciders: Track A

## Context

Calling a bank API from the state machine would make DIBS a payment originator.

## Options

1. transitionDraw posts to the bank.
2. DIBS writes SETTLEMENT_INSTRUCTED. A bank or treasury file moves funds. DIBS records SETTLEMENT_CONFIRMED from evidence (CSV, webhook, statement).
3. Smart-contract escrow.

## Decision

Option 2.

SETTLEMENT_INSTRUCTED means an instruction row exists. SETTLEMENT_CONFIRMED requires funds-moved evidence. Confirm is not automatic. Recon is match / mismatch, not auto-close. Cancel after funds-moved evidence is forbidden; open RECONCILIATION_EXCEPTION.

## Consequences

- Good: matches ADR-0001.
- Good: adapters (CSV today, bank API later) do not change the machine.
- Bad: ops must import confirmations.
- Bad: smart-contract escrow stays parked with vaults.
