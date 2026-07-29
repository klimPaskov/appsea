ALTER TABLE appsea.research_runs
  ADD CONSTRAINT research_runs_campaign_run_unique
  UNIQUE (workspace_id, campaign_id, run_id);

CREATE TABLE appsea.workflow_job_executions (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  workflow_id text NOT NULL CHECK (
    char_length(workflow_id) BETWEEN 3 AND 240
    AND workflow_id ~ '^[a-z][a-z0-9_:-]*$'
  ),
  temporal_first_execution_run_id uuid NOT NULL,
  workflow_type text NOT NULL CHECK (workflow_type = 'fixtureResearchWorkflow'),
  workflow_version text NOT NULL CHECK (workflow_version = 'fixture-research-v1'),
  task_queue text NOT NULL CHECK (
    char_length(task_queue) BETWEEN 3 AND 120
    AND task_queue ~ '^[a-z][a-z0-9_-]*$'
  ),
  campaign_id text NOT NULL,
  requested_research_run_id text NOT NULL CHECK (
    requested_research_run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  idempotency_digest char(64) NOT NULL CHECK (idempotency_digest ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (
    state IN ('queued', 'running', 'completed', 'failed', 'canceled', 'budget_rejected')
  ),
  checkpoint text NOT NULL CHECK (
    checkpoint IN (
      'accepted', 'initialized', 'inspected', 'budget_approved', 'persisting',
      'persisted', 'completed', 'failed', 'canceled', 'budget_rejected'
    )
  ),
  budget_currency char(3) NOT NULL CHECK (budget_currency = 'USD'),
  max_source_items integer NOT NULL CHECK (max_source_items BETWEEN 0 AND 5000),
  max_cost_micros bigint NOT NULL CHECK (max_cost_micros BETWEEN 0 AND 1000000000000),
  max_activity_attempts integer NOT NULL CHECK (max_activity_attempts BETWEEN 1 AND 10),
  consumed_source_items integer NOT NULL DEFAULT 0 CHECK (consumed_source_items >= 0),
  consumed_cost_micros bigint NOT NULL DEFAULT 0 CHECK (consumed_cost_micros >= 0),
  activity_attempts integer NOT NULL DEFAULT 0 CHECK (activity_attempts >= 0),
  persisted_run_id text,
  opportunity_id text,
  score_snapshot_id text,
  plan_package_id text,
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'source_item_budget_exceeded', 'cost_budget_exceeded',
      'activity_failed', 'workflow_canceled'
    )
  ),
  failure_summary text CHECK (
    failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 240
  ),
  requested_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz,
  PRIMARY KEY (workspace_id, workflow_id),
  UNIQUE (workspace_id, workflow_type, idempotency_digest),
  UNIQUE (workspace_id, requested_research_run_id),
  UNIQUE (temporal_first_execution_run_id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES appsea.research_campaigns(workspace_id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, campaign_id, persisted_run_id)
    REFERENCES appsea.research_runs(workspace_id, campaign_id, run_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, score_snapshot_id)
    REFERENCES appsea.opportunity_score_snapshots(workspace_id, score_snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, plan_package_id)
    REFERENCES appsea.plan_package_versions(workspace_id, plan_package_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, persisted_run_id, opportunity_id)
    REFERENCES appsea.research_run_opportunities(workspace_id, run_id, opportunity_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, persisted_run_id, opportunity_id, score_snapshot_id)
    REFERENCES appsea.research_run_score_snapshots(
      workspace_id, run_id, opportunity_id, score_snapshot_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, persisted_run_id, opportunity_id, plan_package_id)
    REFERENCES appsea.research_run_plan_packages(
      workspace_id, run_id, opportunity_id, plan_package_id
    ) ON DELETE RESTRICT,
  CHECK (started_at >= requested_at),
  CHECK (updated_at >= started_at),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK (finished_at IS NULL OR updated_at >= finished_at),
  CHECK ((state IN ('completed', 'failed', 'canceled', 'budget_rejected')) = (finished_at IS NOT NULL)),
  CHECK (activity_attempts <= max_activity_attempts),
  CHECK (consumed_source_items <= max_source_items),
  CHECK (consumed_cost_micros <= max_cost_micros),
  CHECK (persisted_run_id IS NULL OR persisted_run_id = requested_research_run_id),
  CHECK (
    (state = 'completed') = (
      persisted_run_id IS NOT NULL
      AND opportunity_id IS NOT NULL
      AND score_snapshot_id IS NOT NULL
      AND plan_package_id IS NOT NULL
    )
  ),
  CHECK (
    (state IN ('failed', 'canceled', 'budget_rejected')) =
      (failure_code IS NOT NULL AND failure_summary IS NOT NULL)
  ),
  CHECK (
    state <> 'budget_rejected'
    OR failure_code IN ('source_item_budget_exceeded', 'cost_budget_exceeded')
  ),
  CHECK (state <> 'canceled' OR failure_code = 'workflow_canceled'),
  CHECK (state <> 'failed' OR failure_code = 'activity_failed'),
  CHECK (state <> 'completed' OR checkpoint = 'completed'),
  CHECK (state <> 'failed' OR checkpoint = 'failed'),
  CHECK (state <> 'canceled' OR checkpoint = 'canceled'),
  CHECK (state <> 'budget_rejected' OR checkpoint = 'budget_rejected')
);

CREATE TABLE appsea.workflow_job_checkpoints (
  workspace_id text NOT NULL,
  workflow_id text NOT NULL,
  checkpoint_key text NOT NULL CHECK (
    char_length(checkpoint_key) BETWEEN 3 AND 160
    AND checkpoint_key ~ '^[a-z][a-z0-9_:-]*$'
  ),
  sequence_no integer NOT NULL CHECK (sequence_no BETWEEN 1 AND 1000),
  checkpoint text NOT NULL CHECK (
    checkpoint IN (
      'accepted', 'initialized', 'inspected', 'budget_approved', 'persisting',
      'persisted', 'completed', 'failed', 'canceled', 'budget_rejected'
    )
  ),
  state text NOT NULL CHECK (
    state IN ('queued', 'running', 'completed', 'failed', 'canceled', 'budget_rejected')
  ),
  activity_attempt integer NOT NULL CHECK (activity_attempt BETWEEN 1 AND 10),
  consumed_source_items integer NOT NULL CHECK (consumed_source_items BETWEEN 0 AND 5000),
  consumed_cost_micros bigint NOT NULL CHECK (
    consumed_cost_micros BETWEEN 0 AND 1000000000000
  ),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, workflow_id, checkpoint_key),
  UNIQUE (workspace_id, workflow_id, sequence_no),
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES appsea.workflow_job_executions(workspace_id, workflow_id) ON DELETE RESTRICT
);

CREATE INDEX workflow_job_executions_state_idx
  ON appsea.workflow_job_executions (workspace_id, state, updated_at DESC);
CREATE INDEX workflow_job_executions_campaign_idx
  ON appsea.workflow_job_executions (workspace_id, campaign_id, requested_at DESC);
CREATE INDEX workflow_job_checkpoints_history_idx
  ON appsea.workflow_job_checkpoints (workspace_id, workflow_id, occurred_at, checkpoint_key);

CREATE OR REPLACE FUNCTION appsea.enforce_workflow_job_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  old_checkpoint_rank integer;
  new_checkpoint_rank integer;
BEGIN
  IF OLD.state IN ('completed', 'failed', 'canceled', 'budget_rejected')
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal workflow job % cannot be changed', OLD.workflow_id
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'queued' AND NEW.state NOT IN ('queued', 'running', 'failed', 'canceled', 'budget_rejected') THEN
    RAISE EXCEPTION 'invalid queued workflow transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'running' AND NEW.state NOT IN ('running', 'completed', 'failed', 'canceled', 'budget_rejected') THEN
    RAISE EXCEPTION 'invalid running workflow transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.consumed_source_items < OLD.consumed_source_items
     OR NEW.consumed_cost_micros < OLD.consumed_cost_micros
     OR NEW.activity_attempts < OLD.activity_attempts THEN
    RAISE EXCEPTION 'workflow counters cannot decrease' USING ERRCODE = '23514';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'workflow update time cannot move backward' USING ERRCODE = '23514';
  END IF;

  old_checkpoint_rank := array_position(
    ARRAY[
      'accepted', 'initialized', 'inspected', 'budget_approved', 'persisting',
      'persisted', 'completed', 'failed', 'canceled', 'budget_rejected'
    ]::text[],
    OLD.checkpoint
  );
  new_checkpoint_rank := array_position(
    ARRAY[
      'accepted', 'initialized', 'inspected', 'budget_approved', 'persisting',
      'persisted', 'completed', 'failed', 'canceled', 'budget_rejected'
    ]::text[],
    NEW.checkpoint
  );
  IF NEW.state = OLD.state
     AND NEW.state IN ('queued', 'running')
     AND new_checkpoint_rank < old_checkpoint_rank THEN
    RAISE EXCEPTION 'workflow checkpoint cannot move backward' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER workflow_job_transition_guard
BEFORE UPDATE ON appsea.workflow_job_executions
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_workflow_job_transition();

ALTER TABLE appsea.workflow_job_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.workflow_job_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.workflow_job_executions
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.workflow_job_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.workflow_job_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.workflow_job_checkpoints
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.workflow_job_executions, appsea.workflow_job_checkpoints
  FROM appsea_service;
GRANT SELECT, INSERT ON appsea.workflow_job_executions, appsea.workflow_job_checkpoints
  TO appsea_service;
GRANT UPDATE (
  state, checkpoint, consumed_source_items, consumed_cost_micros, activity_attempts,
  persisted_run_id, opportunity_id, score_snapshot_id, plan_package_id,
  failure_code, failure_summary, updated_at, finished_at
) ON appsea.workflow_job_executions TO appsea_service;

REVOKE ALL ON FUNCTION appsea.enforce_workflow_job_transition() FROM PUBLIC;
