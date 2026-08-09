/**
 * DIBS Backend — External API Marketplace
 *
 * Build Step 20: External API for third-party integrations, white-label distribution,
 * and partner access to DIBS platform capabilities.
 *
 * Access Tiers:
 * - Growth Tier: Basic RPC access, public dashboard, standard ERC-4626 routing
 * - Institutional Tier: Real-time API, WebSocket telemetry, health-factor alerts, pool-level risk reporting
 * - Enterprise Tier: White-label vault factory, custom permissioned access, KYC/AML wrappers, custom oracle adapters, dedicated infrastructure
 *
 * API Key Management:
 * - Per-tenant API keys with scoped permissions
 * - Rate limiting per tier
 * - Usage tracking and quota enforcement
 * - Key rotation and revocation
 */

import { Router } from 'express';

// Extend Express Request with tenant context
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      apiKey?: any;
    }
  }
}


export type ApiTier = 'growth' | 'institutional' | 'enterprise';

export interface ApiKey {
  keyId: string;
  tenantId: string;
  tier: ApiTier;
  scopes: string[];
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  active: boolean;
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  usageCount: number;
  lastUsedAt?: string;
}

export interface ApiScope {
  name: string;
  description: string;
  tiers: ApiTier[];
}

export const AVAILABLE_SCOPES: ApiScope[] = [
  { name: 'read:capital_requests', description: 'Read capital request data', tiers: ['growth', 'institutional', 'enterprise'] },
  { name: 'write:capital_requests', description: 'Create and modify capital requests', tiers: ['growth', 'institutional', 'enterprise'] },
  { name: 'read:covenants', description: 'Read covenant status and evaluations', tiers: ['growth', 'institutional', 'enterprise'] },
  { name: 'read:collateral', description: 'Read collateral records and risk flags', tiers: ['growth', 'institutional', 'enterprise'] },
  { name: 'read:tranche', description: 'Read tranche NAV and junior ratio', tiers: ['growth', 'institutional', 'enterprise'] },
  { name: 'read:reserves', description: 'Read reserve health and shortfall data', tiers: ['institutional', 'enterprise'] },
  { name: 'read:analytics', description: 'Read advanced analytics dashboard data', tiers: ['institutional', 'enterprise'] },
  { name: 'read:vrdct', description: 'Read VRDCT trust signals and scores', tiers: ['institutional', 'enterprise'] },
  { name: 'write:evidence', description: 'Submit evidence objects', tiers: ['growth', 'institutional', 'enterprise'] },
  { name: 'read:settlement', description: 'Read settlement instructions and reconciliation status', tiers: ['institutional', 'enterprise'] },
  { name: 'websocket:telemetry', description: 'WebSocket real-time telemetry stream', tiers: ['institutional', 'enterprise'] },
  { name: 'admin:api_keys', description: 'Manage API keys for tenant', tiers: ['enterprise'] },
  { name: 'admin:policies', description: 'Manage capital policies', tiers: ['enterprise'] },
  { name: 'admin:whitelabel', description: 'White-label vault factory access', tiers: ['enterprise'] },
  { name: 'write:webhooks', description: 'Register webhook endpoints for event notifications', tiers: ['institutional', 'enterprise'] },
];

export const TIER_RATE_LIMITS: Record<ApiTier, { perMinute: number; perHour: number }> = {
  growth: { perMinute: 30, perHour: 1000 },
  institutional: { perMinute: 100, perHour: 10000 },
  enterprise: { perMinute: 500, perHour: 100000 },
};

export class ApiKeyManager {
  public keys: Map<string, ApiKey> = new Map();
  private tenantKeys: Map<string, Set<string>> = new Map();

  /**
   * Generate a new API key for a tenant.
   */
  generateKey(tenantId: string, tier: ApiTier, scopes: string[]): ApiKey {
    // Validate scopes are available for tier
    for (const scope of scopes) {
      const scopeDef = AVAILABLE_SCOPES.find(s => s.name === scope);
      if (!scopeDef) {
        throw new Error(`UNKNOWN_SCOPE: ${scope}`);
      }
      if (!scopeDef.tiers.includes(tier)) {
        throw new Error(`SCOPE_NOT_AVAILABLE_FOR_TIER: ${scope} requires ${scopeDef.tiers.join('/')}`);
      }
    }

    const rateLimits = TIER_RATE_LIMITS[tier];
    const keyId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;

    const apiKey: ApiKey = {
      keyId,
      tenantId,
      tier,
      scopes,
      rateLimitPerMinute: rateLimits.perMinute,
      rateLimitPerHour: rateLimits.perHour,
      active: true,
      createdAt: new Date().toISOString(),
      usageCount: 0,
    };

    this.keys.set(keyId, apiKey);
    if (!this.tenantKeys.has(tenantId)) {
      this.tenantKeys.set(tenantId, new Set());
    }
    this.tenantKeys.get(tenantId)!.add(keyId);

    return apiKey;
  }

  /**
   * Validate an API key and check scope permissions.
   */
  validateKey(keyId: string, requiredScope: string): { valid: boolean; apiKey?: ApiKey; error?: string } {
    const apiKey = this.keys.get(keyId);
    if (!apiKey) {
      return { valid: false, error: 'API_KEY_NOT_FOUND' };
    }
    if (!apiKey.active) {
      return { valid: false, error: 'API_KEY_INACTIVE' };
    }
    if (!apiKey.scopes.includes(requiredScope)) {
      return { valid: false, error: `SCOPE_NOT_GRANTED: ${requiredScope}` };
    }

    // Track usage
    apiKey.usageCount++;
    apiKey.lastUsedAt = new Date().toISOString();

    return { valid: true, apiKey };
  }

  /**
   * Rotate an API key (invalidate old, create new with same scopes).
   */
  rotateKey(keyId: string): ApiKey {
    const oldKey = this.keys.get(keyId);
    if (!oldKey) {
      throw new Error(`API_KEY_NOT_FOUND: ${keyId}`);
    }

    oldKey.active = false;
    oldKey.revokedAt = new Date().toISOString();

    return this.generateKey(oldKey.tenantId, oldKey.tier, oldKey.scopes);
  }

  /**
   * Revoke an API key.
   */
  revokeKey(keyId: string): void {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`API_KEY_NOT_FOUND: ${keyId}`);
    }
    key.active = false;
    key.revokedAt = new Date().toISOString();
  }

  /**
   * List all API keys for a tenant.
   */
  getTenantKeys(tenantId: string): ApiKey[] {
    const keyIds = this.tenantKeys.get(tenantId) || new Set<string>();
    return Array.from(keyIds).map(id => this.keys.get(id)!).filter(Boolean);
  }

  /**
   * Check rate limit for an API key.
   * TODO: Implement with Redis sliding window counter.
   */
  checkRateLimit(apiKey: ApiKey): { allowed: boolean; retryAfterSeconds?: number } {
    // TODO: Implement actual rate limiting with Redis
    return { allowed: true };
  }
}

export function createApiMarketplaceRouter(keyManager: ApiKeyManager): Router {
  const router = Router();

  /**
   * Middleware: API key authentication
   * Expects header: X-DIBS-API-Key
   */
  router.use((req, res, next) => {
    const keyId = (req.headers['x-dibs-api-key'] as string) || '';
    if (!keyId) {
      return res.status(401).json({ error: 'API_KEY_REQUIRED' });
    }

    // Basic validation — specific scope check happens per route
    const apiKey = keyManager.keys.get(keyId as string);
    if (!apiKey || !apiKey.active) {
      return res.status(401).json({ error: 'INVALID_API_KEY' });
    }

    // Rate limit check
    const rateCheck = keyManager.checkRateLimit(apiKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        retryAfter: rateCheck.retryAfterSeconds,
      });
    }

    req.tenantId = apiKey.tenantId;
    req.apiKey = apiKey;
    next();
  });

  /**
   * Helper to check scope on a route
   */
  function requireScope(scope: string) {
    return (req: any, res: any, next: any) => {
      const result = keyManager.validateKey(req.apiKey.keyId, scope);
      if (!result.valid) {
        return res.status(403).json({ error: result.error });
      }
      next();
    };
  }

  /**
   * GET /v1/capital-requests — List capital requests
   */
  router.get('/v1/capital-requests', requireScope('read:capital_requests'), (req, res) => {
    // TODO: Proxy to capital request service
    res.json({ tenantId: req.tenantId || '', requests: [] });
  });

  /**
   * POST /v1/capital-requests — Create capital request
   */
  router.post('/v1/capital-requests', requireScope('write:capital_requests'), (req, res) => {
    // TODO: Proxy to capital request service
    res.status(201).json({ tenantId: req.tenantId || '', requestId: 'pending' });
  });

  /**
   * GET /v1/covenants — List covenant status
   */
  router.get('/v1/covenants', requireScope('read:covenants'), (req, res) => {
    // TODO: Proxy to covenant engine
    res.json({ tenantId: req.tenantId || '', covenants: [] });
  });

  /**
   * GET /v1/collateral — List collateral records
   */
  router.get('/v1/collateral', requireScope('read:collateral'), (req, res) => {
    // TODO: Proxy to collateral service
    res.json({ tenantId: req.tenantId || '', collateral: [] });
  });

  /**
   * GET /v1/tranche — Get tranche NAV and junior ratio
   */
  router.get('/v1/tranche', requireScope('read:tranche'), (req, res) => {
    // TODO: Proxy to vault layer
    res.json({
      tenantId: req.tenantId || '',
      navSentinel: 0,
      navCatalyst: 0,
      juniorRatio: 0,
      minJuniorRatio: 0.20,
      capitalPreservationMode: false,
    });
  });

  /**
   * GET /v1/analytics/:category — Get analytics data
   */
  router.get('/v1/analytics/:category', requireScope('read:analytics'), (req, res) => {
    // TODO: Proxy to analytics engine
    res.json({ tenantId: req.tenantId || '', category: req.params.category, data: [] });
  });

  /**
   * POST /v1/evidence — Submit evidence
   */
  router.post('/v1/evidence', requireScope('write:evidence'), (req, res) => {
    // TODO: Proxy to evidence ingestion service
    res.status(201).json({ tenantId: req.tenantId || '', evidenceId: 'pending' });
  });

  /**
   * GET /v1/reserves — Get reserve health
   */
  router.get('/v1/reserves', requireScope('read:reserves'), (req, res) => {
    // TODO: Proxy to reserve engine
    res.json({
      tenantId: req.tenantId || '',
      reserveBalance: 0,
      reserveShortfall: 0,
      reserveCoverageRatio: 0,
    });
  });

  /**
   * POST /v1/webhooks — Register webhook endpoint
   */
  router.post('/v1/webhooks', requireScope('write:webhooks'), (req, res) => {
    // TODO: Register webhook for event notifications
    res.status(201).json({
      tenantId: req.tenantId || '',
      webhookId: `wh_${Date.now()}`,
      url: req.body.url,
      events: req.body.events,
    });
  });

  /**
   * API key management (enterprise tier only)
   */
  router.post('/v1/api-keys', requireScope('admin:api_keys'), (req, res) => {
    try {
      const key = keyManager.generateKey(
        req.tenantId || '',
        req.body.tier,
        req.body.scopes
      );
      res.status(201).json({ keyId: key.keyId, tier: key.tier, scopes: key.scopes });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/v1/api-keys', requireScope('admin:api_keys'), (req, res) => {
    const keys = keyManager.getTenantKeys(req.tenantId || '');
    res.json(keys.map(k => ({
      keyId: k.keyId,
      tier: k.tier,
      scopes: k.scopes,
      active: k.active,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      usageCount: k.usageCount,
    })));
  });

  router.post('/v1/api-keys/:keyId/rotate', requireScope('admin:api_keys'), (req, res) => {
    try {
      const newKey = keyManager.rotateKey(req.params.keyId);
      res.json({ keyId: newKey.keyId, tier: newKey.tier, scopes: newKey.scopes });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/v1/api-keys/:keyId/revoke', requireScope('admin:api_keys'), (req, res) => {
    try {
      keyManager.revokeKey(req.params.keyId);
      res.json({ revoked: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /v1/scopes — List available API scopes for the current tier
   */
  router.get('/v1/scopes', (req, res) => {
    const tier = (req as any).apiKey?.tier as ApiTier;
    const available = AVAILABLE_SCOPES.filter(s => s.tiers.includes(tier));
    res.json(available);
  });

  return router;
}
