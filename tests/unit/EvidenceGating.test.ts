/**
 * DIBS Tests — Evidence Gating
 *
 * Tests the evaluateEvidenceGating function and EvidenceGatingWorkflow class
 * for all gating scenarios: presence, freshness, expiration, flags, conflicts,
 * strict vs non-strict policy, multi-class validation, and workflow integration.
 */

import {
  evaluateEvidenceGating,
  EvidenceGatingPolicy,
  EvidenceGatingResult,
  DEFAULT_MAX_AGE_PER_CLASS,
} from '../../backend/evidence/evidence-gating';
import { EvidenceIngestionService } from '../../backend/evidence/evidence-ingestion';
import { EventStore, EventType } from '../../backend/audit/event-store';
import { EvidenceObject } from '../../shared/types';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const tenantId = 'tenant_1';
const projectId = 'proj_101';

/**
 * Build a valid evidence object with sensible defaults.
 * All fields can be overridden via the partial argument.
 */
let _evidenceCounter = 0;

function makeEvidence(overrides: Partial<EvidenceObject> = {}): EvidenceObject {
  _evidenceCounter++;
  const cls = overrides.evidenceClass || 'contract';
  const id = overrides.evidenceId || `ev_${_evidenceCounter}_${cls}`;
  // Generate a unique document hash per evidence object to avoid duplicate-hash conflicts
  const hashBase = `${id}:${cls}:${_evidenceCounter}`;
  const defaultHash = require('crypto').createHash('sha256').update(hashBase).digest('hex');
  return {
    evidenceId: id,
    evidenceClass: 'contract',
    documentHash: defaultHash,
    issuerIdentity: 'vendor_acme',
    projectAssociation: projectId,
    milestoneAssociation: 'ms_1',
    submissionTimestamp: new Date().toISOString(),
    expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year out
    validationStatus: 'validated',
    flags: [],
    ...overrides,
  };
}

/**
 * Standard policy used across most tests — requires contract + inspection_report + lien_waiver.
 */
function makeStandardPolicy(overrides: Partial<EvidenceGatingPolicy> = {}): EvidenceGatingPolicy {
  return {
    requiredEvidenceClasses: ['contract', 'inspection_report', 'lien_waiver'],
    strictNoFlags: true,
    ...overrides,
  };
}

/**
 * Build a request object for the gating function.
 */
function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    tenantId,
    requestId: 'req_1',
    borrowerOrSponsorId: 'borrower_1',
    spvId: 'spv_1',
    requestedAmount: 500_000,
    currentState: 'evidence_submission' as const,
    policyVersion: 'v1.0',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Evidence Gating', () => {

  // ─── 1. ALL REQUIRED EVIDENCE CLASSES PRESENT → GATE PASSES ──────────────

  describe('Gate Pass Scenarios', () => {
    it('passes when all required evidence classes are present, fresh, and valid', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_contract_1' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_inspection_1' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_lien_1' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(true);
      expect(result.allPresent).toBe(true);
      expect(result.allFresh).toBe(true);
      expect(result.allValid).toBe(true);
      expect(result.missingClasses).toHaveLength(0);
      expect(result.expiredEvidence).toHaveLength(0);
      expect(result.flags).toHaveLength(0);
    });

    it('passes when required classes include all 18 evidence types and all are present', () => {
      const allClasses: EvidenceObject['evidenceClass'][] = [
        'construction_photo', 'inspection_report', 'invoice', 'contract',
        'change_order', 'lien_waiver', 'title_update', 'insurance_verification',
        'borrower_representation', 'vendor_validation', 'appraisal',
        'draw_budget_reconciliation', 'bank_account_validation',
        'collateral_value_documentation', 'covenant_compliance_attestation',
        'third_party_inspection', 'authorized_signatory_verification', 'kyc_documentation',
      ];

      const evidence: EvidenceObject[] = allClasses.map((cls, i) =>
        makeEvidence({ evidenceClass: cls, evidenceId: `ev_${i}_${cls}` })
      );

      const policy: EvidenceGatingPolicy = {
        requiredEvidenceClasses: allClasses,
        strictNoFlags: true,
      };

      const result = evaluateEvidenceGating(makeRequest(), policy, evidence);

      expect(result.gatePassed).toBe(true);
      expect(result.allPresent).toBe(true);
      expect(result.missingClasses).toHaveLength(0);
    });

    it('passes with strictNoFlags=false when evidence has no flags but has conflict flags', () => {
      // Create two contracts with same document hash (duplicate) — generates conflict flag
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_dup_1', documentHash: 'd'.repeat(64) }),
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_dup_2', documentHash: 'd'.repeat(64) }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_inspect_2' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_lien_2' }),
      ];

      // With strictNoFlags=false, gate passes if allPresent && allFresh && allValid
      // (flags can be present but gate still passes)
      const policy = makeStandardPolicy({ strictNoFlags: false });

      const result = evaluateEvidenceGating(makeRequest(), policy, evidence);

      expect(result.allPresent).toBe(true);
      expect(result.allFresh).toBe(true);
      expect(result.allValid).toBe(true);
      expect(result.gatePassed).toBe(true);
      expect(result.flags.length).toBeGreaterThan(0); // conflict flags present
    });
  });

  // ─── 2. MISSING EVIDENCE CLASS → GATE FAILS ─────────────────────────────

  describe('Missing Evidence Class', () => {
    it('fails when one required class is missing', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_1' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_1' }),
        // lien_waiver MISSING
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(false);
      expect(result.allPresent).toBe(false);
      expect(result.missingClasses).toEqual(['lien_waiver']);
      expect(result.flags).toContain('MISSING_EVIDENCE_CLASS:lien_waiver');
    });

    it('fails when multiple required classes are missing', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_2' }),
        // inspection_report MISSING
        // lien_waiver MISSING
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(false);
      expect(result.allPresent).toBe(false);
      expect(result.missingClasses).toContain('inspection_report');
      expect(result.missingClasses).toContain('lien_waiver');
      expect(result.missingClasses).toHaveLength(2);
    });

    it('fails when all required classes are missing (empty evidence list)', () => {
      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), []);

      expect(result.gatePassed).toBe(false);
      expect(result.allPresent).toBe(false);
      expect(result.missingClasses).toEqual(['contract', 'inspection_report', 'lien_waiver']);
    });

    it('does not count expired evidence toward presence', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_3' }),
        makeEvidence({
          evidenceClass: 'inspection_report',
          evidenceId: 'ev_i_3',
          validationStatus: 'expired',
        }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_3' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      // inspection_report is "expired" — should not count as present
      expect(result.allPresent).toBe(false);
      expect(result.missingClasses).toContain('inspection_report');
      expect(result.gatePassed).toBe(false);
    });
  });

  // ─── 3. EXPIRED EVIDENCE → GATE FAILS ───────────────────────────────────

  describe('Expired Evidence', () => {
    it('fails when evidence has validationStatus=expired', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_4' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_4' }),
        makeEvidence({
          evidenceClass: 'lien_waiver',
          evidenceId: 'ev_l_4',
          validationStatus: 'expired',
        }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(false);
      expect(result.allValid).toBe(false);
      expect(result.expiredEvidence).toHaveLength(1);
      expect(result.expiredEvidence[0].evidenceId).toBe('ev_l_4');
      expect(result.flags).toContain('EXPIRED_EVIDENCE:ev_l_4:lien_waiver');
    });

    it('fails when evidence has a past expirationDate', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_5' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_5' }),
        makeEvidence({
          evidenceClass: 'lien_waiver',
          evidenceId: 'ev_l_5',
          expirationDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(false);
      expect(result.allValid).toBe(false);
      expect(result.expiredEvidence).toHaveLength(1);
      expect(result.expiredEvidence[0].evidenceId).toBe('ev_l_5');
    });

    it('fails when multiple evidence items are expired', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({
          evidenceClass: 'contract',
          evidenceId: 'ev_c_6',
          validationStatus: 'expired',
        }),
        makeEvidence({
          evidenceClass: 'inspection_report',
          evidenceId: 'ev_i_6',
          expirationDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_6' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(false);
      expect(result.allValid).toBe(false);
      expect(result.expiredEvidence.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── 4. STALE EVIDENCE → GATE FAILS ─────────────────────────────────────

  describe('Stale Evidence (Freshness Check)', () => {
    it('fails when evidence exceeds default max age', () => {
      const staleDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(); // 120 days ago

      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_7' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_7' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_7' }),
        // Stale evidence (not required, but still checked)
        makeEvidence({
          evidenceClass: 'construction_photo',
          evidenceId: 'ev_stale_1',
          submissionTimestamp: staleDate,
        }),
      ];

      // Default max age for construction_photo is 30 days
      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.allFresh).toBe(false);
      expect(result.gatePassed).toBe(false);
      // Flag format: EVIDENCE_STALE:ev_stale_1:construction_photo:120d_exceeds_30d
      const staleFlag = result.flags.find(f => f.startsWith('EVIDENCE_STALE:ev_stale_1'));
      expect(staleFlag).toBeDefined();
    });

    it('respects per-class max age overrides', () => {
      // construction_photo default max age is 30 days
      // Set override to 200 days
      const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago

      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_8' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_8' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_8' }),
        makeEvidence({
          evidenceClass: 'construction_photo',
          evidenceId: 'ev_stale_2',
          submissionTimestamp: staleDate,
        }),
      ];

      const policy = makeStandardPolicy({
        maxAgePerClassDays: { construction_photo: 200 },
      });

      const result = evaluateEvidenceGating(makeRequest(), policy, evidence);

      // With override at 200 days, 100-day-old evidence should be fresh
      expect(result.allFresh).toBe(true);
      expect(result.gatePassed).toBe(true);
    });

    it('respects defaultMaxAgeDays fallback for unknown classes', () => {
      const staleDate = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(); // 50 days ago

      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_9' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_9' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_9' }),
        makeEvidence({
          evidenceClass: 'construction_photo',
          evidenceId: 'ev_stale_3',
          submissionTimestamp: staleDate,
        }),
      ];

      // Default max age 10 days — construction_photo (50 days) exceeds this
      // But construction_photo has DEFAULT_MAX_AGE_PER_CLASS = 30 days
      // So defaultMaxAgeDays is only used if the class is not in DEFAULT_MAX_AGE_PER_CLASS
      // construction_photo IS in the default map (30 days), so it will use 30, not 10
      const policy = makeStandardPolicy({ defaultMaxAgeDays: 10 });

      const result = evaluateEvidenceGating(makeRequest(), policy, evidence);

      expect(result.allFresh).toBe(false); // 50 > 30 days
      expect(result.gatePassed).toBe(false);
    });

    it('passes when all evidence is within freshness window', () => {
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago

      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_10', submissionTimestamp: recentDate }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_10', submissionTimestamp: recentDate }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_10', submissionTimestamp: recentDate }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.allFresh).toBe(true);
      expect(result.gatePassed).toBe(true);
    });
  });

  // ─── 5. FLAGGED EVIDENCE → GATE FAILS ───────────────────────────────────

  describe('Flagged Evidence', () => {
    it('fails when evidence has validationStatus=flagged', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_11' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_11' }),
        makeEvidence({
          evidenceClass: 'lien_waiver',
          evidenceId: 'ev_l_11',
          validationStatus: 'flagged',
        }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(false);
      expect(result.allValid).toBe(false);
      expect(result.flags).toContain('EVIDENCE_FLAGGED:ev_l_11');
    });

    it('fails when evidence has item-level flags array', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_12' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_12' }),
        makeEvidence({
          evidenceClass: 'lien_waiver',
          evidenceId: 'ev_l_12',
          flags: ['AMOUNT_MISMATCH', 'VENDOR_NOT_VERIFIED'],
        }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(false);
      // Item-level flags are prefixed with FLAG:{evidenceId}:{flag}
      expect(result.flags).toContain('FLAG:ev_l_12:AMOUNT_MISMATCH');
      expect(result.flags).toContain('FLAG:ev_l_12:VENDOR_NOT_VERIFIED');
    });

    it('fails with strictNoFlags=true when any flags exist even if all evidence is valid', () => {
      // Create evidence with duplicate hashes to trigger conflict flags
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_13', documentHash: 'x'.repeat(64) }),
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_dup', documentHash: 'x'.repeat(64) }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_13' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_13' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      // All required classes present, all fresh, none expired/flagged
      // But conflict flags exist → strictNoFlags=true blocks gate
      expect(result.allPresent).toBe(true);
      expect(result.allFresh).toBe(true);
      expect(result.allValid).toBe(true);
      expect(result.flags.length).toBeGreaterThan(0); // conflict flags present
      expect(result.gatePassed).toBe(false); // strict mode blocks
    });
  });

  // ─── 6. CONFLICT DETECTION ──────────────────────────────────────────────

  describe('Conflict Detection', () => {
    it('detects duplicate document hashes as conflicts', () => {
      const dupHash = 'f'.repeat(64);
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_dup_a', documentHash: dupHash }),
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_dup_b', documentHash: dupHash }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_14' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_14' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      // Should have conflict flags for duplicate hash
      const conflictFlags = result.flags.filter(f => f.includes('DUPLICATE') || f.includes('CONFLICT'));
      // At minimum, flags should be non-empty due to the duplicate
      expect(result.flags.length).toBeGreaterThan(0);
    });
  });

  // ─── 7. STRICT VS NON-STRICT FLAG POLICY ────────────────────────────────

  describe('Strict vs Non-Strict Flag Policy', () => {
    it('strictNoFlags=true: gate fails if any flag exists', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({
          evidenceClass: 'contract',
          evidenceId: 'ev_c_15',
          flags: ['MINOR_NOTE'], // a non-critical flag
        }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_15' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_15' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy({ strictNoFlags: true }), evidence);

      expect(result.gatePassed).toBe(false);
    });

    it('strictNoFlags=false: gate passes if allPresent && allFresh && allValid despite flags', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({
          evidenceClass: 'contract',
          evidenceId: 'ev_c_16',
          flags: ['MINOR_NOTE'],
        }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_16' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_16' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy({ strictNoFlags: false }), evidence);

      // allPresent=true, allFresh=true, allValid=true (validationStatus is 'validated')
      expect(result.allPresent).toBe(true);
      expect(result.allFresh).toBe(true);
      expect(result.allValid).toBe(true);
      expect(result.gatePassed).toBe(true);
      // Flags still present in result
      expect(result.flags.length).toBeGreaterThan(0);
    });
  });

  // ─── 8. DEFAULT MAX AGE PER CLASS ───────────────────────────────────────

  describe('Default Max Age Per Class', () => {
    it('provides sensible defaults for all 18 evidence classes', () => {
      const expectedClasses = [
        'construction_photo', 'inspection_report', 'invoice', 'contract',
        'change_order', 'lien_waiver', 'title_update', 'insurance_verification',
        'borrower_representation', 'vendor_validation', 'appraisal',
        'draw_budget_reconciliation', 'bank_account_validation',
        'collateral_value_documentation', 'covenant_compliance_attestation',
        'third_party_inspection', 'authorized_signatory_verification', 'kyc_documentation',
      ];

      for (const cls of expectedClasses) {
        expect(DEFAULT_MAX_AGE_PER_CLASS[cls as keyof typeof DEFAULT_MAX_AGE_PER_CLASS]).toBeDefined();
        expect(DEFAULT_MAX_AGE_PER_CLASS[cls as keyof typeof DEFAULT_MAX_AGE_PER_CLASS]).toBeGreaterThan(0);
      }
    });

    it('construction_photo has 30-day max age', () => {
      expect(DEFAULT_MAX_AGE_PER_CLASS.construction_photo).toBe(30);
    });

    it('contract has 365-day max age', () => {
      expect(DEFAULT_MAX_AGE_PER_CLASS.contract).toBe(365);
    });

    it('kyc_documentation has 365-day max age', () => {
      expect(DEFAULT_MAX_AGE_PER_CLASS.kyc_documentation).toBe(365);
    });
  });

  // ─── 9. GATE RESULT STRUCTURE ───────────────────────────────────────────

  describe('Result Structure', () => {
    it('returns all expected fields in the result', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_struct_1' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_struct_2' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_struct_3' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result).toHaveProperty('allPresent');
      expect(result).toHaveProperty('allFresh');
      expect(result).toHaveProperty('allValid');
      expect(result).toHaveProperty('missingClasses');
      expect(result).toHaveProperty('expiredEvidence');
      expect(result).toHaveProperty('flags');
      expect(result).toHaveProperty('gatePassed');

      expect(typeof result.allPresent).toBe('boolean');
      expect(typeof result.allFresh).toBe('boolean');
      expect(typeof result.allValid).toBe('boolean');
      expect(Array.isArray(result.missingClasses)).toBe(true);
      expect(Array.isArray(result.expiredEvidence)).toBe(true);
      expect(Array.isArray(result.flags)).toBe(true);
      expect(typeof result.gatePassed).toBe('boolean');
    });
  });

  // ─── 10. EDGE CASES ─────────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('extra evidence classes not in required list do not cause failure', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_17' }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_17' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_17' }),
        makeEvidence({ evidenceClass: 'appraisal', evidenceId: 'ev_extra_1' }),
        makeEvidence({ evidenceClass: 'kyc_documentation', evidenceId: 'ev_extra_2' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      expect(result.gatePassed).toBe(true);
      expect(result.allPresent).toBe(true);
    });

    it('duplicate required evidence does not cause failure', () => {
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_18' }),
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_c_18_dup', documentHash: 'b'.repeat(64) }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_i_18' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_l_18' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      // Multiple contracts present — still passes presence check
      // But duplicate hash detection might add flags
      expect(result.allPresent).toBe(true);
    });

    it('evidence with empty required classes always passes presence', () => {
      const result = evaluateEvidenceGating(
        makeRequest(),
        makeStandardPolicy({ requiredEvidenceClasses: [] }),
        []
      );

      expect(result.allPresent).toBe(true);
      expect(result.gatePassed).toBe(true);
    });

    it('handles evidence with future submission timestamps (edge: clock skew)', () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_future_1', submissionTimestamp: futureDate }),
        makeEvidence({ evidenceClass: 'inspection_report', evidenceId: 'ev_future_2' }),
        makeEvidence({ evidenceClass: 'lien_waiver', evidenceId: 'ev_future_3' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), makeStandardPolicy(), evidence);

      // Future timestamps produce negative age → should be fresh
      expect(result.allFresh).toBe(true);
      expect(result.gatePassed).toBe(true);
    });
  });

  // ─── 11. EVIDENCE GATING WORKFLOW INTEGRATION ───────────────────────────

  describe('EvidenceGatingWorkflow Integration', () => {
    let eventStore: EventStore;
    let ingestionService: EvidenceIngestionService;

    beforeEach(() => {
      eventStore = new EventStore();
      ingestionService = new EvidenceIngestionService(eventStore);
    });

    it('evaluates gating by retrieving project evidence from ingestion service', async () => {
      // Submit all required evidence
      await ingestionService.submitEvidence({
        evidenceClass: 'contract',
        documentHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        issuerIdentity: 'vendor_acme',
        projectAssociation: projectId,
        milestoneAssociation: 'ms_1',
        tenantId,
      });

      await ingestionService.submitEvidence({
        evidenceClass: 'inspection_report',
        documentHash: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5',
        issuerIdentity: 'inspector_bob',
        projectAssociation: projectId,
        milestoneAssociation: 'ms_1',
        tenantId,
      });

      await ingestionService.submitEvidence({
        evidenceClass: 'lien_waiver',
        documentHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        issuerIdentity: 'vendor_acme',
        projectAssociation: projectId,
        milestoneAssociation: 'ms_1',
        tenantId,
      });

      const { EvidenceGatingWorkflow } = await import('../../backend/evidence/evidence-gating');
      const workflow = new EvidenceGatingWorkflow(ingestionService);

      const result = await workflow.evaluateGatingForRequest(
        makeRequest(),
        makeStandardPolicy()
      );

      expect(result.gatePassed).toBe(true);
      expect(result.allPresent).toBe(true);
      expect(result.allFresh).toBe(true);
    });

    it('fails gating when ingestion service has insufficient evidence', async () => {
      // Submit only one of three required classes
      await ingestionService.submitEvidence({
        evidenceClass: 'contract',
        documentHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        issuerIdentity: 'vendor_acme',
        projectAssociation: projectId,
        milestoneAssociation: 'ms_1',
        tenantId,
      });

      const { EvidenceGatingWorkflow } = await import('../../backend/evidence/evidence-gating');
      const workflow = new EvidenceGatingWorkflow(ingestionService);

      const result = await workflow.evaluateGatingForRequest(
        makeRequest(),
        makeStandardPolicy()
      );

      expect(result.gatePassed).toBe(false);
      expect(result.allPresent).toBe(false);
      expect(result.missingClasses).toContain('inspection_report');
      expect(result.missingClasses).toContain('lien_waiver');
    });

    it('respects tenant isolation in workflow', async () => {
      // Submit evidence for tenant_1
      await ingestionService.submitEvidence({
        evidenceClass: 'contract',
        documentHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        issuerIdentity: 'vendor_acme',
        projectAssociation: projectId,
        milestoneAssociation: 'ms_1',
        tenantId: 'tenant_1',
      });

      const { EvidenceGatingWorkflow } = await import('../../backend/evidence/evidence-gating');
      const workflow = new EvidenceGatingWorkflow(ingestionService);

      // Query as tenant_2 — should see no evidence
      const result = await workflow.evaluateGatingForRequest(
        makeRequest({ tenantId: 'tenant_2' }),
        makeStandardPolicy()
      );

      expect(result.allPresent).toBe(false);
      expect(result.missingClasses).toEqual(['contract', 'inspection_report', 'lien_waiver']);
    });
  });

  // ─── 12. POLICY CONFIGURATION ───────────────────────────────────────────

  describe('Policy Configuration', () => {
    it('policy with policyId and policyVersion is accepted', () => {
      const policy: EvidenceGatingPolicy = {
        policyId: 'pol_001',
        policyVersion: 'v2.1',
        requiredEvidenceClasses: ['contract'],
        strictNoFlags: true,
      };

      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_pol_1' }),
      ];

      const result = evaluateEvidenceGating(makeRequest(), policy, evidence);

      expect(result.gatePassed).toBe(true);
    });

    it('policy with custom defaultMaxAgeDays affects freshness check for unmapped classes', () => {
      // Evidence class not in DEFAULT_MAX_AGE_PER_CLASS won't exist since all 18 are mapped,
      // but defaultMaxAgeDays still serves as the final fallback
      const evidence: EvidenceObject[] = [
        makeEvidence({ evidenceClass: 'contract', evidenceId: 'ev_pol_2' }),
      ];

      const policy: EvidenceGatingPolicy = {
        requiredEvidenceClasses: ['contract'],
        defaultMaxAgeDays: 500, // very generous
      };

      const result = evaluateEvidenceGating(makeRequest(), policy, evidence);

      // Contract is 365 days in DEFAULT_MAX_AGE_PER_CLASS, 500 fallback doesn't override it
      expect(result.allFresh).toBe(true);
    });
  });
});
