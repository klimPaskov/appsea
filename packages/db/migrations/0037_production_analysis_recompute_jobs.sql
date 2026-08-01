-- Durable read-state for deletion-triggered analysis repair. Temporal owns the
-- workflow history; this table records the tenant-scoped, idempotent dispatch
-- request and keeps a blocked seed or exhausted retry visible to operators.
CREATE TABLE appsea.production_analysis_recompute_jobs (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  recompute_id text NOT NULL CHECK (
    recompute_id ~ '^recompute:analysis:[a-f0-9]{32}$'
  ),
  opportunity_id text NOT NULL,
  collection_run_id text NOT NULL,
  seed_review_id text NOT NULL,
  source_tombstone_id text NOT NULL,
  analysis_run_id text NOT NULL CHECK (
    analysis_run_id ~ '^analysis-run:[a-f0-9]{32}$'
  ),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  requested_at timestamptz NOT NULL,
  state text NOT NULL CHECK (
    state IN ('queued', 'dispatching', 'started', 'blocked', 'satisfied', 'failed')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  workflow_id text CHECK (
    workflow_id IS NULL OR workflow_id ~ '^workflow:analysis:[a-z][a-z0-9_:-]*:[a-f0-9]{32}$'
  ),
  failure_code text CHECK (
    failure_code IS NULL
    OR failure_code IN (
      'analysis_not_ready', 'seed_not_approved', 'recompute_dispatch_failed',
      'analysis_already_repaired'
    )
  ),
  failure_summary text CHECK (
    failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 240
  ),
  next_attempt_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, recompute_id),
  UNIQUE (workspace_id, opportunity_id, source_tombstone_id),
  UNIQUE (workspace_id, analysis_run_id),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, collection_run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, seed_review_id)
    REFERENCES appsea.opportunity_seed_reviews(workspace_id, seed_review_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_tombstone_id)
    REFERENCES appsea.deletion_tombstones(workspace_id, tombstone_id)
    ON DELETE RESTRICT,
  CHECK ((failure_code IS NULL) = (failure_summary IS NULL)),
  CHECK ((state IN ('blocked', 'satisfied', 'failed')) = (finished_at IS NOT NULL)),
  CHECK ((state = 'started') = (workflow_id IS NOT NULL AND started_at IS NOT NULL)),
  CHECK (state <> 'failed' OR workflow_id IS NULL),
  CHECK (finished_at IS NULL OR finished_at >= requested_at),
  CHECK (updated_at >= requested_at)
);

CREATE INDEX production_analysis_recompute_dispatch_idx
  ON appsea.production_analysis_recompute_jobs (workspace_id, state, next_attempt_at, updated_at);

CREATE INDEX production_analysis_recompute_opportunity_idx
  ON appsea.production_analysis_recompute_jobs (workspace_id, opportunity_id, requested_at DESC);

CREATE OR REPLACE FUNCTION appsea.enforce_production_analysis_recompute_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.opportunities opportunity
     WHERE opportunity.workspace_id = NEW.workspace_id
       AND opportunity.opportunity_id = NEW.opportunity_id
       AND opportunity.availability_state = 'invalidated'
  ) THEN
    RAISE EXCEPTION 'production analysis recomputation requires an invalidated opportunity'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.opportunity_seed_reviews seed
     WHERE seed.workspace_id = NEW.workspace_id
       AND seed.seed_review_id = NEW.seed_review_id
       AND seed.seed_payload ->> 'id' = NEW.opportunity_id
  ) THEN
    RAISE EXCEPTION 'production analysis recomputation seed does not match its opportunity'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS production_analysis_recompute_lineage_guard
  ON appsea.production_analysis_recompute_jobs;
CREATE TRIGGER production_analysis_recompute_lineage_guard
BEFORE INSERT OR UPDATE OF opportunity_id, seed_review_id
ON appsea.production_analysis_recompute_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_analysis_recompute_lineage();

ALTER TABLE appsea.production_analysis_recompute_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_analysis_recompute_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_analysis_recompute_jobs
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.production_analysis_recompute_jobs FROM appsea_service;
GRANT SELECT, INSERT ON appsea.production_analysis_recompute_jobs TO appsea_service;
GRANT UPDATE (
  state, attempt_count, workflow_id, failure_code, failure_summary,
  next_attempt_at, started_at, finished_at, updated_at
) ON appsea.production_analysis_recompute_jobs TO appsea_service;

REVOKE ALL ON FUNCTION appsea.enforce_production_analysis_recompute_lineage() FROM PUBLIC;
