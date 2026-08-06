-- Re-evaluate completed production outputs when the current source policy is
-- no longer collectible. Policy decay is deliberately non-destructive: an
-- expired analysis remains retained for audit/review and is not sent through
-- the source-deletion object purge trigger. A later source deletion still
-- transitions it to invalidated through the normal destructive path.

CREATE INDEX IF NOT EXISTS research_analysis_run_source_policies_policy_idx
  ON appsea.research_analysis_run_source_policies
     (workspace_id, source_id, policy_version, analysis_run_id);

CREATE OR REPLACE FUNCTION appsea.production_analysis_policies_collectible(
  p_workspace_id text,
  p_analysis_run_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM appsea.research_analysis_run_source_policies lineage
      JOIN appsea.sources source
        ON source.source_id = lineage.source_id
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = lineage.source_id
       AND policy.policy_version = lineage.policy_version
     WHERE lineage.workspace_id = p_workspace_id
       AND lineage.analysis_run_id = p_analysis_run_id
       AND source.source_type <> 'fixture'
       AND (
         source.lifecycle_state <> 'active'
         OR source.current_policy_version IS DISTINCT FROM lineage.policy_version
         OR policy.policy_state <> 'approved'
         OR policy.reviewed_at IS NULL
         OR policy.commercial_use NOT IN ('allowed', 'restricted')
         OR (policy.expires_at IS NOT NULL AND policy.expires_at <= clock_timestamp())
         OR policy.content_hash <> lineage.policy_content_hash
         OR policy.display_mode = 'fixture'
         OR NOT appsea.source_policy_has_complete_reviews(
           policy.source_id, policy.policy_version, policy.content_hash
         )
       )
  )
$$;

CREATE OR REPLACE FUNCTION appsea.source_policy_output_impact_reason(
  p_workspace_id text,
  p_analysis_run_id text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN source.lifecycle_state <> 'active' THEN 'source_policy_source_disabled'
      WHEN source.current_policy_version IS DISTINCT FROM lineage.policy_version
        THEN 'source_policy_version_changed'
      WHEN policy.policy_state <> 'approved'
        THEN 'source_policy_state_' || policy.policy_state
      WHEN policy.reviewed_at IS NULL THEN 'source_policy_review_incomplete'
      WHEN policy.commercial_use NOT IN ('allowed', 'restricted')
        THEN 'source_policy_commercial_use_blocked'
      WHEN policy.expires_at IS NOT NULL AND policy.expires_at <= clock_timestamp()
        THEN 'source_policy_expired'
      WHEN policy.content_hash <> lineage.policy_content_hash
        THEN 'source_policy_content_changed'
      WHEN policy.display_mode = 'fixture' THEN 'source_policy_display_mode_blocked'
      WHEN NOT appsea.source_policy_has_complete_reviews(
        policy.source_id, policy.policy_version, policy.content_hash
      ) THEN 'source_policy_review_incomplete'
      ELSE 'source_policy_collectibility_failed'
    END
      FROM appsea.research_analysis_run_source_policies lineage
      JOIN appsea.sources source
        ON source.source_id = lineage.source_id
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = lineage.source_id
       AND policy.policy_version = lineage.policy_version
     WHERE lineage.workspace_id = p_workspace_id
       AND lineage.analysis_run_id = p_analysis_run_id
       AND source.source_type <> 'fixture'
       AND (
         source.lifecycle_state <> 'active'
         OR source.current_policy_version IS DISTINCT FROM lineage.policy_version
         OR policy.policy_state <> 'approved'
         OR policy.reviewed_at IS NULL
         OR policy.commercial_use NOT IN ('allowed', 'restricted')
         OR (policy.expires_at IS NOT NULL AND policy.expires_at <= clock_timestamp())
         OR policy.content_hash <> lineage.policy_content_hash
         OR policy.display_mode = 'fixture'
         OR NOT appsea.source_policy_has_complete_reviews(
           policy.source_id, policy.policy_version, policy.content_hash
         )
       )
     ORDER BY lineage.source_id, lineage.policy_version
     LIMIT 1
  ), 'source_policy_collectibility_failed')
$$;

CREATE OR REPLACE FUNCTION appsea.expire_source_policy_impacted_outputs(
  p_workspace_id text,
  p_limit integer
)
RETURNS TABLE (
  analysis_runs_expired integer,
  opportunities_invalidated integer,
  opportunities_repointed integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  candidate record;
  replacement record;
  opportunity_row record;
  reason text;
  opportunity_invalidated boolean := false;
  invalidated_count integer := 0;
  repointed_count integer := 0;
BEGIN
  IF session_user <> 'appsea_service'
     OR current_workspace IS NULL
     OR current_workspace IS DISTINCT FROM p_workspace_id
     OR p_workspace_id IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 1000 THEN
    RAISE EXCEPTION 'invalid source policy output impact request'
      USING ERRCODE = '42501';
  END IF;

  FOR candidate IN
    SELECT analysis.workspace_id, analysis.analysis_run_id, analysis.opportunity_id
      FROM appsea.production_analysis_runs analysis
     WHERE analysis.workspace_id = p_workspace_id
       AND analysis.state = 'completed'
       AND analysis.availability_state = 'active'
       AND NOT appsea.production_analysis_policies_collectible(
         analysis.workspace_id, analysis.analysis_run_id
       )
     ORDER BY analysis.completed_at ASC NULLS FIRST, analysis.analysis_run_id ASC
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    opportunity_invalidated := false;
    -- Re-check after locking the run so a concurrent policy re-approval or
    -- finalization cannot be mistaken for a stale output.
    IF appsea.production_analysis_policies_collectible(
      candidate.workspace_id, candidate.analysis_run_id
    ) THEN
      CONTINUE;
    END IF;

    reason := appsea.source_policy_output_impact_reason(
      candidate.workspace_id, candidate.analysis_run_id
    );

    UPDATE appsea.production_analysis_runs
       SET availability_state = 'expired',
           invalidated_at = clock_timestamp(),
           invalidation_reason = 'policy-impact:' || reason
     WHERE workspace_id = candidate.workspace_id
       AND analysis_run_id = candidate.analysis_run_id
       AND state = 'completed'
       AND availability_state = 'active';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    analysis_runs_expired := COALESCE(analysis_runs_expired, 0) + 1;

    IF candidate.opportunity_id IS NOT NULL THEN
      SELECT opportunity.workspace_id, opportunity.opportunity_id,
             opportunity.availability_state
        INTO opportunity_row
        FROM appsea.opportunities opportunity
       WHERE opportunity.workspace_id = candidate.workspace_id
         AND opportunity.opportunity_id = candidate.opportunity_id
       FOR UPDATE;
      IF FOUND AND opportunity_row.availability_state = 'active' THEN
        SELECT output.score_snapshot_id, output.plan_package_id
          INTO replacement
          FROM appsea.research_analysis_run_outputs output
          JOIN appsea.production_analysis_runs replacement_analysis
            ON replacement_analysis.workspace_id = output.workspace_id
           AND replacement_analysis.analysis_run_id = output.analysis_run_id
         WHERE output.workspace_id = candidate.workspace_id
           AND output.opportunity_id = candidate.opportunity_id
           AND replacement_analysis.state = 'completed'
           AND replacement_analysis.availability_state = 'active'
           AND appsea.production_analysis_policies_collectible(
             replacement_analysis.workspace_id, replacement_analysis.analysis_run_id
           )
         ORDER BY replacement_analysis.completed_at DESC NULLS LAST,
                  replacement_analysis.analysis_run_id DESC
         LIMIT 1;

        IF FOUND THEN
          UPDATE appsea.opportunities
             SET current_score_snapshot_id = replacement.score_snapshot_id,
                 current_plan_package_id = replacement.plan_package_id,
                 updated_at = clock_timestamp()
           WHERE workspace_id = candidate.workspace_id
             AND opportunity_id = candidate.opportunity_id
             AND availability_state = 'active'
             AND (
               current_score_snapshot_id IS DISTINCT FROM replacement.score_snapshot_id
               OR current_plan_package_id IS DISTINCT FROM replacement.plan_package_id
             );
          IF FOUND THEN
            repointed_count := repointed_count + 1;
          END IF;
        ELSE
          UPDATE appsea.opportunities
             SET availability_state = 'invalidated',
                 invalidated_at = clock_timestamp(),
                 invalidation_reason = 'policy-impact:' || reason,
                 current_score_snapshot_id = NULL,
                 current_plan_package_id = NULL,
                 updated_at = clock_timestamp()
           WHERE workspace_id = candidate.workspace_id
             AND opportunity_id = candidate.opportunity_id
             AND availability_state = 'active';
          IF FOUND THEN
            invalidated_count := invalidated_count + 1;
            opportunity_invalidated := true;
          END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO appsea.audit_events
      (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
       target_id, correlation_id, metadata, occurred_at)
    VALUES
      (candidate.workspace_id,
       'audit:source-policy-impact:' || md5(candidate.workspace_id || ':' || candidate.analysis_run_id),
       'system', 'source-policy-maintenance', 'research.analysis.policy_expired',
       'production_analysis_run', candidate.analysis_run_id,
       'source-policy-impact:' || md5(candidate.workspace_id || ':' || candidate.analysis_run_id),
       jsonb_build_object(
         'analysisRunId', candidate.analysis_run_id,
         'opportunityId', candidate.opportunity_id,
         'reason', reason,
         'opportunityInvalidated', opportunity_invalidated
       ),
       clock_timestamp())
    ON CONFLICT DO NOTHING;

    INSERT INTO appsea.outbox_events
      (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
       schema_version, correlation_id, payload, occurred_at)
    VALUES
      (candidate.workspace_id,
       'outbox:source-policy-impact:' || md5(candidate.workspace_id || ':' || candidate.analysis_run_id),
       'research.analysis.policy_expired', 'production_analysis_run',
       candidate.analysis_run_id, 'source-policy-impact-v1',
       'source-policy-impact:' || md5(candidate.workspace_id || ':' || candidate.analysis_run_id),
       jsonb_build_object(
         'workspaceId', candidate.workspace_id,
         'analysisRunId', candidate.analysis_run_id,
         'opportunityId', candidate.opportunity_id,
         'reason', reason
       ),
       clock_timestamp())
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN QUERY SELECT COALESCE(analysis_runs_expired, 0), invalidated_count, repointed_count;
END
$$;

REVOKE ALL ON FUNCTION appsea.production_analysis_policies_collectible(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.source_policy_output_impact_reason(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.expire_source_policy_impacted_outputs(text, integer)
  FROM PUBLIC, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.production_analysis_policies_collectible(text, text)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.source_policy_output_impact_reason(text, text)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.expire_source_policy_impacted_outputs(text, integer)
  TO appsea_service;

COMMENT ON FUNCTION appsea.production_analysis_policies_collectible(text, text) IS
  'Returns the current fail-closed collectibility state for immutable production analysis policy lineage; fixture lineage is exempt.';
COMMENT ON FUNCTION appsea.expire_source_policy_impacted_outputs(text, integer) IS
  'Bounded fenced maintenance projection for policy decay; expires retained analysis outputs, repairs active opportunity pointers, and never purges objects.';
