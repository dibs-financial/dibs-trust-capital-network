/**
 * DIBS Backend — Multi-Tenant API Gateway
 * Entry point for all DIBS backend services.
 *
 * Build Priority: 1. Multi-tenant authentication, 2. Roles and tenant isolation
 */

import express from 'express';
import { evidenceRouter } from '../evidence/evidence.routes';

const app = express();

app.use(express.json({ limit: '50mb' }));

// Route registration
app.use('/api/evidence', evidenceRouter);

export default app;
