/**
 * DIBS Backend — Multi-Tenant API Gateway
 * Track A: DrawRequest machine + SHA-256 AuditEvent store.
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

import { EventStore, EventType } from '../audit/event-store';

import {
  DrawRequest,
  DrawRequestState,
  ApprovalContext,
  approvalFailures,
  transitionDraw,
} from '../workflow/draw-request';

import { createEvidenceRouter } from '../evidence/evidence.routes';
import { globalEvidenceService } from '../evidence/evidence-ingestion';

import { createSettlementRouter } from '../settlement/settlement.routes';
import { SettlementService } from '../settlement/settlement-service';
import { ReconciliationEngine } from '../settlement/reconciliation-engine';

import collateralRouter from '../covenant/collateral.routes';

import { evaluateCovenant } from '../covenant/covenant-engine';

import {
  ExceptionWaiverService,
  CreateExceptionParams,
  RequestWaiverParams,
  ApproveWaiverParams,
} from '../workflow/exception-waiver';

import { VRDCTAdapter } from '../adapters/vrdct-adapter';

import { createReportingRouter } from '../reporting/reporting.routes';
import { ReportingEngine } from '../reporting/reporting-engine';

import { createAnalyticsRouter } from '../reporting/analytics.routes';
import { AnalyticsEngine } from '../reporting/analytics-engine';

import {
  PolicyLoanService,
  DrawRequest as PolicyLoanDraw,
  RepaymentRequest,
  PremiumPaymentRequest,
} from '../adapters/policy-loan-service';

import { createApiMarketplaceRouter, ApiKeyManager } from './marketplace';

import { authenticate, requireRole, sessionOf, TokenVerifier, verifierFromEnv } from './auth';

declare global {
  namespace Express {
    interface Request {
      apiKey?: any;
    }
  }
}

function newId(prefix: string): string {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Tenant comes only from the verified access token (authenticate() in auth.ts,
 * mounted on /api). This guard just refuses a route reached without one.
 */
function tenantIsolation(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'TOKEN_REQUIRED' });
    return;
  }
  req.tenantId = req.auth.tenantId;
  next();
}

/** The actor on an audit event: the token's subject and its first role. */
function actorOf(req: Request): { id: string; role: string } {
  const s = sessionOf(req);
  return { id: s.subject, role: s.roles[0] || 'unassigned' };
}

function jsonDraw(draw: DrawRequest) {
  return {
    id: draw.id,
    tenantId: draw.tenantId,
    dealId: draw.dealId,
    spvId: draw.spvId,
    seriesId: draw.seriesId,
    requestNumber: draw.requestNumber,
    status: draw.status,
    requestedByUserId: draw.requestedByUserId,
    payeeCounterpartyId: draw.payeeCounterpartyId,
    payeeBankAccountId: draw.payeeBankAccountId,
    amountRequestedMinor: draw.amountRequestedMinor.toString(),
    amountApprovedMinor:
      draw.amountApprovedMinor === null ? null : draw.amountApprovedMinor.toString(),
    currency: draw.currency,
    budgetLineIds: draw.budgetLineIds,
    requestedAt: draw.requestedAt,
    submittedAt: draw.submittedAt,
    lockedPolicyVersion: draw.lockedPolicyVersion,
    lockedEvidenceManifestHash: draw.lockedEvidenceManifestHash,
    approvalBindingHash: draw.approvalBindingHash,
    policyEvaluationId: draw.policyEvaluationId,
    idempotencyKey: draw.idempotencyKey,
    createdAt: draw.createdAt,
    updatedAt: draw.updatedAt,
  };
}

function parseApprovalContext(body: any): ApprovalContext {
  return {
    manifestComplete: !!body.manifestComplete,
    manifestItemExpiredOrUnverified: !!body.manifestItemExpiredOrUnverified,
    remainingBudgetMinor: BigInt(body.remainingBudgetMinor || '0'),
    eligibleThisDrawMinor: BigInt(body.eligibleThisDrawMinor || '0'),
    retainageApplied: !!body.retainageApplied,
    covenantStatus: body.covenantStatus || 'CURRENT',
    waiverCoversBreach: !!body.waiverCoversBreach,
    loanInBalancePasses: !!body.loanInBalancePasses,
    deficiencyDepositConfirmed: !!body.deficiencyDepositConfirmed,
    requiredApprovalsRecorded: !!body.requiredApprovalsRecorded,
    approversDistinctFromRequester: !!body.approversDistinctFromRequester,
    noApproverIsInstructor: !!body.noApproverIsInstructor,
    openHold: !!body.openHold,
    payeeVerified: !!body.payeeVerified,
    sanctionsFresh: !!body.sanctionsFresh,
    settlementRouteValid: !!body.settlementRouteValid,
    policyVersionMatchesLock: !!body.policyVersionMatchesLock,
    manifestHashMatchesLock: !!body.manifestHashMatchesLock,
  };
}

function createCapitalRequestRouter(eventStore: EventStore): express.Router {
  const router = express.Router();
  const requests = new Map<string, DrawRequest>();

  router.post('/request', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const tenantId = sessionOf(req).tenantId;
      const requestId = newId('dr');
      const now = new Date().toISOString();
      const idempotencyKey = (req.header('Idempotency-Key') as string) || requestId;

      const request: DrawRequest = {
        id: requestId,
        tenantId: tenantId,
        dealId: req.body.dealId,
        spvId: req.body.spvId,
        seriesId: req.body.seriesId || null,
        requestNumber: req.body.requestNumber || requestId,
        status: 'DRAFT',
        requestedByUserId: actorOf(req).id,
        payeeCounterpartyId: req.body.payeeCounterpartyId,
        payeeBankAccountId: req.body.payeeBankAccountId,
        amountRequestedMinor: BigInt(req.body.amountRequestedMinor),
        amountApprovedMinor: req.body.amountApprovedMinor
          ? BigInt(req.body.amountApprovedMinor)
          : null,
        currency: req.body.currency || 'USD',
        budgetLineIds: req.body.budgetLineIds || [],
        requestedAt: now,
        submittedAt: null,
        lockedPolicyVersion: req.body.lockedPolicyVersion || null,
        lockedEvidenceManifestHash: req.body.lockedEvidenceManifestHash || null,
        approvalBindingHash: null,
        policyEvaluationId: null,
        idempotencyKey: idempotencyKey,
        createdAt: now,
        updatedAt: now,
      };

      requests.set(requestId, request);

      await eventStore.append({
        eventType: EventType.DRAW_CREATED,
        tenantId: tenantId,
        actorId: actorOf(req).id,
        actorRole: actorOf(req).role,
        actorType: 'USER',
        aggregateType: 'DRAW_REQUEST',
        aggregateId: request.id,
        stateBefore: null,
        stateAfter: 'DRAFT',
        policyVersion: request.lockedPolicyVersion || '',
        evidenceManifestHash: request.lockedEvidenceManifestHash || '',
        idempotencyKey: idempotencyKey,
        correlationId: request.id,
        payload: { status: 'DRAFT' },
      });

      res.status(201).json(jsonDraw(request));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/request/:requestId', tenantIsolation, (req: Request, res: Response) => {
    const request = requests.get(req.params.requestId);
    if (!request) {
      res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
      return;
    }
    if (request.tenantId !== sessionOf(req).tenantId) {
      res.status(403).json({ error: 'TENANT_ISOLATION_VIOLATION' });
      return;
    }
    res.json(jsonDraw(request));
  });

  router.get('/requests', tenantIsolation, (req: Request, res: Response) => {
    const tenantId = sessionOf(req).tenantId;
    const state = req.query.state as DrawRequestState | undefined;
    const tenantRequests = Array.from(requests.values()).filter(function (r) {
      return r.tenantId === tenantId && (!state || r.status === state);
    });
    res.json(tenantRequests.map(jsonDraw));
  });

  router.post(
    '/request/:requestId/transition',
    tenantIsolation,
    async (req: Request, res: Response) => {
      const request = requests.get(req.params.requestId);
      if (!request) {
        res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
        return;
      }
      if (request.tenantId !== sessionOf(req).tenantId) {
        res.status(403).json({ error: 'TENANT_ISOLATION_VIOLATION' });
        return;
      }

      try {
        const targetState = req.body.targetState as DrawRequestState;
        const actorId = actorOf(req).id;
        const actorRole = actorOf(req).role;
        const extras: {
          approvalContext?: ApprovalContext;
          fundsMovedEvidence?: boolean;
          instructionExists?: boolean;
          idempotencyKey?: string;
        } = {
          fundsMovedEvidence: !!req.body.fundsMovedEvidence,
          instructionExists: !!req.body.instructionExists,
          idempotencyKey: req.header('Idempotency-Key') || undefined,
        };
        if (targetState === 'APPROVED') {
          extras.approvalContext = parseApprovalContext(
            req.body.approvalContext || req.body
          );
        }

        const updated = await transitionDraw(
          request,
          targetState,
          eventStore,
          { id: actorId, type: 'USER', role: actorRole },
          extras
        );
        requests.set(request.id, updated);
        res.json(jsonDraw(updated));
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  router.post(
    '/request/:requestId/validate',
    tenantIsolation,
    (req: Request, res: Response) => {
      const request = requests.get(req.params.requestId);
      if (!request) {
        res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
        return;
      }
      if (request.tenantId !== sessionOf(req).tenantId) {
        res.status(403).json({ error: 'TENANT_ISOLATION_VIOLATION' });
        return;
      }
      const ctx = parseApprovalContext(req.body.approvalContext || req.body);
      const failures = approvalFailures(request, ctx);
      res.json({ failures: failures, canApprove: failures.length === 0 });
    }
  );

  return router;
}

function createCovenantRouter(): express.Router {
  const router = express.Router();
  const evaluations = new Map<string, any[]>();

  router.post('/evaluate', tenantIsolation, (req: Request, res: Response) => {
    try {
      const tenantId = sessionOf(req).tenantId;
      const { covenant, measuredValue, thresholdValue } = req.body;
      const result = evaluateCovenant(
        {
          ...covenant,
          category: covenant.category,
          threshold: thresholdValue || covenant.threshold,
          tolerance: covenant.tolerance || 10,
        } as any,
        measuredValue
      );

      const evaluationId = newId('eval');
      const evaluation = {
        ...result,
        evaluationId: evaluationId,
        timestamp: new Date().toISOString(),
        tenantId: tenantId,
      };

      if (!evaluations.has(tenantId)) {
        evaluations.set(tenantId, []);
      }
      evaluations.get(tenantId)!.push(evaluation);

      res.status(201).json(evaluation);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/evaluations', tenantIsolation, (req: Request, res: Response) => {
    const tenantId = sessionOf(req).tenantId;
    res.json(evaluations.get(tenantId) || []);
  });

  return router;
}

function createExceptionRouter(eventStore: EventStore): express.Router {
  const router = express.Router();
  const service = new ExceptionWaiverService(eventStore);

  router.post('/', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const params: CreateExceptionParams = {
        requestId: req.body.requestId,
        projectId: req.body.projectId,
        exceptionType: req.body.exceptionType,
        exceptionReason: req.body.exceptionReason,
        createdBy: actorOf(req).id,
        tenantId: sessionOf(req).tenantId,
      };
      const exception = await service.createException(params);
      res.status(201).json(exception);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/:exceptionId', tenantIsolation, (req: Request, res: Response) => {
    const exception = service.getException(req.params.exceptionId);
    // Another tenant's exception is indistinguishable from a missing one.
    if (!exception || exception.tenantId !== sessionOf(req).tenantId) {
      res.status(404).json({ error: 'EXCEPTION_NOT_FOUND' });
      return;
    }
    res.json(exception);
  });

  router.post('/:exceptionId/escalate', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const escalated = await service.escalateException(
        req.params.exceptionId,
        req.body.escalatedTo || 'senior_approver',
        actorOf(req).id,
        req.body.reason
      );
      res.json(escalated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/:exceptionId/waiver', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const params: RequestWaiverParams = {
        exceptionId: req.params.exceptionId,
        projectId: req.body.projectId,
        waiverScope: req.body.waiverScope,
        waiverAmount: req.body.waiverAmount,
        waiverDuration: req.body.waiverDuration,
        waiverConditions: req.body.waiverConditions,
        followUpConditions: req.body.followUpConditions,
        requestedBy: actorOf(req).id,
        tenantId: sessionOf(req).tenantId,
      };
      const waiver = await service.requestWaiver(params);
      res.status(201).json(waiver);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/:waiverId/approve', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const params: ApproveWaiverParams = {
        waiverId: req.params.waiverId,
        authorizerId: actorOf(req).id,
        authorizerRole: actorOf(req).role,
        signedWaiverHash: req.body.signedWaiverHash || newId('hash'),
        decisionNotes: req.body.decisionNotes,
      };
      const result = await service.approveWaiver(params);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/:waiverId/deny', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const result = await service.denyWaiver(
        req.params.waiverId,
        actorOf(req).id,
        req.body.reason || 'denied'
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}

function createVRDCTRouter(eventStore: EventStore): express.Router {
  const router = express.Router();
  const adapter = new VRDCTAdapter(eventStore);

  router.get('/signals/:entityId', tenantIsolation, (req: Request, res: Response) => {
    res.json(adapter.getEntitySignals(req.params.entityId));
  });

  router.post('/signals', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const signal = await adapter.recordSignal({
        category: req.body.category,
        signalType: req.body.signalType,
        entityId: req.body.entityId,
        projectId: req.body.projectId,
        value: req.body.value,
        normalizedScore: req.body.normalizedScore,
        dataSource: req.body.dataSource,
        consentStatus: req.body.consentStatus,
        refreshDate: req.body.refreshDate || new Date().toISOString(),
        calculationVersion: req.body.calculationVersion || 'v1.0.0',
        isAdverse: req.body.isAdverse || false,
      });
      res.status(201).json(signal);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/adverse-notices/:entityId', tenantIsolation, (req: Request, res: Response) => {
    res.json(adapter.getPendingAdverseNotices(req.params.entityId));
  });

  return router;
}

function createPolicyLoanRouter(eventStore: EventStore): express.Router {
  const router = express.Router();
  const service = new PolicyLoanService();

  router.post('/policy', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const policy = service.createPolicy({
        policyId: req.body.policyId || newId('pol'),
        carrierId: req.body.carrierId,
        insuredId: req.body.insuredId,
        ownerId: req.body.ownerId,
        beneficiaryConfig: req.body.beneficiaryConfig,
        policyType: req.body.policyType,
        policyStatus: req.body.policyStatus,
        cashValue: req.body.cashValue,
        deathBenefit: req.body.deathBenefit,
        surrenderValue: req.body.surrenderValue,
        loanBalance: req.body.loanBalance,
        loanInterestRate: req.body.loanInterestRate,
        dividendCreditingAssumption: req.body.dividendCreditingAssumption,
        directRecognitionStatus: req.body.directRecognitionStatus,
        premiumSchedule: req.body.premiumSchedule,
        premiumDueDate: req.body.premiumDueDate,
        carrierSpecificLoanRules: req.body.carrierSpecificLoanRules,
        hardLtvCeiling: req.body.hardLtvCeiling,
        softLtvThreshold: req.body.softLtvThreshold,
        phase: req.body.phase,
      });

      await eventStore.append({
        eventType: EventType.CAPITAL_REQUEST_CREATED,
        actorId: actorOf(req).id,
        actorRole: 'borrower',
        tenantId: sessionOf(req).tenantId,
        payload: { policyId: policy.policyId },
      });

      res.status(201).json(policy);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/policy/:policyId', tenantIsolation, (req: Request, res: Response) => {
    try {
      res.json(service.getPolicy(req.params.policyId));
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  router.get('/policies', tenantIsolation, (_req: Request, res: Response) => {
    res.json(service.listPolicies());
  });

  router.post('/draw', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const drawRequest: PolicyLoanDraw = {
        policyId: req.body.policyId,
        amount: req.body.amount,
        destination: req.body.destination,
        targetStrategy: req.body.targetStrategy,
      };
      const result = service.recordDraw(drawRequest);

      await eventStore.append({
        eventType: EventType.CAPITAL_REQUEST_APPROVED,
        actorId: actorOf(req).id,
        actorRole: actorOf(req).role,
        tenantId: sessionOf(req).tenantId,
        payload: {
          policyId: req.body.policyId,
          drawId: result.drawId,
          amount: req.body.amount,
        },
      });

      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/repayment', tenantIsolation, (req: Request, res: Response) => {
    try {
      const repaymentRequest: RepaymentRequest = {
        policyId: req.body.policyId,
        amount: req.body.amount,
      };
      res.json(service.recordRepayment(repaymentRequest));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/premium', tenantIsolation, (req: Request, res: Response) => {
    try {
      const premiumRequest: PremiumPaymentRequest = {
        policyId: req.body.policyId,
        amount: req.body.amount,
      };
      res.json(service.recordPremiumPayment(premiumRequest));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/policy/:policyId/collateral', tenantIsolation, (req: Request, res: Response) => {
    try {
      res.json(service.checkCollateralCoverage(req.params.policyId));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/policy/:policyId/accrue', tenantIsolation, (req: Request, res: Response) => {
    try {
      const interest = service.accrueInterest(req.params.policyId, req.body.asOfDate);
      res.json({ policyId: req.params.policyId, accruedInterest: interest });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post(
    '/policy/:policyId/redirect-cashflow',
    tenantIsolation,
    (req: Request, res: Response) => {
      res.json({ success: true, redirectedAmount: req.body.amount });
    }
  );

  return router;
}

function createAuditRouter(eventStore: EventStore): express.Router {
  const router = express.Router();

  router.get('/events', tenantIsolation, async (req: Request, res: Response) => {
    const tenantId = sessionOf(req).tenantId;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = parseInt(req.query.skip as string) || 0;
    const events = await eventStore.getByTenant(tenantId, skip, limit);
    res.json({ events: events, limit: limit, skip: skip, total: events.length });
  });

  return router;
}

export interface AppOptions {
  /** Verifies bearer tokens. Defaults to OIDC_* env; null means every /api request is refused. */
  verifier?: TokenVerifier | null;
}

export function createApp(options: AppOptions = {}): express.Application {
  const app = express();
  const verifier = options.verifier === undefined ? verifierFromEnv(process.env) : options.verifier;

  app.use(helmet());
  app.use(cors());
  app.use(morgan('combined'));
  app.use(express.json({ limit: '50mb' }));

  // Every /api route: tenant and actor from the verified token only.
  app.use('/api', authenticate(verifier));

  const eventStore = new EventStore();
  const settlementService = new SettlementService(eventStore);
  const reconciliationEngine = new ReconciliationEngine(eventStore);
  const reportingEngine = new ReportingEngine(eventStore);
  const analyticsEngine = new AnalyticsEngine(eventStore);
  const apiKeyManager = new ApiKeyManager();

  app.use('/api/audit', createAuditRouter(eventStore));
  app.use('/api/capital', createCapitalRequestRouter(eventStore));
  app.use('/api/evidence', createEvidenceRouter(globalEvidenceService));
  app.use('/api/settlement', createSettlementRouter(settlementService, reconciliationEngine));
  app.use('/api/covenant', createCovenantRouter());
  app.use('/api/collateral', collateralRouter);
  app.use('/api/exceptions', createExceptionRouter(eventStore));
  app.use('/api/vrdct', createVRDCTRouter(eventStore));
  app.use('/api/reporting', createReportingRouter(reportingEngine));
  app.use('/api/policy-loan', createPolicyLoanRouter(eventStore));
  app.use('/api/analytics', createAnalyticsRouter(analyticsEngine));
  app.use('/v1', createApiMarketplaceRouter(apiKeyManager));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
  });

  let emergencyPaused = false;

  app.post('/api/emergency/pause', requireRole('PlatformAdmin'), (_req: Request, res: Response) => {
    emergencyPaused = true;
    res.json({ paused: true, timestamp: new Date().toISOString() });
  });

  app.post('/api/emergency/unpause', requireRole('PlatformAdmin'), (_req: Request, res: Response) => {
    emergencyPaused = false;
    res.json({ paused: false, timestamp: new Date().toISOString() });
  });

  app.get('/api/emergency/status', (_req: Request, res: Response) => {
    res.json({ paused: emergencyPaused });
  });

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'ROUTE_NOT_FOUND', path: req.path });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[DIBS API Error]', err.message);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

export default createApp();
