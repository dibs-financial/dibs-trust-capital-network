-- Application role. The service logs in as a member of dibs_app, which is not a
-- superuser and does not bypass RLS, so tenant isolation always applies.
-- Ledger and decision tables get no UPDATE / DELETE / TRUNCATE at all.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dibs_app') THEN
    CREATE ROLE dibs_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO dibs_app;

-- Mutable operational rows: insert and update, never delete.
GRANT SELECT, INSERT, UPDATE ON
  organization, user_role, spv, deal, counterparty, payee_bank_account, draw_request,
  evidence_document, hold, exception_waiver, settlement_instruction, audit_chain_head
TO dibs_app;

-- Append-only rows: insert and read only.
GRANT SELECT, INSERT ON
  evidence_manifest, policy_evaluation, approval_decision, settlement_confirmation,
  reconciliation_record, audit_event
TO dibs_app;

GRANT EXECUTE ON FUNCTION app_tenant_id() TO dibs_app;

COMMIT;
