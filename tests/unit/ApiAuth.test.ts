/**
 * API tenant and identity come from a verified OIDC token only.
 * Runs the real Express app over HTTP with a throwaway local IdP key.
 */

import { AddressInfo } from 'net';
import { Server } from 'http';
import { createLocalJWKSet, exportJWK, generateKeyPair, JWK, SignJWT } from 'jose';
import { createApp } from '../../backend/api/index';
import { createOidcVerifier } from '../../backend/api/auth';
import { extractTenantId } from '../../backend/evidence/evidence.routes';

const ISSUER = 'https://idp.test.dibs';
const AUDIENCE = 'dibs-api';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let server: Server;
let base: string;
let idpKey: Key;
let rogueKey: Key;

async function token(claims: Record<string, unknown>, opts: { key?: Key; alg?: string; aud?: string; exp?: string | number; kid?: string } = {}) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg || 'ES256', kid: opts.kid || 'idp-1' })
    .setIssuer(ISSUER)
    .setAudience(opts.aud || AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp === undefined ? '5m' : opts.exp);
  return jwt.sign(opts.key || idpKey);
}

function user(tenant: string, sub: string, roles: string[] = ['BorrowerSponsor']) {
  return token({ sub: sub, dibs_tenant_id: tenant, dibs_roles: roles });
}

async function call(method: string, path: string, opts: { bearer?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (opts.bearer) headers.authorization = 'Bearer ' + opts.bearer;
  const res = await fetch(base + path, { method: method, headers: headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const DRAFT = { dealId: 'deal-1', spvId: 'spv-1', payeeCounterpartyId: 'cp-1', payeeBankAccountId: 'pba-1', amountRequestedMinor: '2500000', currency: 'USD' };

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  idpKey = pair.privateKey;
  rogueKey = (await generateKeyPair('ES256')).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'idp-1', alg: 'ES256', use: 'sig' };
  const verifier = createOidcVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks: createLocalJWKSet({ keys: [jwk] }) });
  // No database here: auth runs before any route, so refusals and 401s are fully exercised.
  const app = createApp({ verifier: verifier, pool: null });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('the client cannot choose a tenant or an identity', () => {
  it.each([
    ['x-dibs-tenant header', { headers: { 'x-dibs-tenant': TENANT_B } }, 'CLIENT_SUPPLIED_TENANT'],
    ['x-tenant-id header', { headers: { 'x-tenant-id': TENANT_B } }, 'CLIENT_SUPPLIED_TENANT'],
    ['x-dibs-role header', { headers: { 'x-dibs-role': 'TreasuryOwner' } }, 'CLIENT_SUPPLIED_IDENTITY'],
    ['x-actor-id header', { headers: { 'x-actor-id': 'someone-else' } }, 'CLIENT_SUPPLIED_IDENTITY'],
    ['tenantId in the body', { body: { ...DRAFT, tenantId: TENANT_B } }, 'CLIENT_SUPPLIED_TENANT'],
    ['tenant_id in the body', { body: { ...DRAFT, tenant_id: TENANT_B } }, 'CLIENT_SUPPLIED_TENANT'],
    ['requestedByUserId in the body', { body: { ...DRAFT, requestedByUserId: 'victim' } }, 'CLIENT_SUPPLIED_IDENTITY'],
    ['actorId in the body', { body: { ...DRAFT, actorId: 'victim' } }, 'CLIENT_SUPPLIED_IDENTITY'],
  ])('%s is refused even with a valid token', async (_label, extra, code) => {
    const r = await call('POST', '/api/draws', { bearer: await user(TENANT_A, 'sponsor-a'), body: DRAFT, ...extra });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(code);
  });

  it('tenantId in the query string is refused', async () => {
    const r = await call('GET', '/api/draws?tenantId=' + TENANT_B, { bearer: await user(TENANT_A, 'sponsor-a') });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('CLIENT_SUPPLIED_TENANT');
  });

  it('a tenant in the URL path no longer exists as a route', async () => {
    const r = await call('GET', '/api/reporting/dashboard/' + TENANT_B, { bearer: await user(TENANT_A, 'sponsor-a') });
    expect(r.status).toBe(404);
  });
});

describe('a verified token is required', () => {
  it('no token → 401 with a Bearer challenge', async () => {
    const r = await call('GET', '/api/draws');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('TOKEN_REQUIRED');
    expect(r.headers.get('www-authenticate')).toBe('Bearer');
  });

  it.each([
    ['signed by another key', () => token({ sub: 'x', dibs_tenant_id: TENANT_A }, { key: rogueKey })],
    ['expired', () => token({ sub: 'x', dibs_tenant_id: TENANT_A }, { exp: Math.floor(Date.now() / 1000) - 3600 })],
    ['wrong audience', () => token({ sub: 'x', dibs_tenant_id: TENANT_A }, { aud: 'someone-else' })],
    ['garbage', async () => 'not.a.jwt'],
  ])('token %s → 401 INVALID_TOKEN', async (_label, make) => {
    const r = await call('GET', '/api/draws', { bearer: await make() });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('INVALID_TOKEN');
  });

  it('a symmetric (HS256) token is refused even if its claims look right', async () => {
    const hs = await new SignJWT({ sub: 'x', dibs_tenant_id: TENANT_A })
      .setProtectedHeader({ alg: 'HS256', kid: 'idp-1' })
      .setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-secret-anyone-could-hold-000000'));
    const r = await call('GET', '/api/draws', { bearer: hs });
    expect(r.status).toBe(401);
  });

  it.each([
    ['missing', {}],
    ['not a UUID', { dibs_tenant_id: 'default-tenant' }],
  ])('tenant claim %s → 401 TENANT_CLAIM_MISSING', async (_label, claims) => {
    const r = await call('GET', '/api/draws', { bearer: await token({ sub: 'x', ...claims }) });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('TENANT_CLAIM_MISSING');
  });

  it('with no verifier configured the API fails closed', async () => {
    const closed = createApp({ verifier: null, pool: null });
    const s = await new Promise<Server>((resolve) => {
      const x = closed.listen(0, () => resolve(x));
    });
    try {
      const res = await fetch('http://127.0.0.1:' + (s.address() as AddressInfo).port + '/api/draws', {
        headers: { authorization: 'Bearer ' + (await user(TENANT_A, 'sponsor-a')) },
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe('AUTH_NOT_CONFIGURED');
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  it('/health stays public', async () => {
    expect((await call('GET', '/health')).status).toBe(200);
  });

  it('evidence no longer falls back to a shared "default-tenant"', () => {
    expect(() => extractTenantId({ headers: {}, query: {}, body: {} } as never)).toThrow('UNAUTHENTICATED');
  });
});

describe('role gates on the remaining in-memory routes', () => {
  it('emergency pause needs PlatformAdmin in the token', async () => {
    expect((await call('POST', '/api/emergency/pause', { bearer: await user(TENANT_A, 'ops', ['OperationsOwner']) })).status).toBe(403);
    expect((await call('POST', '/api/emergency/pause', { bearer: await user(TENANT_A, 'root', ['PlatformAdmin']) })).status).toBe(200);
    await call('POST', '/api/emergency/unpause', { bearer: await user(TENANT_A, 'root', ['PlatformAdmin']) });
  });

  it('without a database the persisted draw routes refuse instead of falling back to memory', async () => {
    const r = await call('GET', '/api/draws', { bearer: await user(TENANT_A, 'sponsor-a') });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('DATABASE_NOT_CONFIGURED');
  });
});
