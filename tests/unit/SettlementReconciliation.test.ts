/**
 * DIBS Tests — Settlement and Reconciliation
 */

import { SettlementService, generateInstructionHash, validateBankAccount } from '../../backend/settlement/settlement-service';
import { ReconciliationEngine } from '../../backend/settlement/reconciliation-engine';
import { EventStore } from '../../backend/audit/event-store';

describe('Settlement Service', () => {
  let eventStore: EventStore;
  let service: SettlementService;

  beforeEach(() => {
    eventStore = new EventStore();
    service = new SettlementService(eventStore);
  });

  describe('Bank Account Validation', () => {
    it('passes when account is verified with complete details', () => {
      const result = validateBankAccount('acct_1', {
        accountVerified: true,
        accountName: 'Cornerstone Capital',
        accountType: 'checking',
      });
      expect(result.valid).toBe(true);
    });

    it('fails when account not verified', () => {
      const result = validateBankAccount('acct_1', {
        accountVerified: false,
        failureReason: 'ACCOUNT_FROZEN',
      });
      expect(result.valid).toBe(false);
      expect(result.failureReason).toBe('ACCOUNT_FROZEN');
    });

    it('fails when account details incomplete', () => {
      const result = validateBankAccount('acct_1', {
        accountVerified: true,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('Instruction Hash', () => {
    it('generates deterministic hash for same inputs', () => {
      const hash1 = generateInstructionHash('req_1', 500000, 'acct_1', 'FedWire');
      const hash2 = generateInstructionHash('req_1', 500000, 'acct_1', 'FedWire');
      expect(hash1).toBe(hash2);
    });

    it('generates different hash for different inputs', () => {
      const hash1 = generateInstructionHash('req_1', 500000, 'acct_1', 'FedWire');
      const hash2 = generateInstructionHash('req_2', 500000, 'acct_1', 'FedWire');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Idempotency', () => {
    it('returns same instruction for duplicate requestId', async () => {
      const params = {
        requestId: 'req_1',
        amount: 500000,
        paymentDestination: 'acct_1',
        settlementPartner: 'FedWire',
        tenantId: 'tenant_1',
        bankValidation: {
          accountVerified: true,
          accountName: 'Cornerstone',
          accountType: 'checking',
        },
      };

      const first = await service.createInstruction(params);
      const second = await service.createInstruction(params);
      expect(first.instructionId).toBe(second.instructionId);
    });

    it('throws when bank account not verified', async () => {
      await expect(
        service.createInstruction({
          requestId: 'req_2',
          amount: 500000,
          paymentDestination: 'acct_1',
          settlementPartner: 'FedWire',
          tenantId: 'tenant_1',
          bankValidation: { accountVerified: false, failureReason: 'FROZEN' },
        })
      ).rejects.toThrow('SETTLEMENT_BLOCKED');
    });
  });

  describe('Confirmation', () => {
    it('records confirmation and updates status', async () => {
      const instruction = await service.createInstruction({
        requestId: 'req_3',
        amount: 500000,
        paymentDestination: 'acct_1',
        settlementPartner: 'FedWire',
        tenantId: 'tenant_1',
        bankValidation: {
          accountVerified: true,
          accountName: 'Cornerstone',
          accountType: 'checking',
        },
      });

      const confirmed = await service.recordConfirmation(instruction.instructionId, {
        confirmationHash: '0xabc',
        confirmedAmount: 500000,
        confirmedTimestamp: new Date().toISOString(),
        tenantId: 'tenant_1',
      });

      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.confirmedAmount).toBe(500000);
    });
  });
});

describe('Reconciliation Engine', () => {
  let eventStore: EventStore;
  let reconciliation: ReconciliationEngine;
  let service: SettlementService;

  beforeEach(() => {
    eventStore = new EventStore();
    reconciliation = new ReconciliationEngine(eventStore);
    service = new SettlementService(eventStore);
  });

  it('matches confirmed settlement with exact amount', async () => {
    const instruction = await service.createInstruction({
      requestId: 'req_1',
      amount: 500000,
      paymentDestination: 'acct_1',
      settlementPartner: 'FedWire',
      tenantId: 'tenant_1',
      bankValidation: {
        accountVerified: true,
        accountName: 'Cornerstone',
        accountType: 'checking',
      },
    });

    await reconciliation.createReconciliation(instruction, 'tenant_1');

    const confirmed = await service.recordConfirmation(instruction.instructionId, {
      confirmationHash: '0xdef',
      confirmedAmount: 500000,
      confirmedTimestamp: new Date().toISOString(),
      tenantId: 'tenant_1',
    });

    const record = await reconciliation.reconcile(confirmed, 'tenant_1');
    expect(record.status).toBe('matched');
  });

  it('detects amount variance', async () => {
    const instruction = await service.createInstruction({
      requestId: 'req_2',
      amount: 500000,
      paymentDestination: 'acct_1',
      settlementPartner: 'FedWire',
      tenantId: 'tenant_1',
      bankValidation: {
        accountVerified: true,
        accountName: 'Cornerstone',
        accountType: 'checking',
      },
    });

    await reconciliation.createReconciliation(instruction, 'tenant_1');

    const confirmed = await service.recordConfirmation(instruction.instructionId, {
      confirmationHash: '0xdef',
      confirmedAmount: 499000,
      confirmedTimestamp: new Date().toISOString(),
      tenantId: 'tenant_1',
    });

    const record = await reconciliation.reconcile(confirmed, 'tenant_1');
    expect(record.status).toBe('variance_detected');
    expect(record.varianceType).toBe('amount_mismatch');
  });

  it('blocks releases when unresolved exceptions exist', async () => {
    const instruction = await service.createInstruction({
      requestId: 'req_3',
      amount: 500000,
      paymentDestination: 'acct_1',
      settlementPartner: 'FedWire',
      tenantId: 'tenant_1',
      bankValidation: {
        accountVerified: true,
        accountName: 'Cornerstone',
        accountType: 'checking',
      },
    });

    await reconciliation.createReconciliation(instruction, 'tenant_1');

    const exceptionInstruction = await service.recordException(instruction.instructionId, {
      exceptionType: 'TRANSMISSION_FAILURE',
      exceptionDescription: 'Partner API returned 500',
      tenantId: 'tenant_1',
    });

    // Trigger reconciliation to detect and record the exception
    await reconciliation.reconcile(exceptionInstruction, 'tenant_1');

    const hasUnresolved = reconciliation.hasUnresolvedExceptions('tenant_1');
    expect(hasUnresolved).toBe(true);
  });

  it('resolves exceptions and clears block', async () => {
    const instruction = await service.createInstruction({
      requestId: 'req_4',
      amount: 500000,
      paymentDestination: 'acct_1',
      settlementPartner: 'FedWire',
      tenantId: 'tenant_1',
      bankValidation: {
        accountVerified: true,
        accountName: 'Cornerstone',
        accountType: 'checking',
      },
    });

    await reconciliation.createReconciliation(instruction, 'tenant_1');

    const exceptionInstruction = await service.recordException(instruction.instructionId, {
      exceptionType: 'TRANSMISSION_FAILURE',
      exceptionDescription: 'Partner API returned 500',
      tenantId: 'tenant_1',
    });

    await reconciliation.reconcile(exceptionInstruction, 'tenant_1');

    const exceptions = reconciliation.getUnresolvedExceptions('tenant_1');
    expect(exceptions.length).toBe(1);

    await reconciliation.resolveException(
      exceptions[0].exceptionId,
      'Partner confirmed receipt after retry',
      'tenant_1'
    );

    expect(reconciliation.hasUnresolvedExceptions('tenant_1')).toBe(false);
  });
});
