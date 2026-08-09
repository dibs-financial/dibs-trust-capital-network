/**
 * DIBS Tests — Evidence Ingestion
 */

import {
  EvidenceIngestionService,
  EvidenceSubmissionInput,
  computeSHA256,
  validateEvidencePipeline,
  VALID_EVIDENCE_CLASSES,
  EvidenceClassEnum,
  ExtendedEvidenceObject,
} from '../../backend/evidence/evidence-ingestion';
import { EventStore, EventType } from '../../backend/audit/event-store';

describe('Evidence Ingestion Service', () => {
  let eventStore: EventStore;
  let service: EvidenceIngestionService;

  const validHash = 'a'.repeat(64);
  const tenantId = 'tenant_1';
  const projectId = 'proj_101';
  const milestoneId = 'ms_1';

  beforeEach(() => {
    eventStore = new EventStore();
    service = new EvidenceIngestionService(eventStore);
  });

  describe('SHA-256 Computation Utility', () => {
    it('computes correct SHA-256 hash for string and buffer inputs', () => {
      const text = 'DIBS Trust Network Evidence Payload';
      const hash1 = computeSHA256(text);
      const hash2 = computeSHA256(Buffer.from(text));

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
      expect(/^[a-f0-9]{64}$/.test(hash1)).toBe(true);
    });
  });

  describe('Evidence Record Creation - Valid Data', () => {
    it('creates an evidence record when submitted with raw document content', async () => {
      const input: EvidenceSubmissionInput = {
        evidenceClass: 'contract',
        documentContent: 'Contract #1001 for development services',
        issuerIdentity: 'vendor_acme',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        actorId: 'user_1',
        actorRole: 'borrower',
      };

      const result = await service.submitEvidence(input);

      expect(result.evidenceId).toMatch(/^ev_\d+_[a-z0-9]+$/);
      expect(result.evidenceClass).toBe('contract');
      expect(result.tenantId).toBe(tenantId);
      expect(result.projectAssociation).toBe(projectId);
      expect(result.milestoneAssociation).toBe(milestoneId);
      expect(result.issuerIdentity).toBe('vendor_acme');
      expect(result.documentHash).toBe(computeSHA256('Contract #1001 for development services'));
      expect(result.validationStatus).toBe('validated');
      expect(result.flags).toHaveLength(0);

      // Verify audit event in EventStore
      const events = await eventStore.getByTenant(tenantId);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe(EventType.EVIDENCE_SUBMITTED);
      expect(events[0].actorId).toBe('user_1');
      expect(events[0].metadata.evidenceId).toBe(result.evidenceId);
    });

    it('creates an evidence record when submitted with a valid 64-char document hash', async () => {
      const input: EvidenceSubmissionInput = {
        evidenceClass: 'inspection_report',
        documentHash: validHash,
        issuerIdentity: 'inspector_bob',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      };

      const result = await service.submitEvidence(input);

      expect(result.documentHash).toBe(validHash);
      expect(result.validationStatus).toBe('validated');
      expect(result.issuerIdentity).toBe('inspector_bob');
    });
  });

  describe('Evidence Record Creation - Invalid Data', () => {
    it('throws error if tenantId is missing', async () => {
      const input: EvidenceSubmissionInput = {
        evidenceClass: 'invoice',
        documentHash: validHash,
        issuerIdentity: 'issuer_1',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId: '',
      };

      await expect(service.submitEvidence(input)).rejects.toThrow('TENANT_ID_REQUIRED');
    });

    it('throws error if projectAssociation is missing', async () => {
      const input: EvidenceSubmissionInput = {
        evidenceClass: 'invoice',
        documentHash: validHash,
        issuerIdentity: 'issuer_1',
        projectAssociation: '',
        milestoneAssociation: milestoneId,
        tenantId,
      };

      await expect(service.submitEvidence(input)).rejects.toThrow('PROJECT_ASSOCIATION_REQUIRED');
    });

    it('throws error if evidenceClass is invalid', async () => {
      const input = {
        evidenceClass: 'invalid_class_xyz' as any,
        documentHash: validHash,
        issuerIdentity: 'issuer_1',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      };

      await expect(service.submitEvidence(input)).rejects.toThrow('INVALID_EVIDENCE_CLASS: invalid_class_xyz');
    });

    it('throws error if both documentContent and documentHash are missing', async () => {
      const input: EvidenceSubmissionInput = {
        evidenceClass: 'invoice',
        issuerIdentity: 'issuer_1',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      };

      await expect(service.submitEvidence(input)).rejects.toThrow('DOCUMENT_HASH_OR_CONTENT_REQUIRED');
    });

    it('flags evidence record if documentHash is invalid format', async () => {
      const input: EvidenceSubmissionInput = {
        evidenceClass: 'contract',
        documentHash: 'short-hash-123',
        issuerIdentity: 'issuer_1',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      };

      const result = await service.submitEvidence(input);

      expect(result.validationStatus).toBe('flagged');
      expect(result.flags).toContain('INVALID_DOCUMENT_HASH_FORMAT:short-hash-123');
    });

    it('flags evidence record if issuerIdentity is empty string', async () => {
      const sampleItem: ExtendedEvidenceObject = {
        evidenceId: 'ev_test_1',
        evidenceClass: 'contract',
        documentHash: validHash,
        issuerIdentity: '',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        submissionTimestamp: new Date().toISOString(),
        expirationDate: '',
        validationStatus: 'pending',
        flags: [],
        tenantId,
      };

      const report = validateEvidencePipeline(sampleItem);

      expect(report.checks.issuerValid).toBe(false);
      expect(report.flags).toContain('INVALID_ISSUER_IDENTITY');
    });
  });

  describe('Evidence Type Validation (document, signal, oracle, manual)', () => {
    it('supports all 18 standard Evidence Class Enums', () => {
      expect(VALID_EVIDENCE_CLASSES).toHaveLength(18);
      expect(Object.keys(EvidenceClassEnum)).toHaveLength(18);
    });

    it('validates document evidence types (e.g. contract, construction_photo, lien_waiver)', async () => {
      const documentClasses = ['contract', 'construction_photo', 'lien_waiver'] as const;

      for (const cls of documentClasses) {
        const result = await service.submitEvidence({
          evidenceClass: cls,
          documentHash: computeSHA256(`doc_content_${cls}`),
          issuerIdentity: 'doc_issuer',
          projectAssociation: projectId,
          milestoneAssociation: milestoneId,
          tenantId,
        });
        expect(result.evidenceClass).toBe(cls);
        expect(result.validationStatus).toBe('validated');
      }
    });

    it('validates signal evidence types (e.g. covenant_compliance_attestation, borrower_representation)', async () => {
      const signalClasses = ['covenant_compliance_attestation', 'borrower_representation'] as const;

      for (const cls of signalClasses) {
        const result = await service.submitEvidence({
          evidenceClass: cls,
          documentHash: computeSHA256(`signal_content_${cls}`),
          issuerIdentity: 'signal_issuer',
          projectAssociation: projectId,
          milestoneAssociation: milestoneId,
          tenantId,
        });
        expect(result.evidenceClass).toBe(cls);
        expect(result.validationStatus).toBe('validated');
      }
    });

    it('validates oracle evidence types (e.g. third_party_inspection, appraisal, title_update)', async () => {
      const oracleClasses = ['third_party_inspection', 'appraisal', 'title_update'] as const;

      for (const cls of oracleClasses) {
        const result = await service.submitEvidence({
          evidenceClass: cls,
          documentHash: computeSHA256(`oracle_content_${cls}`),
          issuerIdentity: 'oracle_provider',
          projectAssociation: projectId,
          milestoneAssociation: milestoneId,
          tenantId,
        });
        expect(result.evidenceClass).toBe(cls);
        expect(result.validationStatus).toBe('validated');
      }
    });

    it('validates manual evidence types (e.g. authorized_signatory_verification, kyc_documentation)', async () => {
      const manualClasses = ['authorized_signatory_verification', 'kyc_documentation'] as const;

      for (const cls of manualClasses) {
        const result = await service.submitEvidence({
          evidenceClass: cls,
          documentHash: computeSHA256(`manual_content_${cls}`),
          issuerIdentity: 'compliance_officer',
          projectAssociation: projectId,
          milestoneAssociation: milestoneId,
          tenantId,
        });
        expect(result.evidenceClass).toBe(cls);
        expect(result.validationStatus).toBe('validated');
      }
    });
  });

  describe('Evidence Source & Actor Validation', () => {
    it('defaults issuer identity when omitted or unknown', async () => {
      const result = await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('contract_default_issuer'),
        issuerIdentity: '',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      expect(result.issuerIdentity).toBe('UNKNOWN_ISSUER');
    });

    it('records actor and policy context in submission events', async () => {
      await service.submitEvidence({
        evidenceClass: 'insurance_verification',
        documentHash: computeSHA256('insurance_actor_context'),
        issuerIdentity: 'state_farm',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        actorId: 'agent_42',
        actorRole: 'underwriter',
        policyVersion: 'v2.1',
      });

      const events = await eventStore.getByTenant(tenantId);
      expect(events[0].actorId).toBe('agent_42');
      expect(events[0].actorRole).toBe('underwriter');
      expect(events[0].policyVersion).toBe('v2.1');
    });

    it('flags evidence when approval status is pending or rejected', async () => {
      const pendingResult = await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('pending_contract'),
        issuerIdentity: 'vendor_1',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        approvalStatus: 'pending',
      });
      expect(pendingResult.validationStatus).toBe('flagged');
      expect(pendingResult.flags).toContain('APPROVAL_PENDING');

      const rejectedResult = await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('rejected_contract'),
        issuerIdentity: 'vendor_1',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        approvalStatus: 'rejected',
      });
      expect(rejectedResult.validationStatus).toBe('flagged');
      expect(rejectedResult.flags).toContain('APPROVAL_REJECTED');
    });
  });

  describe('Evidence Timestamp & Freshness Validation', () => {
    it('sets current ISO timestamp upon submission', async () => {
      const before = new Date().getTime();
      const result = await service.submitEvidence({
        evidenceClass: 'title_update',
        documentHash: computeSHA256('title_update_timestamp'),
        issuerIdentity: 'title_co',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });
      const after = new Date().getTime();

      const timestamp = new Date(result.submissionTimestamp).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('flags expired evidence when expiration date is in the past', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago

      const result = await service.submitEvidence({
        evidenceClass: 'insurance_verification',
        documentHash: computeSHA256('expired_insurance'),
        issuerIdentity: 'insurer',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        expirationDate: pastDate,
      });

      expect(result.validationStatus).toBe('expired');
      expect(result.flags).toContain(`EVIDENCE_EXPIRED:${result.evidenceId}`);

      const events = await eventStore.getByTenant(tenantId);
      const expiredEvent = events.find(e => e.eventType === EventType.EVIDENCE_EXPIRED);
      expect(expiredEvent).toBeDefined();
    });

    it('flags stale evidence during re-validation when age exceeds maxAgeDays', async () => {
      const submitted = await service.submitEvidence({
        evidenceClass: 'inspection_report',
        documentHash: computeSHA256('inspection_stale'),
        issuerIdentity: 'inspector',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      // Override submissionTimestamp to 100 days ago
      const item = await service.getEvidenceById(submitted.evidenceId, tenantId);
      if (item) {
        item.submissionTimestamp = new Date(Date.now() - 100 * 86400000).toISOString();
      }

      const reval = await service.validateEvidence(submitted.evidenceId, tenantId, { maxAgeDays: 90 });
      expect(reval.evidence.validationStatus).toBe('flagged');
      expect(reval.report.checks.freshness).toBe(false);
      expect(reval.report.flags).toContain('EVIDENCE_STALE:exceeds_90_days');
    });
  });

  describe('Duplicate Evidence Rejection & Conflict Detection', () => {
    it('detects duplicate invoice numbers for the same vendor', async () => {
      await service.submitEvidence({
        evidenceClass: 'invoice',
        documentHash: computeSHA256('inv_1_content'),
        issuerIdentity: 'vendor_a',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        invoiceNumber: 'INV-999',
        vendorId: 'VENDOR_A',
      });

      const duplicate = await service.submitEvidence({
        evidenceClass: 'invoice',
        documentHash: computeSHA256('inv_2_content'),
        issuerIdentity: 'vendor_a',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        invoiceNumber: 'INV-999',
        vendorId: 'VENDOR_A',
      });

      expect(duplicate.validationStatus).toBe('flagged');
      expect(duplicate.flags).toContain('DUPLICATE_INVOICE_NUMBER:INV-999:VENDOR_A');
    });

    it('detects duplicate document hash across invoice records', async () => {
      const sharedHash = computeSHA256('identical invoice PDF content');

      await service.submitEvidence({
        evidenceClass: 'invoice',
        documentHash: sharedHash,
        issuerIdentity: 'vendor_1',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        invoiceNumber: 'INV-001',
      });

      const duplicate = await service.submitEvidence({
        evidenceClass: 'invoice',
        documentHash: sharedHash,
        issuerIdentity: 'vendor_2',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        invoiceNumber: 'INV-002',
      });

      expect(duplicate.validationStatus).toBe('flagged');
      expect(duplicate.flags).toContain(`DUPLICATE_INVOICE_HASH:${sharedHash}`);
    });

    it('detects missing lien waiver when invoice is submitted', async () => {
      const result = await service.submitEvidence({
        evidenceClass: 'invoice',
        documentHash: computeSHA256('invoice_missing_lien'),
        issuerIdentity: 'vendor_x',
        projectAssociation: projectId,
        milestoneAssociation: 'milestone_no_lien',
        tenantId,
      });

      expect(result.validationStatus).toBe('flagged');
      expect(result.flags).toContain('MISSING_LIEN_WAIVER:milestone=milestone_no_lien');
    });

    it('detects budget category inconsistency', async () => {
      // First submit lien waiver so missing lien waiver flag is not triggered
      await service.submitEvidence({
        evidenceClass: 'lien_waiver',
        documentHash: computeSHA256('lien waiver content'),
        issuerIdentity: 'subcontractor',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      const invoiceWithMismatch = await service.submitEvidence({
        evidenceClass: 'invoice',
        documentHash: computeSHA256('invoice_budget_mismatch'),
        issuerIdentity: 'vendor_x',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        drawCategory: 'plumbing',
        expectedCategory: 'electrical',
      });

      expect(invoiceWithMismatch.validationStatus).toBe('flagged');
      expect(invoiceWithMismatch.flags).toContain('INCONSISTENT_BUDGET_CATEGORY:requested=plumbing:expected=electrical');
    });

    it('detects collateral value deterioration and minimum shortfall', async () => {
      const result = await service.submitEvidence({
        evidenceClass: 'appraisal',
        documentHash: computeSHA256('appraisal_deterioration'),
        issuerIdentity: 'appraiser_1',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        appraisalValue: 800000,
        minRequiredCollateralValue: 1000000,
        previousAppraisalValue: 950000,
      });

      expect(result.validationStatus).toBe('flagged');
      expect(result.flags).toContain('COLLATERAL_VALUE_BELOW_MINIMUM:appraisal=800000:min_required=1000000');
      expect(result.flags.some(f => f.startsWith('COLLATERAL_VALUE_DETERIORATION:'))).toBe(true);
    });

    it('detects payment destination changes without bank validation', async () => {
      const result = await service.submitEvidence({
        evidenceClass: 'draw_budget_reconciliation',
        documentHash: computeSHA256('draw_budget_dest_change'),
        issuerIdentity: 'treasurer',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
        paymentDestination: 'unverified_acct_888',
        verifiedPaymentDestination: 'verified_acct_111',
      });

      expect(result.validationStatus).toBe('flagged');
      expect(result.flags).toContain('PAYMENT_DESTINATION_CHANGE:unverified_destination=unverified_acct_888:verified=verified_acct_111');
    });
  });

  describe('Evidence Retrieval by ID', () => {
    it('retrieves evidence by ID for the matching tenant', async () => {
      const created = await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('contract_retrieval_test'),
        issuerIdentity: 'law_firm',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      const retrieved = await service.getEvidenceById(created.evidenceId, tenantId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.evidenceId).toBe(created.evidenceId);
      expect(retrieved?.issuerIdentity).toBe('law_firm');
    });

    it('returns null when retrieving evidence with a non-matching tenant (tenant isolation)', async () => {
      const created = await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('contract_tenant_iso'),
        issuerIdentity: 'law_firm',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      const retrieved = await service.getEvidenceById(created.evidenceId, 'other_tenant');

      expect(retrieved).toBeNull();
    });

    it('returns null for non-existent evidenceId', async () => {
      const retrieved = await service.getEvidenceById('ev_nonexistent_999', tenantId);

      expect(retrieved).toBeNull();
    });
  });

  describe('Evidence Listing with Filters', () => {
    it('lists all evidence records for a project within a tenant', async () => {
      await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('contract_listing_1'),
        issuerIdentity: 'law_firm',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      await service.submitEvidence({
        evidenceClass: 'appraisal',
        documentHash: computeSHA256('appraisal PDF 2'),
        issuerIdentity: 'appraiser',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('other contract 3'),
        issuerIdentity: 'law_firm',
        projectAssociation: 'proj_202',
        milestoneAssociation: milestoneId,
        tenantId,
      });

      const proj101Items = await service.getEvidenceByProject(projectId, tenantId);

      expect(proj101Items).toHaveLength(2);
      expect(proj101Items.every(item => item.projectAssociation === projectId)).toBe(true);
    });

    it('lists only flagged evidence for a project', async () => {
      // Valid contract
      await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('clean_contract_listing'),
        issuerIdentity: 'law_firm',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      // Flagged invoice (missing lien waiver)
      await service.submitEvidence({
        evidenceClass: 'invoice',
        documentHash: computeSHA256('flagged_invoice_listing'),
        issuerIdentity: 'vendor',
        projectAssociation: projectId,
        milestoneAssociation: 'm_uncovered',
        tenantId,
      });

      const flaggedList = await service.getFlaggedEvidenceByProject(projectId, tenantId);

      expect(flaggedList).toHaveLength(1);
      expect(flaggedList[0].evidenceClass).toBe('invoice');
      expect(flaggedList[0].validationStatus).toBe('flagged');
    });

    it('enforces tenant isolation during project listing', async () => {
      await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('contract_tenant_listing'),
        issuerIdentity: 'law_firm',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId: 'tenant_A',
      });

      const tenantBItems = await service.getEvidenceByProject(projectId, 'tenant_B');

      expect(tenantBItems).toHaveLength(0);
    });
  });

  describe('Explicit Re-validation API', () => {
    it('throws error when re-validating non-existent evidence', async () => {
      await expect(service.validateEvidence('ev_missing', tenantId)).rejects.toThrow('EVIDENCE_NOT_FOUND: ev_missing');
    });

    it('emits EVIDENCE_VALIDATED event when re-validating a clean evidence record', async () => {
      const created = await service.submitEvidence({
        evidenceClass: 'contract',
        documentHash: computeSHA256('reval_contract_content'),
        issuerIdentity: 'attorney',
        projectAssociation: projectId,
        milestoneAssociation: milestoneId,
        tenantId,
      });

      const reval = await service.validateEvidence(created.evidenceId, tenantId);

      expect(reval.evidence.validationStatus).toBe('validated');
      expect(reval.report.valid).toBe(true);

      const events = await eventStore.getByTenant(tenantId);
      const validatedEvent = events.find(e => e.eventType === EventType.EVIDENCE_VALIDATED);
      expect(validatedEvent).toBeDefined();
    });
  });
});
