BEGIN;

-- Deep research is an append-only, compact governance record. It binds a
-- human checklist to one completed production analysis and the currently
-- confirmed competitor observations. Raw source content never enters this
-- table; source/evidence IDs remain the auditable join points.
CREATE TABLE appsea.deep_research_gate_reviews (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  gate_id text NOT NULL CHECK (gate_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  opportunity_id text NOT NULL,
  analysis_run_id text NOT NULL,
  artifact_id text NOT NULL,
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('not-ready', 'passed', 'stale', 'withdrawn')),
  checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'object' AND pg_column_size(checks) <= 256000),
  confirmed_observation_ids text[] NOT NULL DEFAULT '{}',
  source_ids text[] NOT NULL DEFAULT '{}',
  evidence_ids text[] NOT NULL DEFAULT '{}',
  contrary_observation_ids text[] NOT NULL DEFAULT '{}',
  competitor_relation_types text[] NOT NULL DEFAULT '{}',
  blocking_reasons text[] NOT NULL DEFAULT '{}',
  coverage_gaps text[] NOT NULL DEFAULT '{}',
  created_by text NOT NULL REFERENCES appsea.users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  passed_by text REFERENCES appsea.users(user_id) ON DELETE RESTRICT,
  passed_at timestamptz,
  withdrawn_by text REFERENCES appsea.users(user_id) ON DELETE RESTRICT,
  withdrawn_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, gate_id),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, analysis_run_id)
    REFERENCES appsea.production_analysis_runs(workspace_id, analysis_run_id) ON DELETE RESTRICT,
  CHECK (status <> 'passed' OR (passed_by IS NOT NULL AND passed_at IS NOT NULL)),
  CHECK (status <> 'withdrawn' OR (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL)),
  CHECK (status IN ('not-ready', 'stale') OR passed_by IS NULL OR status = 'passed'),
  CHECK (status <> 'passed' OR cardinality(confirmed_observation_ids) > 0),
  CHECK (status <> 'passed' OR cardinality(source_ids) > 0),
  CHECK (status <> 'passed' OR cardinality(evidence_ids) > 0),
  CHECK (status <> 'passed' OR cardinality(contrary_observation_ids) > 0),
  CHECK (status <> 'passed' OR ('workaround' = ANY(competitor_relation_types)
    OR 'do-nothing' = ANY(competitor_relation_types))),
  CHECK (created_at <= updated_at),
  CHECK (passed_at IS NULL OR passed_at >= created_at),
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= created_at)
);

CREATE INDEX deep_research_gate_reviews_latest_idx
  ON appsea.deep_research_gate_reviews
     (workspace_id, opportunity_id, updated_at DESC, gate_id DESC);
CREATE INDEX deep_research_gate_reviews_analysis_idx
  ON appsea.deep_research_gate_reviews
     (workspace_id, analysis_run_id, status, updated_at DESC);

ALTER TABLE appsea.deep_research_gate_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.deep_research_gate_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.deep_research_gate_reviews
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

-- The trigger is the database second line of defense. The application derives
-- the exact snapshot hash and arrays; the trigger independently verifies that
-- a passed record references a current completed non-synthetic analysis and
-- at least one active confirmed competitor observation with evidence.
CREATE OR REPLACE FUNCTION appsea.enforce_deep_research_gate_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  actor_role text;
  analysis_row record;
  confirmed_count integer;
  contrary_count integer;
BEGIN
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    RETURN NEW;
  END IF;

  actor_id := NULLIF(current_setting('appsea.auth_user_id', true), '');
  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
    JOIN appsea.workspaces workspace
      ON workspace.workspace_id = membership.workspace_id
   WHERE membership.workspace_id = NEW.workspace_id
     AND membership.user_id = actor_id
     AND workspace.status = 'active';

  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'deep research gate requires an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.created_by <> actor_id THEN
    RAISE EXCEPTION 'deep research gate creator must be the authenticated actor'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'passed' AND actor_role <> 'owner' THEN
    RAISE EXCEPTION 'only a workspace owner may pass a deep research gate'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'withdrawn' AND actor_role <> 'owner' THEN
    RAISE EXCEPTION 'only a workspace owner may withdraw a deep research gate'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'withdrawn'
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.deep_research_gate_reviews prior_gate
        WHERE prior_gate.workspace_id = NEW.workspace_id
          AND prior_gate.opportunity_id = NEW.opportunity_id
          AND prior_gate.analysis_run_id = NEW.analysis_run_id
          AND prior_gate.artifact_id = NEW.artifact_id
          AND prior_gate.snapshot_hash = NEW.snapshot_hash
          AND prior_gate.checks = NEW.checks
          AND prior_gate.status = 'passed'
     ) THEN
    RAISE EXCEPTION 'a withdrawn deep research gate must reference a prior passed snapshot'
      USING ERRCODE = '23514';
  END IF;

  SELECT analysis.opportunity_id,
         analysis.artifact_id,
         analysis.state,
         analysis.availability_state,
         analysis.artifact_snapshot,
         opportunity.synthetic
    INTO analysis_row
    FROM appsea.production_analysis_runs analysis
    JOIN appsea.opportunities opportunity
      ON opportunity.workspace_id = analysis.workspace_id
     AND opportunity.opportunity_id = analysis.opportunity_id
   WHERE analysis.workspace_id = NEW.workspace_id
     AND analysis.analysis_run_id = NEW.analysis_run_id
     AND analysis.opportunity_id = NEW.opportunity_id;

  IF analysis_row.opportunity_id IS NULL
     OR analysis_row.state <> 'completed'
     OR analysis_row.availability_state <> 'active'
     OR analysis_row.artifact_id <> NEW.artifact_id
     OR analysis_row.synthetic IS TRUE
     OR (analysis_row.artifact_snapshot ->> 'artifactId') IS DISTINCT FROM NEW.artifact_id
     OR (analysis_row.artifact_snapshot ->> 'mode') IS DISTINCT FROM 'production-analysis' THEN
    RAISE EXCEPTION 'deep research gate must bind to a completed active production analysis'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer
    INTO confirmed_count
    FROM appsea.competitor_research_observations observation
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = observation.workspace_id
     AND source_item.source_item_id = observation.source_item_id
    JOIN appsea.evidence_records evidence
      ON evidence.workspace_id = observation.workspace_id
     AND evidence.evidence_id = observation.evidence_id
   WHERE observation.workspace_id = NEW.workspace_id
     AND observation.opportunity_id = NEW.opportunity_id
     AND observation.review_state = 'confirmed'
     AND observation.synthetic = false
     AND observation.evidence_id IS NOT NULL
     AND source_item.deletion_state = 'active'
     AND evidence.deletion_state = 'active';
  IF NEW.status = 'passed' AND confirmed_count = 0 THEN
    RAISE EXCEPTION 'deep research gate requires an active confirmed competitor observation'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer
    INTO contrary_count
    FROM appsea.competitor_research_observations observation
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = observation.workspace_id
     AND source_item.source_item_id = observation.source_item_id
    JOIN appsea.evidence_records evidence
      ON evidence.workspace_id = observation.workspace_id
     AND evidence.evidence_id = observation.evidence_id
   WHERE observation.workspace_id = NEW.workspace_id
     AND observation.opportunity_id = NEW.opportunity_id
     AND observation.review_state = 'confirmed'
     AND observation.claim_type = 'contrary_signal'
     AND observation.synthetic = false
     AND source_item.deletion_state = 'active'
     AND evidence.deletion_state = 'active';
  IF NEW.status = 'passed' AND contrary_count = 0 THEN
    RAISE EXCEPTION 'deep research gate requires a confirmed contrary signal'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status = 'passed'
     AND EXISTS (
       SELECT 1
         FROM jsonb_each(NEW.checks) entry
        WHERE entry.value ->> 'state' <> 'pass'
           OR (
             entry.value ->> 'note' IS NULL
             AND COALESCE(jsonb_array_length(entry.value -> 'evidenceIds'), 0) = 0
           )
     ) THEN
    RAISE EXCEPTION 'every deep research gate check must pass with review provenance'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'passed' AND cardinality(NEW.blocking_reasons) > 0 THEN
    RAISE EXCEPTION 'a passed deep research gate cannot retain blocking reasons'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := clock_timestamp();
  IF NEW.status = 'passed' THEN
    NEW.passed_by := actor_id;
    NEW.passed_at := NEW.updated_at;
    NEW.withdrawn_by := NULL;
    NEW.withdrawn_at := NULL;
  ELSIF NEW.status = 'withdrawn' THEN
    NEW.withdrawn_by := actor_id;
    NEW.withdrawn_at := NEW.updated_at;
    NEW.passed_by := NULL;
    NEW.passed_at := NULL;
  ELSE
    NEW.passed_by := NULL;
    NEW.passed_at := NULL;
    NEW.withdrawn_by := NULL;
    NEW.withdrawn_at := NULL;
  END IF;

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (NEW.workspace_id,
     'audit:deep-research-gate:' || md5(concat_ws(':', NEW.workspace_id, NEW.gate_id, txid_current()::text)),
     'user', actor_id,
     CASE NEW.status
       WHEN 'passed' THEN 'opportunity.deep_research_gate.passed'
       WHEN 'withdrawn' THEN 'opportunity.deep_research_gate.withdrawn'
       ELSE 'opportunity.deep_research_gate.submitted'
     END,
     'deep_research_gate', NEW.gate_id,
     'deep-research-gate:' || NEW.gate_id,
     jsonb_build_object(
       'workspaceId', NEW.workspace_id,
       'opportunityId', NEW.opportunity_id,
       'analysisRunId', NEW.analysis_run_id,
       'artifactId', NEW.artifact_id,
       'snapshotHash', NEW.snapshot_hash,
       'status', NEW.status,
       'confirmedObservationCount', cardinality(NEW.confirmed_observation_ids),
       'sourceCount', cardinality(NEW.source_ids),
       'evidenceCount', cardinality(NEW.evidence_ids)
     ),
     NEW.updated_at)
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (NEW.workspace_id,
     'outbox:deep-research-gate:' || md5(concat_ws(':', NEW.workspace_id, NEW.gate_id, txid_current()::text)),
     CASE NEW.status
       WHEN 'passed' THEN 'opportunity.deep_research_gate.passed'
       WHEN 'withdrawn' THEN 'opportunity.deep_research_gate.withdrawn'
       ELSE 'opportunity.deep_research_gate.submitted'
     END,
     'deep_research_gate', NEW.gate_id, 'deep-research-gate-v1',
     'deep-research-gate:' || NEW.gate_id,
     jsonb_build_object('opportunityId', NEW.opportunity_id, 'status', NEW.status),
     NEW.updated_at)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;

CREATE TRIGGER deep_research_gate_review_guard
BEFORE INSERT ON appsea.deep_research_gate_reviews
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_deep_research_gate_review();

REVOKE ALL ON FUNCTION appsea.enforce_deep_research_gate_review() FROM PUBLIC;
REVOKE ALL ON appsea.deep_research_gate_reviews FROM PUBLIC, appsea_service;
GRANT SELECT, INSERT ON appsea.deep_research_gate_reviews TO appsea_service;

COMMENT ON TABLE appsea.deep_research_gate_reviews IS
  'Append-only deep-research readiness reviews. Passed rows require owner attestation, active policy-backed competitor evidence, contrary-signal provenance, substitute coverage, and a completed production analysis snapshot.';

COMMIT;
