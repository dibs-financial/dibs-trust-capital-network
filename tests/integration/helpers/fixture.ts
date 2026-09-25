/**
 * Week-one fixture: one tenant, one SPV, one deal, one verified payee, and the
 * user triangle — sponsor (requester), approver, treasury (instructor).
 *
 * Tenant bootstrap and reference data are seeded directly; in production these
 * come from admin flows. Everything the draw does goes through DrawService.
 */

import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Session, withTenantTx } from '../../../backend/api/db';

export interface Fixture {
  tenantId: string;
  spvId: string;
  dealId: string;
  counterpartyId: string;
  payeeBankAccountId: string;
  payeeAccountRef: string;
  sponsor: Session;
  approver: Session;
  treasury: Session;
}

export const POLICY_VERSION = 'policy-2026.09.19';

export async function seedTenant(
  pool: Pool,
  name: string,
  extraRoles: Array<{ subject: string; role: string }> = []
): Promise<Fixture> {
  const tenantId = randomUUID();
  const bootstrap: Session = { tenantId: tenantId, subject: 'bootstrap@' + name };
  const sponsor: Session = { tenantId: tenantId, subject: 'sponsor@' + name };
  const approver: Session = { tenantId: tenantId, subject: 'approver@' + name };
  const treasury: Session = { tenantId: tenantId, subject: 'treasury@' + name };
  const spvId = randomUUID();
  const dealId = randomUUID();
  const counterpartyId = randomUUID();
  const payeeBankAccountId = randomUUID();
  const payeeAccountRef = 'tok_' + name + '_gc_operating';

  await withTenantTx(pool, bootstrap, async function (tx) {
    await tx.query('INSERT INTO organization (id, name) VALUES ($1, $2)', [tenantId, name]);
    const roles = [
      { subject: sponsor.subject, role: 'BorrowerSponsor' },
      { subject: approver.subject, role: 'RiskOwner' },
      { subject: treasury.subject, role: 'TreasuryOwner' },
    ].concat(extraRoles);
    for (const r of roles) {
      await tx.query(
        "INSERT INTO user_role (tenant_id, user_subject, role, scope_type, granted_by_subject) VALUES ($1,$2,$3,'TENANT',$4)",
        [tenantId, r.subject, r.role, bootstrap.subject]
      );
    }
    await tx.query(
      "INSERT INTO spv (id, tenant_id, legal_name, jurisdiction, entity_type, lifecycle_status) VALUES ($1,$2,$3,'US-DE','LLC','ACTIVE')",
      [spvId, tenantId, name + ' Fixture SPV LLC']
    );
    await tx.query(
      "INSERT INTO deal (id, tenant_id, spv_id, name, currency, effective_policy_version) VALUES ($1,$2,$3,$4,'USD',$5)",
      [dealId, tenantId, spvId, name + ' FX-1 construction loan', POLICY_VERSION]
    );
    await tx.query(
      "INSERT INTO counterparty (id, tenant_id, legal_name, counterparty_type, kyc_status, sanctions_status, sanctions_screened_at) " +
        "VALUES ($1,$2,'GC Fixture LLC','CONTRACTOR','CURRENT','CLEAR', now())",
      [counterpartyId, tenantId]
    );
    await tx.query(
      "INSERT INTO payee_bank_account (id, tenant_id, counterparty_id, account_ref, account_last4, currency, verification_status, verified_at, verified_by_subject) " +
        "VALUES ($1,$2,$3,$4,'4321','USD','VERIFIED', now(), $5)",
      [payeeBankAccountId, tenantId, counterpartyId, payeeAccountRef, bootstrap.subject]
    );
  });

  return {
    tenantId: tenantId,
    spvId: spvId,
    dealId: dealId,
    counterpartyId: counterpartyId,
    payeeBankAccountId: payeeBankAccountId,
    payeeAccountRef: payeeAccountRef,
    sponsor: sponsor,
    approver: approver,
    treasury: treasury,
  };
}
