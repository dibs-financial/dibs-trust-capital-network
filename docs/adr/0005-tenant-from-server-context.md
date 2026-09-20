# ADR-0005: Tenant comes from server context

- Status: Accepted
- Date: 2026-09-19
- Deciders: Track A
- Code: backend/api/index.ts tenantIsolation

## Context

The prototype read `x-dibs-tenant` and defaulted to `'default'`. A client can impersonate any tenant.

## Options

1. Trust `x-dibs-tenant`.
2. Require the header and reject if missing, still trusting the client value.
3. Bind tenant from the authenticated session (OIDC). Header is not authoritative.

## Decision

Option 3 is the rule. Option 2 is the current scaffold.

`tenantIsolation` rejects a missing header with `TENANT_REQUIRED`. It does not default to `'default'`. Sprint 1 replaces the header with the session tenant. Cross-tenant reads stay 403 `TENANT_ISOLATION_VIOLATION`.

## Consequences

- Good: empty tenant cannot slide into a shared bucket.
- Bad: header-trusted tenant is still spoofable until OIDC lands.
- Bad: every route that mutates capital state must run `tenantIsolation`.
