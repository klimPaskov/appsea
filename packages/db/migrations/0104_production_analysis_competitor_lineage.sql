BEGIN;

-- A production analysis may consume owner-import competitor/contrary claims,
-- but it must retain the exact confirmed observation provenance it used.  The
-- rows are append-only and deliberately retain the observation hash after a
-- source item or evidence record is deleted or a claim is rejected.  A later
-- read therefore reports a stale lineage instead of silently rewriting the
-- analysis history.
CREATE TABLE appsea.research_analysis_run_competitor_observations (
  workspace_id text NOT NULL,
  analysis_run_id text NOT NULL,
  opportunity_id text NOT NULL,
  observation_id text NOT NULL,
  competitor_id text NOT NULL,
  source_id text NOT NULL CHECK (source_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  source_record_id text NOT NULL CHECK (char_length(source_record_id) BETWEEN 1 AND 240),
  source_item_id text NOT NULL,
  evidence_id text NOT NULL,
  observation_content_hash char(64) NOT NULL CHECK (observation_content_hash ~ '^[a-f0-9]{64}$'),
  evidence_content_hash char(64) NOT NULL CHECK (evidence_content_hash ~ '^[a-f0-9]{64}$'),
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, analysis_run_id, observation_id),
  FOREIGN KEY (workspace_id, analysis_run_id)
    REFERENCES appsea.production_analysis_runs(workspace_id, analysis_run_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, observation_id)
    REFERENCES appsea.competitor_research_observations(workspace_id, observation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, opportunity_id, competitor_id)
    REFERENCES appsea.opportunity_competitors(workspace_id, opportunity_id, competitor_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_item_id)
    REFERENCES appsea.source_items(workspace_id, source_item_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES appsea.evidence_records(workspace_id, evidence_id)
    ON DELETE RESTRICT,
  CHECK (linked_at IS NOT NULL)
);

CREATE INDEX research_analysis_run_competitor_observations_snapshot_idx
  ON appsea.research_analysis_run_competitor_observations
     (workspace_id, analysis_run_id, opportunity_id, observation_id);
CREATE INDEX research_analysis_run_competitor_observations_observation_idx
  ON appsea.research_analysis_run_competitor_observations
     (workspace_id, observation_id, observation_content_hash);

ALTER TABLE appsea.research_analysis_run_competitor_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.research_analysis_run_competitor_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.research_analysis_run_competitor_observations
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

CREATE OR REPLACE FUNCTION appsea.enforce_production_analysis_competitor_observation_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  analysis_row record;
  observation_row record;
  policy_ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'production analysis competitor observation lineage is immutable'
      USING ERRCODE = '42501';
  END IF;

  SELECT analysis.collection_run_id,
         analysis.opportunity_id,
         analysis.state,
         analysis.availability_state
    INTO analysis_row
    FROM appsea.production_analysis_runs analysis
   WHERE analysis.workspace_id = NEW.workspace_id
     AND analysis.analysis_run_id = NEW.analysis_run_id;

  IF analysis_row.collection_run_id IS NULL
     OR analysis_row.collection_run_id = ''
     OR analysis_row.collection_run_id IS DISTINCT FROM (
       SELECT run_id
         FROM appsea.research_run_opportunities
        WHERE workspace_id = NEW.workspace_id
          AND run_id = analysis_row.collection_run_id
          AND opportunity_id = NEW.opportunity_id
        LIMIT 1
     ) THEN
    -- The opportunity is linked by the analysis transaction immediately before
    -- this table is written.  Keep this check database-owned and fail closed if
    -- a caller tries to wire a different workspace/run/opportunity.
    RAISE EXCEPTION 'production analysis competitor observation collection lineage is missing'
      USING ERRCODE = '42501';
  END IF;
  IF analysis_row.opportunity_id IS NOT NULL
     AND analysis_row.opportunity_id <> NEW.opportunity_id THEN
    RAISE EXCEPTION 'production analysis competitor observation opportunity conflicts with run'
      USING ERRCODE = '42501';
  END IF;
  IF analysis_row.state IN ('failed', 'canceled')
     OR analysis_row.availability_state <> 'active' THEN
    RAISE EXCEPTION 'production analysis competitor observation cannot link to an unavailable run'
      USING ERRCODE = '42501';
  END IF;

  SELECT observation.observation_id,
         observation.opportunity_id,
         observation.competitor_id,
         observation.source_id,
         observation.source_record_id,
         observation.source_item_id,
         observation.evidence_id,
         observation.content_hash,
         evidence.content_hash AS evidence_content_hash,
         observation.review_state,
         observation.synthetic,
         source_item.source_policy_version,
         source_item.collection_purpose,
         source_item.deletion_state AS source_item_deletion_state,
         evidence.deletion_state AS evidence_deletion_state,
         evidence.source_item_id AS evidence_source_item_id,
         evidence.synthetic AS evidence_synthetic,
         evidence.allowed_representation AS evidence_representation,
         source_item.requested_display_mode,
         competitor.synthetic AS competitor_synthetic
    INTO observation_row
    FROM appsea.competitor_research_observations observation
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = observation.workspace_id
     AND source_item.source_item_id = observation.source_item_id
    JOIN appsea.evidence_records evidence
      ON evidence.workspace_id = observation.workspace_id
     AND evidence.evidence_id = observation.evidence_id
    JOIN appsea.opportunity_competitors relation
      ON relation.workspace_id = observation.workspace_id
     AND relation.opportunity_id = observation.opportunity_id
     AND relation.competitor_id = observation.competitor_id
    JOIN appsea.competitors competitor
      ON competitor.workspace_id = relation.workspace_id
     AND competitor.competitor_id = relation.competitor_id
   WHERE observation.workspace_id = NEW.workspace_id
     AND observation.observation_id = NEW.observation_id;

  IF observation_row.observation_id IS NULL THEN
    RAISE EXCEPTION 'production analysis competitor observation was not found'
      USING ERRCODE = '23503';
  END IF;
  IF observation_row.opportunity_id <> NEW.opportunity_id
     OR observation_row.competitor_id <> NEW.competitor_id
     OR observation_row.source_id <> NEW.source_id
     OR observation_row.source_record_id <> NEW.source_record_id
     OR observation_row.source_item_id <> NEW.source_item_id
     OR observation_row.evidence_id <> NEW.evidence_id
     OR observation_row.content_hash <> NEW.observation_content_hash
     OR observation_row.evidence_content_hash <> NEW.evidence_content_hash THEN
    RAISE EXCEPTION 'production analysis competitor observation provenance does not match'
      USING ERRCODE = '42501';
  END IF;
  IF observation_row.review_state <> 'confirmed'
     OR observation_row.synthetic
     OR observation_row.competitor_synthetic
     OR observation_row.source_item_deletion_state <> 'active'
     OR observation_row.evidence_deletion_state <> 'active'
     OR observation_row.evidence_source_item_id <> NEW.source_item_id
     OR observation_row.evidence_synthetic
     OR observation_row.evidence_representation <> observation_row.requested_display_mode THEN
    RAISE EXCEPTION 'production analysis competitor observation is not confirmed and active'
      USING ERRCODE = '42501';
  END IF;
  IF observation_row.collection_purpose NOT IN ('competitor-research', 'contrary-evidence') THEN
    RAISE EXCEPTION 'production analysis competitor observation purpose is not permitted'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.research_run_source_items run_item
      JOIN appsea.research_run_source_policies run_policy
        ON run_policy.workspace_id = run_item.workspace_id
       AND run_policy.run_id = run_item.run_id
       AND run_policy.source_id = run_item.source_id
       AND run_policy.policy_version = run_item.source_policy_version
     WHERE run_item.workspace_id = NEW.workspace_id
       AND run_item.run_id = analysis_row.collection_run_id
       AND run_item.source_item_id = NEW.source_item_id
       AND run_item.source_id = NEW.source_id
  ) THEN
    RAISE EXCEPTION 'production analysis competitor observation source is not in collection lineage'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM appsea.source_policy_versions policy
      JOIN appsea.sources source
        ON source.source_id = policy.source_id
      JOIN appsea.source_policy_reviews review
        ON review.source_id = policy.source_id
       AND review.policy_version = policy.policy_version
       AND review.content_hash = policy.content_hash
       AND review.decision = 'approved'
       AND review.independence_attested
       AND review.reviewer_role <> 'legacy'
     WHERE policy.source_id = NEW.source_id
       AND policy.policy_version = observation_row.source_policy_version
       AND policy.policy_state = 'approved'
       AND policy.commercial_use IN ('allowed', 'restricted')
       AND policy.reviewed_at IS NOT NULL
       AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
       AND source.lifecycle_state = 'active'
       AND source.current_policy_version = policy.policy_version
       AND source.source_type <> 'fixture'
       AND observation_row.collection_purpose = ANY(policy.permitted_purposes)
  ) INTO policy_ok;
  IF policy_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'production analysis competitor observation source policy is stale or unapproved'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_competitor_observation_lineage_guard
BEFORE INSERT OR UPDATE ON appsea.research_analysis_run_competitor_observations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_analysis_competitor_observation_lineage();

REVOKE ALL ON appsea.research_analysis_run_competitor_observations FROM PUBLIC, appsea_service;
GRANT SELECT, INSERT ON appsea.research_analysis_run_competitor_observations TO appsea_service;
REVOKE ALL ON FUNCTION appsea.enforce_production_analysis_competitor_observation_lineage() FROM PUBLIC;

COMMENT ON TABLE appsea.research_analysis_run_competitor_observations IS
  'Append-only confirmed non-synthetic competitor/contrary observation lineage for production analyses; retained hashes make source deletion or review rejection observable as stale.';

-- Rejecting a consumed observation must make the current output unavailable
-- immediately. A later explicit reviewed analysis may rebuild from the
-- remaining confirmed snapshot; this trigger never starts work autonomously.
CREATE OR REPLACE FUNCTION appsea.invalidate_competitive_observation_analysis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  reason text;
  actor_id text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.review_state <> 'rejected'
     AND NEW.review_state = 'rejected' THEN
    reason := 'Competitive observation rejection ' || NEW.observation_id;
    UPDATE appsea.production_analysis_runs analysis
       SET availability_state = 'invalidated',
           invalidated_at = clock_timestamp(),
           invalidation_reason = reason
     WHERE analysis.workspace_id = NEW.workspace_id
       AND analysis.availability_state = 'active'
       AND EXISTS (
         SELECT 1
           FROM appsea.research_analysis_run_competitor_observations lineage
          WHERE lineage.workspace_id = analysis.workspace_id
            AND lineage.analysis_run_id = analysis.analysis_run_id
            AND lineage.observation_id = NEW.observation_id
       );

    UPDATE appsea.opportunities opportunity
       SET availability_state = 'invalidated',
           invalidated_at = clock_timestamp(),
           invalidation_reason = reason,
           current_score_snapshot_id = NULL,
           current_plan_package_id = NULL,
           updated_at = clock_timestamp()
     WHERE opportunity.workspace_id = NEW.workspace_id
       AND opportunity.availability_state = 'active'
       AND EXISTS (
         SELECT 1
           FROM appsea.research_analysis_run_outputs output
           JOIN appsea.production_analysis_runs analysis
             ON analysis.workspace_id = output.workspace_id
            AND analysis.analysis_run_id = output.analysis_run_id
          WHERE output.workspace_id = opportunity.workspace_id
            AND output.opportunity_id = opportunity.opportunity_id
            AND analysis.availability_state = 'invalidated'
            AND analysis.invalidation_reason = reason
       )
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

    actor_id := NULLIF(current_setting('appsea.auth_user_id', true), '');
    IF actor_id IS NOT NULL THEN
      INSERT INTO appsea.audit_events
        (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
         target_id, correlation_id, metadata, occurred_at)
      VALUES
        (NEW.workspace_id,
         'audit:competitor-review:' || md5(concat_ws(':', NEW.workspace_id, NEW.observation_id, txid_current()::text)),
         'user', actor_id, 'competitor_observation.review.rejected',
         'competitor_research_observation', NEW.observation_id,
         'competitor-review:' || md5(concat_ws(':', NEW.workspace_id, NEW.observation_id, txid_current()::text)),
         jsonb_build_object('workspaceId', NEW.workspace_id, 'observationId', NEW.observation_id,
                            'opportunityId', NEW.opportunity_id, 'nextState', NEW.review_state),
         clock_timestamp())
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER competitor_observation_analysis_invalidation
AFTER UPDATE OF review_state ON appsea.competitor_research_observations
FOR EACH ROW EXECUTE FUNCTION appsea.invalidate_competitive_observation_analysis();

REVOKE ALL ON FUNCTION appsea.invalidate_competitive_observation_analysis() FROM PUBLIC;

COMMIT;
