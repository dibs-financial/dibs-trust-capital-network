/**
 * DIBS Backend — Analytics Routes
 *
 * Endpoints for advanced analytics dashboard data.
 */

import { Router } from 'express';
import { AnalyticsEngine } from '../reporting/analytics-engine';

export function createAnalyticsRouter(analyticsEngine: AnalyticsEngine): Router {
  const router = Router();

  /**
   * GET /summary — Full dashboard summary across all categories
   * Query: from, to (ISO dates for time range filtering)
   */
  router.get('/summary', async (req, res) => {
    const tenantId = req.tenantId || req.query.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'TENANT_ID_REQUIRED' });
    }

    const timeRange = (req.query.from || req.query.to) ? {
      from: req.query.from as string,
      to: req.query.to as string,
    } : undefined;

    try {
      const summary = await analyticsEngine.generateDashboardSummary(tenantId, timeRange);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /:category — Specific analytics category
   * Categories: tranche, yield, covenants, collateral, capital_flow, policy_loan, vrdct, portfolio
   * Query: from, to
   */
  router.get('/:category', async (req, res) => {
    const tenantId = req.tenantId || req.query.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'TENANT_ID_REQUIRED' });
    }

    const validCategories = ['tranche', 'yield', 'covenants', 'collateral', 'capital_flow', 'policy_loan', 'vrdct', 'portfolio'];
    if (!validCategories.includes(req.params.category)) {
      return res.status(400).json({ error: `INVALID_CATEGORY. Valid: ${validCategories.join(', ')}` });
    }

    const timeRange = (req.query.from || req.query.to) ? {
      from: req.query.from as string,
      to: req.query.to as string,
    } : undefined;

    try {
      const data = await analyticsEngine.generateAnalytics(tenantId, req.params.category as any, timeRange);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
