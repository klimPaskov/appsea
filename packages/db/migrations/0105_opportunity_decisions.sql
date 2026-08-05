BEGIN;

-- Opportunity lifecycle decisions are append-only, tenant-private governance
-- records. The snapshot is identifier-only: raw complaint text never enters a
-- decision or its audit/outbox receipt.
CREATE TABLE appsea.opportunity_decisions (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  decision_id text NOT NULL CHECK (decision_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  opportunity_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approve', 'watch', 'reject', 'archive')),
  previous_state text NOT NULL CHECK (
    previous_state IN ('signal', 'candidate', 'researched', 'planned', 'approved', 'monitoring', 'archived')
  ),
  next_state text NOT NULL CHECK (
    next_state IN ('signal', 'candidate', 'researched', 'planned', 'approved', 'monitoring', 'archived')
  ),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2_000),
  evidence_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(evidence_snapshot) = 'object' AND pg_column_size(evidence_snapshot) <= 256000),
  evidence_snapshot_hash char(64) NOT NULL CHECK (evidence_snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, decision_id),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT,
  CHECK (previous_state <> next_state),
  CHECK ((decision = 'approve' AND next_state = 'approved')
    OR (decision = 'watch' AND next_state = 'monitoring')
    OR (decision IN ('reject', 'archive') AND next_state = 'archived'))
);

CREATE INDEX opportunity_decisions_history_idx
  ON appsea.opportunity_decisions (workspace_id, opportunity_id, created_at DESC, decision_id DESC);

ALTER TABLE appsea.opportunity_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.opportunity_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.opportunity_decisions
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

-- The application checks the transition before insert; this trigger is the
-- database second line of defense and performs the state change in the same
-- transaction. A stale expected state therefore cannot silently overwrite a
-- later decision.
CREATE OR REPLACE FUNCTION appsea.enforce_opportunity_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  actor_role text;
  opportunity_row record;
  plan_approval_state text;
  plan_readiness_state text;
  report_state text;
  gate_state text;
  event_id text;
  event_action text;
  payload jsonb;
BEGIN
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    RETURN NEW;
  END IF;

  actor_id := NULLIF(current_setting('appsea.auth_user_id', true), '');
  IF actor_id IS NULL OR NEW.actor_id <> actor_id THEN
    RAISE EXCEPTION 'opportunity decision actor must be the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
    JOIN appsea.workspaces workspace
      ON workspace.workspace_id = membership.workspace_id
   WHERE membership.workspace_id = NEW.workspace_id
     AND membership.user_id = actor_id
     AND workspace.status = 'active';
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'opportunity decisions require an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT opportunity.opportunity_id, opportunity.state, opportunity.synthetic,
         opportunity.source_run_id, opportunity.current_score_snapshot_id,
         opportunity.current_plan_package_id
    INTO opportunity_row
    FROM appsea.opportunities opportunity
   WHERE opportunity.workspace_id = NEW.workspace_id
     AND opportunity.opportunity_id = NEW.opportunity_id
     AND opportunity.availability_state = 'active'
   FOR UPDATE;
  IF opportunity_row.opportunity_id IS NULL THEN
    RAISE EXCEPTION 'opportunity is not active'
      USING ERRCODE = '23503';
  END IF;
  IF opportunity_row.state IS DISTINCT FROM NEW.previous_state THEN
    RAISE EXCEPTION 'opportunity decision snapshot is stale'
      USING ERRCODE = '40001';
  END IF;
  IF (NEW.evidence_snapshot ->> 'opportunityId') IS DISTINCT FROM NEW.opportunity_id
     OR (NEW.evidence_snapshot ->> 'sourceRunId') IS DISTINCT FROM opportunity_row.source_run_id
     OR (NEW.evidence_snapshot ->> 'previousState') IS DISTINCT FROM NEW.previous_state
     OR (NEW.evidence_snapshot ->> 'snapshotHash') IS DISTINCT FROM NEW.evidence_snapshot_hash THEN
    RAISE EXCEPTION 'opportunity decision evidence snapshot does not match the current opportunity'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(COALESCE(NEW.evidence_snapshot -> 'evidenceIds', '[]'::jsonb)) evidence_id
     WHERE NOT EXISTS (
       SELECT 1
         FROM appsea.evidence_records evidence
         JOIN appsea.research_run_complaints run_complaint
           ON run_complaint.workspace_id = evidence.workspace_id
          AND run_complaint.run_id = opportunity_row.source_run_id
         JOIN appsea.complaint_observations complaint
           ON complaint.workspace_id = run_complaint.workspace_id
          AND complaint.complaint_id = run_complaint.complaint_id
          AND complaint.evidence_id = evidence.evidence_id
        WHERE evidence.workspace_id = NEW.workspace_id
          AND evidence.evidence_id = evidence_id.value
          AND evidence.deletion_state = 'active'
     )
  ) THEN
    RAISE EXCEPTION 'opportunity decision evidence snapshot contains an unrelated evidence reference'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.decision = 'approve' THEN
    IF actor_role <> 'owner' THEN
      RAISE EXCEPTION 'only a workspace owner may approve an opportunity'
        USING ERRCODE = '42501';
    END IF;
    IF opportunity_row.synthetic OR opportunity_row.state <> 'planned' THEN
      RAISE EXCEPTION 'only a planned, non-synthetic opportunity may be approved'
        USING ERRCODE = '23514';
    END IF;
    SELECT plan.approval_state, plan.readiness_state, report.approval_state
      INTO plan_approval_state, plan_readiness_state, report_state
      FROM appsea.plan_package_versions plan
      LEFT JOIN appsea.report_versions report
        ON report.workspace_id = plan.workspace_id
       AND report.report_id = plan.report_id
     WHERE plan.workspace_id = NEW.workspace_id
       AND plan.plan_package_id = opportunity_row.current_plan_package_id
       AND plan.deletion_state = 'active';
    IF plan_approval_state IS DISTINCT FROM 'approved'
       OR plan_readiness_state IS DISTINCT FROM 'ready'
       OR report_state IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'an approved report and plan are required before approval'
        USING ERRCODE = '23514';
    END IF;
    SELECT gate.status
      INTO gate_state
      FROM appsea.deep_research_gate_reviews gate
      JOIN appsea.production_analysis_runs analysis
        ON analysis.workspace_id = gate.workspace_id
       AND analysis.analysis_run_id = gate.analysis_run_id
       AND analysis.opportunity_id = gate.opportunity_id
       AND analysis.collection_run_id = opportunity_row.source_run_id
       AND analysis.artifact_id = gate.artifact_id
       AND analysis.analysis_run_id = (
         SELECT current_analysis.analysis_run_id
           FROM appsea.production_analysis_runs current_analysis
          WHERE current_analysis.workspace_id = NEW.workspace_id
            AND current_analysis.opportunity_id = NEW.opportunity_id
            AND current_analysis.collection_run_id = opportunity_row.source_run_id
            AND current_analysis.state = 'completed'
            AND current_analysis.availability_state = 'active'
          ORDER BY current_analysis.completed_at DESC, current_analysis.analysis_run_id DESC
          LIMIT 1
       )
       AND analysis.state = 'completed'
       AND analysis.availability_state = 'active'
         WHERE gate.workspace_id = NEW.workspace_id
       AND gate.opportunity_id = NEW.opportunity_id
       AND gate.status = 'passed'
     ORDER BY gate.updated_at DESC, gate.gate_id DESC
     LIMIT 1;
    IF gate_state IS DISTINCT FROM 'passed' THEN
      RAISE EXCEPTION 'a passed deep-research gate is required before approval'
        USING ERRCODE = '23514';
    END IF;
    event_action := 'opportunity.approved';
  ELSIF NEW.decision = 'watch' THEN
    IF opportunity_row.state IN ('monitoring', 'archived') THEN
      RAISE EXCEPTION 'the opportunity cannot be watched from its current state'
        USING ERRCODE = '23514';
    END IF;
    event_action := 'opportunity.monitoring_started';
  ELSIF NEW.decision IN ('reject', 'archive') THEN
    IF opportunity_row.state = 'archived' THEN
      RAISE EXCEPTION 'the opportunity is already archived'
        USING ERRCODE = '23514';
    END IF;
    event_action := CASE NEW.decision
      WHEN 'reject' THEN 'opportunity.rejected'
      ELSE 'opportunity.archived'
    END;
  ELSE
    RAISE EXCEPTION 'unsupported opportunity decision'
      USING ERRCODE = '23514';
  END IF;

  UPDATE appsea.opportunities
     SET state = NEW.next_state,
         updated_at = clock_timestamp()
   WHERE workspace_id = NEW.workspace_id
     AND opportunity_id = NEW.opportunity_id;

  event_id := 'opportunity-decision:' || md5(concat_ws(':', NEW.workspace_id, NEW.decision_id));
  payload := jsonb_build_object(
    'workspaceId', NEW.workspace_id,
    'opportunityId', NEW.opportunity_id,
    'decisionId', NEW.decision_id,
    'decision', NEW.decision,
    'previousState', NEW.previous_state,
    'nextState', NEW.next_state,
    'evidenceSnapshotHash', NEW.evidence_snapshot_hash
  );

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (NEW.workspace_id, 'audit:' || event_id, 'user', actor_id, event_action,
     'opportunity', NEW.opportunity_id, event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (NEW.workspace_id, 'outbox:' || event_id, event_action, 'opportunity',
     NEW.opportunity_id, 'opportunity-decision-v1', event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$$;

CREATE TRIGGER opportunity_decision_guard
BEFORE INSERT ON appsea.opportunity_decisions
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_opportunity_decision();

CREATE OR REPLACE FUNCTION appsea.prevent_opportunity_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  RAISE EXCEPTION 'opportunity decisions are append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER opportunity_decision_immutable
BEFORE UPDATE OR DELETE ON appsea.opportunity_decisions
FOR EACH ROW EXECUTE FUNCTION appsea.prevent_opportunity_decision_mutation();

REVOKE ALL ON FUNCTION appsea.enforce_opportunity_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.prevent_opportunity_decision_mutation() FROM PUBLIC;
REVOKE ALL ON appsea.opportunity_decisions FROM PUBLIC, appsea_service;
GRANT SELECT, INSERT ON appsea.opportunity_decisions TO appsea_service;

COMMENT ON TABLE appsea.opportunity_decisions IS
  'Append-only, owner/editor-authored lifecycle decisions with identifier-only evidence snapshots and audited state transitions.';

COMMIT;
