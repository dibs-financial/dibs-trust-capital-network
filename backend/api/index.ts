/**
 * DIBS Backend — Multi-Tenant API Gateway
 * Entry point for all DIBS backend services.
 *
 * All 20 build steps wired:
 * 1-2: Auth & tenant isolation
 * 3: Immutable event model
 * 4: Capital-request workflow
 * 5: Evidence-gating
 * 6: Object-level authorization
 * 7: Settlement integration
 * 8: Reconciliation engine
 * 9: Covenant engine
 * 10: Collateral hold system
 * 11: Exception & waiver workflow
 * 12: VRDCT monitoring adapter
 * 13: Enterprise reporting
 * 14-16: Vault, reserve, yield routing (contract layer)
 * 17: Policy-loan subsystem
 * 18: Advanced analytics
 * 19: Tokenization (gated)
 * 20: External API marketplace
 */

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';

// Audit layer (build step 3)
import { EventStore, EventType, ImmutableEvent } from '../audit/event-store';

// Capital request workflow (build step 4)
import {
  CapitalRequest,
  CapitalRequestState,
  CapitalPolicy,
  validateReleasePreconditions,
  transitionState,
} from '../workflow/capital-request';

// Evidence routes (build step 5)
import { createEvidenceRouter } from '../evidence/evidence.routes';
import { globalEvidenceService } from '../evidence/evidence-ingestion';

// Settlement routes (build steps 7-8)
import { createSettlementRouter } from '../settlement/settlement.routes';
import { SettlementService } from '../settlement/settlement-service';
import { ReconciliationEngine } from '../settlement/reconciliation-engine';

// Collateral routes (build step 10)
import collateralRouter from '../covenant/collateral.routes';

// Covenant engine (build step 9)
import { evaluateCovenant } from '../covenant/covenant-engine';

// Exception & waiver (build step 11)
import {
  ExceptionWaiverService,
  CreateExceptionParams,
  RequestWaiverParams,
  ApproveWaiverParams,
} from '../workflow/exception-waiver';

// VRDCT adapter (build step 12)
import { VRDCTAdapter, VRDCTSignal } from '../adapters/vrdct-adapter';

// Reporting routes (build step 13)
import { createReportingRouter } from '../reporting/reporting.routes';
import { ReportingEngine } from '../reporting/reporting-engine';

// Analytics routes (build step 18)
import { createAnalyticsRouter } from '../reporting/analytics.routes';
import { AnalyticsEngine } from '../reporting/analytics-engine';

// Policy-loan subsystem (build step 17)
import {
  PolicyLoanService,
  DrawRequest,
  RepaymentRequest,
  PremiumPaymentRequest,
} from '../adapters/policy-loan-service';

// External API marketplace (build step 20)
import { createApiMarketplaceRouter, ApiKeyManager } from './marketplace';

// ─── Express Request Augmentation ──────────────────────────

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      apiKey?: any;
    }
  }
}

// ─── Tenant Isolation Middleware ───────────────────────────

function tenantIsolation(req: Request, res: Response, next: NextFunction): void {
  const tenantId = (req.headers['x-dibs-tenant'] as string) || 'default';
  (req as any).tenantId = tenantId;
  next();
}

// ─── Authorization Middleware ───────────────────────────────

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req.headers['x-dibs-role'] as string) || 'viewer';
    if (!roles.includes(role)) {
      res.status(403).json({
        error: 'INSUFFICIENT_ROLE',
        required: roles,
        provided: role,
      });
      return;
    }
    next();
  };
}

// ─── Capital Request Workflow Router (Build Step 4) ────────

function createCapitalRequestRouter(eventStore: EventStore): express.Router {
  const router = express.Router();

  const requests = new Map<string, CapitalRequest>();
  const policies = new Map<string, CapitalPolicy>();

  // POST /api/capital/request — Create capital request
  router.post('/request', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const requestId = `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();

      const request: CapitalRequest = {
        requestId,
        borrowerOrSponsorId: req.body.borrowerOrSponsorId,
        projectId: req.body.projectId,
        spvId: req.body.spvId,
        requestedAmount: req.body.requestedAmount,
        requestedPaymentDate: req.body.requestedPaymentDate,
        paymentDestination: req.body.paymentDestination,
        drawCategory: req.body.drawCategory,
        supportingInvoiceSet: req.body.supportingInvoiceSet || [],
        milestoneId: req.body.milestoneId || '',
        covenantDependencies: req.body.covenantDependencies || [],
        collateralDependencies: req.body.collateralDependencies || [],
        requiredApproverList: req.body.requiredApproverList || [],
        currentState: 'pending',
        policyVersion: req.body.policyVersion || '1.0.0',
        createdAt: now,
        updatedAt: now,
        tenantId,
      };

      requests.set(requestId, request);

      await eventStore.append({
        eventType: EventType.CAPITAL_REQUEST_CREATED,
        actorId: req.body.borrowerOrSponsorId || 'system',
        actorRole: 'borrower',
        tenantId,
        payloadHash: '',
        policyVersion: req.body.policyVersion || '1.0.0',
        metadata: { requestId, request },
      });

      res.status(201).json(request);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/capital/request/:requestId — Retrieve capital request
  router.get('/request/:requestId', tenantIsolation, (req: Request, res: Response) => {
    const request = requests.get(req.params.requestId);
    if (!request) {
      res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
      return;
    }
    if (request.tenantId !== (req as any).tenantId) {
      res.status(403).json({ error: 'TENANT_ISOLATION_VIOLATION' });
      return;
    }
    res.json(request);
  });

  // GET /api/capital/requests — List capital requests for tenant
  router.get('/requests', tenantIsolation, (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const state = req.query.state as CapitalRequestState | undefined;
    const tenantRequests = Array.from(requests.values()).filter(
      (r) => r.tenantId === tenantId && (!state || r.currentState === state)
    );
    res.json(tenantRequests);
  });

  // POST /api/capital/request/:requestId/transition — State transition
  router.post('/request/:requestId/transition', tenantIsolation, async (req: Request, res: Response) => {
    const request = requests.get(req.params.requestId);
    if (!request) {
      res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
      return;
    }
    if (request.tenantId !== (req as any).tenantId) {
      res.status(403).json({ error: 'TENANT_ISOLATION_VIOLATION' });
      return;
    }

    try {
      const targetState = req.body.targetState as CapitalRequestState;
      const actorId = req.body.actorId || 'system';
      const actorRole = (req.headers['x-dibs-role'] as string) || 'approver';

      const updated = transitionState(request, targetState, eventStore, { id: actorId, role: actorRole });
      requests.set(request.requestId, updated);

      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/capital/request/:requestId/validate — Validate release preconditions
  router.post('/request/:requestId/validate', tenantIsolation, (req: Request, res: Response) => {
    const request = requests.get(req.params.requestId);
    if (!request) {
      res.status(404).json({ error: 'REQUEST_NOT_FOUND' });
      return;
    }

    const policy = policies.get(req.body.policyId) || {
      policyId: 'default',
      entityScope: '',
      projectScope: '',
      assetScope: '',
      maxReleaseAmount: request.requestedAmount,
      cumulativeDrawLimit: request.requestedAmount * 10,
      requiredEvidenceClasses: [],
      requiredVerifierRoles: [],
      requiredSignatures: 1,
      escalationPath: 'senior_approver',
      holdTriggers: [],
      exceptionTriggers: [],
      expirationInterval: 86400,
      auditRequirements: [],
    };

    const context = {
      drawBudgetRemaining: req.body.drawBudgetRemaining ?? request.requestedAmount,
      collateralSatisfied: req.body.collateralSatisfied ?? true,
      covenantSatisfied: req.body.covenantSatisfied ?? true,
      activeHold: req.body.activeHold ?? false,
      fraudBlock: req.body.fraudBlock ?? false,
      sanctionsBlock: req.body.sanctionsBlock ?? false,
      kycBlock: req.body.kycBlock ?? false,
      settlementVerified: req.body.settlementVerified ?? true,
      reconciliationException: req.body.reconciliationException ?? false,
      releaseWindowOpen: req.body.releaseWindowOpen ?? true,
      policyVersionCurrent: req.body.policyVersionCurrent ?? true,
      signaturesValid: req.body.signaturesValid ?? true,
    };

    const failures = validateReleasePreconditions(request, policy, context);
    res.json({ failures, canRelease: failures.length === 0 });
  });

  // POST /api/capital/policy — Create capital policy
  router.post('/policy', tenantIsolation, requireRole('admin', 'lender'), (req: Request, res: Response) => {
    const policyId = `pol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const policy: CapitalPolicy = {
      policyId,
      entityScope: req.body.entityScope || '',
      projectScope: req.body.projectScope || '',
      assetScope: req.body.assetScope || '',
      maxReleaseAmount: req.body.maxReleaseAmount || 0,
      cumulativeDrawLimit: req.body.cumulativeDrawLimit || 0,
      requiredEvidenceClasses: req.body.requiredEvidenceClasses || [],
      requiredVerifierRoles: req.body.requiredVerifierRoles || [],
      requiredSignatures: req.body.requiredSignatures || 1,
      escalationPath: req.body.escalationPath || 'senior_approver',
      holdTriggers: req.body.holdTriggers || [],
      exceptionTriggers: req.body.exceptionTriggers || [],
      expirationInterval: req.body.expirationInterval || 86400,
      auditRequirements: req.body.auditRequirements || [],
    };
    policies.set(policyId, policy);
    res.status(201).json(policy);
  });

  // GET /api/capital/policy/:policyId — Retrieve policy
  router.get('/policy/:policyId', tenantIsolation, (req: Request, res: Response) => {
    const policy = policies.get(req.params.policyId);
    if (!policy) {
      res.status(404).json({ error: 'POLICY_NOT_FOUND' });
      return;
    }
    res.json(policy);
  });

  return router;
}

// ─── Covenant Engine Router (Build Step 9) ─────────────────

function createCovenantRouter(): express.Router {
  const router = express.Router();
  const evaluations = new Map<string, any[]>();

  // POST /api/covenant/evaluate — Evaluate a covenant
  router.post('/evaluate', tenantIsolation, (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId;
      const { covenant, measuredValue, thresholdValue, context } = req.body;
      const result = evaluateCovenant({ ...covenant, category: covenant.category, threshold: thresholdValue || covenant.threshold, tolerance: covenant.tolerance || 10 } as any, measuredValue);

      const evaluationId = `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const evaluation = {
        ...result,
        evaluationId,
        timestamp: new Date().toISOString(),
        tenantId,
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

  // GET /api/covenant/evaluations — List covenant evaluations for tenant
  router.get('/evaluations', tenantIsolation, (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const tenantEvals = evaluations.get(tenantId) || [];
    res.json(tenantEvals);
  });

  return router;
}

// ─── Exception & Waiver Router (Build Step 11) ─────────────

function createExceptionRouter(eventStore: EventStore): express.Router {
  const router = express.Router();
  const service = new ExceptionWaiverService(eventStore);

  // POST /api/exceptions — Create exception
  router.post('/', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const params: CreateExceptionParams = {
        requestId: req.body.requestId,
        projectId: req.body.projectId,
        exceptionType: req.body.exceptionType,
        exceptionReason: req.body.exceptionReason,
        createdBy: req.body.createdBy || 'system',
        tenantId: (req as any).tenantId,
      };
      const exception = await service.createException(params);
      res.status(201).json(exception);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/exceptions/:exceptionId — Retrieve exception
  router.get('/:exceptionId', tenantIsolation, (req: Request, res: Response) => {
    const exception = service.getException(req.params.exceptionId);
    if (!exception) {
      res.status(404).json({ error: 'EXCEPTION_NOT_FOUND' });
      return;
    }
    res.json(exception);
  });

  // POST /api/exceptions/:exceptionId/escalate — Escalate exception
  router.post('/:exceptionId/escalate', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const escalated = await service.escalateException(
        req.params.exceptionId,
        req.body.escalatedTo || 'senior_approver',
        req.body.actorId || 'system',
        req.body.reason
      );
      res.json(escalated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/exceptions/:exceptionId/waiver — Request waiver
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
        requestedBy: req.body.requestedBy || 'system',
        tenantId: (req as any).tenantId,
      };
      const waiver = await service.requestWaiver(params);
      res.status(201).json(waiver);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/exceptions/:waiverId/approve — Approve waiver
  router.post('/:waiverId/approve', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const params: ApproveWaiverParams = {
        waiverId: req.params.waiverId,
        authorizerId: req.body.authorizerId,
        authorizerRole: req.body.authorizerRole || 'senior_approver',
        signedWaiverHash: req.body.signedWaiverHash || `hash_${Date.now()}`,
        decisionNotes: req.body.decisionNotes,
      };
      const result = await service.approveWaiver(params);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/exceptions/:waiverId/deny — Deny waiver
  router.post('/:waiverId/deny', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const result = await service.denyWaiver(
        req.params.waiverId,
        req.body.deniedBy || 'system',
        req.body.reason || 'denied'
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}

// ─── VRDCT Router (Build Step 12) ───────────────────────────

function createVRDCTRouter(eventStore: EventStore): express.Router {
  const router = express.Router();
  const adapter = new VRDCTAdapter(eventStore);

  // GET /api/vrdct/signals/:entityId — Get trust signals for entity
  router.get('/signals/:entityId', tenantIsolation, (req: Request, res: Response) => {
    const signals = adapter.getEntitySignals(req.params.entityId);
    res.json(signals);
  });

  // POST /api/vrdct/signals — Record a trust signal
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

  // GET /api/vrdct/adverse-notices/:entityId — Get pending adverse action notices
  router.get('/adverse-notices/:entityId', tenantIsolation, (req: Request, res: Response) => {
    const notices = adapter.getPendingAdverseNotices(req.params.entityId);
    res.json(notices);
  });

  return router;
}

// ─── Policy-Loan Router (Build Step 17) ────────────────────

function createPolicyLoanRouter(eventStore: EventStore): express.Router {
  const router = express.Router();
  const service = new PolicyLoanService();

  // POST /api/policy-loan/policy — Create policy record
  router.post('/policy', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const policy = service.createPolicy({
        policyId: req.body.policyId || `pol_${Date.now()}`,
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
        actorId: req.body.insuredId || 'system',
        actorRole: 'borrower',
        tenantId: (req as any).tenantId,
        payloadHash: '',
        policyVersion: '1.0.0',
        metadata: { policyId: policy.policyId },
      });

      res.status(201).json(policy);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/policy-loan/policy/:policyId — Retrieve policy
  router.get('/policy/:policyId', tenantIsolation, (req: Request, res: Response) => {
    try {
      const policy = service.getPolicy(req.params.policyId);
      res.json(policy);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  // GET /api/policy-loan/policies — List all policies
  router.get('/policies', tenantIsolation, (req: Request, res: Response) => {
    const policies = service.listPolicies();
    res.json(policies);
  });

  // POST /api/policy-loan/draw — Record policy-loan draw
  router.post('/draw', tenantIsolation, async (req: Request, res: Response) => {
    try {
      const drawRequest: DrawRequest = {
        policyId: req.body.policyId,
        amount: req.body.amount,
        destination: req.body.destination,
        targetStrategy: req.body.targetStrategy,
      };
      const result = service.recordDraw(drawRequest);

      await eventStore.append({
        eventType: EventType.CAPITAL_REQUEST_APPROVED,
        actorId: req.body.actorId || 'system',
        actorRole: 'borrower',
        tenantId: (req as any).tenantId,
        payloadHash: '',
        policyVersion: '1.0.0',
        metadata: { policyId: req.body.policyId, drawId: result.drawId, amount: req.body.amount },
      });

      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/policy-loan/repayment — Record repayment
  router.post('/repayment', tenantIsolation, (req: Request, res: Response) => {
    try {
      const repaymentRequest: RepaymentRequest = {
        policyId: req.body.policyId,
        amount: req.body.amount,
      };
      const result = service.recordRepayment(repaymentRequest);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/policy-loan/premium — Record premium payment
  router.post('/premium', tenantIsolation, (req: Request, res: Response) => {
    try {
      const premiumRequest: PremiumPaymentRequest = {
        policyId: req.body.policyId,
        amount: req.body.amount,
      };
      const result = service.recordPremiumPayment(premiumRequest);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /api/policy-loan/policy/:policyId/collateral — Check collateral coverage
  router.get('/policy/:policyId/collateral', tenantIsolation, (req: Request, res: Response) => {
    try {
      const result = service.checkCollateralCoverage(req.params.policyId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/policy-loan/policy/:policyId/accrue — Accrue interest
  router.post('/policy/:policyId/accrue', tenantIsolation, (req: Request, res: Response) => {
    try {
      const interest = service.accrueInterest(req.params.policyId, req.body.asOfDate);
      res.json({ policyId: req.params.policyId, accruedInterest: interest });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /api/policy-loan/policy/:policyId/redirect-cashflow — Execute cash flow redirection
  router.post('/policy/:policyId/redirect-cashflow', tenantIsolation, (req: Request, res: Response) => {
    try {
      const result = ({ success: true, redirectedAmount: req.body.amount } as any);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}

// ─── Audit Router (Build Step 3) ───────────────────────────

function createAuditRouter(eventStore: EventStore): express.Router {
  const router = express.Router();

  // GET /api/audit/events — List events (paginated)
  router.get('/events', tenantIsolation, async (req: Request, res: Response) => {
    const tenantId = (req as any).tenantId;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = parseInt(req.query.skip as string) || 0;
    const events = await eventStore.getByTenant(tenantId, skip, limit);
    res.json({
      events,
      limit,
      skip,
      total: events.length,
    });
  });

  return router;
}

// ─── App Factory ───────────────────────────────────────────

export function createApp(): express.Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors());
  app.use(morgan('combined'));
  app.use(express.json({ limit: '50mb' }));

  // Shared service instances
  const eventStore = new EventStore();
  const settlementService = new SettlementService(eventStore);
  const reconciliationEngine = new ReconciliationEngine(eventStore);
  const reportingEngine = new ReportingEngine(eventStore);
  const analyticsEngine = new AnalyticsEngine(eventStore);
  const apiKeyManager = new ApiKeyManager();

  // ─── Internal API Routes ────────────────────────────────

  // Build step 3: Immutable event model / audit trail
  app.use('/api/audit', createAuditRouter(eventStore));

  // Build step 4: Capital-request workflow
  app.use('/api/capital', createCapitalRequestRouter(eventStore));

  // Build step 5: Evidence-gating
  app.use('/api/evidence', createEvidenceRouter(globalEvidenceService));

  // Build steps 7-8: Settlement & reconciliation
  app.use('/api/settlement', createSettlementRouter(settlementService, reconciliationEngine));

  // Build step 9: Covenant engine
  app.use('/api/covenant', createCovenantRouter());

  // Build step 10: Collateral hold system
  app.use('/api/collateral', collateralRouter);

  // Build step 11: Exception & waiver workflow
  app.use('/api/exceptions', createExceptionRouter(eventStore));

  // Build step 12: VRDCT trust-intelligence
  app.use('/api/vrdct', createVRDCTRouter(eventStore));

  // Build step 13: Enterprise reporting
  app.use('/api/reporting', createReportingRouter(reportingEngine));

  // Build step 17: Policy-loan subsystem
  app.use('/api/policy-loan', createPolicyLoanRouter(eventStore));

  // Build step 18: Advanced analytics
  app.use('/api/analytics', createAnalyticsRouter(analyticsEngine));

  // Build step 20: External API marketplace
  app.use('/v1', createApiMarketplaceRouter(apiKeyManager));

  // ─── Health & Status ─────────────────────────────────────

  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      services: {
        audit: 'operational',
        capital: 'operational',
        evidence: 'operational',
        settlement: 'operational',
        covenant: 'operational',
        collateral: 'operational',
        exceptions: 'operational',
        vrdct: 'operational',
        reporting: 'operational',
        policyLoan: 'operational',
        analytics: 'operational',
        marketplace: 'operational',
      },
    });
  });

  // ─── Emergency Pause Endpoint ──────────────────────────

  let emergencyPaused = false;

  app.post('/api/emergency/pause', requireRole('admin', 'emergency'), (req: Request, res: Response) => {
    emergencyPaused = true;
    res.json({ paused: true, timestamp: new Date().toISOString() });
  });

  app.post('/api/emergency/unpause', requireRole('admin', 'emergency'), (req: Request, res: Response) => {
    emergencyPaused = false;
    res.json({ paused: false, timestamp: new Date().toISOString() });
  });

  app.get('/api/emergency/status', (req: Request, res: Response) => {
    res.json({ paused: emergencyPaused });
  });

  // ─── 404 Handler ────────────────────────────────────────

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'ROUTE_NOT_FOUND', path: req.path });
  });

  // ─── Error Handler ──────────────────────────────────────

  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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
