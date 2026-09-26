/**
 * Applies migrations/*.sql in filename order, once each.
 * Run with an owner connection: DATABASE_URL=… npm run db:migrate
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

export async function runMigrations(client: Client, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
  );
  const applied = new Set(
    (await client.query('SELECT filename FROM schema_migrations')).rows.map(function (r) { return String(r.filename); })
  );
  const files = readdirSync(dir).filter(function (f) { return f.endsWith('.sql'); }).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    // Each file carries its own BEGIN / COMMIT.
    await client.query(readFileSync(join(dir, file), 'utf8'));
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    ran.push(file);
  }
  return ran;
}

if (require.main === module) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client
    .connect()
    .then(function () { return runMigrations(client); })
    .then(function (ran) {
      console.log(ran.length ? 'Applied: ' + ran.join(', ') : 'Up to date');
      return client.end();
    })
    .catch(function (err) {
      console.error(err);
      process.exitCode = 1;
      return client.end();
    });
}
