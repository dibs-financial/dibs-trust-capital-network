/**
 * DIBS Tests — Evidence Ingestion Service & Routes Unit Tests
 *
 * Tests evidence submission, document hashing, validation pipeline,
 * conflict detection, 18 evidence classes, and event store logging.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvidenceIngestionService,
  EvidenceClassEnum,
  VALID_EVIDENCE_CLASSES,
  computeSHA256,
  detectEvidenceConflicts,
  validateEvidencePipeline,
  ExtendedEvidenceObject,
} from '../../backend/evidence/evidence-ingestion';
import { EventStore, EventType } from '../../backend/audit/event-store';

describe('Evidence Ingestion Service', () => {
  let eventStore: EventStore;
  let service: EvidenceIngestionService;

  beforeEach(() => {
    eventStore = new EventStore();
    service = new EvidenceIngestionService(eventStore);
  });

  describe('18 Evidence Classes Enum', () => {
    it('contains exactly 18 evidence classes', () => {
      expect(VALID_EVIDENCE_CLASSES).toHaveLength(18);
    });

    it('contains all required standard evidence classes', () => {
      const required = [
        'construction_photo',
        'inspection_report',
        'invoice',
        'contract',
        'change_order',
        'lien_waiver',
        'title_update',
        'insurance_verification',
        'borrower_representation',
        'vendor_validation',
        'appraisal',
        'draw_budget_reconciliation',
        'bank_account_validation',
        'collateral_value_documentation',
        'covenant_compliance_attestation',
        'third_party_inspection',
        'authorized_signatory_verification',
        'kyc_documentation',
      ];

      for (const cls of required) {
        expect(VALID_EVIDENCE_CLASSES).toContain(cls);
      }
    });
  });

  describe('Document Hashing', () => {
    it('computes correct SHA-256 hash for string content', () => {
      const hash = computeSHA256('sample invoice document content');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('computes hash when document content Buffer is provided in submission', async () => {
      const evidence = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.INVOICE,
        documentContent: Buffer.from('Invoice #1001 for electrical work'),
        issuerIdentity: 'Vendor Alpha LLC',
        projectAssociation: 'proj_100',
        milestoneAssociation: 'ms_1',
        tenantId: 'tenant_dibs_1',
      });

      expect(evidence.documentHash).toBe(computeSHA256('Invoice #1001 for electrical work'));
      expect(evidence.validationStatus).toBe('validated');
    });
  });

  describe('Evidence Submission & Event Store Emission', () => {
    it('stores evidence record and emits EVIDENCE_SUBMITTED event', async () => {
      const evidence = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.INSPECTION_REPORT,
        documentHash: 'a'.repeat(64),
        issuerIdentity: 'Inspector Bob',
        projectAssociation: 'proj_100',
        milestoneAssociation: 'ms_1',
        tenantId: 'tenant_dibs_1',
      });

      expect(evidence.evidenceId).toBeDefined();
      expect(evidence.tenantId).toBe('tenant_dibs_1');

      const events = await eventStore.getByTenant('tenant_dibs_1');
      expect(events.length).toBeGreaterThanOrEqual(1);

      const submittedEvent = events.find(e => e.eventType === EventType.EVIDENCE_SUBMITTED);
      expect(submittedEvent).toBeDefined();
      expect((submittedEvent?.metadata as any).evidenceId).toBe(evidence.evidenceId);
    });

    it('rejects invalid evidence class', async () => {
      await expect(
        service.submitEvidence({
          evidenceClass: 'invalid_class' as any,
          documentHash: 'a'.repeat(64),
          issuerIdentity: 'Inspector Bob',
          projectAssociation: 'proj_100',
          milestoneAssociation: 'ms_1',
          tenantId: 'tenant_dibs_1',
        })
      ).rejects.toThrow('INVALID_EVIDENCE_CLASS');
    });

    it('rejects missing tenant ID', async () => {
      await expect(
        service.submitEvidence({
          evidenceClass: EvidenceClassEnum.INVOICE,
          documentHash: 'a'.repeat(64),
          issuerIdentity: 'Vendor',
          projectAssociation: 'proj_100',
          milestoneAssociation: 'ms_1',
          tenantId: '',
        })
      ).rejects.toThrow('TENANT_ID_REQUIRED');
    });
  });

  describe('Conflict Detection Scenarios', () => {
    it('detects duplicate invoice number for same vendor', async () => {
      const firstInvoice = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.INVOICE,
        documentHash: '1'.repeat(64),
        issuerIdentity: 'Vendor Alpha',
        projectAssociation: 'proj_100',
        milestoneAssociation: 'ms_1',
        tenantId: 'tenant_1',
        invoiceNumber: 'INV-2026-001',
        vendorId: 'vendor_101',
      });

      const duplicateInvoice = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.INVOICE,
        documentHash: '2'.repeat(64),
        issuerIdentity: 'Vendor Alpha',
        projectAssociation: 'proj_100',
        milestoneAssociation: 'ms_2',
        tenantId: 'tenant_1',
        invoiceNumber: 'INV-2026-001',
        vendorId: 'vendor_101',
      });

      expect(duplicateInvoice.validationStatus).toBe('flagged');
      expect(duplicateInvoice.flags.some(f => f.includes('DUPLICATE_INVOICE_NUMBER'))).toBe(true);
    });

    it('detects inconsistent budget categories', async () => {
      const evidence = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.INVOICE,
        documentHash: '3'.repeat(64),
        issuerIdentity: 'Electric LLC',
        projectAssociation: 'proj_100',
        milestoneAssociation: 'ms_1',
        tenantId: 'tenant_1',
        drawCategory: 'Plumbing',
        expectedCategory: 'Electrical',
      });

      expect(evidence.validationStatus).toBe('flagged');
      expect(evidence.flags.some(f => f.includes('INCONSISTENT_BUDGET_CATEGORY'))).toBe(true);
    });

    it('detects payment destination changes', async () => {
      const evidence = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.INVOICE,
        documentHash: '4'.repeat(64),
        issuerIdentity: 'Subcontractor A',
        projectAssociation: 'proj_100',
        milestoneAssociation: 'ms_1',
        tenantId: 'tenant_1',
        paymentDestination: 'bank_acc_new_unverified',
        verifiedPaymentDestination: 'bank_acc_original_verified',
      });

      expect(evidence.validationStatus).toBe('flagged');
      expect(evidence.flags.some(f => f.includes('PAYMENT_DESTINATION_CHANGE'))).toBe(true);
    });

    it('detects missing lien waivers on invoice submission', async () => {
      const invoice = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.INVOICE,
        documentHash: '5'.repeat(64),
        issuerIdentity: 'General Contractor',
        projectAssociation: 'proj_200',
        milestoneAssociation: 'ms_foundation',
        tenantId: 'tenant_1',
      });

      expect(invoice.validationStatus).toBe('flagged');
      expect(invoice.flags.some(f => f.includes('MISSING_LIEN_WAIVER'))).toBe(true);
    });

    it('detects expired insurance verification', async () => {
      const expiredInsurance = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.INSURANCE_VERIFICATION,
        documentHash: '6'.repeat(64),
        issuerIdentity: 'Insurance Co',
        projectAssociation: 'proj_100',
        milestoneAssociation: 'ms_1',
        tenantId: 'tenant_1',
        expirationDate: '2025-01-01T00:00:00Z', // Past date
      });

      expect(expiredInsurance.validationStatus).toBe('expired');
      expect(expiredInsurance.flags.some(f => f.includes('EXPIRED') || f.includes('BREACHED'))).toBe(true);
    });

    it('detects collateral value deterioration', async () => {
      const appraisal = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.APPRAISAL,
        documentHash: '7'.repeat(64),
        issuerIdentity: 'Appraiser Inc',
        projectAssociation: 'proj_100',
        milestoneAssociation: 'ms_1',
        tenantId: 'tenant_1',
        appraisalValue: 800000,
        previousAppraisalValue: 1000000,
        minRequiredCollateralValue: 900000,
      });

      expect(appraisal.validationStatus).toBe('flagged');
      expect(appraisal.flags.some(f => f.includes('COLLATERAL_VALUE_BELOW_MINIMUM'))).toBe(true);
      expect(appraisal.flags.some(f => f.includes('COLLATERAL_VALUE_DETERIORATION'))).toBe(true);
    });
  });

  describe('Explicit Validation Trigger', () => {
    it('allows re-triggering validation on existing evidence', async () => {
      const evidence = await service.submitEvidence({
        evidenceClass: EvidenceClassEnum.CONSTRUCTION_PHOTO,
        documentHash: '8'.repeat(64),
        issuerIdentity: 'Site Supervisor',
        projectAssociation: 'proj_300',
        milestoneAssociation: 'ms_roofing',
        tenantId: 'tenant_1',
      });

      const { evidence: revalidated, report } = await service.validateEvidence(
        evidence.evidenceId,
        'tenant_1',
        { maxAgeDays: 30 }
      );

      expect(revalidated.validationStatus).toBe('validated');
      expect(report.valid).toBe(true);
    });
  });
});
