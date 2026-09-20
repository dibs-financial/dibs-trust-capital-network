# ADR-0001: DIBS is the control plane, not a bank

- Status: Accepted
- Date: 2026-09-19
- Deciders: Track A
- Repo: dibs-trust-capital-network

## Context

DIBS can be described as a bank, an insurer, a lender, or a token issuer. Those descriptions create licensing and custody obligations the product does not perform.

## Options

1. Operate as a chartered or partner bank that holds and moves funds.
2. Broker live policy loans and guarantee spreads.
3. Record policy, evidence, authorization, and settlement confirmation. Banks and carriers move the money.

## Decision

Option 3.

DIBS does not accept deposits, issue insurance, make policy loans, guarantee financing, guarantee investment or tax outcomes, or automatically deploy client capital.

A capital-state change requires policy + evidence + authorization + settlement confirmation + reconciliation + an immutable audit event.

## Consequences

- Good: legal line is one sentence and matches the Autopilot invariant.
- Good: settlement adapters stay replaceable.
- Bad: product copy and partner decks must be reviewed against this ADR.
- Bad: live carrier draw and vault features stay out of Track A.
