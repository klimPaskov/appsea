BEGIN;

-- Expose only the bounded scalar source-health observations needed by the
-- maintenance alert scan. The function is intentionally maintenance-only:
-- authenticated source-registry reads continue through the workspace RLS
-- projection, while this cross-workspace read cannot become a general source
-- payload or policy export.
CREATE OR REPLACE FUNCTION appsea.read_source_health_alert_observations(
  p_workspace_id text,
  p_limit integer
)
RETURNS TABLE (
  source_id text,
  collectible boolean,
  health_state text,
  health_last_attempt_at timestamptz,
  freshness_state text,
  freshness_age_hours integer,
  quota_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user <> 'appsea_maintenance' THEN
    RAISE EXCEPTION 'source health alert read requires the maintenance role'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid source health alert input' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspaces workspace
     WHERE workspace.workspace_id = p_workspace_id
       AND workspace.status = 'active'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT source.source_id,
           source.lifecycle_state,
           source.current_policy_version,
           policy.policy_version,
           policy.policy_state,
           policy.reviewed_at,
           policy.expires_at,
           policy.policy_payload,
           EXISTS (
             SELECT 1
               FROM appsea.source_policy_reviews review
              WHERE review.source_id = policy.source_id
                AND review.policy_version = policy.policy_version
                AND review.decision = 'approved'
                AND review.content_hash = policy.content_hash
                AND review.independence_attested
           ) AS independently_reviewed,
           health_job.state AS health_job_state,
           health_job.updated_at AS health_last_attempt_at,
           source_observation.last_observed_at,
           quota_window.request_count
      FROM appsea.sources source
      LEFT JOIN appsea.source_policy_versions policy
        ON policy.source_id = source.source_id
       AND policy.policy_version = source.current_policy_version
      LEFT JOIN LATERAL (
        SELECT job.state,
               job.updated_at
          FROM appsea.production_collection_workflow_jobs job
         WHERE job.workspace_id = p_workspace_id
           AND job.source_id = source.source_id
         ORDER BY job.updated_at DESC, job.workflow_id DESC
         LIMIT 1
      ) health_job ON true
      LEFT JOIN LATERAL (
        SELECT MAX(item.captured_at) AS last_observed_at
          FROM appsea.source_items item
         WHERE item.workspace_id = p_workspace_id
           AND item.source_id = source.source_id
           AND item.deletion_state = 'active'
      ) source_observation ON true
      LEFT JOIN LATERAL (
        SELECT quota_window.request_count
          FROM appsea.source_quota_windows quota_window
         WHERE quota_window.source_id = source.source_id
           AND quota_window.policy_version = policy.policy_version
           AND quota_window.window_started_at = date_trunc('minute', clock_timestamp())
      ) quota_window ON true
     WHERE source.source_type <> 'fixture'
       AND source.lifecycle_state <> 'retired'
     ORDER BY source.source_id
     LIMIT p_limit
  ), policy_state AS (
    SELECT base.*,
           (
             base.lifecycle_state = 'active'
             AND base.policy_version = base.current_policy_version
             AND base.policy_state = 'approved'
             AND base.reviewed_at IS NOT NULL
             AND (base.expires_at IS NULL OR base.expires_at > clock_timestamp())
             AND base.independently_reviewed
           ) AS collectible,
           CASE
             WHEN base.last_observed_at IS NULL THEN NULL
             ELSE LEAST(
               87600,
               GREATEST(
                 0,
                 FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - base.last_observed_at)) / 3600)::integer
               )
             )
           END AS freshness_age_hours,
           CASE
             WHEN base.policy_payload #>> '{quota,requestsPerMinute}' ~ '^[0-9]+$'
               AND (base.policy_payload #>> '{quota,requestsPerMinute}')::numeric BETWEEN 1 AND 10000
               THEN (base.policy_payload #>> '{quota,requestsPerMinute}')::integer
             ELSE NULL
           END AS quota_limit,
           base.policy_payload #>> '{freshness,mode}' AS freshness_mode,
           CASE
             WHEN base.policy_payload #>> '{freshness,expectedIntervalHours}' ~ '^[0-9]+$'
               AND (base.policy_payload #>> '{freshness,expectedIntervalHours}')::numeric BETWEEN 1 AND 8760
               THEN (base.policy_payload #>> '{freshness,expectedIntervalHours}')::integer
             ELSE NULL
           END AS freshness_expected_hours,
           CASE
             WHEN base.policy_payload #>> '{freshness,allowedDelayHours}' ~ '^[0-9]+$'
               AND (base.policy_payload #>> '{freshness,allowedDelayHours}')::numeric BETWEEN 0 AND 8760
               THEN (base.policy_payload #>> '{freshness,allowedDelayHours}')::integer
             ELSE NULL
           END AS freshness_allowed_hours
      FROM base
  ), measured AS (
    SELECT policy_state.*,
           CASE
             WHEN policy_state.quota_limit IS NULL OR policy_state.request_count IS NULL THEN NULL
             ELSE LEAST(
               GREATEST(policy_state.request_count, 0),
               policy_state.quota_limit
             )
           END AS quota_used
      FROM policy_state
  ), derived AS (
    SELECT measured.*,
           CASE
             WHEN NOT measured.collectible THEN 'blocked'
             WHEN measured.health_job_state = 'completed'
               OR measured.last_observed_at IS NOT NULL THEN 'healthy'
             WHEN measured.health_job_state IS NOT NULL THEN 'degraded'
             ELSE 'unknown'
           END AS derived_health_state,
           CASE
             WHEN NOT measured.collectible THEN 'blocked'
             WHEN measured.freshness_mode = 'on_demand' THEN 'on_demand'
             WHEN measured.freshness_mode <> 'scheduled'
               OR measured.freshness_expected_hours IS NULL
               OR measured.freshness_allowed_hours IS NULL THEN 'unknown'
             WHEN measured.last_observed_at IS NULL
               OR measured.freshness_age_hours IS NULL THEN 'unknown'
             WHEN measured.freshness_age_hours <=
                  measured.freshness_expected_hours + measured.freshness_allowed_hours
               THEN 'fresh'
             ELSE 'stale'
           END AS derived_freshness_state,
           CASE
             WHEN NOT measured.collectible THEN 'blocked'
             WHEN measured.quota_limit IS NULL OR measured.quota_used IS NULL THEN 'unknown'
             WHEN measured.quota_limit - measured.quota_used = 0 THEN 'exhausted'
             WHEN measured.quota_limit - measured.quota_used <=
                  GREATEST(1, CEIL(measured.quota_limit * 0.1)::integer)
               THEN 'near_limit'
             ELSE 'available'
           END AS derived_quota_state
      FROM measured
  )
  SELECT derived.source_id,
         derived.collectible,
         derived.derived_health_state,
         derived.health_last_attempt_at,
         derived.derived_freshness_state,
         derived.freshness_age_hours,
         derived.derived_quota_state
    FROM derived;
END
$$;

REVOKE ALL ON FUNCTION appsea.read_source_health_alert_observations(text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.read_source_health_alert_observations(text, integer)
  TO appsea_maintenance;

COMMENT ON FUNCTION appsea.read_source_health_alert_observations(text, integer) IS
  'Returns bounded scalar source-health observations for the maintenance alert scan; never returns policy payloads, source text, or credentials.';

COMMIT;
