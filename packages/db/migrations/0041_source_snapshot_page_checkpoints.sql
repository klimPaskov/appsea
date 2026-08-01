-- Page checkpoints make bounded snapshot retries idempotent without staging raw
-- provider records. A completed page is immutable; only its identifier set is
-- stored in source_snapshot_reconciliation_items.
ALTER TABLE appsea.source_snapshot_reconciliation_jobs
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE INDEX source_snapshot_reconciliation_due_idx
  ON appsea.source_snapshot_reconciliation_jobs
    (workspace_id, source_id, next_attempt_at, reconciliation_id)
  WHERE state IN ('queued', 'running');

CREATE TABLE appsea.source_snapshot_reconciliation_pages (
  workspace_id text NOT NULL,
  reconciliation_id text NOT NULL,
  page_offset integer NOT NULL CHECK (page_offset BETWEEN 0 AND 1000),
  page_size integer NOT NULL CHECK (page_size BETWEEN 1 AND 1000),
  source_record_count integer NOT NULL CHECK (source_record_count BETWEEN 0 AND 1000),
  page_hash char(64) NOT NULL CHECK (page_hash ~ '^[a-f0-9]{64}$'),
  short_page boolean NOT NULL,
  warnings text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(warnings) <= 50 AND array_position(warnings, NULL) IS NULL),
  observed_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, reconciliation_id, page_offset),
  FOREIGN KEY (workspace_id, reconciliation_id)
    REFERENCES appsea.source_snapshot_reconciliation_jobs(workspace_id, reconciliation_id)
    ON DELETE CASCADE,
  CHECK ((short_page) = (source_record_count < page_size)),
  CHECK (completed_at >= observed_at)
);

CREATE INDEX source_snapshot_reconciliation_pages_lookup_idx
  ON appsea.source_snapshot_reconciliation_pages
    (workspace_id, reconciliation_id, page_offset);

ALTER TABLE appsea.source_snapshot_reconciliation_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.source_snapshot_reconciliation_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.source_snapshot_reconciliation_pages
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

GRANT UPDATE (next_attempt_at)
  ON appsea.source_snapshot_reconciliation_jobs TO appsea_service;
REVOKE ALL ON appsea.source_snapshot_reconciliation_pages FROM PUBLIC, appsea_service;
GRANT SELECT, INSERT ON appsea.source_snapshot_reconciliation_pages TO appsea_service;
