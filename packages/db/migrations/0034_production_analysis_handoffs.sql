-- A collection may request analysis only through an explicitly identified,
-- owner-approved seed review. The seed ID is part of the immutable workflow
-- input and is never replaced by model-generated opportunity claims.
ALTER TABLE appsea.production_collection_workflow_jobs
  ADD COLUMN analysis_seed_review_id text;

ALTER TABLE appsea.production_collection_workflow_jobs
  ADD CONSTRAINT production_collection_workflow_seed_review_id_check
  CHECK (
    analysis_seed_review_id IS NULL
    OR analysis_seed_review_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  );

ALTER TABLE appsea.production_collection_workflow_jobs
  ADD CONSTRAINT production_collection_workflow_seed_review_fk
  FOREIGN KEY (workspace_id, analysis_seed_review_id)
  REFERENCES appsea.opportunity_seed_reviews(workspace_id, seed_review_id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION appsea.enforce_production_collection_workflow_seed_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.analysis_seed_review_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.opportunity_seed_reviews seed_review
        WHERE seed_review.workspace_id = NEW.workspace_id
          AND seed_review.seed_review_id = NEW.analysis_seed_review_id
          AND seed_review.review_state = 'approved'
     ) THEN
    RAISE EXCEPTION 'production workflow analysis seed review is not approved'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS production_collection_workflow_seed_review_gate
  ON appsea.production_collection_workflow_jobs;
CREATE TRIGGER production_collection_workflow_seed_review_gate
BEFORE INSERT OR UPDATE OF analysis_seed_review_id
ON appsea.production_collection_workflow_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_collection_workflow_seed_review();

-- The handoff is the durable bridge between a committed collection and the
-- existing idempotent analysis workflow. A dispatcher may safely reclaim a
-- stale dispatching row after a worker crash without duplicating analysis.
CREATE TABLE appsea.production_analysis_handoffs (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  handoff_id text NOT NULL CHECK (
    handoff_id ~ '^handoff:analysis:[a-f0-9]{32}$'
  ),
  collection_workflow_id text NOT NULL,
  collection_run_id text NOT NULL,
  seed_review_id text NOT NULL,
  analysis_run_id text NOT NULL CHECK (
    analysis_run_id ~ '^analysis-run:[a-f0-9]{32}$'
  ),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  requested_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'dispatching', 'started', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  workflow_id text CHECK (
    workflow_id IS NULL OR workflow_id ~ '^workflow:analysis:[a-z][a-z0-9_:-]*:[a-f0-9]{32}$'
  ),
  failure_code text CHECK (
    failure_code IS NULL
    OR failure_code IN ('analysis_not_ready', 'seed_not_approved', 'handoff_dispatch_failed')
  ),
  failure_summary text CHECK (
    failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 240
  ),
  next_attempt_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, handoff_id),
  UNIQUE (workspace_id, collection_workflow_id),
  UNIQUE (workspace_id, analysis_run_id),
  FOREIGN KEY (workspace_id, collection_workflow_id)
    REFERENCES appsea.production_collection_workflow_jobs(workspace_id, workflow_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, collection_run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, seed_review_id)
    REFERENCES appsea.opportunity_seed_reviews(workspace_id, seed_review_id)
    ON DELETE RESTRICT,
  CHECK ((state = 'started') = (workflow_id IS NOT NULL AND started_at IS NOT NULL)),
  CHECK ((state = 'failed') = (failure_code IS NOT NULL AND failure_summary IS NOT NULL AND finished_at IS NOT NULL)),
  CHECK (state <> 'failed' OR workflow_id IS NULL),
  CHECK (finished_at IS NULL OR finished_at >= requested_at),
  CHECK (updated_at >= requested_at)
);

CREATE INDEX production_analysis_handoffs_dispatch_idx
  ON appsea.production_analysis_handoffs (workspace_id, state, next_attempt_at, updated_at);

ALTER TABLE appsea.production_analysis_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_analysis_handoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_analysis_handoffs
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.production_analysis_handoffs FROM appsea_service;
GRANT SELECT, INSERT ON appsea.production_analysis_handoffs TO appsea_service;
GRANT UPDATE (
  state, attempt_count, workflow_id, failure_code, failure_summary,
  next_attempt_at, started_at, finished_at, updated_at
) ON appsea.production_analysis_handoffs TO appsea_service;

REVOKE ALL ON FUNCTION appsea.enforce_production_collection_workflow_seed_review() FROM PUBLIC;
