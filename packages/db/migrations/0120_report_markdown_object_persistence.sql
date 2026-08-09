-- Persist the deterministic Markdown representation alongside the structured
-- report.  The full ObjectReference is retained so retention, source
-- deletion, and workspace purge paths can act on the exact content-addressed
-- object without reconstructing provider metadata from an opaque URI.

ALTER TABLE appsea.report_versions
  ADD COLUMN markdown_object_reference jsonb;

ALTER TABLE appsea.report_versions
  ADD CONSTRAINT report_markdown_object_reference_check CHECK (
    markdown_object_reference IS NULL
    OR (
      jsonb_typeof(markdown_object_reference) = 'object'
      AND markdown_object_reference->>'version' = '1'
      AND markdown_object_reference->>'workspaceId' = workspace_id
      AND markdown_object_reference->>'kind' = 'report-markdown'
      AND markdown_object_reference->>'uri' ~ '^appsea-object://[a-z][a-z0-9_:-]*/report-markdown/[a-f0-9]{64}$'
      AND (
        markdown_object_ref IS NULL
        OR markdown_object_ref = markdown_object_reference->>'uri'
      )
    )
  );

ALTER TABLE appsea.production_analysis_runs
  ADD COLUMN report_markdown_object_ref jsonb;

ALTER TABLE appsea.production_analysis_runs
  ADD CONSTRAINT production_analysis_runs_report_markdown_object_ref_check CHECK (
    report_markdown_object_ref IS NULL
    OR (
      jsonb_typeof(report_markdown_object_ref) = 'object'
      AND report_markdown_object_ref->>'version' = '1'
      AND report_markdown_object_ref->>'workspaceId' = workspace_id
      AND report_markdown_object_ref->>'kind' = 'report-markdown'
      AND report_markdown_object_ref->>'uri' ~ '^appsea-object://[a-z][a-z0-9_:-]*/report-markdown/[a-f0-9]{64}$'
    )
  );

-- The existing purge queue is intentionally shared by all content-addressed
-- analysis outputs.  Extend its allowlist and enqueue function in a forward
-- migration so applied migration history remains immutable.
ALTER TABLE appsea.production_analysis_object_purge_jobs
  DROP CONSTRAINT IF EXISTS production_analysis_object_purge_jobs_object_uri_check,
  DROP CONSTRAINT IF EXISTS production_analysis_object_purge_jobs_object_kind_check;

ALTER TABLE appsea.production_analysis_object_purge_jobs
  ADD CONSTRAINT production_analysis_object_purge_jobs_object_uri_check CHECK (
    object_uri ~ '^appsea-object://[a-z][a-z0-9_:-]*/(?:report-json|report-markdown|plan-package|workflow-artifact)/[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT production_analysis_object_purge_jobs_object_kind_check CHECK (
    object_kind IN ('report-json', 'report-markdown', 'plan-package', 'workflow-artifact')
  );

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
        jsonb_build_array(
          NEW.artifact_object_ref,
          NEW.report_object_ref,
          NEW.report_markdown_object_ref,
          NEW.plan_object_ref
        )
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

-- Source-deletion propagation clears both the legacy URI and the durable
-- metadata projection.  The invalidation trigger above has already captured
-- the complete reference in the purge queue before this update runs.
CREATE OR REPLACE FUNCTION appsea.guard_report_deletion_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.deletion_state = 'active'
     AND NEW.deletion_state = 'active'
     AND (
       NEW.structured_report IS DISTINCT FROM OLD.structured_report
       OR NEW.markdown_object_ref IS DISTINCT FROM OLD.markdown_object_ref
       OR NEW.markdown_object_reference IS DISTINCT FROM OLD.markdown_object_reference
     ) THEN
    RAISE EXCEPTION 'active report payloads are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.deletion_state <> 'active' AND NEW.deletion_state = 'active' THEN
    RAISE EXCEPTION 'report deletion state cannot be restored' USING ERRCODE = '42501';
  END IF;
  IF OLD.deletion_tombstone_id IS NOT NULL
     AND NEW.deletion_tombstone_id IS DISTINCT FROM OLD.deletion_tombstone_id THEN
    RAISE EXCEPTION 'report deletion tombstone is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.deletion_state <> 'active'
     AND (
       NEW.structured_report -> '_deletion' IS NULL
       OR NEW.markdown_object_ref IS NOT NULL
       OR NEW.markdown_object_reference IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'non-active reports must not retain report content' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS report_versions_deletion_guard ON appsea.report_versions;
CREATE TRIGGER report_versions_deletion_guard
BEFORE UPDATE OF structured_report, markdown_object_ref, markdown_object_reference,
  deletion_state, deletion_tombstone_id ON appsea.report_versions FOR EACH ROW
EXECUTE FUNCTION appsea.guard_report_deletion_state();

GRANT UPDATE (report_markdown_object_ref)
  ON appsea.production_analysis_runs TO appsea_service;
GRANT UPDATE (markdown_object_ref, markdown_object_reference)
  ON appsea.report_versions TO appsea_service;

COMMENT ON COLUMN appsea.report_versions.markdown_object_reference IS
  'Complete content-addressed report-markdown reference retained for deletion and purge workflows.';
COMMENT ON COLUMN appsea.production_analysis_runs.report_markdown_object_ref IS
  'Complete report-markdown reference included in the invalidated-output purge set.';
