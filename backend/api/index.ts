/**
 * DIBS Backend — Multi-Tenant API Gateway
 * Entry point for all DIBS backend services.
 *
 * Build Priority: 1. Multi-tenant authentication, 2. Roles and tenant isolation
 */

import express from 'express';
import { identityRouter } from './identity/identity.routes';
import { evidenceRouter } from './evidence/evidence.routes';
import { workflowRouter } from './workflow/workflow.routes';
import { covenantRouter } from './covenant/covenant.routes';
import { reconciliationRouter } from './reconciliation/reconciliation.routes';
import { auditRouter } from './audit/audit.routes';
import { reportingRouter } from './reporting/reporting.routes';

const app = express();

// TODO: Multi-tenant middleware
// - Extract tenant ID from authenticated session
// - Enforce tenant isolation on all data access
// - Reject cross-tenant requests unless admin role

// TODO: Immutable event middleware
// - Hash-linked event storage for all state transitions
// - Versioned policy logic, calculation inputs, and risk parameters

app.use(express.json({ limit: '50mb' }));

// Route registration (stubs — implement per build priority order)
app.use('/api/identity', identityRouter);
app.use('/api/evidence', evidenceRouter);
app.use('/api/workflow', workflowRouter);
app.use('/api/covenant', covenantRouter);
app.use('/api/reconciliation', reconciliationRouter);
app.use('/api/audit', auditRouter);
app.use('/api/reporting', reportingRouter);

// TODO: Health check endpoint
// TODO: WebSocket telemetry endpoint (institutional tier)
// TODO: Rate limiting and per-transaction limits
// TODO: Emergency pause endpoint (restricted to emergency role)

export default app;
