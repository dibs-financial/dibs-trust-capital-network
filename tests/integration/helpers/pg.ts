/**
 * Throwaway Postgres database per test file.
 *
 * DATABASE_URL must be an owner/superuser connection (CI provides one). The
 * migrations run as that owner; the application pool connects as a fresh
 * LOGIN role that is only a member of dibs_app — not a superuser and without
 * BYPASSRLS — so row-level security is really enforced in these tests.
 */

import { randomBytes } from 'crypto';
import { Client, Pool } from 'pg';
import { runMigrations } from '../../../backend/api/migrate';

const ADMIN_URL = process.env.DATABASE_URL;

if (process.env.CI && !ADMIN_URL) {
  throw new Error('DATABASE_URL is required in CI: the Track A integration tests need Postgres.');
}

/** Integration suites run only where a database is configured (always in CI). */
export const describeDb: jest.Describe = ADMIN_URL ? describe : describe.skip;

export interface TestDatabase {
  /** Application pool: dibs_app member, RLS enforced. */
  pool: Pool;
  /** Owner connection string for the test database (for tamper tests only). */
  ownerUrl: string;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!ADMIN_URL) throw new Error('DATABASE_URL not set');
  const suffix = randomBytes(6).toString('hex');
  const dbName = 'dibs_it_' + suffix;
  const loginRole = 'dibs_it_app_' + suffix;
  const password = randomBytes(16).toString('hex');

  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query('CREATE ROLE dibs_app NOLOGIN NOSUPERUSER NOBYPASSRLS');
  } catch (err) {
    const code = (err as { code?: string }).code;
    // 42710 duplicate_object; 23505 when two workers race on pg_authid.
    if (code !== '42710' && code !== '23505') throw err;
  }
  await admin.query('CREATE DATABASE ' + dbName);
  await admin.query('CREATE ROLE ' + loginRole + " LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '" + password + "' IN ROLE dibs_app");
  await admin.end();

  const ownerUrl = new URL(ADMIN_URL);
  ownerUrl.pathname = '/' + dbName;
  const owner = new Client({ connectionString: ownerUrl.toString() });
  await owner.connect();
  await runMigrations(owner);
  await owner.end();

  const appUrl = new URL(ownerUrl.toString());
  appUrl.username = loginRole;
  appUrl.password = password;
  const pool = new Pool({ connectionString: appUrl.toString(), max: 4 });

  return {
    pool: pool,
    ownerUrl: ownerUrl.toString(),
    async drop() {
      await pool.end();
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query('DROP DATABASE IF EXISTS ' + dbName + ' WITH (FORCE)');
      await a.query('DROP ROLE IF EXISTS ' + loginRole);
      await a.end();
    },
  };
}
