-- The production collection workflow uses the same Temporal task queue as the
-- fixture workflow, but its checkpoint projection cannot require an
-- opportunity/score/plan package. Keep the projection separate until the
-- downstream production analysis stages are implemented.
CREATE TABLE appsea.production_collection_workflow_jobs (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  workflow_id text NOT NULL CHECK (
    char_length(workflow_id) BETWEEN 3 AND 240
    AND workflow_id ~ '^[a-z][a-z0-9_:-]*$'
  ),
  temporal_first_execution_run_id uuid NOT NULL,
  workflow_type text NOT NULL CHECK (workflow_type = 'productionCollectionWorkflow'),
  workflow_version text NOT NULL CHECK (workflow_version = 'production-collection-v1'),
  task_queue text NOT NULL CHECK (
    char_length(task_queue) BETWEEN 3 AND 120
    AND task_queue ~ '^[a-z][a-z0-9_-]*$'
  ),
  campaign_id text NOT NULL,
  requested_research_run_id text NOT NULL CHECK (
    requested_research_run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  source_id text NOT NULL,
  policy_version text NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  idempotency_digest char(64) NOT NULL CHECK (idempotency_digest ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  requested_by_actor_type text NOT NULL DEFAULT 'service' CHECK (requested_by_actor_type IN ('user', 'service')),
  requested_by_actor_id text NOT NULL DEFAULT 'appsea-worker' CHECK (
    requested_by_actor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
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
  UNIQUE (workspace_id, idempotency_digest),
  UNIQUE (workspace_id, requested_research_run_id),
  UNIQUE (temporal_first_execution_run_id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES appsea.research_campaigns(workspace_id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, campaign_id, persisted_run_id)
    REFERENCES appsea.research_runs(workspace_id, campaign_id, run_id) ON DELETE RESTRICT,
  CHECK (started_at >= requested_at),
  CHECK (updated_at >= started_at),
  CHECK (finished_at IS NULL OR finished_at >= started_at),
  CHECK (finished_at IS NULL OR updated_at >= finished_at),
  CHECK ((state IN ('completed', 'failed', 'canceled', 'budget_rejected')) = (finished_at IS NOT NULL)),
  CHECK (activity_attempts <= max_activity_attempts),
  CHECK (consumed_source_items <= max_source_items),
  CHECK (consumed_cost_micros <= max_cost_micros),
  CHECK (persisted_run_id IS NULL OR persisted_run_id = requested_research_run_id),
  CHECK ((state = 'completed') = (persisted_run_id IS NOT NULL)),
  CHECK (
    (state IN ('failed', 'canceled', 'budget_rejected')) =
      (failure_code IS NOT NULL AND failure_summary IS NOT NULL)
  ),
  CHECK (
    state <> 'budget_rejected'
    OR failure_code IN ('source_item_budget_exceeded', 'cost_budget_exceeded')
  ),
  CHECK (
    (requested_by_actor_type = 'service' AND requested_by_actor_id = 'appsea-worker')
    OR requested_by_actor_type = 'user'
  ),
  CHECK (state <> 'canceled' OR failure_code = 'workflow_canceled'),
  CHECK (state <> 'failed' OR failure_code = 'activity_failed'),
  CHECK (state <> 'completed' OR checkpoint = 'completed'),
  CHECK (state <> 'failed' OR checkpoint = 'failed'),
  CHECK (state <> 'canceled' OR checkpoint = 'canceled'),
  CHECK (state <> 'budget_rejected' OR checkpoint = 'budget_rejected')
);

CREATE TABLE appsea.production_collection_workflow_checkpoints (
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
  consumed_cost_micros bigint NOT NULL CHECK (consumed_cost_micros BETWEEN 0 AND 1000000000000),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, workflow_id, checkpoint_key),
  UNIQUE (workspace_id, workflow_id, sequence_no),
  FOREIGN KEY (workspace_id, workflow_id)
    REFERENCES appsea.production_collection_workflow_jobs(workspace_id, workflow_id)
    ON DELETE RESTRICT
);

CREATE INDEX production_collection_workflow_state_idx
  ON appsea.production_collection_workflow_jobs (workspace_id, state, updated_at DESC);
CREATE INDEX production_collection_workflow_checkpoint_history_idx
  ON appsea.production_collection_workflow_checkpoints (workspace_id, workflow_id, occurred_at);

CREATE OR REPLACE FUNCTION appsea.enforce_production_collection_workflow_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.requested_by_actor_type IS DISTINCT FROM OLD.requested_by_actor_type
    OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
  ) THEN
    RAISE EXCEPTION 'production workflow requesting actor is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.requested_by_actor_type = 'service' THEN
    IF NEW.requested_by_actor_id <> 'appsea-worker' THEN
      RAISE EXCEPTION 'unsupported production workflow service actor'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = NEW.workspace_id
       AND membership.user_id = NEW.requested_by_actor_id
       AND membership.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'production workflow user actor is not an editor or owner'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_collection_workflow_actor_guard
BEFORE INSERT OR UPDATE ON appsea.production_collection_workflow_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_collection_workflow_actor();

CREATE OR REPLACE FUNCTION appsea.enforce_production_collection_workflow_source_policy()
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
     WHERE source.source_id = NEW.source_id
       AND source.source_type <> 'fixture'
       AND source.lifecycle_state = 'active'
       AND source.current_policy_version = NEW.policy_version
       AND policy.policy_state = 'approved'
       AND policy.reviewed_at IS NOT NULL
       AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'production workflow source policy is not active and approved'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_collection_workflow_source_policy_gate
BEFORE INSERT OR UPDATE OF source_id, policy_version
ON appsea.production_collection_workflow_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_collection_workflow_source_policy();

CREATE OR REPLACE FUNCTION appsea.enforce_production_collection_workflow_transition()
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
    RAISE EXCEPTION 'terminal production workflow % cannot be changed', OLD.workflow_id
      USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'running' AND NEW.state NOT IN ('running', 'completed', 'failed', 'canceled', 'budget_rejected') THEN
    RAISE EXCEPTION 'invalid production workflow transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.consumed_source_items < OLD.consumed_source_items
     OR NEW.consumed_cost_micros < OLD.consumed_cost_micros
     OR NEW.activity_attempts < OLD.activity_attempts THEN
    RAISE EXCEPTION 'production workflow counters cannot decrease' USING ERRCODE = '23514';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'production workflow update time cannot move backward' USING ERRCODE = '23514';
  END IF;
  old_checkpoint_rank := array_position(
    ARRAY['accepted', 'initialized', 'inspected', 'budget_approved', 'persisting',
          'persisted', 'completed', 'failed', 'canceled', 'budget_rejected']::text[],
    OLD.checkpoint
  );
  new_checkpoint_rank := array_position(
    ARRAY['accepted', 'initialized', 'inspected', 'budget_approved', 'persisting',
          'persisted', 'completed', 'failed', 'canceled', 'budget_rejected']::text[],
    NEW.checkpoint
  );
  IF NEW.state = OLD.state AND new_checkpoint_rank < old_checkpoint_rank THEN
    RAISE EXCEPTION 'production workflow checkpoint cannot move backward' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_collection_workflow_transition_guard
BEFORE UPDATE ON appsea.production_collection_workflow_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_collection_workflow_transition();

ALTER TABLE appsea.production_collection_workflow_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_collection_workflow_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_collection_workflow_jobs
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.production_collection_workflow_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_collection_workflow_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_collection_workflow_checkpoints
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.production_collection_workflow_jobs,
  appsea.production_collection_workflow_checkpoints FROM appsea_service;
GRANT SELECT, INSERT ON appsea.production_collection_workflow_jobs,
  appsea.production_collection_workflow_checkpoints TO appsea_service;
GRANT UPDATE (
  state, checkpoint, consumed_source_items, consumed_cost_micros, activity_attempts,
  persisted_run_id, failure_code, failure_summary, updated_at, finished_at
) ON appsea.production_collection_workflow_jobs TO appsea_service;
REVOKE ALL ON FUNCTION appsea.enforce_production_collection_workflow_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_production_collection_workflow_source_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_production_collection_workflow_actor() FROM PUBLIC;
