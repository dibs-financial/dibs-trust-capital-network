/**
 * DIBS Tests — API Marketplace
 */

import { ApiKeyManager, AVAILABLE_SCOPES, TIER_RATE_LIMITS, createApiMarketplaceRouter } from '../../backend/api/marketplace';

describe('API Key Manager', () => {
  let keyManager: ApiKeyManager;

  beforeEach(() => {
    keyManager = new ApiKeyManager();
  });

  describe('Key Generation', () => {
    it('generates a key with valid scopes for growth tier', () => {
      const key = keyManager.generateKey('tenant_1', 'growth', ['read:capital_requests', 'read:covenants']);
      expect(key.keyId).toBeDefined();
      expect(key.tier).toBe('growth');
      expect(key.scopes).toContain('read:capital_requests');
      expect(key.active).toBe(true);
    });

    it('generates a key with all scopes for enterprise tier', () => {
      const allScopes = AVAILABLE_SCOPES.map(s => s.name);
      const key = keyManager.generateKey('tenant_1', 'enterprise', allScopes);
      expect(key.scopes.length).toBe(allScopes.length);
    });

    it('rejects scope not available for tier', () => {
      expect(() => {
        keyManager.generateKey('tenant_1', 'growth', ['read:reserves']);
      }).toThrow('SCOPE_NOT_AVAILABLE_FOR_TIER');
    });

    it('rejects unknown scope', () => {
      expect(() => {
        keyManager.generateKey('tenant_1', 'growth', ['unknown:scope']);
      }).toThrow('UNKNOWN_SCOPE');
    });
  });

  describe('Key Validation', () => {
    it('validates a key with correct scope', () => {
      const key = keyManager.generateKey('tenant_1', 'institutional', ['read:tranche']);
      const result = keyManager.validateKey(key.keyId, 'read:tranche');
      expect(result.valid).toBe(true);
      expect(result.apiKey?.keyId).toBe(key.keyId);
    });

    it('rejects key with missing scope', () => {
      const key = keyManager.generateKey('tenant_1', 'growth', ['read:capital_requests']);
      const result = keyManager.validateKey(key.keyId, 'read:reserves');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('SCOPE_NOT_GRANTED');
    });

    it('rejects inactive key', () => {
      const key = keyManager.generateKey('tenant_1', 'growth', ['read:capital_requests']);
      keyManager.revokeKey(key.keyId);
      const result = keyManager.validateKey(key.keyId, 'read:capital_requests');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('API_KEY_INACTIVE');
    });

    it('rejects unknown key', () => {
      const result = keyManager.validateKey('nonexistent', 'read:capital_requests');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('API_KEY_NOT_FOUND');
    });
  });

  describe('Key Rotation', () => {
    it('rotates key and invalidates old key', () => {
      const key = keyManager.generateKey('tenant_1', 'institutional', ['read:tranche']);
      const newKey = keyManager.rotateKey(key.keyId);

      expect(newKey.keyId).not.toBe(key.keyId);
      expect(newKey.scopes).toEqual(key.scopes);
      expect(newKey.tier).toBe(key.tier);

      const oldResult = keyManager.validateKey(key.keyId, 'read:tranche');
      expect(oldResult.valid).toBe(false);
    });
  });

  describe('Key Revocation', () => {
    it('revokes a key', () => {
      const key = keyManager.generateKey('tenant_1', 'growth', ['read:capital_requests']);
      keyManager.revokeKey(key.keyId);

      const result = keyManager.validateKey(key.keyId, 'read:capital_requests');
      expect(result.valid).toBe(false);
    });
  });

  describe('Tenant Keys', () => {
    it('lists all keys for a tenant', () => {
      keyManager.generateKey('tenant_1', 'growth', ['read:capital_requests']);
      keyManager.generateKey('tenant_1', 'institutional', ['read:tranche', 'read:reserves']);
      keyManager.generateKey('tenant_2', 'growth', ['read:capital_requests']);

      const tenant1Keys = keyManager.getTenantKeys('tenant_1');
      expect(tenant1Keys.length).toBe(2);

      const tenant2Keys = keyManager.getTenantKeys('tenant_2');
      expect(tenant2Keys.length).toBe(1);
    });
  });

  describe('Tier Rate Limits', () => {
    it('growth tier has lowest rate limits', () => {
      expect(TIER_RATE_LIMITS.growth.perMinute).toBeLessThan(TIER_RATE_LIMITS.institutional.perMinute);
      expect(TIER_RATE_LIMITS.growth.perHour).toBeLessThan(TIER_RATE_LIMITS.institutional.perHour);
    });

    it('enterprise tier has highest rate limits', () => {
      expect(TIER_RATE_LIMITS.enterprise.perMinute).toBeGreaterThan(TIER_RATE_LIMITS.institutional.perMinute);
      expect(TIER_RATE_LIMITS.enterprise.perHour).toBeGreaterThan(TIER_RATE_LIMITS.institutional.perHour);
    });
  });

  describe('Available Scopes', () => {
    it('growth tier has access to basic read scopes', () => {
      const growthScopes = AVAILABLE_SCOPES.filter(s => s.tiers.includes('growth'));
      expect(growthScopes.some(s => s.name === 'read:capital_requests')).toBe(true);
      expect(growthScopes.some(s => s.name === 'read:covenants')).toBe(true);
    });

    it('enterprise tier has access to admin scopes', () => {
      const enterpriseScopes = AVAILABLE_SCOPES.filter(s => s.tiers.includes('enterprise'));
      expect(enterpriseScopes.some(s => s.name === 'admin:api_keys')).toBe(true);
      expect(enterpriseScopes.some(s => s.name === 'admin:whitelabel')).toBe(true);
    });

    it('institutional tier cannot access admin scopes', () => {
      const institutionalScopes = AVAILABLE_SCOPES.filter(s => s.tiers.includes('institutional'));
      expect(institutionalScopes.some(s => s.name === 'admin:api_keys')).toBe(false);
    });
  });
});
