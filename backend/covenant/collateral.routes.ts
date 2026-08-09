/**
 * DIBS Backend — Collateral Express Routes
 *
 * REST API endpoints for collateral holds and risk evaluations.
 *
 * Routes:
 * - POST /hold — create collateral hold
 * - GET /hold/:holdId — retrieve hold
 * - POST /hold/:holdId/release — release hold
 * - GET /holds/:projectId — list holds for a project
 * - GET /flags/:projectId — list collateral risk flags
 */

import { Router, Request, Response } from 'express';
import {
  collateralHoldService,
  HoldTrigger,
  ReleaseCondition,
  HoldStatus,
} from './collateral-hold';

export const collateralRouter = Router();

/**
 * POST /hold
 * Create a new collateral hold.
 */
collateralRouter.post('/hold', async (req: Request, res: Response) => {
  try {
    const { assetId, projectId, requestId, holdReason, triggeredBy, tenantId, notes } = req.body;

    if (!assetId || !projectId || !holdReason || !triggeredBy) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Required fields: assetId, projectId, holdReason, triggeredBy.',
      });
    }

    const hold = await collateralHoldService.createHold({
      assetId,
      projectId,
      requestId,
      holdReason: holdReason as HoldTrigger,
      triggeredBy,
      tenantId,
      notes,
    });

    return res.status(201).json({
      success: true,
      hold,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'HOLD_CREATION_FAILED',
      message: err.message || 'An error occurred while creating the hold.',
    });
  }
});

/**
 * GET /hold/:holdId
 * Retrieve a specific collateral hold record by ID.
 */
collateralRouter.get('/hold/:holdId', (req: Request, res: Response) => {
  try {
    const { holdId } = req.params;
    const hold = collateralHoldService.getHold(holdId);

    if (!hold) {
      return res.status(404).json({
        error: 'HOLD_NOT_FOUND',
        message: `Collateral hold with ID ${holdId} was not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      hold,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'HOLD_FETCH_FAILED',
      message: err.message,
    });
  }
});

/**
 * POST /hold/:holdId/release
 * Release an active collateral hold upon cure verification.
 */
collateralRouter.post('/hold/:holdId/release', async (req: Request, res: Response) => {
  try {
    const { holdId } = req.params;
    const { releaseCondition, releasedBy, notes } = req.body;

    if (!releaseCondition || !releasedBy) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Required fields: releaseCondition, releasedBy.',
      });
    }

    const hold = await collateralHoldService.releaseHold({
      holdId,
      releaseCondition: releaseCondition as ReleaseCondition,
      releasedBy,
      notes,
    });

    return res.status(200).json({
      success: true,
      hold,
    });
  } catch (err: any) {
    const statusCode = err.message?.includes('HOLD_NOT_FOUND') ? 404 : 400;
    return res.status(statusCode).json({
      error: 'HOLD_RELEASE_FAILED',
      message: err.message,
    });
  }
});

/**
 * GET /holds/:projectId
 * List all collateral holds associated with a project.
 */
collateralRouter.get('/holds/:projectId', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { status } = req.query;

    const holds = collateralHoldService.getHoldsByProject(
      projectId,
      status ? (status as HoldStatus) : undefined
    );

    return res.status(200).json({
      success: true,
      projectId,
      count: holds.length,
      holds,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'PROJECT_HOLDS_FETCH_FAILED',
      message: err.message,
    });
  }
});

/**
 * GET /flags/:projectId
 * List active collateral risk flags for a project.
 */
collateralRouter.get('/flags/:projectId', (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const holds = collateralHoldService.getHoldsByProject(projectId, 'active');

    const flags = holds.map(h => ({
      holdId: h.holdId,
      assetId: h.assetId,
      flagReason: h.holdReason,
      holdTimestamp: h.holdTimestamp,
      triggeredBy: h.triggeredBy,
    }));

    return res.status(200).json({
      success: true,
      projectId,
      flagCount: flags.length,
      flags,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'FLAGS_FETCH_FAILED',
      message: err.message,
    });
  }
});

export default collateralRouter;
