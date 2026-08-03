-- Keep the runtime owner-import path least-privileged. The service role may
-- read ordinary source rows where explicitly required, but it must not need
-- row-lock privileges on the global source-policy tables to stage an import.
-- This narrow security-definer gate returns only the collectible decision.

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
     OR p_policy_version <> 'manual-owner-import-v1'
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
    JOIN appsea.source_policy_reviews review
      ON review.source_id = policy.source_id
     AND review.policy_version = policy.policy_version
     AND review.decision = 'approved'
     AND review.content_hash = policy.content_hash
     AND review.independence_attested
   WHERE source.source_id = p_source_id
     AND source.source_type = 'manual'
     AND source.lifecycle_state = 'active'
     AND source.current_policy_version = policy.policy_version
     AND policy.policy_state = 'approved'
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
