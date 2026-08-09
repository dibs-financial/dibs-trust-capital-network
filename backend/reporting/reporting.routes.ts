/**
 * DIBS Backend — Reporting Routes
 */

import { Router } from 'express';
import { ReportingEngine, ReportType, ReportParams } from './reporting-engine';

export function createReportingRouter(reportingEngine: ReportingEngine): Router {
  const router = Router();

  /**
   * GET /report/:reportType — Generate report
   * Query: dateFrom, dateTo, entityScope, projectScope, assetScope, format
   */
  router.get('/report/:reportType', async (req, res) => {
    const tenantId = req.tenantId || req.query.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'TENANT_ID_REQUIRED' });
    }

    const params: ReportParams = {
      tenantId,
      dateFrom: req.query.dateFrom as string,
      dateTo: req.query.dateTo as string,
      entityScope: req.query.entityScope as string,
      projectScope: req.query.projectScope as string,
      assetScope: req.query.assetScope as string,
      format: (req.query.format as 'json' | 'csv') || 'json',
    };

    try {
      const report = await reportingEngine.generateReport(
        req.params.reportType as ReportType,
        params
      );

      if (params.format === 'csv') {
        const csv = reportingEngine.exportCSV(report);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${report.reportType}_${report.reportId}.csv"`);
        return res.send(csv);
      }

      res.json(report);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /dashboard/:tenantId — Real-time dashboard data
   */
  router.get('/dashboard/:tenantId', async (req, res) => {
    try {
      const data = await reportingEngine.getDashboardData(req.params.tenantId);
      res.json(data);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /audit-log/:tenantId — Audit event log with pagination
   * Query: skip, limit
   */
  router.get('/audit-log/:tenantId', async (req, res) => {
    try {
      const skip = parseInt(req.query.skip as string) || 0;
      const limit = parseInt(req.query.limit as string) || 100;
      // TODO: Call eventStore.getByTenant with pagination
      res.json({ tenantId: req.params.tenantId, skip, limit, events: [] });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
