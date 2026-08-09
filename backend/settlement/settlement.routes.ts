/**
 * DIBS Backend — Settlement Routes
 *
 * Express router for settlement partner integration and reconciliation.
 */

import { Router } from 'express';
import { SettlementService } from './settlement-service';
import { ReconciliationEngine } from './reconciliation-engine';

export function createSettlementRouter(
  settlementService: SettlementService,
  reconciliationEngine: ReconciliationEngine
): Router {
  const router = Router();

  /**
   * POST /instruction — Create settlement instruction
   * Body: { requestId, amount, paymentDestination, settlementPartner, bankValidation }
   */
  router.post('/instruction', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.body.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'TENANT_ID_REQUIRED' });
      }

      const instruction = await settlementService.createInstruction({
        requestId: req.body.requestId,
        amount: req.body.amount,
        paymentDestination: req.body.paymentDestination,
        settlementPartner: req.body.settlementPartner,
        tenantId,
        bankValidation: req.body.bankValidation,
      });

      // Create reconciliation record
      await reconciliationEngine.createReconciliation(instruction, tenantId);

      res.status(201).json(instruction);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /instruction/:instructionId — Retrieve settlement instruction
   */
  router.get('/instruction/:instructionId', (req, res) => {
    const instruction = settlementService.getInstruction(req.params.instructionId);
    if (!instruction) {
      return res.status(404).json({ error: 'INSTRUCTION_NOT_FOUND' });
    }
    res.json(instruction);
  });

  /**
   * POST /confirm/:instructionId — Record settlement confirmation
   * Body: { confirmationHash, confirmedAmount, confirmedTimestamp }
   */
  router.post('/confirm/:instructionId', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.body.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'TENANT_ID_REQUIRED' });
      }

      const instruction = await settlementService.recordConfirmation(
        req.params.instructionId,
        {
          confirmationHash: req.body.confirmationHash,
          confirmedAmount: req.body.confirmedAmount,
          confirmedTimestamp: req.body.confirmedTimestamp,
          tenantId,
        }
      );

      // Reconcile
      await reconciliationEngine.reconcile(instruction, tenantId);

      res.json(instruction);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /reconciliation/:instructionId — Get reconciliation status
   */
  router.get('/reconciliation/:instructionId', (req, res) => {
    const record = reconciliationEngine.getReconciliationByInstruction(req.params.instructionId);
    if (!record) {
      return res.status(404).json({ error: 'RECONCILIATION_NOT_FOUND' });
    }
    res.json(record);
  });

  /**
   * GET /exceptions — List unresolved reconciliation exceptions
   */
  router.get('/exceptions', (req, res) => {
    const tenantId = req.tenantId || req.query.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'TENANT_ID_REQUIRED' });
    }
    const exceptions = reconciliationEngine.getUnresolvedExceptions(tenantId);
    res.json(exceptions);
  });

  /**
   * POST /exceptions/:exceptionId/resolve — Resolve reconciliation exception
   * Body: { resolutionNotes }
   */
  router.post('/exceptions/:exceptionId/resolve', async (req, res) => {
    try {
      const tenantId = req.tenantId || req.body.tenantId;
      if (!tenantId) {
        return res.status(400).json({ error: 'TENANT_ID_REQUIRED' });
      }

      const exception = await reconciliationEngine.resolveException(
        req.params.exceptionId,
        req.body.resolutionNotes,
        tenantId
      );

      res.json(exception);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
