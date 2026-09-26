-- Dual-entry CSV over HTTP: the first person stages the file, a different
-- person submits their own copy, and the import runs only if both agree.
-- The staged first entry is append-only; completion is the CSV_BATCH_IMPORTED
-- audit event keyed by batch_key.

BEGIN;

CREATE TABLE csv_import_batch (
  tenant_id            uuid NOT NULL REFERENCES organization (id),
  batch_key            text NOT NULL CHECK (length(batch_key) > 0),
  first_entry_csv      text NOT NULL,
  first_entry_hash     text NOT NULL CHECK (first_entry_hash ~ '^sha256:[0-9a-f]{64}$'),
  first_entry_subject  text NOT NULL,
  staged_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, batch_key)
);
CREATE TRIGGER csv_import_batch_append_only BEFORE UPDATE OR DELETE ON csv_import_batch
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE csv_import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE csv_import_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON csv_import_batch USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT ON csv_import_batch TO dibs_app;

COMMIT;
