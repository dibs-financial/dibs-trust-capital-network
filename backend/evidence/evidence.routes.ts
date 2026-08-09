/**
 * DIBS Backend — Evidence Management API Router
 * Express router exposing tenant-isolated endpoints for evidence submission,
 * retrieval, validation, and flag inspection.
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  EvidenceIngestionService,
  globalEvidenceService,
  EvidenceSubmissionInput,
} from './evidence-ingestion';

/**
 * Extracts tenant isolation context from the incoming request.
 */
export function extractTenantId(req: Request): string {
  const tenantId =
    (req.headers['x-tenant-id'] as string) ||
    (req.headers['tenant-id'] as string) ||
    (req.query.tenantId as string) ||
    (req.body && req.body.tenantId);

  if (!tenantId) {
    return 'default-tenant';
  }
  return String(tenantId).trim();
}

/**
 * Extracts actor audit context from the request.
 */
export function extractActorContext(req: Request): { actorId: string; actorRole: string; policyVersion: string } {
  const actorId =
    (req.headers['x-actor-id'] as string) ||
    (req.headers['actor-id'] as string) ||
    (req.body && req.body.actorId) ||
    'anonymous_user';

  const actorRole =
    (req.headers['x-actor-role'] as string) ||
    (req.headers['actor-role'] as string) ||
    (req.body && req.body.actorRole) ||
    'borrower';

  const policyVersion =
    (req.headers['x-policy-version'] as string) ||
    (req.body && req.body.policyVersion) ||
    'v1.0';

  return { actorId, actorRole, policyVersion };
}

/**
 * Factory function creating an Express Router bound to an EvidenceIngestionService.
 */
export function createEvidenceRouter(service: EvidenceIngestionService = globalEvidenceService): Router {
  const router = Router();

  /**
   * POST /submit — Submit new evidence document
   */
  router.post('/submit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = extractTenantId(req);
      const { actorId, actorRole, policyVersion } = extractActorContext(req);

      const {
        evidenceClass,
        documentContent,
        documentHash,
        issuerIdentity,
        projectAssociation,
        milestoneAssociation,
        expirationDate,
        invoiceNumber,
        vendorId,
        amount,
        drawCategory,
        expectedCategory,
        paymentDestination,
        verifiedPaymentDestination,
        appraisalValue,
        minRequiredCollateralValue,
        previousAppraisalValue,
        approvalStatus,
        exceptionStatus,
        metadata,
      } = req.body;

      if (!evidenceClass) {
        return res.status(400).json({ success: false, error: 'MISSING_EVIDENCE_CLASS' });
      }
      if (!projectAssociation) {
        return res.status(400).json({ success: false, error: 'MISSING_PROJECT_ASSOCIATION' });
      }
      if (!documentContent && !documentHash) {
        return res.status(400).json({ success: false, error: 'DOCUMENT_HASH_OR_CONTENT_REQUIRED' });
      }

      const input: EvidenceSubmissionInput = {
        evidenceClass,
        documentContent,
        documentHash,
        issuerIdentity: issuerIdentity || 'SYSTEM_SUBMISSION',
        projectAssociation,
        milestoneAssociation: milestoneAssociation || '',
        tenantId,
        expirationDate,
        actorId,
        actorRole,
        policyVersion,
        invoiceNumber,
        vendorId,
        amount,
        drawCategory,
        expectedCategory,
        paymentDestination,
        verifiedPaymentDestination,
        appraisalValue,
        minRequiredCollateralValue,
        previousAppraisalValue,
        approvalStatus,
        exceptionStatus,
        metadata,
      };

      const evidence = await service.submitEvidence(input);
      return res.status(201).json({ success: true, data: evidence });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'SUBMISSION_FAILED';
      return res.status(400).json({ success: false, error: message });
    }
  });

  /**
   * GET /flags/:projectId — List all flagged evidence for a given project
   * (Placed before /:evidenceId to prevent path collision)
   */
  router.get('/flags/:projectId', async (req: Request, res: Response) => {
    try {
      const tenantId = extractTenantId(req);
      const { projectId } = req.params;

      if (!projectId) {
        return res.status(400).json({ success: false, error: 'PROJECT_ID_REQUIRED' });
      }

      const flaggedList = await service.getFlaggedEvidenceByProject(projectId, tenantId);
      return res.status(200).json({
        success: true,
        count: flaggedList.length,
        data: flaggedList,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'FETCH_FLAGGED_FAILED';
      return res.status(500).json({ success: false, error: message });
    }
  });

  /**
   * GET /project/:projectId — List all evidence for a project
   * (Placed before /:evidenceId to prevent path collision)
   */
  router.get('/project/:projectId', async (req: Request, res: Response) => {
    try {
      const tenantId = extractTenantId(req);
      const { projectId } = req.params;

      if (!projectId) {
        return res.status(400).json({ success: false, error: 'PROJECT_ID_REQUIRED' });
      }

      const evidenceList = await service.getEvidenceByProject(projectId, tenantId);
      return res.status(200).json({
        success: true,
        count: evidenceList.length,
        data: evidenceList,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'FETCH_PROJECT_EVIDENCE_FAILED';
      return res.status(500).json({ success: false, error: message });
    }
  });

  /**
   * POST /validate/:evidenceId — Trigger explicit re-validation for evidence
   */
  router.post('/validate/:evidenceId', async (req: Request, res: Response) => {
    try {
      const tenantId = extractTenantId(req);
      const { actorId, actorRole, policyVersion } = extractActorContext(req);
      const { evidenceId } = req.params;
      const { maxAgeDays } = req.body || {};

      if (!evidenceId) {
        return res.status(400).json({ success: false, error: 'EVIDENCE_ID_REQUIRED' });
      }

      const result = await service.validateEvidence(evidenceId, tenantId, {
        maxAgeDays: typeof maxAgeDays === 'number' ? maxAgeDays : undefined,
        actorId,
        actorRole,
        policyVersion,
      });

      return res.status(200).json({
        success: true,
        data: result.evidence,
        validationResult: result.report,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'VALIDATION_FAILED';
      if (message.startsWith('EVIDENCE_NOT_FOUND')) {
        return res.status(404).json({ success: false, error: message });
      }
      return res.status(400).json({ success: false, error: message });
    }
  });

  /**
   * GET /:evidenceId — Retrieve specific evidence object by ID
   */
  router.get('/:evidenceId', async (req: Request, res: Response) => {
    try {
      const tenantId = extractTenantId(req);
      const { evidenceId } = req.params;

      if (!evidenceId) {
        return res.status(400).json({ success: false, error: 'EVIDENCE_ID_REQUIRED' });
      }

      const evidence = await service.getEvidenceById(evidenceId, tenantId);
      if (!evidence) {
        return res.status(404).json({ success: false, error: `EVIDENCE_NOT_FOUND: ${evidenceId}` });
      }

      return res.status(200).json({ success: true, data: evidence });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'RETRIEVAL_FAILED';
      return res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}

export const evidenceRouter = createEvidenceRouter();
export default evidenceRouter;
