-- Durable, tenant-scoped purge work for content-addressed production-analysis
-- objects.  Source deletion invalidates an analysis in the same transaction;
-- this queue records the full immutable object reference before an external
-- store is touched so a worker can mark and purge it safely after a crash.
CREATE TABLE appsea.production_analysis_object_purge_jobs (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  purge_id text NOT NULL CHECK (
    purge_id ~ '^object-purge:[a-f0-9]{32}$'
  ),
  analysis_run_id text NOT NULL,
  object_uri text NOT NULL CHECK (
    object_uri ~ '^appsea-object://[a-z][a-z0-9_:-]*/(?:report-json|plan-package|workflow-artifact)/[a-f0-9]{64}$'
  ),
  object_kind text NOT NULL CHECK (
    object_kind IN ('report-json', 'plan-package', 'workflow-artifact')
  ),
  object_ref jsonb NOT NULL,
  "authorization" text NOT NULL CHECK ("authorization" = 'retention-expired'),
  requested_at timestamptz NOT NULL,
  eligible_at timestamptz NOT NULL,
  state text NOT NULL CHECK (
    state IN ('pending', 'processing', 'marked', 'completed', 'failed')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  processing_started_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  failure_code text CHECK (
    failure_code IS NULL OR failure_code = 'object_store_purge_failed'
  ),
  failure_summary text CHECK (
    failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 240
  ),
  PRIMARY KEY (workspace_id, purge_id),
  UNIQUE (workspace_id, object_uri),
  FOREIGN KEY (workspace_id, analysis_run_id)
    REFERENCES appsea.production_analysis_runs(workspace_id, analysis_run_id)
    ON DELETE RESTRICT,
  CHECK (
    jsonb_typeof(object_ref) = 'object'
    AND object_ref->>'version' = '1'
    AND object_ref->>'workspaceId' = workspace_id
    AND object_ref->>'uri' = object_uri
    AND object_ref->>'kind' = object_kind
    AND object_ref->>'deletionState' = 'active'
  ),
  CHECK (eligible_at >= requested_at),
  CHECK (next_attempt_at >= requested_at),
  CHECK ((state = 'processing') = (processing_started_at IS NOT NULL)),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL)),
  CHECK ((failure_code IS NULL) = (failure_summary IS NULL))
);

CREATE INDEX production_analysis_object_purge_due_idx
  ON appsea.production_analysis_object_purge_jobs
    (workspace_id, state, next_attempt_at, requested_at, purge_id);

-- Queue all three analysis outputs before the source-deletion transaction
-- commits.  The full object reference is retained in PostgreSQL because the
-- report and plan projections historically store only opaque URIs.
CREATE OR REPLACE FUNCTION appsea.enqueue_invalidated_production_analysis_objects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  source_object_ref jsonb;
  source_object_uri text;
  source_object_kind text;
  source_retention_until timestamptz;
  observed_at timestamptz := clock_timestamp();
BEGIN
  IF NEW.availability_state <> 'invalidated'
     OR (TG_OP = 'UPDATE' AND OLD.availability_state = 'invalidated') THEN
    RETURN NEW;
  END IF;

  FOR source_object_ref IN
    SELECT value
      FROM jsonb_array_elements(
        jsonb_build_array(NEW.artifact_object_ref, NEW.report_object_ref, NEW.plan_object_ref)
      )
     WHERE value IS NOT NULL
  LOOP
    source_object_uri := source_object_ref->>'uri';
    source_object_kind := source_object_ref->>'kind';
    IF source_object_uri IS NULL OR source_object_kind IS NULL THEN
      CONTINUE;
    END IF;
    source_retention_until := NULLIF(source_object_ref->>'retentionUntil', '')::timestamptz;
    INSERT INTO appsea.production_analysis_object_purge_jobs
      (workspace_id, purge_id, analysis_run_id, object_uri, object_kind, object_ref,
       "authorization", requested_at, eligible_at, state, next_attempt_at)
    VALUES
      (NEW.workspace_id,
       'object-purge:' || md5(NEW.workspace_id || ':' || source_object_uri),
       NEW.analysis_run_id,
       source_object_uri,
       source_object_kind,
       source_object_ref,
       'retention-expired',
       observed_at,
       GREATEST(observed_at, COALESCE(source_retention_until, observed_at)),
       'pending',
       GREATEST(observed_at, COALESCE(source_retention_until, observed_at)))
    ON CONFLICT (workspace_id, object_uri) DO NOTHING;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_object_purge_enqueue
AFTER INSERT OR UPDATE OF availability_state
ON appsea.production_analysis_runs
FOR EACH ROW EXECUTE FUNCTION appsea.enqueue_invalidated_production_analysis_objects();

ALTER TABLE appsea.production_analysis_object_purge_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_analysis_object_purge_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_analysis_object_purge_jobs
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.production_analysis_object_purge_jobs FROM PUBLIC, appsea_service;
GRANT SELECT ON appsea.production_analysis_object_purge_jobs TO appsea_service;
GRANT UPDATE (
  state, attempt_count, processing_started_at, completed_at, next_attempt_at,
  failure_code, failure_summary
) ON appsea.production_analysis_object_purge_jobs TO appsea_service;

REVOKE ALL ON FUNCTION appsea.enqueue_invalidated_production_analysis_objects() FROM PUBLIC;
