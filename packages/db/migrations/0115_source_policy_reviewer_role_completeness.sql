-- A policy's reviewer-role declaration is a required approval set, not merely
-- an allow-list. Preserve one immutable approval per role and keep a source
-- disabled until every declared independent role has approved the same hash.
ALTER TABLE appsea.source_policy_reviews
  DROP CONSTRAINT IF EXISTS source_policy_reviews_source_id_policy_version_decision_content_hash_key;

-- PostgreSQL truncates the pre-existing generated name at the identifier
-- length limit; retain both names so upgrades from every foundation snapshot
-- remove the legacy one-column-per-policy uniqueness boundary.
ALTER TABLE appsea.source_policy_reviews
  DROP CONSTRAINT IF EXISTS source_policy_reviews_source_id_policy_version_decision_con_key;

ALTER TABLE appsea.source_policy_reviews
  ADD CONSTRAINT source_policy_reviews_role_content_hash_key
    UNIQUE (source_id, policy_version, decision, reviewer_role, content_hash);

CREATE OR REPLACE FUNCTION appsea.source_policy_required_reviewer_roles(
  p_source_id text,
  p_policy_version text
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  source_type text;
  required_roles jsonb;
  role_values text[];
BEGIN
  SELECT source.source_type, policy.policy_payload->'requiredReviewerRoles'
    INTO source_type, required_roles
    FROM appsea.sources source
    JOIN appsea.source_policy_versions policy
      ON policy.source_id = source.source_id
     AND policy.policy_version = p_policy_version
   WHERE source.source_id = p_source_id;

  IF source_type IS NULL THEN
    RAISE EXCEPTION 'source policy reviewer roles require an existing policy'
      USING ERRCODE = '22023';
  END IF;

  IF required_roles IS NULL THEN
    IF source_type = 'manual' THEN
      RETURN ARRAY['independent_operator']::text[];
    END IF;
    RETURN ARRAY['legal', 'privacy', 'security']::text[];
  END IF;

  IF jsonb_typeof(required_roles) <> 'array'
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(required_roles) AS role(value)
        WHERE jsonb_typeof(role.value) <> 'string'
           OR role.value #>> '{}' NOT IN ('legal', 'privacy', 'security', 'independent_operator')
     ) THEN
    RAISE EXCEPTION 'source policy required reviewer roles are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(role.value #>> '{}' ORDER BY role.ordinality)
    INTO role_values
    FROM jsonb_array_elements(required_roles) WITH ORDINALITY AS role(value, ordinality);

  IF role_values IS NULL
     OR cardinality(role_values) = 0
     OR cardinality(role_values) <> (
       SELECT count(DISTINCT role.value)
         FROM unnest(role_values) AS role(value)
     ) THEN
    RAISE EXCEPTION 'source policy required reviewer roles are invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN role_values;
END
$$;

REVOKE ALL ON FUNCTION appsea.source_policy_required_reviewer_roles(text, text)
  FROM PUBLIC, appsea_service, appsea_maintenance, appsea_migrator;

-- Existing non-fixture activations that predate complete role enforcement must
-- fail closed until their missing roles are recorded. Historical review rows
-- remain immutable audit evidence.
UPDATE appsea.source_policy_versions policy
   SET policy_state = 'pending_review',
       reviewed_at = NULL
  FROM appsea.sources source
 WHERE source.source_id = policy.source_id
   AND source.current_policy_version = policy.policy_version
   AND source.source_type <> 'fixture'
   AND source.lifecycle_state = 'active'
   AND EXISTS (
     SELECT 1
       FROM unnest(appsea.source_policy_required_reviewer_roles(
         policy.source_id, policy.policy_version
       )) AS required(role)
      WHERE NOT EXISTS (
        SELECT 1
          FROM appsea.source_policy_reviews review
         WHERE review.source_id = policy.source_id
           AND review.policy_version = policy.policy_version
           AND review.decision = 'approved'
           AND review.content_hash = policy.content_hash
           AND review.reviewer_role = required.role
      )
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
        AND EXISTS (
          SELECT 1
            FROM unnest(appsea.source_policy_required_reviewer_roles(
              policy.source_id, policy.policy_version
            )) AS required(role)
           WHERE NOT EXISTS (
             SELECT 1
               FROM appsea.source_policy_reviews review
              WHERE review.source_id = policy.source_id
                AND review.policy_version = policy.policy_version
                AND review.decision = 'approved'
                AND review.content_hash = policy.content_hash
                AND review.reviewer_role = required.role
           )
        )
   );

CREATE OR REPLACE FUNCTION appsea.enforce_source_policy_reviewer_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  required_roles text[];
BEGIN
  IF NEW.decision <> 'approved' THEN
    RETURN NEW;
  END IF;

  required_roles := appsea.source_policy_required_reviewer_roles(
    NEW.source_id, NEW.policy_version
  );
  IF NOT NEW.reviewer_role = ANY(required_roles) THEN
    RAISE EXCEPTION 'source policy approval reviewer role is not permitted by policy'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_policy_reviewer_role_guard
  ON appsea.source_policy_reviews;
CREATE TRIGGER source_policy_reviewer_role_guard
BEFORE INSERT OR UPDATE ON appsea.source_policy_reviews
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_policy_reviewer_role();

CREATE OR REPLACE FUNCTION appsea.approve_source_policy(
  p_source_id text,
  p_policy_version text,
  p_review_id text,
  p_reviewer text,
  p_reviewer_identity text,
  p_reviewer_role text,
  p_independence_attested boolean,
  p_approval_reference text,
  p_permission_evidence_reference text,
  p_notes text[],
  p_content_hash text,
  p_reviewed_at timestamptz,
  p_expires_at timestamptz,
  p_recorded_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  policy_row appsea.source_policy_versions%ROWTYPE;
  source_row appsea.sources%ROWTYPE;
  policy_owner text;
  permission_evidence_required boolean;
  required_roles text[];
BEGIN
  IF session_user <> 'appsea_migrator' THEN
    RAISE EXCEPTION 'source policy approval requires the migration operator role'
      USING ERRCODE = '42501';
  END IF;
  IF p_source_id IS NULL
     OR p_policy_version IS NULL
     OR p_review_id IS NULL
     OR p_reviewer IS NULL
     OR p_reviewer_identity IS NULL
     OR p_reviewer_role IS NULL
     OR p_independence_attested IS DISTINCT FROM true
     OR p_approval_reference IS NULL
     OR p_notes IS NULL
     OR p_content_hash IS NULL
     OR p_reviewed_at IS NULL
     OR p_recorded_at IS NULL
     OR p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_review_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR char_length(p_reviewer) NOT BETWEEN 1 AND 160
     OR p_reviewer_identity !~ '^[a-z0-9][a-z0-9._:@/+~-]{2,159}$'
     OR p_reviewer_identity <> lower(p_reviewer_identity)
     OR p_reviewer_role NOT IN ('legal', 'privacy', 'security', 'independent_operator')
     OR char_length(p_approval_reference) NOT BETWEEN 1 AND 500
     OR p_permission_evidence_reference IS NOT NULL
        AND (
          char_length(p_permission_evidence_reference) NOT BETWEEN 1 AND 500
          OR NULLIF(trim(p_permission_evidence_reference), '') IS NULL
        )
     OR cardinality(p_notes) > 100
     OR EXISTS (
       SELECT 1 FROM unnest(p_notes) AS note WHERE note IS NULL OR char_length(note) > 500
     )
     OR p_content_hash !~ '^[a-f0-9]{64}$'
     OR p_expires_at IS NOT NULL AND p_expires_at <= p_reviewed_at THEN
    RAISE EXCEPTION 'invalid source policy approval' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO source_row
    FROM appsea.sources
   WHERE source_id = p_source_id
   FOR UPDATE;
  SELECT * INTO policy_row
    FROM appsea.source_policy_versions
   WHERE source_id = p_source_id AND policy_version = p_policy_version
   FOR UPDATE;

  IF source_row.source_id IS NULL OR policy_row.source_id IS NULL THEN
    RAISE EXCEPTION 'source policy draft was not found' USING ERRCODE = '22023';
  END IF;
  IF policy_row.content_hash <> p_content_hash
     OR policy_row.policy_state NOT IN ('pending_review', 'approved')
     OR source_row.lifecycle_state IN ('retired', 'disabled_operator') THEN
    RAISE EXCEPTION 'source policy draft is not eligible for approval'
      USING ERRCODE = '42501';
  END IF;

  policy_owner := lower(trim(policy_row.policy_payload->>'policyOwner'));
  permission_evidence_required := COALESCE(
    (policy_row.policy_payload->>'permissionEvidenceRequired')::boolean,
    false
  );
  IF policy_owner IS NOT NULL
     AND policy_owner <> ''
     AND policy_owner = p_reviewer_identity THEN
    RAISE EXCEPTION 'source policy owner cannot approve its own policy'
      USING ERRCODE = '42501';
  END IF;
  IF permission_evidence_required
     AND NULLIF(trim(p_permission_evidence_reference), '') IS NULL THEN
    RAISE EXCEPTION 'source policy approval requires a permission evidence reference'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO appsea.source_policy_reviews
    (review_id, source_id, policy_version, decision, reviewer, reviewer_identity,
     reviewer_role, independence_attested, approval_reference,
     permission_evidence_reference, notes, content_hash, reviewed_at, recorded_at)
  VALUES
    (p_review_id, p_source_id, p_policy_version, 'approved', p_reviewer,
     p_reviewer_identity, p_reviewer_role, p_independence_attested,
     p_approval_reference, p_permission_evidence_reference,
     COALESCE(p_notes, '{}'), p_content_hash, p_reviewed_at, p_recorded_at)
  ON CONFLICT (review_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.source_policy_reviews review
     WHERE review.review_id = p_review_id
       AND review.source_id = p_source_id
       AND review.policy_version = p_policy_version
       AND review.decision = 'approved'
       AND review.content_hash = p_content_hash
       AND review.reviewer_identity = p_reviewer_identity
       AND review.reviewer_role = p_reviewer_role
       AND review.independence_attested
       AND review.permission_evidence_reference IS NOT DISTINCT FROM p_permission_evidence_reference
  ) THEN
    RAISE EXCEPTION 'source policy approval conflicts with immutable review evidence'
      USING ERRCODE = '23505';
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
          AND review.content_hash = p_content_hash
          AND review.reviewer_role = required.role
     )
  ) THEN
    UPDATE appsea.source_policy_versions
       SET policy_state = 'pending_review',
           reviewed_at = NULL
     WHERE source_id = p_source_id AND policy_version = p_policy_version;
    UPDATE appsea.sources
       SET lifecycle_state = 'disabled_pending_review',
           current_policy_version = NULL,
           updated_at = GREATEST(updated_at, p_recorded_at)
     WHERE source_id = p_source_id;
    RETURN;
  END IF;

  UPDATE appsea.source_policy_versions
     SET policy_state = 'approved',
         reviewed_at = p_reviewed_at,
         expires_at = p_expires_at
   WHERE source_id = p_source_id AND policy_version = p_policy_version;
  UPDATE appsea.sources
     SET lifecycle_state = 'active',
         current_policy_version = p_policy_version,
         updated_at = GREATEST(updated_at, p_recorded_at)
   WHERE source_id = p_source_id;
END
$$;

REVOKE ALL ON FUNCTION appsea.approve_source_policy(
  text, text, text, text, text, text, boolean, text, text, text[], text,
  timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.approve_source_policy(
  text, text, text, text, text, text, boolean, text, text, text[], text,
  timestamptz, timestamptz, timestamptz
) TO appsea_migrator;

COMMENT ON FUNCTION appsea.source_policy_required_reviewer_roles(text, text) IS
  'Returns the immutable approval role set; manual policies without a declaration default to independent_operator and other legacy policies fail closed to legal/privacy/security.';
