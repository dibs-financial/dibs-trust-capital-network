-- DIBS Capital Autopilot — append-only audit ledger with a per-tenant hash chain.
--
-- Every financial or control-relevant change writes one audit_event row, in the
-- same transaction and before the row it describes changes. Rows are never
-- updated, deleted or truncated. Corrections are new events.
--
-- Chain: within a tenant, event N stores event N−1's hash in previous_event_hash
-- (64 zeros for the first). audit_chain_head serializes appends per tenant.
-- event_hash is computed by the application over the canonical envelope
-- (backend/audit/event-store.ts hashEventEnvelope) and re-verified on read.

BEGIN;

CREATE TABLE audit_chain_head (
  tenant_id        uuid PRIMARY KEY REFERENCES organization (id),
  last_seq         bigint NOT NULL CHECK (last_seq >= 0),
  last_event_hash  text NOT NULL CHECK (last_event_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE audit_event (
  tenant_id               uuid NOT NULL REFERENCES organization (id),
  chain_seq               bigint NOT NULL CHECK (chain_seq >= 1),
  event_id                uuid NOT NULL UNIQUE,
  event_type              text NOT NULL,
  event_version           integer NOT NULL CHECK (event_version >= 1),
  occurred_at             timestamptz NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now(),
  actor_type              text NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM', 'PARTNER', 'SUPER_AGENT')),
  actor_id                text NOT NULL,
  actor_role              text NOT NULL,
  aggregate_type          text NOT NULL,
  aggregate_id            text NOT NULL,
  state_before            text,
  state_after             text,
  policy_version          text NOT NULL,
  evidence_manifest_hash  text NOT NULL,
  payload                 jsonb NOT NULL,
  payload_hash            text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  previous_event_hash     text NOT NULL CHECK (previous_event_hash ~ '^[0-9a-f]{64}$'),
  event_hash              text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key         text NOT NULL,
  correlation_id          text NOT NULL,
  PRIMARY KEY (tenant_id, chain_seq),
  -- No forks: each hash is followed at most once within a tenant.
  UNIQUE (tenant_id, previous_event_hash),
  UNIQUE (tenant_id, event_hash)
);
CREATE UNIQUE INDEX audit_event_idempotency_uq ON audit_event (tenant_id, idempotency_key, event_type)
  WHERE idempotency_key <> '';
CREATE INDEX audit_event_aggregate_idx ON audit_event (tenant_id, aggregate_type, aggregate_id, chain_seq);

CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: TRUNCATE on % is not allowed', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

-- The head only moves forward, one step at a time.
CREATE FUNCTION audit_chain_head_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.last_seq <> OLD.last_seq + 1 THEN
    RAISE EXCEPTION 'AUDIT_CHAIN_HEAD_MUST_ADVANCE_BY_ONE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain_head_guard BEFORE UPDATE ON audit_chain_head
  FOR EACH ROW EXECUTE FUNCTION audit_chain_head_guard();
CREATE TRIGGER audit_chain_head_no_delete BEFORE DELETE ON audit_chain_head
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE audit_chain_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain_head FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_chain_head USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_event USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

COMMIT;
