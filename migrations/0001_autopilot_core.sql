-- DIBS Capital Autopilot — core schema (Sprints 1–4)
--
-- Tables: organization, user_role, deal, spv, counterparty, payee_bank_account,
-- draw_request, evidence_document, evidence_manifest, policy_evaluation,
-- approval_decision, hold, exception_waiver, settlement_instruction,
-- settlement_confirmation, reconciliation_record.
--
-- Specs: docs/architecture/DIBS-Domain-State-Event-Model.md,
--        docs/architecture/DIBS-Trust-Capital-Network-Master-Scaffold.md
--
-- Conventions
--   * Every row carries tenant_id. Cross-table references are composite
--     (tenant_id, id) foreign keys, so a row can never point into another tenant.
--   * Row-level security reads the tenant from the session setting app.tenant_id,
--     never from a column the client chooses. Unset means no rows.
--   * Users come from OIDC. They are identified by their subject; there is no
--     local password or user table.
--   * Money is BIGINT minor units plus an ISO-4217 currency. No floats.
--   * Timestamps are timestamptz (UTC).
--   * Decisions and evidence are append-only; corrections are new rows.
--   * DIBS approves and records. Nothing here moves funds.

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Tenant for the current session. NULL when unset, which RLS treats as no access.
CREATE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Append-only guard for decision and evidence history.
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % on % is not allowed; write a new row', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

-- ---------------------------------------------------------------------------
-- organization, user_role
-- ---------------------------------------------------------------------------

CREATE TABLE organization (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) > 0),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_role (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES organization (id),
  user_subject        text NOT NULL CHECK (length(user_subject) > 0),  -- OIDC sub
  is_service_account  boolean NOT NULL DEFAULT false,
  role                text NOT NULL CHECK (role IN (
                        'PlatformAdmin', 'LenderAdmin', 'Underwriter', 'PortfolioManager', 'RiskOwner',
                        'TreasuryOwner', 'OperationsOwner', 'BorrowerSponsor', 'Inspector',
                        'ComplianceReviewer', 'FundAdministrator', 'EscrowPartner', 'Auditor', 'SuperAgent')),
  scope_type          text NOT NULL CHECK (scope_type IN ('TENANT', 'DEAL', 'SPV')),
  scope_id            uuid,
  granted_by_subject  text NOT NULL,
  granted_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  revoked_by_subject  text,
  UNIQUE (tenant_id, id),
  CHECK ((scope_type = 'TENANT') = (scope_id IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by_subject IS NULL)),
  CHECK (granted_by_subject <> user_subject)
);
CREATE UNIQUE INDEX user_role_active_uq
  ON user_role (tenant_id, user_subject, role, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'))
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- spv, deal, counterparty, payee_bank_account
-- ---------------------------------------------------------------------------

CREATE TABLE spv (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES organization (id),
  legal_name         text NOT NULL,
  jurisdiction       text NOT NULL,
  entity_type        text NOT NULL,
  lifecycle_status   text NOT NULL DEFAULT 'INTAKE' CHECK (lifecycle_status IN (
                       'INTAKE', 'BLUEPRINTED', 'FORMATION_IN_PROGRESS', 'FORMED', 'EIN_PENDING', 'EIN_READY',
                       'BANKING_PENDING', 'BANKING_READY', 'GOVERNANCE_READY', 'DOCUMENTS_READY',
                       'COMPLIANCE_REVIEW', 'FUNDING_READY', 'ACTIVE', 'WIND_DOWN_IN_PROGRESS', 'CLOSED')),
  series_isolation   boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE deal (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES organization (id),
  spv_id                    uuid NOT NULL,
  name                      text NOT NULL,
  status                    text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  currency                  char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_policy_version  text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, spv_id) REFERENCES spv (tenant_id, id)
);

CREATE TABLE counterparty (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES organization (id),
  legal_name             text NOT NULL,
  counterparty_type      text NOT NULL CHECK (counterparty_type IN (
                           'SPONSOR', 'LENDER', 'INSPECTOR', 'CONTRACTOR', 'SERVICER', 'OTHER')),
  kyc_status             text NOT NULL DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING', 'CURRENT', 'STALE', 'FAILED')),
  sanctions_status       text NOT NULL DEFAULT 'PENDING' CHECK (sanctions_status IN ('PENDING', 'CLEAR', 'HIT')),
  sanctions_screened_at  timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (sanctions_status = 'PENDING' OR sanctions_screened_at IS NOT NULL)
);

-- Account numbers never live here: account_ref is a token from the custody /
-- banking partner, account_last4 is for humans.
CREATE TABLE payee_bank_account (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES organization (id),
  counterparty_id         uuid NOT NULL,
  account_ref             text NOT NULL,
  account_last4           char(4) NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  currency                char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  verification_status     text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN (
                            'UNVERIFIED', 'PENDING', 'VERIFIED', 'REVOKED')),
  verified_at             timestamptz,
  verified_by_subject     text,
  cooling_period_ends_at  timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, account_ref),
  FOREIGN KEY (tenant_id, counterparty_id) REFERENCES counterparty (tenant_id, id),
  CHECK ((verification_status = 'VERIFIED') = (verified_at IS NOT NULL AND verified_by_subject IS NOT NULL)
         OR verification_status = 'REVOKED')
);

-- ---------------------------------------------------------------------------
-- draw_request
-- ---------------------------------------------------------------------------

CREATE TABLE draw_request (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                      uuid NOT NULL REFERENCES organization (id),
  deal_id                        uuid NOT NULL,
  spv_id                         uuid NOT NULL,
  series_id                      uuid,  -- required when the SPV uses series isolation
  request_number                 text NOT NULL,
  status                         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                                   'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SETTLEMENT_INSTRUCTED',
                                   'SETTLEMENT_CONFIRMED', 'RECONCILED', 'CLOSED',
                                   'REQUIRES_INFORMATION', 'HELD', 'ESCALATED', 'SETTLEMENT_FAILED',
                                   'RECONCILIATION_EXCEPTION', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  requested_by_subject           text NOT NULL,
  payee_counterparty_id          uuid NOT NULL,
  payee_bank_account_id          uuid NOT NULL,
  amount_requested_minor         bigint NOT NULL CHECK (amount_requested_minor > 0),
  amount_approved_minor          bigint,
  currency                       char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  budget_line_ids                uuid[] NOT NULL DEFAULT '{}',  -- draw_budget_line is not in this migration
  requested_at                   timestamptz NOT NULL DEFAULT now(),
  submitted_at                   timestamptz,
  locked_policy_version          text,
  locked_evidence_manifest_hash  text,
  approval_binding_hash          text,
  policy_evaluation_id           uuid,
  policy_evaluation_status       text CHECK (policy_evaluation_status IN ('PASS', 'HOLD', 'FAIL', 'REVIEW_REQUIRED')),
  evidence_status                text NOT NULL DEFAULT 'INCOMPLETE' CHECK (evidence_status IN ('INCOMPLETE', 'COMPLETE', 'FROZEN', 'EXPIRED')),
  approval_status                text NOT NULL DEFAULT 'NOT_STARTED' CHECK (approval_status IN ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED')),
  settlement_status              text NOT NULL DEFAULT 'NONE' CHECK (settlement_status IN ('NONE', 'INSTRUCTED', 'CONFIRMED', 'FAILED')),
  reconciliation_status          text NOT NULL DEFAULT 'PENDING' CHECK (reconciliation_status IN ('PENDING', 'MATCHED', 'EXCEPTION')),
  hold_reason_code               text,
  hold_reason_text               text,
  idempotency_key                text NOT NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, request_number),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deal (tenant_id, id),
  FOREIGN KEY (tenant_id, spv_id) REFERENCES spv (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_counterparty_id) REFERENCES counterparty (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_bank_account_id) REFERENCES payee_bank_account (tenant_id, id),
  -- Everything past DRAFT is bound to a locked policy and a frozen manifest.
  CHECK (status = 'DRAFT' OR (submitted_at IS NOT NULL AND locked_policy_version IS NOT NULL AND locked_evidence_manifest_hash IS NOT NULL)),
  -- APPROVED and every step after it carries the approved amount and the binding.
  CHECK (status NOT IN ('APPROVED', 'SETTLEMENT_INSTRUCTED', 'SETTLEMENT_CONFIRMED', 'SETTLEMENT_FAILED',
                        'RECONCILIATION_EXCEPTION', 'RECONCILED', 'CLOSED')
         OR (amount_approved_minor IS NOT NULL AND approval_binding_hash IS NOT NULL)),
  CHECK (amount_approved_minor IS NULL OR (amount_approved_minor > 0 AND amount_approved_minor <= amount_requested_minor)),
  -- A held draw always says why, in code and in words.
  CHECK (status NOT IN ('HELD', 'REQUIRES_INFORMATION') OR (hold_reason_code IS NOT NULL AND hold_reason_text IS NOT NULL)),
  CHECK (status NOT IN ('RECONCILED', 'CLOSED') OR reconciliation_status = 'MATCHED'),
  CHECK (status <> 'RECONCILIATION_EXCEPTION' OR reconciliation_status = 'EXCEPTION')
);

-- locked_policy_version and locked_evidence_manifest_hash are immutable once set.
CREATE FUNCTION draw_request_guard_locks() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_policy_version IS NOT NULL AND NEW.locked_policy_version IS DISTINCT FROM OLD.locked_policy_version THEN
    RAISE EXCEPTION 'LOCKED_POLICY_VERSION_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.locked_evidence_manifest_hash IS NOT NULL
     AND NEW.locked_evidence_manifest_hash IS DISTINCT FROM OLD.locked_evidence_manifest_hash THEN
    RAISE EXCEPTION 'LOCKED_EVIDENCE_MANIFEST_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.requested_by_subject IS DISTINCT FROM OLD.requested_by_subject THEN
    RAISE EXCEPTION 'REQUESTER_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER draw_request_guard_locks BEFORE UPDATE ON draw_request
  FOR EACH ROW EXECUTE FUNCTION draw_request_guard_locks();

-- ---------------------------------------------------------------------------
-- evidence_document, evidence_manifest
-- ---------------------------------------------------------------------------

CREATE TABLE evidence_document (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES organization (id),
  deal_id                   uuid NOT NULL,
  spv_id                    uuid NOT NULL,
  draw_request_id           uuid,
  milestone_id              uuid,  -- milestone is not in this migration
  document_type             text NOT NULL CHECK (document_type IN (
                              'INVOICE', 'INSPECTION_REPORT', 'MILESTONE_ATTESTATION', 'LIEN_WAIVER',
                              'BORROWER_ATTESTATION', 'BUDGET_SUPPORT', 'CHANGE_ORDER_SUPPORT', 'COLLATERAL_UPDATE',
                              'INSURANCE_EVIDENCE', 'EXECUTED_CONTRACT', 'TITLE_OR_LEGAL', 'KYC_AML_STATUS',
                              'SANCTIONS_RESULT', 'PAYEE_ACCOUNT_SUPPORT', 'SETTLEMENT_INSTRUCTION_SUPPORT')),
  storage_uri               text NOT NULL,
  content_hash              text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  version                   integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id             uuid,
  uploaded_by_subject       text NOT NULL,
  uploaded_at               timestamptz NOT NULL DEFAULT now(),
  verified_at               timestamptz,
  verification_status       text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  source_system             text NOT NULL,
  retention_classification  text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deal (tenant_id, id),
  FOREIGN KEY (tenant_id, spv_id) REFERENCES spv (tenant_id, id),
  FOREIGN KEY (tenant_id, draw_request_id) REFERENCES draw_request (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES evidence_document (tenant_id, id),
  CHECK ((supersedes_id IS NULL) = (version = 1))
);
-- Evidence bytes are never deleted in place; supersession is a new version.
-- Only verification may change after upload.
CREATE FUNCTION evidence_document_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.storage_uri, NEW.content_hash, NEW.version, NEW.supersedes_id, NEW.document_type,
      NEW.uploaded_by_subject, NEW.uploaded_at, NEW.draw_request_id, NEW.deal_id, NEW.spv_id)
     IS DISTINCT FROM
     (OLD.storage_uri, OLD.content_hash, OLD.version, OLD.supersedes_id, OLD.document_type,
      OLD.uploaded_by_subject, OLD.uploaded_at, OLD.draw_request_id, OLD.deal_id, OLD.spv_id) THEN
    RAISE EXCEPTION 'EVIDENCE_IMMUTABLE: supersede with a new version' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_document_guard BEFORE UPDATE ON evidence_document
  FOR EACH ROW EXECUTE FUNCTION evidence_document_guard();
CREATE TRIGGER evidence_document_no_delete BEFORE DELETE ON evidence_document
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- The frozen evidence set bound to a draw. Written once, at SUBMITTED.
CREATE TABLE evidence_manifest (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES organization (id),
  draw_request_id       uuid NOT NULL,
  document_ids          uuid[] NOT NULL CHECK (cardinality(document_ids) > 0),
  manifest_hash         text NOT NULL CHECK (manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  frozen_at             timestamptz NOT NULL DEFAULT now(),
  frozen_by_subject     text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, draw_request_id),
  FOREIGN KEY (tenant_id, draw_request_id) REFERENCES draw_request (tenant_id, id)
);
CREATE TRIGGER evidence_manifest_append_only BEFORE UPDATE OR DELETE ON evidence_manifest
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- policy_evaluation
-- ---------------------------------------------------------------------------

CREATE TABLE policy_evaluation (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES organization (id),
  draw_request_id         uuid NOT NULL,
  locked_policy_version   text NOT NULL,
  evidence_manifest_hash  text NOT NULL,
  result                  text NOT NULL CHECK (result IN ('PASS', 'HOLD', 'FAIL', 'REVIEW_REQUIRED')),
  -- [{rule, result, reason_code, reason_text}, …] — machine-readable and human-readable.
  rule_results            jsonb NOT NULL CHECK (jsonb_typeof(rule_results) = 'array'),
  evaluated_at            timestamptz NOT NULL DEFAULT now(),
  evaluated_by            text NOT NULL,  -- engine version or subject
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, draw_request_id) REFERENCES draw_request (tenant_id, id)
);
CREATE TRIGGER policy_evaluation_append_only BEFORE UPDATE OR DELETE ON policy_evaluation
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE draw_request
  ADD FOREIGN KEY (tenant_id, policy_evaluation_id) REFERENCES policy_evaluation (tenant_id, id);

-- ---------------------------------------------------------------------------
-- approval_decision, hold, exception_waiver
-- ---------------------------------------------------------------------------

CREATE TABLE approval_decision (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES organization (id),
  draw_request_id         uuid NOT NULL,
  approver_subject        text NOT NULL,
  approver_role           text NOT NULL,
  decision                text NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  reason_text             text,
  locked_policy_version   text NOT NULL,
  evidence_manifest_hash  text NOT NULL,
  approval_binding_hash   text NOT NULL,
  decided_at              timestamptz NOT NULL DEFAULT now(),
  idempotency_key         text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, draw_request_id, approver_subject, approval_binding_hash),
  FOREIGN KEY (tenant_id, draw_request_id) REFERENCES draw_request (tenant_id, id),
  CHECK (decision = 'APPROVE' OR reason_text IS NOT NULL)
);

-- requester ≠ approver; service accounts cannot approve; the decision binds the
-- draw's locked policy and manifest.
CREATE FUNCTION approval_decision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d draw_request%ROWTYPE;
BEGIN
  SELECT * INTO d FROM draw_request WHERE tenant_id = NEW.tenant_id AND id = NEW.draw_request_id;
  IF NEW.approver_subject = d.requested_by_subject THEN
    RAISE EXCEPTION 'SOD_REQUESTER_CANNOT_APPROVE' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM user_role r
             WHERE r.tenant_id = NEW.tenant_id AND r.user_subject = NEW.approver_subject
               AND r.is_service_account AND r.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'SOD_SERVICE_ACCOUNT_CANNOT_APPROVE' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_role r
                 WHERE r.tenant_id = NEW.tenant_id AND r.user_subject = NEW.approver_subject
                   AND r.role = NEW.approver_role AND r.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'APPROVER_ROLE_NOT_HELD' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.locked_policy_version IS DISTINCT FROM d.locked_policy_version
     OR NEW.evidence_manifest_hash IS DISTINCT FROM d.locked_evidence_manifest_hash THEN
    RAISE EXCEPTION 'APPROVAL_NOT_BOUND_TO_LOCKED_DRAW' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_decision_guard BEFORE INSERT ON approval_decision
  FOR EACH ROW EXECUTE FUNCTION approval_decision_guard();
CREATE TRIGGER approval_decision_append_only BEFORE UPDATE OR DELETE ON approval_decision
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE hold (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES organization (id),
  scope_type           text NOT NULL CHECK (scope_type IN ('DRAW', 'DEAL', 'SPV', 'COUNTERPARTY', 'TENANT')),
  scope_id             uuid,
  hold_type            text NOT NULL CHECK (hold_type IN ('COMPLIANCE', 'OPERATIONAL', 'COVENANT', 'EVIDENCE', 'PAYEE', 'RECONCILIATION', 'PARTNER_DISAGREEMENT')),
  reason_code          text NOT NULL,
  reason_text          text NOT NULL CHECK (length(reason_text) > 0),
  placed_by_subject    text NOT NULL,
  placed_at            timestamptz NOT NULL DEFAULT now(),
  released_at          timestamptz,
  released_by_subject  text,
  release_reason_text  text,
  UNIQUE (tenant_id, id),
  CHECK ((scope_type = 'TENANT') = (scope_id IS NULL)),
  CHECK ((released_at IS NULL) = (released_by_subject IS NULL)),
  CHECK (released_at IS NULL OR release_reason_text IS NOT NULL)
);
CREATE INDEX hold_open_idx ON hold (tenant_id, scope_type, scope_id) WHERE released_at IS NULL;

-- A hold is released once and never reopened or rewritten; a new hold is a new row.
CREATE FUNCTION hold_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.released_at IS NOT NULL
     OR (NEW.scope_type, NEW.scope_id, NEW.hold_type, NEW.reason_code, NEW.reason_text, NEW.placed_by_subject, NEW.placed_at)
        IS DISTINCT FROM
        (OLD.scope_type, OLD.scope_id, OLD.hold_type, OLD.reason_code, OLD.reason_text, OLD.placed_by_subject, OLD.placed_at) THEN
    RAISE EXCEPTION 'HOLD_IMMUTABLE: only an open hold may be released' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hold_guard BEFORE UPDATE ON hold FOR EACH ROW EXECUTE FUNCTION hold_guard();
CREATE TRIGGER hold_no_delete BEFORE DELETE ON hold FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A waiver is a new authorization record. It never overwrites the failure it covers.
CREATE TABLE exception_waiver (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     uuid NOT NULL REFERENCES organization (id),
  deal_id                       uuid NOT NULL,
  spv_id                        uuid NOT NULL,
  draw_request_id               uuid,
  covenant_id                   uuid,  -- covenant is not in this migration
  rule_code                     text NOT NULL,
  reason_text                   text NOT NULL,
  requested_by_subject          text NOT NULL,
  required_approver_roles       text[] NOT NULL CHECK (cardinality(required_approver_roles) > 0),
  approved_by_subject           text,
  approved_at                   timestamptz,
  starts_at                     timestamptz NOT NULL,
  expires_at                    timestamptz NOT NULL,
  max_permitted_exposure_minor  bigint NOT NULL CHECK (max_permitted_exposure_minor >= 0),
  currency                      char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  compensating_controls         text NOT NULL,
  policy_version                text NOT NULL,
  revocation_authority_role     text NOT NULL,
  revoked_at                    timestamptz,
  revoked_by_subject            text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deal (tenant_id, id),
  FOREIGN KEY (tenant_id, spv_id) REFERENCES spv (tenant_id, id),
  FOREIGN KEY (tenant_id, draw_request_id) REFERENCES draw_request (tenant_id, id),
  CHECK (draw_request_id IS NOT NULL OR covenant_id IS NOT NULL),
  CHECK (expires_at > starts_at),
  CHECK ((approved_at IS NULL) = (approved_by_subject IS NULL)),
  CHECK (approved_by_subject IS NULL OR approved_by_subject <> requested_by_subject),
  CHECK ((revoked_at IS NULL) = (revoked_by_subject IS NULL))
);

-- ---------------------------------------------------------------------------
-- settlement_instruction, settlement_confirmation, reconciliation_record
-- ---------------------------------------------------------------------------

-- What DIBS asked the partner to pay. Not a fund movement.
CREATE TABLE settlement_instruction (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                      uuid NOT NULL REFERENCES organization (id),
  draw_request_id                uuid NOT NULL,
  instructed_by_subject          text NOT NULL,
  external_partner_id            text NOT NULL,
  amount_minor                   bigint NOT NULL CHECK (amount_minor > 0),
  currency                       char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payee_bank_account_id          uuid NOT NULL,
  locked_policy_version          text NOT NULL,
  locked_evidence_manifest_hash  text NOT NULL,
  approval_binding_hash          text NOT NULL,
  settlement_reference           text NOT NULL,
  status                         text NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'CONFIRMED', 'REJECTED_BY_PARTNER', 'TIMED_OUT')),
  instructed_at                  timestamptz NOT NULL DEFAULT now(),
  idempotency_key                text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, external_partner_id, settlement_reference),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, draw_request_id) REFERENCES draw_request (tenant_id, id),
  FOREIGN KEY (tenant_id, payee_bank_account_id) REFERENCES payee_bank_account (tenant_id, id)
);

-- Only an APPROVED draw; only TreasuryOwner; instructor ≠ requester ≠ approver;
-- the instruction binds exactly what was approved, to a verified payee.
CREATE FUNCTION settlement_instruction_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d draw_request%ROWTYPE;
  acct payee_bank_account%ROWTYPE;
BEGIN
  SELECT * INTO d FROM draw_request WHERE tenant_id = NEW.tenant_id AND id = NEW.draw_request_id;
  IF d.status NOT IN ('APPROVED', 'SETTLEMENT_FAILED') THEN
    RAISE EXCEPTION 'DRAW_NOT_APPROVED' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.instructed_by_subject = d.requested_by_subject THEN
    RAISE EXCEPTION 'SOD_REQUESTER_CANNOT_INSTRUCT' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM approval_decision a
             WHERE a.tenant_id = NEW.tenant_id AND a.draw_request_id = NEW.draw_request_id
               AND a.approver_subject = NEW.instructed_by_subject) THEN
    RAISE EXCEPTION 'SOD_APPROVER_CANNOT_INSTRUCT' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_role r
                 WHERE r.tenant_id = NEW.tenant_id AND r.user_subject = NEW.instructed_by_subject
                   AND r.role = 'TreasuryOwner' AND NOT r.is_service_account AND r.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_TREASURY_OWNER' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_minor IS DISTINCT FROM d.amount_approved_minor
     OR NEW.currency IS DISTINCT FROM d.currency
     OR NEW.payee_bank_account_id IS DISTINCT FROM d.payee_bank_account_id
     OR NEW.locked_policy_version IS DISTINCT FROM d.locked_policy_version
     OR NEW.locked_evidence_manifest_hash IS DISTINCT FROM d.locked_evidence_manifest_hash
     OR NEW.approval_binding_hash IS DISTINCT FROM d.approval_binding_hash THEN
    RAISE EXCEPTION 'INSTRUCTION_NOT_BOUND_TO_APPROVAL' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO acct FROM payee_bank_account WHERE tenant_id = NEW.tenant_id AND id = NEW.payee_bank_account_id;
  IF acct.verification_status <> 'VERIFIED' OR (acct.cooling_period_ends_at IS NOT NULL AND acct.cooling_period_ends_at > now()) THEN
    RAISE EXCEPTION 'PAYEE_NOT_VERIFIED' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hold h
             WHERE h.tenant_id = NEW.tenant_id AND h.released_at IS NULL
               AND (h.scope_type = 'TENANT'
                    OR (h.scope_type = 'DRAW' AND h.scope_id = d.id)
                    OR (h.scope_type = 'DEAL' AND h.scope_id = d.deal_id)
                    OR (h.scope_type = 'SPV' AND h.scope_id = d.spv_id)
                    OR (h.scope_type = 'COUNTERPARTY' AND h.scope_id = d.payee_counterparty_id))) THEN
    RAISE EXCEPTION 'OPEN_HOLD_PRESENT' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
-- At most one live instruction per draw; a failed one may be re-instructed.
CREATE UNIQUE INDEX settlement_instruction_live_uq ON settlement_instruction (tenant_id, draw_request_id)
  WHERE status IN ('SENT', 'CONFIRMED');

CREATE TRIGGER settlement_instruction_guard BEFORE INSERT ON settlement_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement_instruction_guard();

-- Only status may change after an instruction is written.
CREATE FUNCTION settlement_instruction_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.draw_request_id, NEW.instructed_by_subject, NEW.external_partner_id, NEW.amount_minor, NEW.currency,
      NEW.payee_bank_account_id, NEW.approval_binding_hash, NEW.settlement_reference, NEW.instructed_at)
     IS DISTINCT FROM
     (OLD.draw_request_id, OLD.instructed_by_subject, OLD.external_partner_id, OLD.amount_minor, OLD.currency,
      OLD.payee_bank_account_id, OLD.approval_binding_hash, OLD.settlement_reference, OLD.instructed_at) THEN
    RAISE EXCEPTION 'INSTRUCTION_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_instruction_immutable BEFORE UPDATE ON settlement_instruction
  FOR EACH ROW EXECUTE FUNCTION settlement_instruction_immutable();
CREATE TRIGGER settlement_instruction_no_delete BEFORE DELETE ON settlement_instruction
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- What the partner says happened. Signed webhook, or dual-entry CSV (two different people).
CREATE TABLE settlement_confirmation (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES organization (id),
  settlement_instruction_id  uuid,  -- null when the partner reports a settlement DIBS never instructed
  source                     text NOT NULL CHECK (source IN ('CSV', 'WEBHOOK')),
  external_partner_id        text NOT NULL,
  settlement_reference       text NOT NULL,
  confirmed_amount_minor     bigint NOT NULL CHECK (confirmed_amount_minor > 0),
  currency                   char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payee_account_ref          text NOT NULL,
  settlement_date            date NOT NULL,
  raw_payload_hash           text NOT NULL CHECK (raw_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  signature_verified         boolean NOT NULL DEFAULT false,
  entered_by_subject         text,
  second_entry_by_subject    text,
  received_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, external_partner_id, settlement_reference, raw_payload_hash),
  FOREIGN KEY (tenant_id, settlement_instruction_id) REFERENCES settlement_instruction (tenant_id, id),
  CHECK (source <> 'WEBHOOK' OR signature_verified),
  CHECK (source <> 'CSV' OR (entered_by_subject IS NOT NULL AND second_entry_by_subject IS NOT NULL
                             AND entered_by_subject <> second_entry_by_subject))
);
CREATE TRIGGER settlement_confirmation_append_only BEFORE UPDATE OR DELETE ON settlement_confirmation
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Match or break. Mismatches are exceptions; nothing is auto-reconciled.
CREATE TABLE reconciliation_record (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES organization (id),
  draw_request_id             uuid,
  settlement_instruction_id   uuid,
  settlement_confirmation_id  uuid,
  status                      text NOT NULL CHECK (status IN ('PENDING', 'MATCHED', 'EXCEPTION')),
  mismatch_codes              text[] NOT NULL DEFAULT '{}' CHECK (mismatch_codes <@ ARRAY[
                                'AMOUNT', 'CURRENCY', 'PAYEE', 'DATE', 'DUPLICATE_REFERENCE',
                                'MISSING_CONFIRMATION', 'UNAPPROVED_SETTLEMENT']::text[]),
  reconciled_by_subject       text NOT NULL,
  reconciled_at               timestamptz NOT NULL DEFAULT now(),
  note                        text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, draw_request_id) REFERENCES draw_request (tenant_id, id),
  FOREIGN KEY (tenant_id, settlement_instruction_id) REFERENCES settlement_instruction (tenant_id, id),
  FOREIGN KEY (tenant_id, settlement_confirmation_id) REFERENCES settlement_confirmation (tenant_id, id),
  CHECK (status <> 'MATCHED' OR (cardinality(mismatch_codes) = 0 AND draw_request_id IS NOT NULL
                                 AND settlement_instruction_id IS NOT NULL AND settlement_confirmation_id IS NOT NULL)),
  CHECK (status <> 'EXCEPTION' OR cardinality(mismatch_codes) > 0)
);

-- MATCHED only on an exact match of amount, currency, payee, partner and reference.
CREATE FUNCTION reconciliation_record_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  i settlement_instruction%ROWTYPE;
  c settlement_confirmation%ROWTYPE;
  acct payee_bank_account%ROWTYPE;
BEGIN
  IF NEW.status <> 'MATCHED' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO i FROM settlement_instruction WHERE tenant_id = NEW.tenant_id AND id = NEW.settlement_instruction_id;
  SELECT * INTO c FROM settlement_confirmation WHERE tenant_id = NEW.tenant_id AND id = NEW.settlement_confirmation_id;
  SELECT * INTO acct FROM payee_bank_account WHERE tenant_id = NEW.tenant_id AND id = i.payee_bank_account_id;
  IF i.draw_request_id IS DISTINCT FROM NEW.draw_request_id
     OR c.settlement_instruction_id IS DISTINCT FROM i.id
     OR c.confirmed_amount_minor IS DISTINCT FROM i.amount_minor
     OR c.currency IS DISTINCT FROM i.currency
     OR c.payee_account_ref IS DISTINCT FROM acct.account_ref
     OR c.external_partner_id IS DISTINCT FROM i.external_partner_id
     OR c.settlement_reference IS DISTINCT FROM i.settlement_reference THEN
    RAISE EXCEPTION 'RECONCILIATION_NOT_EXACT_MATCH' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reconciliation_record_guard BEFORE INSERT ON reconciliation_record
  FOR EACH ROW EXECUTE FUNCTION reconciliation_record_guard();
CREATE TRIGGER reconciliation_record_append_only BEFORE UPDATE OR DELETE ON reconciliation_record
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE TRIGGER organization_updated_at BEFORE UPDATE ON organization FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER spv_updated_at BEFORE UPDATE ON spv FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deal_updated_at BEFORE UPDATE ON deal FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER counterparty_updated_at BEFORE UPDATE ON counterparty FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payee_bank_account_updated_at BEFORE UPDATE ON payee_bank_account FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER draw_request_updated_at BEFORE UPDATE ON draw_request FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: tenant from session (app.tenant_id), fail closed
-- ---------------------------------------------------------------------------

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_role', 'spv', 'deal', 'counterparty', 'payee_bank_account', 'draw_request',
    'evidence_document', 'evidence_manifest', 'policy_evaluation', 'approval_decision', 'hold',
    'exception_waiver', 'settlement_instruction', 'settlement_confirmation', 'reconciliation_record'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

COMMIT;
