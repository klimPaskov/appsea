-- Give the migration and maintenance operators a bounded scalar view of a
-- policy's approval progress. It deliberately omits reviewer identities,
-- notes, approval references, and permission evidence locators.
CREATE OR REPLACE FUNCTION appsea.read_source_policy_review_progress(
  p_source_id text,
  p_policy_version text
)
RETURNS TABLE (
  source_id text,
  display_name text,
  source_type text,
  lifecycle_state text,
  current_policy_version text,
  policy_version text,
  policy_state text,
  content_hash text,
  expires_at timestamptz,
  required_reviewer_roles text[],
  approved_reviewer_roles text[],
  missing_reviewer_roles text[],
  permission_evidence_required boolean,
  permission_evidence_present boolean,
  complete boolean,
  collectible boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  source_row record;
  required_roles text[];
  approved_roles text[];
  missing_roles text[];
  permission_required boolean;
  permission_present boolean;
  is_complete boolean;
BEGIN
  IF session_user NOT IN ('appsea_migrator', 'appsea_maintenance') THEN
    RAISE EXCEPTION 'source policy review progress requires an operator role'
      USING ERRCODE = '42501';
  END IF;
  IF p_source_id IS NULL
     OR p_policy_version IS NULL
     OR p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_policy_version !~ '^[a-zA-Z0-9._:-]{1,80}$' THEN
    RAISE EXCEPTION 'invalid source policy review progress identity'
      USING ERRCODE = '22023';
  END IF;

  SELECT source.source_id,
         source.display_name,
         source.source_type,
         source.lifecycle_state,
         source.current_policy_version,
         policy.policy_version,
         policy.policy_state,
         policy.content_hash,
         policy.reviewed_at,
         policy.expires_at,
         policy.policy_payload
    INTO source_row
    FROM appsea.sources source
    JOIN appsea.source_policy_versions policy
      ON policy.source_id = source.source_id
     AND policy.policy_version = p_policy_version
   WHERE source.source_id = p_source_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  required_roles := appsea.source_policy_required_reviewer_roles(
    p_source_id, p_policy_version
  );
  permission_required := COALESCE(
    (source_row.policy_payload->>'permissionEvidenceRequired')::boolean,
    false
  );

  SELECT COALESCE(array_agg(required.role ORDER BY required.ordinality), '{}')
    INTO approved_roles
    FROM unnest(required_roles) WITH ORDINALITY AS required(role, ordinality)
   WHERE EXISTS (
     SELECT 1
       FROM appsea.source_policy_reviews review
      WHERE review.source_id = p_source_id
        AND review.policy_version = p_policy_version
        AND review.decision = 'approved'
        AND review.reviewer_role = required.role
        AND review.content_hash = source_row.content_hash
        AND review.independence_attested
        AND (
          permission_required = false
          OR NULLIF(trim(review.permission_evidence_reference), '') IS NOT NULL
        )
   );

  SELECT COALESCE(array_agg(required.role ORDER BY required.ordinality), '{}')
    INTO missing_roles
    FROM unnest(required_roles) WITH ORDINALITY AS required(role, ordinality)
   WHERE NOT EXISTS (
     SELECT 1
       FROM appsea.source_policy_reviews review
      WHERE review.source_id = p_source_id
        AND review.policy_version = p_policy_version
        AND review.decision = 'approved'
        AND review.reviewer_role = required.role
        AND review.content_hash = source_row.content_hash
        AND review.independence_attested
        AND (
          permission_required = false
          OR NULLIF(trim(review.permission_evidence_reference), '') IS NOT NULL
        )
   );

  permission_present := NOT permission_required OR NOT EXISTS (
    SELECT 1
      FROM unnest(required_roles) AS required(role)
     WHERE NOT EXISTS (
       SELECT 1
         FROM appsea.source_policy_reviews review
        WHERE review.source_id = p_source_id
          AND review.policy_version = p_policy_version
          AND review.decision = 'approved'
          AND review.reviewer_role = required.role
          AND review.content_hash = source_row.content_hash
          AND review.independence_attested
          AND NULLIF(trim(review.permission_evidence_reference), '') IS NOT NULL
     )
  );
  is_complete := appsea.source_policy_has_complete_reviews(
    p_source_id, p_policy_version, source_row.content_hash
  );

  RETURN QUERY
  SELECT source_row.source_id,
         source_row.display_name,
         source_row.source_type,
         source_row.lifecycle_state,
         source_row.current_policy_version,
         source_row.policy_version,
         source_row.policy_state,
         source_row.content_hash::text,
         source_row.expires_at,
         required_roles,
         approved_roles,
         missing_roles,
         permission_required,
         permission_present,
         is_complete,
         (
           source_row.source_type <> 'fixture'
           AND source_row.lifecycle_state = 'active'
           AND source_row.current_policy_version = source_row.policy_version
           AND source_row.policy_state = 'approved'
           AND source_row.reviewed_at IS NOT NULL
           AND (source_row.expires_at IS NULL OR source_row.expires_at > clock_timestamp())
           AND is_complete
         );
END
$$;

REVOKE ALL ON FUNCTION appsea.read_source_policy_review_progress(text, text)
  FROM PUBLIC, appsea_service;
GRANT EXECUTE ON FUNCTION appsea.read_source_policy_review_progress(text, text)
  TO appsea_migrator, appsea_maintenance;

COMMENT ON FUNCTION appsea.read_source_policy_review_progress(text, text) IS
  'Operator-only scalar approval progress; exposes role completion and collectibility but never reviewer identities, notes, or approval references.';
