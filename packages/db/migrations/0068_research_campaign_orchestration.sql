BEGIN;

-- A campaign orchestration is a durable parent request. Each configured
-- source is represented by an independent child dispatch record so a source
-- policy denial, worker crash, or Temporal retry cannot hide the other source
-- outcomes behind an in-memory fan-out.
CREATE TABLE appsea.research_campaign_orchestrations (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  orchestration_id text NOT NULL CHECK (
    orchestration_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  campaign_id text NOT NULL,
  idempotency_digest char(64) NOT NULL CHECK (idempotency_digest ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  requested_by_actor_type text NOT NULL DEFAULT 'user'
    CHECK (requested_by_actor_type IN ('user', 'service')),
  requested_by_actor_id text NOT NULL CHECK (
    requested_by_actor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  analysis_seed_review_id text,
  state text NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'partial', 'failed', 'canceled')),
  source_count integer NOT NULL CHECK (source_count BETWEEN 2 AND 16),
  completed_source_count integer NOT NULL DEFAULT 0 CHECK (completed_source_count BETWEEN 0 AND 16),
  failed_source_count integer NOT NULL DEFAULT 0 CHECK (failed_source_count BETWEEN 0 AND 16),
  failure_code text CHECK (failure_code IS NULL OR failure_code IN (
    'source_policy_denied', 'source_unsupported', 'input_invalid',
    'admission_rate_limited', 'admission_concurrency_limited',
    'temporal_unavailable', 'dispatch_failed', 'attempts_exhausted',
    'child_failed', 'canceled'
  )),
  failure_summary text CHECK (failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 240),
  requested_at timestamptz NOT NULL,
  started_at timestamptz,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz,
  PRIMARY KEY (workspace_id, orchestration_id),
  UNIQUE (workspace_id, idempotency_digest),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES appsea.research_campaigns(workspace_id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, analysis_seed_review_id)
    REFERENCES appsea.opportunity_seed_reviews(workspace_id, seed_review_id) ON DELETE RESTRICT,
  CHECK (started_at IS NULL OR started_at >= requested_at),
  CHECK (updated_at >= requested_at),
  CHECK (finished_at IS NULL OR started_at IS NOT NULL),
  CHECK (finished_at IS NULL OR finished_at >= COALESCE(started_at, requested_at)),
  CHECK (finished_at IS NULL OR updated_at >= finished_at),
  CHECK (completed_source_count + failed_source_count <= source_count),
  CHECK ((state IN ('completed', 'partial', 'failed', 'canceled')) = (finished_at IS NOT NULL)),
  CHECK (state IN ('queued', 'running', 'completed') OR failure_code IS NOT NULL AND failure_summary IS NOT NULL),
  CHECK (state <> 'completed' OR (completed_source_count = source_count AND failed_source_count = 0)),
  CHECK (state <> 'partial' OR (completed_source_count > 0 AND failed_source_count > 0)),
  CHECK (state <> 'failed' OR failed_source_count = source_count),
  CHECK ((requested_by_actor_type = 'service' AND requested_by_actor_id = 'appsea-worker')
      OR requested_by_actor_type = 'user')
);

CREATE TABLE appsea.research_campaign_orchestration_sources (
  workspace_id text NOT NULL,
  orchestration_id text NOT NULL,
  source_id text NOT NULL REFERENCES appsea.sources(source_id) ON DELETE RESTRICT,
  child_run_id text NOT NULL CHECK (child_run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  state text NOT NULL CHECK (state IN ('queued', 'dispatching', 'started', 'completed', 'failed', 'canceled')),
  policy_version text CHECK (
    policy_version IS NULL OR (char_length(policy_version) BETWEEN 1 AND 80
      AND policy_version ~ '^[a-zA-Z0-9._:-]+$')
  ),
  workflow_id text CHECK (
    workflow_id IS NULL OR (char_length(workflow_id) BETWEEN 3 AND 240
      AND workflow_id ~ '^[a-z][a-z0-9_:-]*$')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  claim_owner text,
  claim_token text,
  claim_until timestamptz,
  next_attempt_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code IN (
    'source_policy_denied', 'source_unsupported', 'input_invalid',
    'admission_rate_limited', 'admission_concurrency_limited',
    'temporal_unavailable', 'dispatch_failed', 'attempts_exhausted',
    'child_failed', 'canceled'
  )),
  failure_summary text CHECK (failure_summary IS NULL OR char_length(failure_summary) BETWEEN 1 AND 240),
  requested_at timestamptz NOT NULL,
  started_at timestamptz,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz,
  PRIMARY KEY (workspace_id, orchestration_id, source_id),
  UNIQUE (workspace_id, child_run_id),
  UNIQUE (workspace_id, workflow_id),
  FOREIGN KEY (workspace_id, orchestration_id)
    REFERENCES appsea.research_campaign_orchestrations(workspace_id, orchestration_id)
    ON DELETE CASCADE,
  CHECK ((claim_owner IS NULL AND claim_token IS NULL AND claim_until IS NULL)
      OR (claim_owner IS NOT NULL AND claim_token IS NOT NULL AND claim_until IS NOT NULL)),
  CHECK (finished_at IS NULL OR started_at IS NOT NULL OR state IN ('failed', 'canceled')),
  CHECK (started_at IS NULL OR started_at >= requested_at),
  CHECK (finished_at IS NULL OR finished_at >= COALESCE(started_at, requested_at)),
  CHECK (updated_at >= requested_at),
  CHECK ((state IN ('completed', 'failed', 'canceled')) = (finished_at IS NOT NULL)),
  CHECK (state NOT IN ('failed', 'canceled') OR (failure_code IS NOT NULL AND failure_summary IS NOT NULL)),
  -- A queued child may retain the last bounded retry failure for inspection;
  -- a new claim clears it before dispatch.
  CHECK (state NOT IN ('dispatching', 'started', 'completed') OR failure_code IS NULL),
  CHECK (state IN ('queued', 'dispatching') OR workflow_id IS NOT NULL OR state IN ('failed', 'canceled')),
  CHECK (state <> 'started' OR (workflow_id IS NOT NULL AND started_at IS NOT NULL)),
  CHECK (state <> 'completed' OR workflow_id IS NOT NULL),
  CHECK (state <> 'dispatching' OR claim_owner IS NOT NULL),
  CHECK (state <> 'dispatching' OR claim_until IS NOT NULL),
  CHECK (state <> 'dispatching' OR claim_until > updated_at)
);

CREATE INDEX research_campaign_orchestration_state_idx
  ON appsea.research_campaign_orchestrations (workspace_id, state, updated_at DESC);
CREATE INDEX research_campaign_orchestration_child_dispatch_idx
  ON appsea.research_campaign_orchestration_sources
     (workspace_id, state, next_attempt_at, updated_at)
  WHERE state IN ('queued', 'dispatching');

CREATE OR REPLACE FUNCTION appsea.enforce_research_campaign_orchestration_actor()
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
    RAISE EXCEPTION 'campaign orchestration requesting actor is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.requested_by_actor_type = 'service' THEN
    IF NEW.requested_by_actor_id <> 'appsea-worker' THEN
      RAISE EXCEPTION 'unsupported campaign orchestration service actor'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = NEW.workspace_id
       AND membership.user_id = NEW.requested_by_actor_id
       AND membership.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'campaign orchestration actor is not an editor or owner'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER research_campaign_orchestration_actor_guard
BEFORE INSERT OR UPDATE ON appsea.research_campaign_orchestrations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_research_campaign_orchestration_actor();

CREATE OR REPLACE FUNCTION appsea.enforce_research_campaign_orchestration_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.state IN ('completed', 'partial', 'failed', 'canceled') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal campaign orchestration % cannot be changed', OLD.orchestration_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.completed_source_count < OLD.completed_source_count
     OR NEW.failed_source_count < OLD.failed_source_count
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'campaign orchestration counters or time cannot move backward'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'queued' AND NEW.state NOT IN ('queued', 'running', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'invalid campaign orchestration transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'running' AND NEW.state NOT IN ('running', 'completed', 'partial', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'invalid campaign orchestration transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER research_campaign_orchestration_transition_guard
BEFORE UPDATE ON appsea.research_campaign_orchestrations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_research_campaign_orchestration_transition();

CREATE OR REPLACE FUNCTION appsea.enforce_research_campaign_orchestration_source_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.state IN ('completed', 'failed', 'canceled') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal campaign orchestration source % cannot be changed', OLD.child_run_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'campaign orchestration source counters or time cannot move backward'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.policy_version IS NOT NULL AND NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'campaign orchestration source policy version is immutable after dispatch'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.workflow_id IS NOT NULL AND NEW.workflow_id IS DISTINCT FROM OLD.workflow_id THEN
    RAISE EXCEPTION 'campaign orchestration source workflow identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'queued' AND NEW.state NOT IN ('queued', 'dispatching', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'invalid campaign orchestration source transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'dispatching' AND NEW.state NOT IN ('queued', 'dispatching', 'started', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'invalid campaign orchestration source transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'started' AND NEW.state NOT IN ('started', 'completed', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'invalid campaign orchestration source transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.state IN ('started', 'completed') AND NOT EXISTS (
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
       AND review.independence_attested
     WHERE source.source_id = NEW.source_id
       AND source.source_type <> 'fixture'
       AND source.lifecycle_state = 'active'
       AND source.current_policy_version = NEW.policy_version
       AND policy.policy_state = 'approved'
       AND policy.reviewed_at IS NOT NULL
       AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'campaign orchestration source policy is not approved and collectible'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER research_campaign_orchestration_source_transition_guard
BEFORE UPDATE ON appsea.research_campaign_orchestration_sources
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_research_campaign_orchestration_source_transition();

ALTER TABLE appsea.research_campaign_orchestrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.research_campaign_orchestrations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.research_campaign_orchestrations
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.research_campaign_orchestration_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.research_campaign_orchestration_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.research_campaign_orchestration_sources
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.research_campaign_orchestrations,
  appsea.research_campaign_orchestration_sources FROM appsea_service;
GRANT SELECT, INSERT ON appsea.research_campaign_orchestrations,
  appsea.research_campaign_orchestration_sources TO appsea_service;
GRANT UPDATE (
  state, completed_source_count, failed_source_count, started_at, updated_at,
  finished_at, failure_code, failure_summary
) ON appsea.research_campaign_orchestrations TO appsea_service;
GRANT UPDATE (
  state, policy_version, workflow_id, attempt_count, claim_owner, claim_token,
  claim_until, next_attempt_at, failure_code, failure_summary, started_at,
  updated_at, finished_at
) ON appsea.research_campaign_orchestration_sources TO appsea_service;
REVOKE ALL ON FUNCTION appsea.enforce_research_campaign_orchestration_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_research_campaign_orchestration_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_research_campaign_orchestration_source_transition() FROM PUBLIC;

COMMIT;
