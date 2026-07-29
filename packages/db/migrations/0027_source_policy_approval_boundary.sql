-- Production source policies are registered as disabled drafts and can only
-- become collectible through an explicit operator approval record. Runtime
-- workers can read approved policy snapshots, but cannot create or activate
-- one themselves.
CREATE TABLE appsea.source_policy_reviews (
  review_id text CHECK (
    char_length(review_id) BETWEEN 3 AND 160
    AND review_id ~ '^[a-z][a-z0-9_:-]*$'
  ),
  source_id text NOT NULL,
  policy_version text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewer text NOT NULL CHECK (char_length(reviewer) BETWEEN 1 AND 160),
  approval_reference text NOT NULL CHECK (char_length(approval_reference) BETWEEN 1 AND 500),
  notes text[] NOT NULL DEFAULT '{}',
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CHECK (cardinality(notes) <= 100),
  PRIMARY KEY (review_id),
  FOREIGN KEY (source_id, policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version)
    ON DELETE RESTRICT,
  UNIQUE (source_id, policy_version, decision, content_hash)
);

CREATE INDEX source_policy_reviews_source_idx
  ON appsea.source_policy_reviews (source_id, policy_version, reviewed_at DESC);

CREATE OR REPLACE FUNCTION appsea.register_source_policy_draft(
  p_source_id text,
  p_display_name text,
  p_source_type text,
  p_policy_version text,
  p_permitted_purposes text[],
  p_commercial_use text,
  p_access_method text,
  p_retention_days integer,
  p_deletion_required boolean,
  p_attribution_required boolean,
  p_display_mode text,
  p_coverage_notes text[],
  p_policy_document_ref text,
  p_expires_at timestamptz,
  p_policy_payload jsonb,
  p_content_hash text,
  p_recorded_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  stored_source_type text;
  stored_lifecycle_state text;
  stored_policy_version text;
  stored_content_hash text;
BEGIN
  IF session_user <> 'appsea_migrator' THEN
    RAISE EXCEPTION 'source policy drafts require the migration operator role'
      USING ERRCODE = '42501';
  END IF;
  IF p_source_id IS NULL
     OR p_display_name IS NULL
     OR p_source_type IS NULL
     OR p_policy_version IS NULL
     OR p_permitted_purposes IS NULL
     OR p_commercial_use IS NULL
     OR p_access_method IS NULL
     OR p_retention_days IS NULL
     OR p_deletion_required IS NULL
     OR p_attribution_required IS NULL
     OR p_display_mode IS NULL
     OR p_coverage_notes IS NULL
     OR p_policy_payload IS NULL
     OR p_content_hash IS NULL
     OR p_recorded_at IS NULL
     OR p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR char_length(p_display_name) NOT BETWEEN 1 AND 160
     OR p_source_type NOT IN ('api', 'export', 'licensed-feed', 'manual')
     OR char_length(p_policy_version) NOT BETWEEN 1 AND 80
     OR cardinality(p_permitted_purposes) < 1
     OR p_commercial_use NOT IN ('allowed', 'restricted', 'unknown')
     OR char_length(p_access_method) < 1
     OR p_retention_days < 0
     OR p_display_mode NOT IN ('excerpt', 'metadata-only', 'aggregate-only')
     OR p_policy_document_ref IS NULL
     OR p_policy_payload->>'sourceId' IS NULL
     OR p_policy_payload->>'sourceId' <> p_source_id
     OR p_policy_payload->>'sourceType' IS NULL
     OR p_policy_payload->>'sourceType' <> p_source_type
     OR p_policy_payload->>'enabled' IS NULL
     OR COALESCE((p_policy_payload->>'enabled')::boolean, true)
     OR p_policy_payload->>'policyState' IS NULL
     OR p_policy_payload->>'policyState' <> 'pending_review'
     OR p_policy_payload->>'displayMode' IS NULL
     OR p_policy_payload->>'displayMode' <> p_display_mode
     OR p_policy_payload->'permittedPurposes' IS NULL
     OR p_policy_payload->'permittedPurposes' <> to_jsonb(p_permitted_purposes)
     OR p_policy_payload->>'commercialUse' IS NULL
     OR p_policy_payload->>'commercialUse' <> p_commercial_use
     OR p_policy_payload->>'accessMethod' IS NULL
     OR p_policy_payload->>'accessMethod' <> p_access_method
     OR p_policy_payload->>'retentionDays' IS NULL
     OR (p_policy_payload->>'retentionDays')::integer <> p_retention_days
     OR p_policy_payload->>'deletionRequired' IS NULL
     OR (p_policy_payload->>'deletionRequired')::boolean <> p_deletion_required
     OR p_policy_payload->>'attributionRequired' IS NULL
     OR (p_policy_payload->>'attributionRequired')::boolean <> p_attribution_required
     OR p_policy_payload->'coverageNotes' IS NULL
     OR p_policy_payload->'coverageNotes' <> to_jsonb(p_coverage_notes)
     OR p_policy_payload->>'policyDocumentRef' IS NULL
     OR p_policy_payload->>'policyDocumentRef' <> p_policy_document_ref
     OR p_policy_payload->>'expiresAt' IS NULL
        AND p_expires_at IS NOT NULL
     OR p_policy_payload->>'expiresAt' IS NOT NULL
        AND p_expires_at IS NULL
     OR p_policy_payload->>'expiresAt' IS NOT NULL
        AND (p_policy_payload->>'expiresAt')::timestamptz <> p_expires_at
     OR jsonb_typeof(p_policy_payload->'quota') <> 'object'
     OR jsonb_typeof(p_policy_payload->'deletion') <> 'object'
     OR p_policy_payload #>> '{deletion,retentionAction}' = 'purge'
     OR p_content_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid source policy draft' USING ERRCODE = '22023';
  END IF;

  INSERT INTO appsea.sources
    (source_id, display_name, source_type, lifecycle_state, created_at, updated_at)
  VALUES
    (p_source_id, p_display_name, p_source_type, 'disabled_pending_review',
     p_recorded_at, p_recorded_at)
  ON CONFLICT (source_id) DO NOTHING;

  SELECT source.source_type, source.lifecycle_state, source.current_policy_version,
         current_policy.content_hash
    INTO stored_source_type, stored_lifecycle_state, stored_policy_version, stored_content_hash
    FROM appsea.sources source
    LEFT JOIN appsea.source_policy_versions current_policy
      ON current_policy.source_id = source.source_id
     AND current_policy.policy_version = source.current_policy_version
   WHERE source.source_id = p_source_id
   FOR UPDATE OF source;

  IF stored_source_type <> p_source_type THEN
    RAISE EXCEPTION 'source identifier is already owned by another source type'
      USING ERRCODE = '23505';
  END IF;
  IF stored_lifecycle_state IN ('retired', 'disabled_operator') THEN
    RAISE EXCEPTION 'source is blocked by an operator decision'
      USING ERRCODE = '42501';
  END IF;
  IF stored_policy_version IS NOT NULL
     AND stored_policy_version <> p_policy_version
     AND stored_content_hash IS NULL THEN
    RAISE EXCEPTION 'source current policy is inconsistent' USING ERRCODE = '23514';
  END IF;

  INSERT INTO appsea.source_policy_versions
    (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
     access_method, retention_days, deletion_required, attribution_required,
     display_mode, coverage_notes, policy_document_ref, expires_at, policy_payload,
     content_hash, created_at)
  VALUES
    (p_source_id, p_policy_version, 'pending_review', p_permitted_purposes,
     p_commercial_use, p_access_method, p_retention_days, p_deletion_required,
     p_attribution_required, p_display_mode, p_coverage_notes, p_policy_document_ref,
     p_expires_at, p_policy_payload, p_content_hash, p_recorded_at)
  ON CONFLICT (source_id, policy_version) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.source_policy_versions policy
     WHERE policy.source_id = p_source_id
       AND policy.policy_version = p_policy_version
       AND policy.content_hash = p_content_hash
       AND policy.policy_state = 'pending_review'
  ) THEN
    RAISE EXCEPTION 'source policy draft conflicts with immutable content'
      USING ERRCODE = '23505';
  END IF;

  UPDATE appsea.sources
     SET display_name = p_display_name,
         updated_at = GREATEST(updated_at, p_recorded_at)
   WHERE source_id = p_source_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.approve_source_policy(
  p_source_id text,
  p_policy_version text,
  p_review_id text,
  p_reviewer text,
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
BEGIN
  IF session_user <> 'appsea_migrator' THEN
    RAISE EXCEPTION 'source policy approval requires the migration operator role'
      USING ERRCODE = '42501';
  END IF;
  IF p_source_id IS NULL
     OR p_policy_version IS NULL
     OR p_review_id IS NULL
     OR p_reviewer IS NULL
     OR p_approval_reference IS NULL
     OR p_notes IS NULL
     OR p_content_hash IS NULL
     OR p_reviewed_at IS NULL
     OR p_recorded_at IS NULL
     OR p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_review_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR char_length(p_reviewer) NOT BETWEEN 1 AND 160
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

  INSERT INTO appsea.source_policy_reviews
    (review_id, source_id, policy_version, decision, reviewer, approval_reference,
     notes, content_hash, reviewed_at, recorded_at)
  VALUES
    (p_review_id, p_source_id, p_policy_version, 'approved', p_reviewer,
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

REVOKE ALL ON TABLE appsea.source_policy_reviews FROM PUBLIC, appsea_service;
GRANT SELECT ON TABLE appsea.source_policy_reviews TO appsea_service;
REVOKE ALL ON FUNCTION appsea.register_source_policy_draft(
  text, text, text, text, text[], text, text, integer, boolean, boolean, text,
  text[], text, timestamptz, jsonb, text, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.register_source_policy_draft(
  text, text, text, text, text[], text, text, integer, boolean, boolean, text,
  text[], text, timestamptz, jsonb, text, timestamptz
) TO appsea_migrator;
REVOKE ALL ON FUNCTION appsea.approve_source_policy(
  text, text, text, text, text, text[], text, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.approve_source_policy(
  text, text, text, text, text, text[], text, timestamptz, timestamptz, timestamptz
) TO appsea_migrator;
