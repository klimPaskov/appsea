-- Durable, bounded full-snapshot reconciliation for sources that do not expose
-- deletion tombstones. Only identifier sets cross this boundary; raw provider
-- records are never staged or persisted.
CREATE TABLE appsea.source_snapshot_reconciliation_jobs (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  reconciliation_id text NOT NULL CHECK (
    reconciliation_id ~ '^reconciliation:source:[a-f0-9]{32}$'
  ),
  source_id text NOT NULL,
  policy_version text NOT NULL,
  idempotency_key char(64) NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  page_size integer NOT NULL CHECK (page_size BETWEEN 1 AND 1000),
  max_records integer NOT NULL CHECK (max_records BETWEEN 1 AND 1000),
  requested_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'incomplete', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  claim_token_hash char(64) CHECK (claim_token_hash IS NULL OR claim_token_hash ~ '^[a-f0-9]{64}$'),
  claim_expires_at timestamptz,
  observed_at timestamptz,
  next_offset integer NOT NULL DEFAULT 0 CHECK (next_offset BETWEEN 0 AND 1000),
  pages_scanned integer NOT NULL DEFAULT 0 CHECK (pages_scanned BETWEEN 0 AND 1000),
  source_record_count integer NOT NULL DEFAULT 0 CHECK (source_record_count BETWEEN 0 AND 1000),
  deletion_count integer NOT NULL DEFAULT 0 CHECK (deletion_count BETWEEN 0 AND 1000000),
  coverage_gaps text[] NOT NULL DEFAULT '{}',
  warnings text[] NOT NULL DEFAULT '{}',
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'policy_denied', 'source_request_failed', 'snapshot_incomplete',
      'reconciliation_failed'
    )
  ),
  failure_summary text CHECK (failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 240),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, reconciliation_id),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (source_id, policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version)
    ON DELETE RESTRICT,
  CHECK (max_records >= page_size),
  CHECK ((failure_code IS NULL) = (failure_summary IS NULL)),
  CHECK ((state IN ('completed', 'incomplete', 'failed')) = (finished_at IS NOT NULL)),
  CHECK ((state = 'running') = (
    claim_token_hash IS NOT NULL AND claim_expires_at IS NOT NULL AND observed_at IS NOT NULL
  )),
  CHECK (state IN ('queued', 'running') OR claim_token_hash IS NULL),
  CHECK (state IN ('queued', 'running') OR claim_expires_at IS NULL),
  CHECK (state = 'queued' OR observed_at IS NOT NULL),
  CHECK (state <> 'incomplete' OR failure_code = 'snapshot_incomplete'),
  CHECK (state <> 'completed' OR failure_code IS NULL),
  CHECK (updated_at >= requested_at)
);

CREATE TABLE appsea.source_snapshot_reconciliation_items (
  workspace_id text NOT NULL,
  reconciliation_id text NOT NULL,
  source_record_id text NOT NULL CHECK (char_length(source_record_id) BETWEEN 1 AND 240),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, reconciliation_id, source_record_id),
  FOREIGN KEY (workspace_id, reconciliation_id)
    REFERENCES appsea.source_snapshot_reconciliation_jobs(workspace_id, reconciliation_id)
    ON DELETE CASCADE
);

CREATE INDEX source_snapshot_reconciliation_dispatch_idx
  ON appsea.source_snapshot_reconciliation_jobs (workspace_id, state, updated_at);
CREATE INDEX source_snapshot_reconciliation_source_idx
  ON appsea.source_snapshot_reconciliation_jobs (workspace_id, source_id, requested_at DESC);
CREATE INDEX source_snapshot_reconciliation_item_lookup_idx
  ON appsea.source_snapshot_reconciliation_items (workspace_id, reconciliation_id, source_record_id);

CREATE OR REPLACE FUNCTION appsea.enforce_source_snapshot_reconciliation_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.sources source
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = source.source_id
       AND policy.policy_version = NEW.policy_version
      JOIN appsea.source_policy_reviews review
        ON review.source_id = policy.source_id
       AND review.policy_version = policy.policy_version
       AND review.decision = 'approved'
       AND review.content_hash = policy.content_hash
     WHERE source.source_id = NEW.source_id
       AND source.source_type <> 'fixture'
       AND source.lifecycle_state = 'active'
       AND source.current_policy_version = NEW.policy_version
       AND policy.policy_state = 'approved'
       AND policy.deletion_required
       AND policy.reviewed_at IS NOT NULL
       AND policy.commercial_use IN ('allowed', 'restricted')
       AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'source snapshot reconciliation requires an active approved deletion policy'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION appsea.guard_source_snapshot_reconciliation_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.page_size IS DISTINCT FROM OLD.page_size
     OR NEW.max_records IS DISTINCT FROM OLD.max_records
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'source snapshot reconciliation identity is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.state = 'queued' AND NEW.state NOT IN ('queued', 'running') THEN
    RAISE EXCEPTION 'queued snapshot reconciliation may only begin running'
      USING ERRCODE = '42501';
  ELSIF OLD.state = 'running' AND NEW.state NOT IN ('running', 'queued', 'completed', 'incomplete', 'failed') THEN
    RAISE EXCEPTION 'running snapshot reconciliation has an invalid transition'
      USING ERRCODE = '42501';
  ELSIF OLD.state IN ('completed', 'incomplete', 'failed') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'terminal snapshot reconciliation state is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.next_offset < OLD.next_offset
     OR NEW.pages_scanned < OLD.pages_scanned
     OR NEW.source_record_count < OLD.source_record_count
     OR NEW.deletion_count < OLD.deletion_count THEN
    RAISE EXCEPTION 'snapshot reconciliation counters cannot decrease'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_snapshot_reconciliation_policy_gate
  ON appsea.source_snapshot_reconciliation_jobs;
CREATE TRIGGER source_snapshot_reconciliation_policy_gate
BEFORE INSERT ON appsea.source_snapshot_reconciliation_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_snapshot_reconciliation_policy();

DROP TRIGGER IF EXISTS source_snapshot_reconciliation_transition_guard
  ON appsea.source_snapshot_reconciliation_jobs;
CREATE TRIGGER source_snapshot_reconciliation_transition_guard
BEFORE UPDATE ON appsea.source_snapshot_reconciliation_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.guard_source_snapshot_reconciliation_transition();

ALTER TABLE appsea.source_snapshot_reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.source_snapshot_reconciliation_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.source_snapshot_reconciliation_jobs
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.source_snapshot_reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.source_snapshot_reconciliation_items FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.source_snapshot_reconciliation_items
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.source_snapshot_reconciliation_jobs FROM PUBLIC, appsea_service;
GRANT SELECT, INSERT ON appsea.source_snapshot_reconciliation_jobs TO appsea_service;
GRANT UPDATE (
  state, attempt_count, claim_token_hash, claim_expires_at, observed_at,
  next_offset, pages_scanned, source_record_count, deletion_count,
  coverage_gaps, warnings, failure_code, failure_summary, finished_at, updated_at
) ON appsea.source_snapshot_reconciliation_jobs TO appsea_service;
REVOKE ALL ON appsea.source_snapshot_reconciliation_items FROM PUBLIC, appsea_service;
GRANT SELECT, INSERT ON appsea.source_snapshot_reconciliation_items TO appsea_service;
GRANT DELETE ON appsea.source_snapshot_reconciliation_items TO appsea_service;

REVOKE ALL ON FUNCTION appsea.enforce_source_snapshot_reconciliation_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_source_snapshot_reconciliation_transition() FROM PUBLIC;
