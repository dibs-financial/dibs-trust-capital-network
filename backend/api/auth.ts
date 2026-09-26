/**
 * DIBS Track A — authentication: tenant and identity come from a verified
 * OIDC access token, never from the request.
 *
 *   Authorization: Bearer <JWT signed by the tenant's IdP>
 *     sub                → subject (the actor on every audit event)
 *     dibs_tenant_id     → tenant (UUID)
 *     dibs_roles         → roles for the in-memory routes; the persisted
 *                          workflow re-reads roles from user_role
 *
 * Requests that try to name a tenant or an actor (headers, query or body) are
 * refused outright, even with a valid token, so a stale client cannot believe
 * it chose a scope. With no verifier configured the API fails closed.
 *
 * No template literals — GitHub web editor corrupts dollar-brace.
 */

import { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, JWTVerifyGetKey, jwtVerify } from 'jose';
import { Session } from './db';

export interface AuthenticatedSession extends Session {
  readonly roles: ReadonlyArray<string>;
}

declare global {
  namespace Express {
    interface Request {
      /** Set only by authenticate() from a verified token. */
      auth?: AuthenticatedSession;
      /** Mirror of auth.tenantId for older routers. Never read from input. */
      tenantId?: string;
    }
  }
}

export type TokenVerifier = (token: string) => Promise<AuthenticatedSession>;

export class AuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AuthError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Asymmetric only: an HS256 token would let anyone holding the secret mint any tenant. */
const DEFAULT_ALGORITHMS = ['RS256', 'PS256', 'ES256', 'EdDSA'];

export interface OidcConfig {
  issuer: string;
  audience: string;
  /** The IdP's key set: a JWKS URL, or a key resolver (tests pass a local set). */
  jwks: URL | JWTVerifyGetKey;
  tenantClaim?: string;
  rolesClaim?: string;
  algorithms?: string[];
  clockToleranceSeconds?: number;
}

export function createOidcVerifier(config: OidcConfig): TokenVerifier {
  const keys: JWTVerifyGetKey = config.jwks instanceof URL ? createRemoteJWKSet(config.jwks) : config.jwks;
  const tenantClaim = config.tenantClaim || 'dibs_tenant_id';
  const rolesClaim = config.rolesClaim || 'dibs_roles';
  return async function (token: string): Promise<AuthenticatedSession> {
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: config.algorithms || DEFAULT_ALGORITHMS,
        clockTolerance: config.clockToleranceSeconds === undefined ? 30 : config.clockToleranceSeconds,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      payload = verified.payload as Record<string, unknown>;
    } catch {
      throw new AuthError('INVALID_TOKEN');
    }
    const subject = payload.sub;
    const tenantId = payload[tenantClaim];
    const roles = payload[rolesClaim] === undefined ? [] : payload[rolesClaim];
    if (typeof subject !== 'string' || subject.length === 0) throw new AuthError('INVALID_TOKEN');
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)) throw new AuthError('TENANT_CLAIM_MISSING');
    if (!Array.isArray(roles) || !roles.every(function (r) { return typeof r === 'string'; })) {
      throw new AuthError('INVALID_TOKEN');
    }
    return Object.freeze({ tenantId: tenantId.toLowerCase(), subject: subject, roles: Object.freeze(roles.slice()) });
  };
}

/** OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URL, or null (the API then refuses every request). */
export function verifierFromEnv(env: NodeJS.ProcessEnv): TokenVerifier | null {
  if (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE || !env.OIDC_JWKS_URL) return null;
  return createOidcVerifier({
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_AUDIENCE,
    jwks: new URL(env.OIDC_JWKS_URL),
    tenantClaim: env.OIDC_TENANT_CLAIM,
    rolesClaim: env.OIDC_ROLES_CLAIM,
  });
}

/** Header names a client might use to pick a tenant or an identity. */
const FORBIDDEN_HEADERS = [
  'x-dibs-tenant', 'x-tenant-id', 'tenant-id', 'x-organization-id',
  'x-dibs-role', 'x-actor-id', 'actor-id', 'x-actor-role', 'actor-role', 'x-user-id',
];
/** Top-level query or body keys that name a tenant or an actor. */
const FORBIDDEN_TENANT_KEYS = ['tenantid', 'tenant', 'organizationid'];
const FORBIDDEN_IDENTITY_KEYS = [
  'actorid', 'actorrole', 'requestedbyuserid', 'triggeredby', 'userid', 'role',
  'createdby', 'requestedby', 'authorizerid', 'authorizerrole', 'approverid', 'instructedby', 'deniedby',
];

function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

function clientSuppliedScope(req: Request): 'CLIENT_SUPPLIED_TENANT' | 'CLIENT_SUPPLIED_IDENTITY' | null {
  for (const h of FORBIDDEN_HEADERS) {
    if (req.headers[h] !== undefined) {
      return h.indexOf('tenant') >= 0 || h.indexOf('organization') >= 0 ? 'CLIENT_SUPPLIED_TENANT' : 'CLIENT_SUPPLIED_IDENTITY';
    }
  }
  const sources: unknown[] = [req.query, req.body];
  for (const src of sources) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    for (const key of Object.keys(src as Record<string, unknown>)) {
      const k = normalize(key);
      if (FORBIDDEN_TENANT_KEYS.indexOf(k) >= 0) return 'CLIENT_SUPPLIED_TENANT';
      if (FORBIDDEN_IDENTITY_KEYS.indexOf(k) >= 0) return 'CLIENT_SUPPLIED_IDENTITY';
    }
  }
  return null;
}

/**
 * Verifies the bearer token and attaches req.auth. Runs after body parsing.
 * Order: refuse client-chosen scope (400), then require a valid token (401).
 */
export function authenticate(verifier: TokenVerifier | null): RequestHandler {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const scope = clientSuppliedScope(req);
    if (scope) {
      res.status(400).json({ error: scope, message: 'tenant and identity come from the access token' });
      return;
    }
    if (!verifier) {
      res.status(401).json({ error: 'AUTH_NOT_CONFIGURED' });
      return;
    }
    const header = req.headers.authorization || '';
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
    if (!match) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'TOKEN_REQUIRED' });
      return;
    }
    try {
      const session = await verifier(match[1]);
      req.auth = session;
      req.tenantId = session.tenantId;
      next();
    } catch (err) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      res.status(401).json({ error: err instanceof AuthError ? err.code : 'INVALID_TOKEN' });
    }
  };
}

/** Role gate on the verified token's roles. */
export function requireRole(...roles: string[]): RequestHandler {
  return function (req: Request, res: Response, next: NextFunction): void {
    const held = (req.auth && req.auth.roles) || [];
    if (!roles.some(function (r) { return held.indexOf(r) >= 0; })) {
      res.status(403).json({ error: 'INSUFFICIENT_ROLE', required: roles });
      return;
    }
    next();
  };
}

/** For handlers: the verified session, or throw (authenticate() must have run). */
export function sessionOf(req: Request): AuthenticatedSession {
  if (!req.auth) throw new AuthError('UNAUTHENTICATED');
  return req.auth;
}
