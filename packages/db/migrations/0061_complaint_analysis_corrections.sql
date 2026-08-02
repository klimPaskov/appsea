BEGIN;

-- Human corrections are derived-analysis governance, not source mutation.
-- Keep each correction immutable so a later analysis can explain which
-- interpretation was used and who changed it.
CREATE TABLE appsea.complaint_analysis_corrections (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  correction_id text NOT NULL CHECK (correction_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  complaint_id text NOT NULL,
  evidence_id text NOT NULL,
  previous_snapshot_hash char(64) NOT NULL CHECK (previous_snapshot_hash ~ '^[a-f0-9]{64}$'),
  next_snapshot_hash char(64) NOT NULL CHECK (next_snapshot_hash ~ '^[a-f0-9]{64}$'),
  correction_snapshot jsonb NOT NULL CHECK (jsonb_typeof(correction_snapshot) = 'object'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, correction_id),
  FOREIGN KEY (workspace_id, complaint_id)
    REFERENCES appsea.complaint_observations(workspace_id, complaint_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES appsea.evidence_records(workspace_id, evidence_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, complaint_id, next_snapshot_hash),
  CHECK (previous_snapshot_hash <> next_snapshot_hash)
);

CREATE INDEX complaint_analysis_corrections_complaint_idx
  ON appsea.complaint_analysis_corrections (workspace_id, complaint_id, created_at DESC);

ALTER TABLE appsea.complaint_analysis_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.complaint_analysis_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.complaint_analysis_corrections
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.complaint_analysis_corrections FROM PUBLIC, appsea_service;

-- Preserve the original review transitions and add the corrected state. The
-- correction function below writes the hash-bearing history row and the
-- derived snapshot in one transaction; this trigger keeps direct review-state
-- writes subject to the same editor/owner and active-evidence checks.
CREATE OR REPLACE FUNCTION appsea.enforce_complaint_review_transition_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  actor_role text;
  event_action text;
  event_id text;
  payload jsonb;
BEGIN
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    RETURN NEW;
  END IF;

  IF NEW.review_state IS NOT DISTINCT FROM OLD.review_state THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.evidence_records evidence
      JOIN appsea.source_items source_item
        ON source_item.workspace_id = evidence.workspace_id
       AND source_item.source_item_id = evidence.source_item_id
     WHERE evidence.workspace_id = NEW.workspace_id
       AND evidence.evidence_id = NEW.evidence_id
       AND evidence.deletion_state = 'active'
       AND source_item.deletion_state = 'active'
  ) THEN
    RAISE EXCEPTION 'deleted complaint evidence cannot be reviewed'
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'complaint review requires an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.review_state = 'unreviewed'
     AND NEW.review_state IN ('confirmed', 'rejected') THEN
    event_action := CASE NEW.review_state
      WHEN 'confirmed' THEN 'complaint.review.confirmed'
      ELSE 'complaint.review.rejected'
    END;
  ELSIF OLD.review_state IN ('confirmed', 'corrected') AND NEW.review_state = 'rejected' THEN
    event_action := 'complaint.review.rejected';
  ELSIF NEW.review_state = 'corrected'
        AND OLD.review_state IN ('unreviewed', 'confirmed', 'corrected') THEN
    IF NEW.analysis_snapshot IS NOT DISTINCT FROM OLD.analysis_snapshot THEN
      RAISE EXCEPTION 'complaint correction requires a changed analysis snapshot'
        USING ERRCODE = '23514';
    END IF;
    event_action := 'complaint.review.corrected';
  ELSE
    RAISE EXCEPTION 'complaint review transition is not permitted'
      USING ERRCODE = '23514';
  END IF;

  event_id := 'complaint-review:' || md5(
    concat_ws(
      ':',
      NEW.workspace_id,
      NEW.complaint_id,
      OLD.review_state,
      NEW.review_state,
      txid_current()::text
    )
  );
  payload := jsonb_build_object(
    'workspaceId', NEW.workspace_id,
    'complaintId', NEW.complaint_id,
    'evidenceId', NEW.evidence_id,
    'previousState', OLD.review_state,
    'nextState', NEW.review_state
  );

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (NEW.workspace_id, 'audit:' || event_id, 'user', actor_id, event_action,
     'complaint_observation', NEW.complaint_id, event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (NEW.workspace_id, 'outbox:' || event_id, event_action, 'complaint_observation',
     NEW.complaint_id, 'complaint-review-v2', event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS complaint_review_transition_guard ON appsea.complaint_observations;
CREATE TRIGGER complaint_review_transition_guard
BEFORE UPDATE OF review_state ON appsea.complaint_observations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_complaint_review_transition_v2();

REVOKE ALL ON FUNCTION appsea.enforce_complaint_review_transition_v2() FROM PUBLIC;

CREATE OR REPLACE FUNCTION appsea.apply_complaint_analysis_correction(
  p_workspace_id text,
  p_complaint_id text,
  p_correction_id text,
  p_previous_snapshot_hash char(64),
  p_next_snapshot_hash char(64),
  p_next_snapshot jsonb
)
RETURNS TABLE (
  review_state text,
  invalidated_analysis_count integer,
  invalidated_opportunity_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  actor_role text;
  complaint_row record;
  existing_correction record;
  correction_reason text;
  analysis_count integer := 0;
  opportunity_count integer := 0;
BEGIN
  IF p_workspace_id IS DISTINCT FROM NULLIF(current_setting('appsea.workspace_id', true), '') THEN
    RAISE EXCEPTION 'complaint correction workspace context is invalid'
      USING ERRCODE = '42501';
  END IF;
  actor_id := NULLIF(current_setting('appsea.auth_user_id', true), '');
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'complaint correction requires an authenticated actor'
      USING ERRCODE = '42501';
  END IF;
  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
    JOIN appsea.workspaces workspace
      ON workspace.workspace_id = membership.workspace_id
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = actor_id
     AND workspace.status = 'active';
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'complaint correction requires an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;
  IF p_correction_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_complaint_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_previous_snapshot_hash !~ '^[a-f0-9]{64}$'
     OR p_next_snapshot_hash !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(p_next_snapshot) <> 'object'
     OR p_next_snapshot->>'complaintId' IS DISTINCT FROM p_complaint_id
     OR p_next_snapshot->>'reviewState' IS DISTINCT FROM 'corrected'
     OR p_next_snapshot->>'extractionVersion' IS DISTINCT FROM 'complaint-analysis-correction-v1'
     OR p_next_snapshot->'derivation'->>'modelVersion' IS DISTINCT FROM 'human-correction-v1' THEN
    RAISE EXCEPTION 'complaint correction input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT correction.correction_id, correction.complaint_id, correction.evidence_id,
         correction.previous_snapshot_hash, correction.next_snapshot_hash
    INTO existing_correction
    FROM appsea.complaint_analysis_corrections correction
   WHERE correction.workspace_id = p_workspace_id
     AND correction.correction_id = p_correction_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_correction.complaint_id <> p_complaint_id
       OR existing_correction.next_snapshot_hash <> p_next_snapshot_hash
       OR (
         p_previous_snapshot_hash <> existing_correction.previous_snapshot_hash
         AND p_previous_snapshot_hash <> existing_correction.next_snapshot_hash
       ) THEN
      RAISE EXCEPTION 'complaint correction id conflicts with an existing correction'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT 'corrected'::text, 0, 0;
    RETURN;
  END IF;
  IF p_previous_snapshot_hash = p_next_snapshot_hash THEN
    RAISE EXCEPTION 'complaint correction must change the derived analysis'
      USING ERRCODE = '22023';
  END IF;

  SELECT complaint.complaint_id, complaint.evidence_id, complaint.review_state,
         evidence.deletion_state AS evidence_state,
         source_item.deletion_state AS source_state
    INTO complaint_row
    FROM appsea.complaint_observations complaint
    JOIN appsea.evidence_records evidence
      ON evidence.workspace_id = complaint.workspace_id
     AND evidence.evidence_id = complaint.evidence_id
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = evidence.workspace_id
     AND source_item.source_item_id = evidence.source_item_id
   WHERE complaint.workspace_id = p_workspace_id
     AND complaint.complaint_id = p_complaint_id
   FOR UPDATE OF complaint;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'complaint correction target was not found'
      USING ERRCODE = '23503';
  END IF;
  IF complaint_row.complaint_id IS NULL
     OR complaint_row.evidence_state <> 'active'
     OR complaint_row.source_state <> 'active' THEN
    RAISE EXCEPTION 'complaint correction evidence is not active'
      USING ERRCODE = '23514';
  END IF;
  IF complaint_row.review_state = 'rejected' THEN
    RAISE EXCEPTION 'rejected complaints cannot be corrected'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO appsea.complaint_analysis_corrections
    (workspace_id, correction_id, complaint_id, evidence_id,
     previous_snapshot_hash, next_snapshot_hash, correction_snapshot,
     actor_id, created_at)
  VALUES
    (p_workspace_id, p_correction_id, p_complaint_id, complaint_row.evidence_id,
     p_previous_snapshot_hash, p_next_snapshot_hash, p_next_snapshot,
     actor_id, clock_timestamp());

  UPDATE appsea.complaint_observations
     SET review_state = 'corrected',
         analysis_snapshot = p_next_snapshot
   WHERE workspace_id = p_workspace_id
     AND complaint_id = p_complaint_id;

  correction_reason := 'Complaint analysis correction ' || p_correction_id;
  UPDATE appsea.production_analysis_runs analysis
     SET availability_state = 'invalidated',
         invalidated_at = clock_timestamp(),
         invalidation_reason = correction_reason
   WHERE analysis.workspace_id = p_workspace_id
     AND analysis.availability_state = 'active'
     AND EXISTS (
       SELECT 1
         FROM appsea.research_analysis_run_evidence analysis_evidence
        WHERE analysis_evidence.workspace_id = analysis.workspace_id
          AND analysis_evidence.analysis_run_id = analysis.analysis_run_id
          AND analysis_evidence.complaint_id = p_complaint_id
     );
  GET DIAGNOSTICS analysis_count = ROW_COUNT;

  WITH invalidated AS (
    SELECT DISTINCT output.opportunity_id
      FROM appsea.research_analysis_run_outputs output
      JOIN appsea.production_analysis_runs analysis
        ON analysis.workspace_id = output.workspace_id
       AND analysis.analysis_run_id = output.analysis_run_id
     WHERE output.workspace_id = p_workspace_id
       AND analysis.availability_state = 'invalidated'
       AND analysis.invalidation_reason = correction_reason
  )
  UPDATE appsea.opportunities opportunity
     SET availability_state = 'invalidated',
         invalidated_at = clock_timestamp(),
         invalidation_reason = correction_reason,
         current_score_snapshot_id = NULL,
         current_plan_package_id = NULL,
         updated_at = clock_timestamp()
    FROM invalidated
   WHERE opportunity.workspace_id = p_workspace_id
     AND opportunity.opportunity_id = invalidated.opportunity_id
     AND opportunity.availability_state = 'active'
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.research_analysis_run_outputs active_output
         JOIN appsea.production_analysis_runs active_analysis
           ON active_analysis.workspace_id = active_output.workspace_id
          AND active_analysis.analysis_run_id = active_output.analysis_run_id
        WHERE active_output.workspace_id = opportunity.workspace_id
          AND active_output.opportunity_id = opportunity.opportunity_id
          AND active_analysis.state = 'completed'
          AND active_analysis.availability_state = 'active'
     );
  GET DIAGNOSTICS opportunity_count = ROW_COUNT;

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id,
     'audit:complaint-analysis-correction:' || md5(p_workspace_id || ':' || p_correction_id),
     'user', actor_id, 'complaint.analysis.corrected', 'complaint_observation',
     p_complaint_id, p_correction_id,
     jsonb_build_object(
       'correctionId', p_correction_id,
       'previousSnapshotHash', p_previous_snapshot_hash,
       'nextSnapshotHash', p_next_snapshot_hash,
       'invalidatedAnalysisCount', analysis_count,
       'invalidatedOpportunityCount', opportunity_count
     ),
     clock_timestamp())
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (p_workspace_id,
     'outbox:complaint-analysis-correction:' || md5(p_workspace_id || ':' || p_correction_id),
     'complaint.analysis.corrected', 'complaint_observation', p_complaint_id,
     'complaint-analysis-correction-v1', p_correction_id,
     jsonb_build_object(
       'workspaceId', p_workspace_id,
       'complaintId', p_complaint_id,
       'correctionId', p_correction_id,
       'nextSnapshotHash', p_next_snapshot_hash,
       'invalidatedAnalysisCount', analysis_count,
       'invalidatedOpportunityCount', opportunity_count
     ),
     clock_timestamp())
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT 'corrected'::text, analysis_count, opportunity_count;
END
$$;

REVOKE ALL ON FUNCTION appsea.apply_complaint_analysis_correction(
  text, text, text, char(64), char(64), jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.apply_complaint_analysis_correction(
  text, text, text, char(64), char(64), jsonb
) TO appsea_service;

COMMENT ON TABLE appsea.complaint_analysis_corrections IS
  'Immutable editor/owner corrections to derived complaint analysis; source evidence and provenance remain unchanged.';

COMMIT;
