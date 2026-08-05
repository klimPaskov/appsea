-- Manual owner-import v2 is an additive policy snapshot. Version 1 remains
-- immutable for historical batches, while new collection must use v2. The
-- extra purposes are still tenant-private and require observation review; no
-- public source or public-market coverage is activated by this migration.

DO $$
DECLARE
  policy_hash constant text := '2495a91d65b56fdd22f4b39b2f478cee119c49c3a0e403fc9bf76ec688da5d1f';
  recorded_at constant timestamptz := '2026-08-05T00:00:00Z';
BEGIN
  INSERT INTO appsea.source_policy_versions
    (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
     access_method, retention_days, deletion_required, attribution_required,
     display_mode, coverage_notes, policy_document_ref, expires_at, policy_payload,
     content_hash, reviewed_at, created_at)
  VALUES
    (
      'manual-owner-import', 'manual-owner-import-v2', 'approved',
      ARRAY['opportunity-research', 'customer-authorized-analysis', 'competitor-research', 'contrary-evidence', 'development', 'testing'],
      'allowed',
      'Authenticated workspace owner uploads a bounded CSV or JSON export they are authorized to analyze; no server-side URL fetching',
      30, true, false, 'excerpt',
      ARRAY[
        'Tenant-private owner-authorized evidence only; it is not public market coverage.',
        'Competitor and contrary-signal claims are private owner-attested research and require separate human observation review.',
        'The operator must attest that the workspace is authorized to analyze the imported records.',
        'Only normalized, PII-scrubbed complaint fields are retained; raw upload bytes are discarded.',
        'URL fields are retained only as validated HTTP(S) locators and are never fetched by AppSea.',
        'Deleting a batch clears staged records and propagates tombstones through downstream evidence.'
      ],
      'https://github.com/klimPaskov/appsea/blob/main/docs/product/manual-import-source-policy.md',
      '2026-11-05T00:00:00Z',
      '{
        "sourceId": "manual-owner-import",
        "displayName": "Owner-authorized private import",
        "sourceType": "manual",
        "enabled": true,
        "policyState": "approved",
        "permittedPurposes": ["opportunity-research", "customer-authorized-analysis", "competitor-research", "contrary-evidence", "development", "testing"],
        "commercialUse": "allowed",
        "accessMethod": "Authenticated workspace owner uploads a bounded CSV or JSON export they are authorized to analyze; no server-side URL fetching",
        "retentionDays": 30,
        "deletionRequired": true,
        "attributionRequired": false,
        "displayMode": "excerpt",
        "coverageNotes": [
          "Tenant-private owner-authorized evidence only; it is not public market coverage.",
          "Competitor and contrary-signal claims are private owner-attested research and require separate human observation review.",
          "The operator must attest that the workspace is authorized to analyze the imported records.",
          "Only normalized, PII-scrubbed complaint fields are retained; raw upload bytes are discarded.",
          "URL fields are retained only as validated HTTP(S) locators and are never fetched by AppSea.",
          "Deleting a batch clears staged records and propagates tombstones through downstream evidence."
        ],
        "reviewedAt": "2026-08-05T00:00:00.000Z",
        "policyOwner": "AppSea internal source-policy review queue",
        "policyDocumentRef": "https://github.com/klimPaskov/appsea/blob/main/docs/product/manual-import-source-policy.md",
        "expiresAt": "2026-11-05T00:00:00.000Z",
        "quota": {"requestsPerMinute": 60, "maxRecordsPerRequest": 5000, "maxRecordsPerRun": 5000, "costPerRequestMicros": 0},
        "deletion": {"sourceRecordIdField": "source_record_id", "supportsTombstones": true, "deletionPollIntervalHours": 0, "retentionAction": "redact"}
      }'::jsonb,
      policy_hash, recorded_at, recorded_at
    )
  ON CONFLICT (source_id, policy_version) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.source_policy_versions
     WHERE source_id = 'manual-owner-import'
       AND policy_version = 'manual-owner-import-v2'
       AND policy_state = 'approved'
       AND content_hash = policy_hash
  ) THEN
    RAISE EXCEPTION 'manual owner-import v2 policy snapshot conflicts with immutable content'
      USING ERRCODE = '23505';
  END IF;

  UPDATE appsea.sources
     SET current_policy_version = 'manual-owner-import-v2',
         updated_at = recorded_at
   WHERE source_id = 'manual-owner-import'
     AND lifecycle_state NOT IN ('retired', 'disabled_operator');

  INSERT INTO appsea.source_policy_reviews
    (review_id, source_id, policy_version, decision, reviewer,
     reviewer_identity, reviewer_role, independence_attested,
     approval_reference, notes, content_hash, reviewed_at, recorded_at)
  VALUES
    (
      'manual-owner-import-review-v2', 'manual-owner-import', 'manual-owner-import-v2',
      'approved', 'AppSea internal source-policy review queue',
      'internal-independent-operator', 'independent_operator', true,
      'https://github.com/klimPaskov/appsea/blob/main/docs/product/manual-import-source-policy.md',
      ARRAY[
        'This additive version remains owner-attested and tenant-private; it is not approval of a third-party source.',
        'Competitor and contrary-signal claims must be linked to retained evidence and reviewed separately before they affect research state.',
        'Operators must verify authority and privacy expectations for each workspace before use.'
      ],
      policy_hash, recorded_at, recorded_at
    )
  ON CONFLICT (review_id) DO NOTHING;
END
$$;

-- Keep historical v1 batches readable and deletable, but allow the current v2
-- snapshot to move through the same owner/service state machine.
CREATE OR REPLACE FUNCTION appsea.enforce_manual_import_batch_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  auth_user text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  service_principal text := NULLIF(current_setting('appsea.service_principal', true), '');
  owner_member boolean;
BEGIN
  IF NEW.source_id <> 'manual-owner-import'
     OR NEW.policy_version NOT IN ('manual-owner-import-v1', 'manual-owner-import-v2')
     OR NEW.authorization_attested IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'manual import source policy or attestation is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = NEW.workspace_id
       AND membership.user_id = auth_user
       AND membership.role = 'owner'
  ) INTO owner_member;

  IF TG_OP = 'INSERT' THEN
    IF service_principal = 'appsea-worker' OR NOT owner_member
       OR NEW.attested_by IS DISTINCT FROM auth_user THEN
      RAISE EXCEPTION 'manual import creation requires an authenticated workspace owner'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF service_principal = 'appsea-worker' THEN
      IF OLD.state <> 'staged' OR NEW.state <> 'consumed'
         OR NEW.run_id IS NULL OR NEW.run_id = OLD.run_id
         OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
         OR NEW.consumed_at IS NULL OR OLD.consumed_at IS NOT NULL
         OR NEW.workspace_id <> OLD.workspace_id
         OR NEW.batch_id <> OLD.batch_id
         OR NEW.campaign_id <> OLD.campaign_id
         OR NEW.source_id <> OLD.source_id
         OR NEW.policy_version <> OLD.policy_version
         OR NEW.purpose <> OLD.purpose
         OR NEW.requested_display_mode <> OLD.requested_display_mode
         OR NEW.idempotency_digest <> OLD.idempotency_digest
         OR NEW.input_hash <> OLD.input_hash
         OR NEW.format <> OLD.format
         OR NEW.filename <> OLD.filename
         OR NEW.warning_count <> OLD.warning_count
         OR NEW.warnings IS DISTINCT FROM OLD.warnings
         OR NEW.authorization_attested IS DISTINCT FROM OLD.authorization_attested
         OR NEW.attested_by <> OLD.attested_by
         OR NEW.attested_at <> OLD.attested_at
         OR NEW.record_count <> OLD.record_count
         OR NEW.content_hash <> OLD.content_hash
         OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'manual import consumption transition is invalid'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NOT owner_member THEN
      RAISE EXCEPTION 'manual import deletion requires an authenticated workspace owner'
        USING ERRCODE = '42501';
    ELSIF OLD.state NOT IN ('staged', 'consumed') OR NEW.state <> 'deleted'
       OR NEW.run_id IS DISTINCT FROM OLD.run_id
       OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
       OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.batch_id <> OLD.batch_id
       OR NEW.campaign_id <> OLD.campaign_id
       OR NEW.source_id <> OLD.source_id
       OR NEW.policy_version <> OLD.policy_version
       OR NEW.purpose <> OLD.purpose
       OR NEW.requested_display_mode <> OLD.requested_display_mode
       OR NEW.idempotency_digest <> OLD.idempotency_digest
       OR NEW.input_hash <> OLD.input_hash
       OR NEW.format <> OLD.format
       OR NEW.filename <> OLD.filename
       OR NEW.warning_count <> OLD.warning_count
       OR NEW.warnings IS DISTINCT FROM OLD.warnings
       OR NEW.authorization_attested IS DISTINCT FROM OLD.authorization_attested
       OR NEW.attested_by <> OLD.attested_by
       OR NEW.attested_at <> OLD.attested_at
       OR NEW.record_count <> OLD.record_count
       OR NEW.content_hash <> OLD.content_hash
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'manual import deletion transition is invalid'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION appsea.enforce_manual_import_record_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  auth_user text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  service_principal text := NULLIF(current_setting('appsea.service_principal', true), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.manual_import_batches batch
     WHERE batch.workspace_id = NEW.workspace_id
       AND batch.batch_id = NEW.batch_id
       AND batch.source_id = 'manual-owner-import'
       AND batch.policy_version IN ('manual-owner-import-v1', 'manual-owner-import-v2')
       AND batch.state IN ('staged', 'consumed')
  ) THEN
    RAISE EXCEPTION 'manual import batch is unavailable' USING ERRCODE = '42501';
  END IF;
  IF service_principal = 'appsea-worker' THEN
    RAISE EXCEPTION 'worker cannot create or redact staged manual records'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = NEW.workspace_id
       AND membership.user_id = auth_user
       AND membership.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'manual record mutation requires an authenticated workspace owner'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

-- The read gate is deliberately current-policy based. It preserves v1
-- history but prevents new collection from using a stale policy snapshot.
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
