-- Expose identity-free source-policy approval progress to authenticated
-- workspace reads. The operator progress function from migration 0117 remains
-- restricted; this projection returns only bounded role and evidence booleans.
CREATE OR REPLACE FUNCTION appsea.read_source_policy_approval_summary(
  p_source_id text,
  p_policy_version text
)
RETURNS TABLE (
  available boolean,
  required_reviewer_roles text[],
  approved_reviewer_roles text[],
  missing_reviewer_roles text[],
  permission_evidence_required boolean,
  permission_evidence_present boolean,
  complete boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  source_type text;
  policy_hash text;
  policy_payload jsonb;
  required_roles text[];
  approved_roles text[];
  missing_roles text[];
  permission_required boolean;
  permission_present boolean;
  is_complete boolean;
BEGIN
  IF session_user <> 'appsea_service' THEN
    RAISE EXCEPTION 'source policy approval summary requires the runtime service role'
      USING ERRCODE = '42501';
  END IF;
  -- Unregistered source rows remain visible in the private registry as
  -- unavailable; do not turn a nullable policy join into a registry failure.
  IF p_source_id IS NULL OR p_policy_version IS NULL THEN
    RETURN;
  END IF;
  IF p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_policy_version !~ '^[a-zA-Z0-9._:-]{1,80}$' THEN
    RAISE EXCEPTION 'invalid source policy approval summary identity'
      USING ERRCODE = '22023';
  END IF;

  SELECT source.source_type,
         policy.content_hash,
         policy.policy_payload
    INTO source_type, policy_hash, policy_payload
    FROM appsea.sources source
    JOIN appsea.source_policy_versions policy
      ON policy.source_id = source.source_id
     AND policy.policy_version = p_policy_version
   WHERE source.source_id = p_source_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Fixture approval is intentionally not an external review claim.
  IF source_type = 'fixture' THEN
    RETURN QUERY
    SELECT true,
           ARRAY[]::text[],
           ARRAY[]::text[],
           ARRAY[]::text[],
           false,
           true,
           true;
    RETURN;
  END IF;

  required_roles := appsea.source_policy_required_reviewer_roles(
    p_source_id, p_policy_version
  );
  permission_required := COALESCE(
    (policy_payload->>'permissionEvidenceRequired')::boolean,
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
        AND review.content_hash = policy_hash
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
        AND review.content_hash = policy_hash
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
          AND review.content_hash = policy_hash
          AND review.independence_attested
          AND NULLIF(trim(review.permission_evidence_reference), '') IS NOT NULL
     )
  );
  is_complete := appsea.source_policy_has_complete_reviews(
    p_source_id, p_policy_version, policy_hash
  );

  RETURN QUERY
  SELECT true,
         required_roles,
         approved_roles,
         missing_roles,
         permission_required,
         permission_present,
         is_complete;
END
$$;

REVOKE ALL ON FUNCTION appsea.read_source_policy_approval_summary(text, text)
  FROM PUBLIC, appsea_migrator, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.read_source_policy_approval_summary(text, text)
  TO appsea_service;

COMMENT ON FUNCTION appsea.read_source_policy_approval_summary(text, text) IS
  'Authenticated source-registry summary containing only reviewer-role completion and permission-evidence booleans; identities, notes, references, and policy payloads never cross the boundary.';
