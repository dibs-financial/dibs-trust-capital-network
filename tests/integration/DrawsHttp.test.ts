/**
 * Track A over HTTP: the week-one flow through the real Express app, a local
 * test IdP, and Postgres. Tenant and actor come from the token; roles come
 * from user_role; money is strings on the wire.
 */

import { readFileSync } from 'fs';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { join } from 'path';
import { createLocalJWKSet, exportJWK, generateKeyPair, JWK, SignJWT } from 'jose';
import { createOidcVerifier } from '../../backend/api/auth';
import { createApp } from '../../backend/api/index';
import { Fixture, seedTenant } from './helpers/fixture';
import { createTestDatabase, describeDb, TestDatabase } from './helpers/pg';

jest.setTimeout(60_000);

const ISSUER = 'https://idp.test.dibs';
const AUDIENCE = 'dibs-api';
const INSPECTION_PDF = readFileSync(join(__dirname, '..', 'fixtures', 'inspection-report.pdf'));
const INVOICE_PDF = readFileSync(join(__dirname, '..', 'fixtures', 'invoice-0001.pdf'));
const CSV_HEADER = 'external_partner_id,settlement_reference,amount_minor,currency,payee_account_ref,settlement_date';
const CONTROLS = {
  remainingBudgetMinor: '100000000',
  eligibleThisDrawMinor: '30000000',
  retainageApplied: true,
  covenantStatus: 'CURRENT',
  waiverCoversBreach: false,
  loanInBalancePasses: true,
  deficiencyDepositConfirmed: false,
};

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

describeDb('Track A over HTTP', () => {
  let db: TestDatabase;
  let server: Server;
  let base: string;
  let idpKey: Key;
  let n = 0;
  const key = (label: string) => label + '-' + ++n;

  async function tokenFor(tenantId: string, subject: string, roles: string[] = []) {
    return new SignJWT({ dibs_tenant_id: tenantId, dibs_roles: roles })
      .setProtectedHeader({ alg: 'ES256', kid: 'idp-1' })
      .setSubject(subject).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m')
      .sign(idpKey);
  }

  async function call(
    method: string,
    path: string,
    who: { tenantId: string; subject: string },
    opts: { body?: unknown; csv?: string; idem?: string | null; roles?: string[] } = {}
  ) {
    const headers: Record<string, string> = { authorization: 'Bearer ' + (await tokenFor(who.tenantId, who.subject, opts.roles)) };
    if (opts.idem !== null && method !== 'GET') headers['idempotency-key'] = opts.idem || key(method + path);
    let body: string | undefined;
    if (opts.csv !== undefined) {
      headers['content-type'] = 'text/csv';
      body = opts.csv;
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(base + path, { method: method, headers: headers, body: body });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    const pair = await generateKeyPair('ES256');
    idpKey = pair.privateKey;
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'idp-1', alg: 'ES256', use: 'sig' };
    const verifier = createOidcVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const app = createApp({ verifier: verifier, pool: db.pool });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.drop();
  });

  async function draft(f: Fixture, amount = '25000000') {
    return call('POST', '/api/draws', f.sponsor, {
      body: {
        dealId: f.dealId, requestNumber: key('DR'), payeeCounterpartyId: f.counterpartyId,
        payeeBankAccountId: f.payeeBankAccountId, amountRequestedMinor: amount, currency: 'USD',
      },
    });
  }

  it('week-one flow: DRAFT → RECONCILED over HTTP, with a verifiable ledger', async () => {
    const f = await seedTenant(db.pool, 'http-alpha');
    const created = await draft(f);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'DRAFT', tenantId: f.tenantId, requestedByUserId: f.sponsor.subject, amountRequestedMinor: '25000000' });
    const id = created.body.id as string;

    for (const [type, pdf] of [['INVOICE', INVOICE_PDF], ['INSPECTION_REPORT', INSPECTION_PDF]] as const) {
      const up = await call('POST', '/api/draws/' + id + '/evidence', f.sponsor, {
        body: { documentType: type, contentBase64: pdf.toString('base64'), storageUri: 's3://fixtures/' + type, sourceSystem: 'http-test' },
      });
      expect(up.status).toBe(201);
      expect((await call('POST', '/api/draws/' + id + '/evidence/' + up.body.documentId + '/verify', f.approver)).status).toBe(204);
    }

    const submitted = await call('POST', '/api/draws/' + id + '/submit', f.sponsor);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', lockedPolicyVersion: 'policy-2026.09.19' });
    expect((await call('POST', '/api/draws/' + id + '/evaluate', f.approver)).body.status).toBe('UNDER_REVIEW');

    const approved = await call('POST', '/api/draws/' + id + '/approve', f.approver, { body: { amountApprovedMinor: '25000000', controls: CONTROLS } });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', amountApprovedMinor: '25000000' });

    const instructed = await call('POST', '/api/draws/' + id + '/instruct', f.treasury, {
      body: { externalPartnerId: 'escrow-factory', settlementReference: 'EF-HTTP-0001' },
    });
    expect(instructed.body.status).toBe('SETTLEMENT_INSTRUCTED');

    const csv = CSV_HEADER + '\nescrow-factory,EF-HTTP-0001,25000000,USD,' + f.payeeAccountRef + ',' + new Date().toISOString().slice(0, 10) + '\n';
    expect((await call('PUT', '/api/confirmations/csv-batches/batch-1', f.treasury, { csv: csv })).status).toBe(201);
    const confirmed = await call('POST', '/api/confirmations/csv-batches/batch-1/confirm', f.approver, { csv: csv });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.results).toEqual([expect.objectContaining({ drawId: id, outcome: 'MATCHED' })]);

    expect((await call('GET', '/api/draws/' + id, f.sponsor)).body.status).toBe('RECONCILED');
    expect((await call('GET', '/api/audit/verify', f.sponsor)).body).toMatchObject({ ok: true });
    const events = (await call('GET', '/api/audit/events?limit=500', f.sponsor)).body.events as Array<{ actorId: string; stateAfter: string | null }>;
    expect(events.filter((e) => e.stateAfter).map((e) => [e.stateAfter, e.actorId])).toEqual([
      ['DRAFT', f.sponsor.subject],
      ['SUBMITTED', f.sponsor.subject],
      ['UNDER_REVIEW', f.approver.subject],
      ['APPROVED', f.approver.subject],
      ['SETTLEMENT_INSTRUCTED', f.treasury.subject],
      ['SETTLEMENT_CONFIRMED', f.treasury.subject],
      ['RECONCILED', f.treasury.subject],
    ]);
  });

  it('two tenants cannot see each other’s draws over HTTP', async () => {
    const a = await seedTenant(db.pool, 'http-a');
    const b = await seedTenant(db.pool, 'http-b');
    const created = await draft(a);
    expect((await call('GET', '/api/draws/' + created.body.id, b.sponsor)).status).toBe(404);
    const list = await call('GET', '/api/draws', b.sponsor);
    expect(list.body.map((d: { id: string }) => d.id)).not.toContain(created.body.id);
    expect((await call('POST', '/api/draws/' + created.body.id + '/submit', b.sponsor)).status).toBe(404);
  });

  it('roles come from user_role, not from the token', async () => {
    const f = await seedTenant(db.pool, 'http-roles');
    const created = await draft(f);
    // The sponsor's token claims TreasuryOwner; the database says BorrowerSponsor.
    const r = await call('POST', '/api/draws/' + created.body.id + '/instruct', f.sponsor, {
      roles: ['TreasuryOwner'], body: { externalPartnerId: 'escrow-factory', settlementReference: 'EF-X' },
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('ROLE_REQUIRED');
  });

  it('writes need an Idempotency-Key and money as strings', async () => {
    const f = await seedTenant(db.pool, 'http-edges');
    const body = { dealId: f.dealId, requestNumber: 'X-1', payeeCounterpartyId: f.counterpartyId, payeeBankAccountId: f.payeeBankAccountId, currency: 'USD' };
    const noKey = await call('POST', '/api/draws', f.sponsor, { idem: null, body: { ...body, amountRequestedMinor: '1' } });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const numeric = await call('POST', '/api/draws', f.sponsor, { body: { ...body, amountRequestedMinor: 250000.5 } });
    expect(numeric.status).toBe(400);
    expect(numeric.body.error).toBe('INVALID_MONEY');

    // Same key twice: one draw.
    const first = await call('POST', '/api/draws', f.sponsor, { idem: 'same-key', body: { ...body, amountRequestedMinor: '1' } });
    const again = await call('POST', '/api/draws', f.sponsor, { idem: 'same-key', body: { ...body, amountRequestedMinor: '1' } });
    expect(again.body.id).toBe(first.body.id);
  });

  it('dual-entry CSV needs two different people who agree', async () => {
    const f = await seedTenant(db.pool, 'http-csv');
    const csv = CSV_HEADER + '\nescrow-factory,EF-NONE,1,USD,x,2026-09-26\n';
    expect((await call('PUT', '/api/confirmations/csv-batches/b-1', f.treasury, { csv: csv })).status).toBe(201);
    const same = await call('POST', '/api/confirmations/csv-batches/b-1/confirm', f.treasury, { csv: csv });
    expect(same.status).toBe(403);
    expect(same.body.error).toBe('SOD_DUAL_ENTRY_SAME_PERSON');
    const differs = await call('POST', '/api/confirmations/csv-batches/b-1/confirm', f.approver, { csv: csv.replace(',1,', ',2,') });
    expect(differs.status).toBe(409);
    expect(differs.body.error).toBe('DUAL_ENTRY_MISMATCH');
    const ok = await call('POST', '/api/confirmations/csv-batches/b-1/confirm', f.approver, { csv: csv });
    expect(ok.body.results).toEqual([expect.objectContaining({ outcome: 'EXCEPTION', mismatchCodes: ['UNAPPROVED_SETTLEMENT'] })]);
    expect((await call('POST', '/api/confirmations/csv-batches/b-1/confirm', f.approver, { csv: csv })).status).toBe(409);
  });
});
