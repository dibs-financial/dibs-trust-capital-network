/**
 * DIBS Backend — Reconciliation Engine
 *
 * Matches settlement instructions to settlement confirmations.
 * Detects variances (amount mismatch, timing mismatch, missing confirmation).
 * Blocks future releases if unresolved reconciliation exceptions exist.
 *
 * Reconciliation States: pending → matched | variance_detected | unmatched | exception
 */

import { EventStore, EventType } from '../audit/event-store';
import { SettlementInstruction } from './settlement-service';

export type ReconciliationStatus =
  | 'pending'
  | 'matched'
  | 'variance_detected'
  | 'unmatched'
  | 'exception';

export interface ReconciliationRecord {
  reconciliationId: string;
  instructionId: string;
  requestId: string;
  expectedAmount: number;
  confirmedAmount: number | null;
  variance: number | null;
  status: ReconciliationStatus;
  timestamp: string;
  varianceType?: 'amount_mismatch' | 'timing_mismatch' | 'missing_confirmation';
  varianceDescription?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  tenantId: string;
}

export interface ReconciliationException {
  exceptionId: string;
  reconciliationId: string;
  instructionId: string;
  exceptionType: 'amount_mismatch' | 'timing_mismatch' | 'missing_confirmation' | 'failed_settlement';
  exceptionDescription: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  resolutionNotes?: string;
  tenantId: string;
}

/**
 * Variance tolerance — amounts within this threshold are considered matched.
 * Configurable per tenant/partner.
 */
const DEFAULT_VARIANCE_TOLERANCE = 0.01; // 1 cent

export class ReconciliationEngine {
  private reconciliations: Map<string, ReconciliationRecord> = new Map();
  private exceptions: Map<string, ReconciliationException> = new Map();
  private instructionIndex: Map<string, string> = new Map(); // instructionId → reconciliationId

  constructor(private eventStore: EventStore) {}

  /**
   * Create a reconciliation record when a settlement instruction is sent.
   */
  async createReconciliation(
    instruction: SettlementInstruction,
    tenantId: string
  ): Promise<ReconciliationRecord> {
    const reconciliationId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const record: ReconciliationRecord = {
      reconciliationId,
      instructionId: instruction.instructionId,
      requestId: instruction.requestId,
      expectedAmount: instruction.amount,
      confirmedAmount: null,
      variance: null,
      status: 'pending',
      timestamp: new Date().toISOString(),
      tenantId,
    };

    this.reconciliations.set(reconciliationId, record);
    this.instructionIndex.set(instruction.instructionId, reconciliationId);

    return record;
  }

  /**
   * Reconcile a confirmed settlement instruction against expected values.
   */
  async reconcile(
    instruction: SettlementInstruction,
    tenantId: string,
    varianceTolerance: number = DEFAULT_VARIANCE_TOLERANCE
  ): Promise<ReconciliationRecord> {
    const reconciliationId = this.instructionIndex.get(instruction.instructionId);
    if (!reconciliationId) {
      throw new Error(`RECONCILIATION_NOT_FOUND for instruction: ${instruction.instructionId}`);
    }

    const record = this.reconciliations.get(reconciliationId)!;

    if (instruction.status === 'confirmed' && instruction.confirmedAmount !== undefined) {
      record.confirmedAmount = instruction.confirmedAmount;
      record.variance = Math.abs(instruction.confirmedAmount - record.expectedAmount);

      if (record.variance <= varianceTolerance) {
        record.status = 'matched';
        record.resolvedAt = new Date().toISOString();
      } else {
        record.status = 'variance_detected';
        record.varianceType = 'amount_mismatch';
        record.varianceDescription = `Expected ${record.expectedAmount}, confirmed ${instruction.confirmedAmount}, variance ${record.variance}`;

        // Create exception
        await this.createException({
          reconciliationId: record.reconciliationId,
          instructionId: instruction.instructionId,
          exceptionType: 'amount_mismatch',
          exceptionDescription: record.varianceDescription,
          tenantId,
        });
      }
    } else if (instruction.status === 'exception') {
      record.status = 'exception';
      record.varianceType = 'failed_settlement';
      record.varianceDescription = instruction.exceptionDescription || 'Settlement exception';

      await this.createException({
        reconciliationId: record.reconciliationId,
        instructionId: instruction.instructionId,
        exceptionType: 'failed_settlement',
        exceptionDescription: record.varianceDescription,
        tenantId,
      });
    } else if (instruction.status === 'failed') {
      record.status = 'exception';
      record.varianceType = 'missing_confirmation';
      record.varianceDescription = 'Settlement transmission failed';

      await this.createException({
        reconciliationId: record.reconciliationId,
        instructionId: instruction.instructionId,
        exceptionType: 'missing_confirmation',
        exceptionDescription: record.varianceDescription,
        tenantId,
      });
    }

    return record;
  }

  /**
   * Check for unmatched reconciliations (sent but never confirmed).
   * Called by scheduled job.
   */
  async checkUnmatched(maxAgeHours: number, tenantId: string): Promise<ReconciliationRecord[]> {
    const now = Date.now();
    const unmatched: ReconciliationRecord[] = [];

    for (const record of this.reconciliations.values()) {
      if (record.tenantId !== tenantId) continue;
      if (record.status !== 'pending') continue;

      const age = (now - new Date(record.timestamp).getTime()) / (1000 * 60 * 60);
      if (age > maxAgeHours) {
        record.status = 'unmatched';
        record.varianceType = 'missing_confirmation';
        record.varianceDescription = `No confirmation received after ${maxAgeHours} hours`;

        unmatched.push(record);

        await this.createException({
          reconciliationId: record.reconciliationId,
          instructionId: record.instructionId,
          exceptionType: 'missing_confirmation',
          exceptionDescription: record.varianceDescription,
          tenantId,
        });
      }
    }

    return unmatched;
  }

  /**
   * Create a reconciliation exception.
   * Unresolved exceptions block future capital releases.
   */
  private async createException(params: {
    reconciliationId: string;
    instructionId: string;
    exceptionType: ReconciliationException['exceptionType'];
    exceptionDescription: string;
    tenantId: string;
  }): Promise<ReconciliationException> {
    const exceptionId = `exc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const exception: ReconciliationException = {
      exceptionId,
      reconciliationId: params.reconciliationId,
      instructionId: params.instructionId,
      exceptionType: params.exceptionType,
      exceptionDescription: params.exceptionDescription,
      createdAt: new Date().toISOString(),
      resolved: false,
      tenantId: params.tenantId,
    };

    this.exceptions.set(exceptionId, exception);

    return exception;
  }

  /**
   * Resolve a reconciliation exception.
   * Must provide resolution notes.
   */
  async resolveException(
    exceptionId: string,
    resolutionNotes: string,
    tenantId: string
  ): Promise<ReconciliationException> {
    const exception = this.exceptions.get(exceptionId);
    if (!exception) {
      throw new Error(`RECONCILIATION_EXCEPTION_NOT_FOUND: ${exceptionId}`);
    }
    if (exception.tenantId !== tenantId) {
      throw new Error('TENANT_MISMATCH');
    }

    exception.resolved = true;
    exception.resolvedAt = new Date().toISOString();
    exception.resolutionNotes = resolutionNotes;

    // Also resolve the reconciliation record
    const record = this.reconciliations.get(exception.reconciliationId);
    if (record) {
      record.status = 'matched';
      record.resolvedAt = new Date().toISOString();
      record.resolutionNotes = resolutionNotes;
    }

    return exception;
  }

  /**
   * Check if any unresolved reconciliation exceptions exist for a tenant.
   * This is exposed to the capital-release policy engine — blocks releases if true.
   */
  hasUnresolvedExceptions(tenantId: string): boolean {
    for (const exception of this.exceptions.values()) {
      if (exception.tenantId === tenantId && !exception.resolved) {
        return true;
      }
    }
    return false;
  }

  getReconciliation(reconciliationId: string): ReconciliationRecord | undefined {
    return this.reconciliations.get(reconciliationId);
  }

  getReconciliationByInstruction(instructionId: string): ReconciliationRecord | undefined {
    const reconciliationId = this.instructionIndex.get(instructionId);
    return reconciliationId ? this.reconciliations.get(reconciliationId) : undefined;
  }

  getUnresolvedExceptions(tenantId: string): ReconciliationException[] {
    return Array.from(this.exceptions.values())
      .filter(e => e.tenantId === tenantId && !e.resolved);
  }
}
