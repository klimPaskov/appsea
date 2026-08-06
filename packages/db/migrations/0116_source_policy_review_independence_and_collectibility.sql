-- Complete source-policy approval is a shared runtime invariant. A policy is
-- collectible only when every declared role has an independent, same-hash,
-- permission-backed approval and no identity is reused across roles.
CREATE OR REPLACE FUNCTION appsea.source_policy_has_complete_reviews(
  p_source_id text,
  p_policy_version text,
  p_content_hash text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  required_roles text[];
  permission_evidence_required boolean;
BEGIN
  IF p_source_id IS NULL OR p_policy_version IS NULL OR p_content_hash IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE((policy.policy_payload->>'permissionEvidenceRequired')::boolean, false)
    INTO permission_evidence_required
    FROM appsea.source_policy_versions policy
   WHERE policy.source_id = p_source_id
     AND policy.policy_version = p_policy_version
     AND policy.content_hash = p_content_hash;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  required_roles := appsea.source_policy_required_reviewer_roles(
    p_source_id, p_policy_version
  );

  IF EXISTS (
    SELECT 1
      FROM unnest(required_roles) AS required(role)
     WHERE NOT EXISTS (
       SELECT 1
         FROM appsea.source_policy_reviews review
        WHERE review.source_id = p_source_id
          AND review.policy_version = p_policy_version
          AND review.decision = 'approved'
          AND review.reviewer_role = required.role
          AND review.content_hash = p_content_hash
          AND review.independence_attested
          AND (
            permission_evidence_required = false
            OR NULLIF(trim(review.permission_evidence_reference), '') IS NOT NULL
          )
     )
  ) THEN
    RETURN false;
  END IF;

  -- A reviewer identity may attest one required role for this immutable
  -- policy snapshot, but cannot satisfy multiple independent roles.
  IF EXISTS (
    SELECT 1
      FROM appsea.source_policy_reviews first_review
      JOIN appsea.source_policy_reviews second_review
        ON second_review.source_id = first_review.source_id
       AND second_review.policy_version = first_review.policy_version
       AND second_review.content_hash = first_review.content_hash
       AND second_review.decision = 'approved'
       AND second_review.independence_attested
       AND second_review.reviewer_identity = first_review.reviewer_identity
       AND second_review.reviewer_role <> first_review.reviewer_role
       AND second_review.review_id <> first_review.review_id
     WHERE first_review.source_id = p_source_id
       AND first_review.policy_version = p_policy_version
       AND first_review.content_hash = p_content_hash
       AND first_review.decision = 'approved'
       AND first_review.independence_attested
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION appsea.source_policy_has_complete_reviews(text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.source_policy_has_complete_reviews(text, text, text)
  TO appsea_service, appsea_maintenance, appsea_migrator;

CREATE OR REPLACE FUNCTION appsea.enforce_source_policy_reviewer_independence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.decision <> 'approved'
     OR NEW.reviewer_role = 'legacy'
     OR NEW.reviewer_identity IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'source-policy-review:' || NEW.source_id || ':' || NEW.policy_version || ':' || NEW.content_hash,
    0
  ));

  IF EXISTS (
    SELECT 1
      FROM appsea.source_policy_reviews review
     WHERE review.source_id = NEW.source_id
       AND review.policy_version = NEW.policy_version
       AND review.content_hash = NEW.content_hash
       AND review.decision = 'approved'
       AND review.reviewer_identity = NEW.reviewer_identity
       AND review.reviewer_role <> NEW.reviewer_role
       AND review.review_id <> NEW.review_id
  ) THEN
    RAISE EXCEPTION 'source policy reviewer identity cannot approve multiple roles'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_source_policy_reviewer_independence() FROM PUBLIC;
DROP TRIGGER IF EXISTS source_policy_reviewer_independence_guard
  ON appsea.source_policy_reviews;
CREATE TRIGGER source_policy_reviewer_independence_guard
BEFORE INSERT OR UPDATE ON appsea.source_policy_reviews
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_policy_reviewer_independence();

-- Existing active rows may have been assembled before identity independence
-- was enforced. Fail closed while preserving the immutable review history.
UPDATE appsea.source_policy_versions policy
   SET policy_state = 'pending_review',
       reviewed_at = NULL
  FROM appsea.sources source
 WHERE source.source_id = policy.source_id
   AND source.current_policy_version = policy.policy_version
   AND source.source_type <> 'fixture'
   AND source.lifecycle_state = 'active'
   AND NOT appsea.source_policy_has_complete_reviews(
     policy.source_id, policy.policy_version, policy.content_hash
   );

UPDATE appsea.sources source
   SET lifecycle_state = 'disabled_pending_review',
       current_policy_version = NULL,
       updated_at = clock_timestamp()
 WHERE source.source_type <> 'fixture'
   AND source.lifecycle_state = 'active'
   AND source.current_policy_version IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM appsea.source_policy_versions policy
      WHERE policy.source_id = source.source_id
        AND policy.policy_version = source.current_policy_version
        AND NOT appsea.source_policy_has_complete_reviews(
          policy.source_id, policy.policy_version, policy.content_hash
        )
   );

COMMENT ON FUNCTION appsea.source_policy_has_complete_reviews(text, text, text) IS
  'Returns true only when every declared reviewer role has an independent same-hash approval with required permission evidence and distinct reviewer identities.';
COMMENT ON FUNCTION appsea.enforce_source_policy_reviewer_independence() IS
  'Rejects one reviewer identity approving multiple roles for the same immutable source-policy snapshot.';

-- Re-apply the bounded owner-import gate against the same shared invariant.
-- This keeps the tenant-private manual path from becoming a policy bypass if
-- its declared reviewer set is ever expanded.
CREATE OR REPLACE FUNCTION appsea.manual_import_source_policy_collectible(
  p_source_id text,
  p_policy_version text,
  p_purpose text,
  p_display_mode text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  matched_source_id text;
BEGIN
  IF p_source_id <> 'manual-owner-import'
     OR p_policy_version NOT IN ('manual-owner-import-v1', 'manual-owner-import-v2')
     OR p_purpose IS NULL
     OR p_display_mode IS NULL THEN
    RETURN false;
  END IF;

  SELECT source.source_id
    INTO matched_source_id
    FROM appsea.sources source
    JOIN appsea.source_policy_versions policy
      ON policy.source_id = source.source_id
     AND policy.policy_version = p_policy_version
   WHERE source.source_id = p_source_id
     AND source.source_type = 'manual'
     AND source.lifecycle_state = 'active'
     AND source.current_policy_version = policy.policy_version
     AND policy.policy_state = 'approved'
     AND appsea.source_policy_has_complete_reviews(
       policy.source_id, policy.policy_version, policy.content_hash
     )
     AND policy.commercial_use IN ('allowed', 'restricted')
     AND policy.reviewed_at IS NOT NULL
     AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
     AND p_purpose = ANY(policy.permitted_purposes)
     AND policy.display_mode = p_display_mode
   FOR SHARE OF source;

  RETURN matched_source_id IS NOT NULL;
END
$$;

REVOKE ALL ON FUNCTION appsea.manual_import_source_policy_collectible(
  text, text, text, text
) FROM PUBLIC, appsea_service;
GRANT EXECUTE ON FUNCTION appsea.manual_import_source_policy_collectible(
  text, text, text, text
) TO appsea_service;

-- Defense-in-depth for durable collection/reconciliation rows whose older
-- trigger functions only checked for one approved review. Existing rows are
-- not rewritten; every new active lease or reconciliation job must pass the
-- complete role-set gate.
CREATE OR REPLACE FUNCTION appsea.enforce_source_collection_lease_complete_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.state = 'active'
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.sources source
         JOIN appsea.source_policy_versions policy
           ON policy.source_id = source.source_id
          AND policy.policy_version = NEW.policy_version
        WHERE source.source_id = NEW.source_id
          AND source.source_type <> 'fixture'
          AND source.lifecycle_state = 'active'
          AND source.current_policy_version = policy.policy_version
          AND policy.policy_state = 'approved'
          AND policy.reviewed_at IS NOT NULL
          AND policy.commercial_use IN ('allowed', 'restricted')
          AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
          AND appsea.source_policy_has_complete_reviews(
            policy.source_id, policy.policy_version, policy.content_hash
          )
     ) THEN
    RAISE EXCEPTION 'source collection lease requires a complete approved policy review set'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_source_collection_lease_complete_policy() FROM PUBLIC;
DROP TRIGGER IF EXISTS source_collection_lease_complete_policy_guard
  ON appsea.source_collection_leases;
CREATE TRIGGER source_collection_lease_complete_policy_guard
BEFORE INSERT OR UPDATE ON appsea.source_collection_leases
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_collection_lease_complete_policy();

CREATE OR REPLACE FUNCTION appsea.enforce_source_snapshot_reconciliation_complete_policy()
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
       AND source.current_policy_version = policy.policy_version
       AND policy.policy_state = 'approved'
       AND policy.deletion_required
       AND policy.reviewed_at IS NOT NULL
       AND policy.commercial_use IN ('allowed', 'restricted')
       AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
       AND appsea.source_policy_has_complete_reviews(
         policy.source_id, policy.policy_version, policy.content_hash
       )
  ) THEN
    RAISE EXCEPTION 'source snapshot reconciliation requires a complete approved deletion policy'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_source_snapshot_reconciliation_complete_policy()
  FROM PUBLIC;
DROP TRIGGER IF EXISTS source_snapshot_reconciliation_complete_policy_guard
  ON appsea.source_snapshot_reconciliation_jobs;
CREATE TRIGGER source_snapshot_reconciliation_complete_policy_guard
BEFORE INSERT ON appsea.source_snapshot_reconciliation_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_snapshot_reconciliation_complete_policy();

CREATE OR REPLACE FUNCTION appsea.enforce_research_campaign_orchestration_complete_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.state IN ('started', 'completed')
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.sources source
         JOIN appsea.source_policy_versions policy
           ON policy.source_id = source.source_id
          AND policy.policy_version = NEW.policy_version
        WHERE source.source_id = NEW.source_id
          AND source.source_type <> 'fixture'
          AND source.lifecycle_state = 'active'
          AND source.current_policy_version = policy.policy_version
          AND policy.policy_state = 'approved'
          AND policy.reviewed_at IS NOT NULL
          AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
          AND appsea.source_policy_has_complete_reviews(
            policy.source_id, policy.policy_version, policy.content_hash
          )
     ) THEN
    RAISE EXCEPTION 'campaign orchestration source policy is not complete and collectible'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_research_campaign_orchestration_complete_policy()
  FROM PUBLIC;
DROP TRIGGER IF EXISTS research_campaign_orchestration_complete_policy_guard
  ON appsea.research_campaign_orchestration_sources;
CREATE TRIGGER research_campaign_orchestration_complete_policy_guard
BEFORE INSERT OR UPDATE ON appsea.research_campaign_orchestration_sources
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_research_campaign_orchestration_complete_policy();

-- Keep maintenance's scalar health projection aligned with the same gate;
-- otherwise an alert could report a partially reviewed source as collectible.
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
           appsea.source_policy_has_complete_reviews(
             policy.source_id, policy.policy_version, policy.content_hash
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
