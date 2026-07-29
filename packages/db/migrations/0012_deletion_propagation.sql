-- Deletion propagation keeps provenance rows and makes their content unavailable.
-- Tombstones remain the durable source of deletion identity and audit context.

ALTER TABLE appsea.source_items
  ADD COLUMN deletion_tombstone_id text;

ALTER TABLE appsea.evidence_records
  ADD COLUMN deletion_tombstone_id text;

ALTER TABLE appsea.report_versions
  ADD COLUMN deletion_state text NOT NULL DEFAULT 'active' CHECK (
    deletion_state IN ('active', 'source_deleted', 'workspace_deleted', 'expired', 'redacted', 'pending')
  );

ALTER TABLE appsea.report_versions
  ADD COLUMN deletion_tombstone_id text;

ALTER TABLE appsea.plan_package_versions
  ADD COLUMN deletion_state text NOT NULL DEFAULT 'active' CHECK (
    deletion_state IN ('active', 'source_deleted', 'workspace_deleted', 'expired', 'redacted', 'pending')
  );

ALTER TABLE appsea.plan_package_versions
  ADD COLUMN deletion_tombstone_id text;

ALTER TABLE appsea.deletion_tombstones
  ADD COLUMN processing_started_at timestamptz;

ALTER TABLE appsea.deletion_tombstones
  ADD COLUMN failure_code text;

ALTER TABLE appsea.deletion_tombstones
  ADD COLUMN failure_summary text;

ALTER TABLE appsea.source_items
  ADD CONSTRAINT source_items_deletion_tombstone_fk
  FOREIGN KEY (workspace_id, deletion_tombstone_id)
  REFERENCES appsea.deletion_tombstones(workspace_id, tombstone_id)
  ON DELETE RESTRICT;

ALTER TABLE appsea.evidence_records
  ADD CONSTRAINT evidence_records_deletion_tombstone_fk
  FOREIGN KEY (workspace_id, deletion_tombstone_id)
  REFERENCES appsea.deletion_tombstones(workspace_id, tombstone_id)
  ON DELETE RESTRICT;

ALTER TABLE appsea.report_versions
  ADD CONSTRAINT report_versions_deletion_tombstone_fk
  FOREIGN KEY (workspace_id, deletion_tombstone_id)
  REFERENCES appsea.deletion_tombstones(workspace_id, tombstone_id)
  ON DELETE RESTRICT;

ALTER TABLE appsea.plan_package_versions
  ADD CONSTRAINT plan_package_versions_deletion_tombstone_fk
  FOREIGN KEY (workspace_id, deletion_tombstone_id)
  REFERENCES appsea.deletion_tombstones(workspace_id, tombstone_id)
  ON DELETE RESTRICT;

ALTER TABLE appsea.deletion_tombstones
  ADD CONSTRAINT deletion_tombstone_failure_code_check CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_:-]{2,79}$'
  );

ALTER TABLE appsea.deletion_tombstones
  ADD CONSTRAINT deletion_tombstone_failure_summary_check CHECK (
    failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 500
  );

CREATE INDEX source_items_deletion_tombstone_idx
  ON appsea.source_items (workspace_id, deletion_tombstone_id)
  WHERE deletion_tombstone_id IS NOT NULL;

CREATE INDEX evidence_records_deletion_tombstone_idx
  ON appsea.evidence_records (workspace_id, deletion_tombstone_id)
  WHERE deletion_tombstone_id IS NOT NULL;

CREATE INDEX report_versions_deletion_tombstone_idx
  ON appsea.report_versions (workspace_id, deletion_tombstone_id)
  WHERE deletion_tombstone_id IS NOT NULL;

CREATE INDEX plan_package_versions_deletion_tombstone_idx
  ON appsea.plan_package_versions (workspace_id, deletion_tombstone_id)
  WHERE deletion_tombstone_id IS NOT NULL;

GRANT UPDATE (raw_object_ref, deletion_state, deletion_tombstone_id)
  ON appsea.source_items TO appsea_service;
GRANT UPDATE (normalized_text, redacted, deletion_state, deletion_tombstone_id)
  ON appsea.evidence_records TO appsea_service;
GRANT UPDATE (deletion_state, deletion_tombstone_id)
  ON appsea.report_versions, appsea.plan_package_versions
TO appsea_service;

GRANT UPDATE (
  state, processing_started_at, completed_at, affected_object_count,
  failure_code, failure_summary
)
  ON appsea.deletion_tombstones
TO appsea_service;
