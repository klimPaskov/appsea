-- Bind source-policy activation to a canonical reviewer identity and an
-- explicit independent review role. Historical approvals are retained for
-- audit, but are conservatively returned to pending review until re-approved
-- with the stronger metadata.
ALTER TABLE appsea.source_policy_reviews
  ADD COLUMN IF NOT EXISTS reviewer_identity text,
  ADD COLUMN IF NOT EXISTS reviewer_role text,
  ADD COLUMN IF NOT EXISTS independence_attested boolean NOT NULL DEFAULT false;

UPDATE appsea.source_policy_reviews
   SET reviewer_identity = 'legacy:' || md5(trim(reviewer)),
       reviewer_role = 'legacy'
 WHERE reviewer_identity IS NULL
    OR reviewer_role IS NULL;

ALTER TABLE appsea.source_policy_reviews
  ALTER COLUMN reviewer_identity SET NOT NULL,
  ALTER COLUMN reviewer_role SET NOT NULL;

ALTER TABLE appsea.source_policy_reviews
  ADD CONSTRAINT source_policy_review_reviewer_identity_check
    CHECK (reviewer_identity ~ '^[a-z0-9][a-z0-9._:@/+~-]{2,159}$'),
  ADD CONSTRAINT source_policy_review_reviewer_role_check
    CHECK (reviewer_role IN ('legal', 'privacy', 'security', 'independent_operator', 'legacy'));

-- Do not treat an approval made before the identity/independence boundary as
-- sufficient for future collection. The immutable review row remains history.
UPDATE appsea.source_policy_versions policy
   SET policy_state = 'pending_review',
       reviewed_at = NULL
  FROM appsea.sources source
 WHERE source.source_id = policy.source_id
   AND source.current_policy_version = policy.policy_version
   AND source.source_type <> 'fixture'
   AND source.lifecycle_state = 'active'
   AND policy.policy_state = 'approved'
   AND NOT EXISTS (
     SELECT 1
       FROM appsea.source_policy_reviews review
      WHERE review.source_id = policy.source_id
        AND review.policy_version = policy.policy_version
        AND review.decision = 'approved'
        AND review.content_hash = policy.content_hash
        AND review.independence_attested
        AND review.reviewer_role <> 'legacy'
   );

UPDATE appsea.sources source
   SET lifecycle_state = 'disabled_pending_review',
       current_policy_version = NULL,
       updated_at = clock_timestamp()
 WHERE source.source_type <> 'fixture'
   AND source.lifecycle_state = 'active'
   AND NOT EXISTS (
     SELECT 1
       FROM appsea.source_policy_versions policy
       JOIN appsea.source_policy_reviews review
         ON review.source_id = policy.source_id
        AND review.policy_version = policy.policy_version
        AND review.decision = 'approved'
        AND review.content_hash = policy.content_hash
        AND review.independence_attested
        AND review.reviewer_role <> 'legacy'
      WHERE policy.source_id = source.source_id
        AND policy.policy_version = source.current_policy_version
        AND policy.policy_state = 'approved'
   );

CREATE OR REPLACE FUNCTION appsea.enforce_source_policy_review_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  policy_owner text;
BEGIN
  IF NEW.decision = 'approved' THEN
    IF NOT NEW.independence_attested
       OR NEW.reviewer_role NOT IN ('legal', 'privacy', 'security', 'independent_operator') THEN
      RAISE EXCEPTION 'source policy approval requires an independent reviewer attestation'
        USING ERRCODE = '42501';
    END IF;

    SELECT lower(trim(policy.policy_payload->>'policyOwner'))
      INTO policy_owner
      FROM appsea.source_policy_versions policy
     WHERE policy.source_id = NEW.source_id
       AND policy.policy_version = NEW.policy_version;

    IF policy_owner IS NOT NULL
       AND policy_owner <> ''
       AND lower(trim(NEW.reviewer_identity)) = policy_owner THEN
      RAISE EXCEPTION 'source policy owner cannot approve its own policy'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_policy_review_integrity_guard
  ON appsea.source_policy_reviews;
CREATE TRIGGER source_policy_review_integrity_guard
BEFORE INSERT OR UPDATE ON appsea.source_policy_reviews
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_policy_review_integrity();

-- Replace the old operator-only function signature so the migration role
-- cannot bypass the identity and independence boundary through an overload.
DROP FUNCTION IF EXISTS appsea.approve_source_policy(
  text, text, text, text, text, text[], text, timestamptz, timestamptz, timestamptz
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
  IF policy_owner IS NOT NULL
     AND policy_owner <> ''
     AND policy_owner = p_reviewer_identity THEN
    RAISE EXCEPTION 'source policy owner cannot approve its own policy'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO appsea.source_policy_reviews
    (review_id, source_id, policy_version, decision, reviewer, reviewer_identity,
     reviewer_role, independence_attested, approval_reference, notes, content_hash,
     reviewed_at, recorded_at)
  VALUES
    (p_review_id, p_source_id, p_policy_version, 'approved', p_reviewer,
     p_reviewer_identity, p_reviewer_role, p_independence_attested,
     p_approval_reference, COALESCE(p_notes, '{}'), p_content_hash,
     p_reviewed_at, p_recorded_at)
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
  text, text, text, text, text, text, boolean, text, text[], text,
  timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.approve_source_policy(
  text, text, text, text, text, text, boolean, text, text[], text,
  timestamptz, timestamptz, timestamptz
) TO appsea_migrator;

COMMENT ON TABLE appsea.source_policy_reviews IS
  'Immutable policy decisions. New approvals require a canonical reviewer identity, independent role, and explicit attestation; legacy approvals remain audit history until re-reviewed.';
