/**
 * DIBS Track A — Postgres access with tenant from the session.
 *
 * Every query runs inside withTenantTx, which pins app.tenant_id for the
 * transaction. Row-level security in migrations/ reads only that setting, so a
 * caller can never widen its scope by naming another tenant in a query or body.
 *
 * The service connects as a member of dibs_app (not a superuser, no BYPASSRLS).
 * No template literals — GitHub web editor corrupts dollar-brace.
 */

import { Pool, PoolClient } from 'pg';

/**
 * An authenticated caller. Built only by the auth layer from a verified OIDC
 * token: tenantId and subject come from the token, never from request input.
 * Roles are not carried here; they are read from user_role inside the tenant.
 */
export interface Session {
  readonly tenantId: string;
  readonly subject: string;
}

export class DomainError extends Error {
  constructor(readonly code: string, message?: string, readonly details?: unknown) {
    super(message ? code + ': ' + message : code);
    this.name = 'DomainError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects any request input that tries to choose a tenant. */
export function assertNoClientTenant(input: unknown): void {
  if (input === null || typeof input !== 'object') return;
  for (const key of Object.keys(input as Record<string, unknown>)) {
    const k = key.toLowerCase().replace(/[-_]/g, '');
    if (k === 'tenantid' || k === 'tenant' || k === 'organizationid') {
      throw new DomainError('CLIENT_SUPPLIED_TENANT', 'tenant comes from the session, not the request');
    }
  }
}

export async function withTenantTx<T>(
  pool: Pool,
  session: Session,
  fn: (tx: PoolClient) => Promise<T>
): Promise<T> {
  if (!session || !UUID.test(session.tenantId) || !session.subject) {
    throw new DomainError('SESSION_REQUIRED');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [session.tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Roles the session's subject holds in its tenant (tenant-scoped or scoped to one of scopeIds). */
export async function rolesOf(tx: PoolClient, session: Session, scopeIds: string[] = []): Promise<Set<string>> {
  const r = await tx.query(
    'SELECT role FROM user_role WHERE user_subject = $1 AND revoked_at IS NULL ' +
      "AND (scope_type = 'TENANT' OR scope_id = ANY($2::uuid[]))",
    [session.subject, scopeIds]
  );
  return new Set(r.rows.map(function (row) { return String(row.role); }));
}

export async function requireRole(
  tx: PoolClient,
  session: Session,
  allowed: string[],
  scopeIds: string[] = []
): Promise<string> {
  const held = await rolesOf(tx, session, scopeIds);
  const match = allowed.find(function (r) { return held.has(r); });
  if (!match) throw new DomainError('ROLE_REQUIRED', allowed.join(' | '));
  return match;
}

/** Money arrives over HTTP as a decimal string of minor units. Never a JS number. */
export function parseMinor(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^[0-9]{1,18}$/.test(value)) {
    throw new DomainError('INVALID_MONEY', field + ' must be a string of integer minor units');
  }
  return BigInt(value);
}
