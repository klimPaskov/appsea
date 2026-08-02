-- Durable, secret-free attempt history for the production-analysis activity.
-- Timestamps are database-observed so callers cannot forge duration or liveness.

CREATE TABLE appsea.production_analysis_activity_attempts (
  workspace_id text NOT NULL,
  analysis_run_id text NOT NULL CHECK (
    analysis_run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  collection_run_id text NOT NULL CHECK (
    collection_run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  activity_attempt integer NOT NULL CHECK (activity_attempt BETWEEN 1 AND 10),
  state text NOT NULL CHECK (state IN ('started', 'completed', 'failed')),
  started_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  heartbeat_count integer NOT NULL DEFAULT 1 CHECK (heartbeat_count BETWEEN 1 AND 10000),
  finished_at timestamptz,
  duration_ms integer,
  failure_code text CHECK (failure_code IS NULL OR failure_code IN (
    'analysis_input_invalid', 'analysis_policy_denied', 'analysis_budget_exceeded',
    'analysis_activity_failed', 'analysis_reconciliation_required'
  )),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, analysis_run_id, activity_attempt),
  FOREIGN KEY (workspace_id, collection_run_id)
    REFERENCES appsea.research_runs(workspace_id, run_id) ON DELETE RESTRICT,
  CHECK (last_heartbeat_at >= started_at),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK ((state = 'started') = (finished_at IS NULL)),
  CHECK (
    state = 'started'
    OR (duration_ms IS NOT NULL AND duration_ms BETWEEN 0 AND 86400000)
  ),
  CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
  CHECK (state <> 'completed' OR failure_code IS NULL)
);

CREATE INDEX production_analysis_activity_attempts_run_idx
  ON appsea.production_analysis_activity_attempts
     (workspace_id, analysis_run_id, activity_attempt);

CREATE OR REPLACE FUNCTION appsea.guard_production_analysis_activity_attempt_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  existing_collection_run_id text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.research_runs run
     WHERE run.workspace_id = NEW.workspace_id
       AND run.run_id = NEW.collection_run_id
       AND run.mode = 'production'
       AND run.state = 'completed'
  ) THEN
    RAISE EXCEPTION 'production analysis activity requires a completed production collection run'
      USING ERRCODE = '42501';
  END IF;

  SELECT analysis.collection_run_id
    INTO existing_collection_run_id
    FROM appsea.production_analysis_runs analysis
   WHERE analysis.workspace_id = NEW.workspace_id
     AND analysis.analysis_run_id = NEW.analysis_run_id;
  IF existing_collection_run_id IS NOT NULL
     AND existing_collection_run_id IS DISTINCT FROM NEW.collection_run_id THEN
    RAISE EXCEPTION 'production analysis activity collection lineage is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.analysis_run_id IS DISTINCT FROM OLD.analysis_run_id
    OR NEW.collection_run_id IS DISTINCT FROM OLD.collection_run_id
    OR NEW.activity_attempt IS DISTINCT FROM OLD.activity_attempt
  ) THEN
    RAISE EXCEPTION 'production analysis activity identity is immutable'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state <> 'started' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal production analysis activity attempt is immutable'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.heartbeat_count > NEW.heartbeat_count THEN
    RAISE EXCEPTION 'production analysis activity heartbeat count cannot decrease'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.last_heartbeat_at < OLD.last_heartbeat_at THEN
    RAISE EXCEPTION 'production analysis activity heartbeat time cannot decrease'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_activity_attempt_lineage
BEFORE INSERT OR UPDATE ON appsea.production_analysis_activity_attempts
FOR EACH ROW EXECUTE FUNCTION appsea.guard_production_analysis_activity_attempt_lineage();

CREATE OR REPLACE FUNCTION appsea.guard_production_analysis_run_activity_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM appsea.production_analysis_activity_attempts attempt
     WHERE attempt.workspace_id = NEW.workspace_id
       AND attempt.analysis_run_id = NEW.analysis_run_id
       AND attempt.collection_run_id IS DISTINCT FROM NEW.collection_run_id
  ) THEN
    RAISE EXCEPTION 'production analysis run collection lineage conflicts with activity history'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_run_activity_lineage
BEFORE INSERT OR UPDATE OF workspace_id, analysis_run_id, collection_run_id
ON appsea.production_analysis_runs
FOR EACH ROW EXECUTE FUNCTION appsea.guard_production_analysis_run_activity_lineage();

ALTER TABLE appsea.production_analysis_activity_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_analysis_activity_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_analysis_activity_attempts
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.production_analysis_activity_attempts FROM appsea_service;
GRANT SELECT, INSERT ON appsea.production_analysis_activity_attempts TO appsea_service;
GRANT UPDATE (
  state, last_heartbeat_at, heartbeat_count, finished_at, duration_ms, failure_code, updated_at
) ON appsea.production_analysis_activity_attempts TO appsea_service;

REVOKE ALL ON FUNCTION appsea.guard_production_analysis_activity_attempt_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_production_analysis_run_activity_lineage() FROM PUBLIC;
