-- Source policies may require a durable external permission or commercial
-- exception before activation. Keep that evidence on the immutable review row,
-- separate from free-form notes, and enforce the requirement in the database
-- activation boundary. Legacy reviews remain auditable with a NULL reference.
ALTER TABLE appsea.source_policy_reviews
  ADD COLUMN permission_evidence_reference text;

ALTER TABLE appsea.source_policy_reviews
  ADD CONSTRAINT source_policy_review_permission_evidence_reference_check
    CHECK (
      permission_evidence_reference IS NULL
      OR (
        char_length(permission_evidence_reference) BETWEEN 1 AND 500
        AND NULLIF(trim(permission_evidence_reference), '') IS NOT NULL
      )
    );

ALTER TABLE appsea.source_policy_versions
  ADD CONSTRAINT source_policy_permission_evidence_type_check
    CHECK (
      policy_payload->'permissionEvidenceRequired' IS NULL
      OR jsonb_typeof(policy_payload->'permissionEvidenceRequired') = 'boolean'
    );

CREATE OR REPLACE FUNCTION appsea.enforce_source_policy_review_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  policy_owner text;
  permission_evidence_required boolean;
BEGIN
  IF NEW.decision = 'approved' THEN
    IF NOT NEW.independence_attested
       OR NEW.reviewer_role NOT IN ('legal', 'privacy', 'security', 'independent_operator') THEN
      RAISE EXCEPTION 'source policy approval requires an independent reviewer attestation'
        USING ERRCODE = '42501';
    END IF;

    SELECT lower(trim(policy.policy_payload->>'policyOwner')),
           COALESCE((policy.policy_payload->>'permissionEvidenceRequired')::boolean, false)
      INTO policy_owner, permission_evidence_required
      FROM appsea.source_policy_versions policy
     WHERE policy.source_id = NEW.source_id
       AND policy.policy_version = NEW.policy_version;

    IF policy_owner IS NOT NULL
       AND policy_owner <> ''
       AND lower(trim(NEW.reviewer_identity)) = policy_owner THEN
      RAISE EXCEPTION 'source policy owner cannot approve its own policy'
        USING ERRCODE = '42501';
    END IF;

    IF permission_evidence_required
       AND NULLIF(trim(NEW.permission_evidence_reference), '') IS NULL THEN
      RAISE EXCEPTION 'source policy approval requires a permission evidence reference'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Remove the previous signature so an operator cannot bypass the new evidence
-- argument through an overload.
DROP FUNCTION IF EXISTS appsea.approve_source_policy(
  text, text, text, text, text, text, boolean, text, text[], text,
  timestamptz, timestamptz, timestamptz
);

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

COMMENT ON COLUMN appsea.source_policy_reviews.permission_evidence_reference IS
  'Immutable reference to external written permission or commercial exception required by the reviewed policy; legacy rows may be NULL.';
