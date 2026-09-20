# ADR-0004: Money is integer minor units

- Status: Accepted
- Date: 2026-09-19
- Deciders: Track A

## Context

`requestedAmount: number` cannot represent cents exactly. Floats drift. JSON has no bigint.

## Options

1. JavaScript `number` dollars.
2. Decimal string dollars.
3. Integer minor units (`bigint` in process, decimal string on the wire).

## Decision

Option 3.

Store `amountRequestedMinor` and `amountApprovedMinor` as `bigint`. JSON responses emit `.toString()`. Request bodies parse with `BigInt(...)`. Currency is an ISO code on the draw, default `USD`.

No arithmetic on floats for principal, approved amount, budget remaining, or eligible-this-draw.

## Consequences

- Good: two cents never become `1.999999`.
- Good: budget and retainage gates are exact.
- Bad: every API boundary must convert.
- Bad: clients that send `25000.00` instead of `"2500000"` will fail closed.
