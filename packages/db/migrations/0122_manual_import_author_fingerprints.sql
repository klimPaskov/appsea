BEGIN;

-- Owner-import v3 adds an explicitly reviewed, privacy-minimized author
-- identity capability. The source item retains only a workspace-scoped digest;
-- raw author keys are never staged or persisted.
ALTER TABLE appsea.source_items
  ADD COLUMN author_fingerprint char(64)
    CHECK (author_fingerprint IS NULL OR author_fingerprint ~ '^[a-f0-9]{64}$');

ALTER TABLE appsea.source_items
  DROP CONSTRAINT IF EXISTS source_items_redacted_fields_check;
ALTER TABLE appsea.source_items
  ADD CONSTRAINT source_items_redacted_fields_check
  CHECK (
    array_position(redacted_fields, NULL) IS NULL
    AND redacted_fields <@ ARRAY['canonicalLocator', 'authorFingerprint']::text[]
  );

ALTER TABLE appsea.evidence_redaction_events
  DROP CONSTRAINT IF EXISTS evidence_redaction_events_fields_check;
ALTER TABLE appsea.evidence_redaction_events
  ADD CONSTRAINT evidence_redaction_events_fields_check
  CHECK (
    cardinality(fields) BETWEEN 1 AND 7
    AND array_position(fields, NULL) IS NULL
    AND fields <@
      ARRAY['text', 'product', 'company', 'feature', 'category', 'canonicalLocator', 'authorFingerprint']::text[]
  );

GRANT UPDATE (author_fingerprint)
  ON appsea.source_items TO appsea_service;

DO $$
DECLARE
  policy_hash constant text := '8febd0d831800801488447c49c6614a61274f5ade39bd3bf6133ba15a2ee0241';
  recorded_at constant timestamptz := '2026-08-10T00:00:00Z';
BEGIN
  INSERT INTO appsea.source_policy_versions
    (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
     access_method, retention_days, deletion_required, attribution_required,
     display_mode, coverage_notes, policy_document_ref, expires_at, policy_payload,
     content_hash, reviewed_at, created_at)
  VALUES
    (
      'manual-owner-import', 'manual-owner-import-v3', 'approved',
      ARRAY['opportunity-research', 'customer-authorized-analysis', 'competitor-research', 'contrary-evidence', 'development', 'testing'],
      'allowed',
      'Authenticated workspace owner uploads a bounded CSV or JSON export they are authorized to analyze; no server-side URL fetching',
      30, true, false, 'excerpt',
      ARRAY[
        'Tenant-private owner-authorized evidence only; it is not public market coverage.',
        'Competitor and contrary-signal claims are private owner-attested research and require separate human observation review.',
        'The operator must attest that the workspace is authorized to analyze the imported records.',
        'Only normalized, PII-scrubbed complaint fields are retained; raw upload bytes are discarded.',
        'If an authorized export supplies an author key, only a workspace-scoped SHA-256 fingerprint is retained; raw author identifiers are discarded.',
        'Author fingerprints are used only for bounded independent-author counts and are cleared by source deletion or explicit author-field redaction.',
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
          "If an authorized export supplies an author key, only a workspace-scoped SHA-256 fingerprint is retained; raw author identifiers are discarded.",
          "Author fingerprints are used only for bounded independent-author counts and are cleared by source deletion or explicit author-field redaction.",
          "URL fields are retained only as validated HTTP(S) locators and are never fetched by AppSea.",
          "Deleting a batch clears staged records and propagates tombstones through downstream evidence."
        ],
        "reviewedAt": "2026-08-05T00:00:00.000Z",
        "policyOwner": "AppSea internal source-policy review queue",
        "policyDocumentRef": "https://github.com/klimPaskov/appsea/blob/main/docs/product/manual-import-source-policy.md",
        "expiresAt": "2026-11-05T00:00:00.000Z",
        "authorIdentity": {
          "mode": "workspace-opaque",
          "inputFields": ["author_key", "author_id", "author_fingerprint"],
          "retention": "fingerprint-only",
          "hashing": "workspace-scoped-sha256"
        },
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
       AND policy_version = 'manual-owner-import-v3'
       AND policy_state = 'approved'
       AND content_hash = policy_hash
  ) THEN
    RAISE EXCEPTION 'manual owner-import v3 policy snapshot conflicts with immutable content'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO appsea.source_policy_reviews
    (review_id, source_id, policy_version, decision, reviewer,
     reviewer_identity, reviewer_role, independence_attested,
     approval_reference, notes, content_hash, reviewed_at, recorded_at)
  VALUES
    (
      'manual-owner-import-review-v3', 'manual-owner-import', 'manual-owner-import-v3',
      'approved', 'AppSea internal source-policy review queue',
      'internal-independent-operator', 'independent_operator', true,
      'https://github.com/klimPaskov/appsea/blob/main/docs/product/manual-import-source-policy.md',
      ARRAY[
        'This additive version remains owner-attested and tenant-private; it is not approval of a third-party source.',
        'Author keys are reduced to workspace-scoped opaque fingerprints before staging and are never displayed as raw identity.',
        'Competitor and contrary-signal claims must be linked to retained evidence and reviewed separately before they affect research state.',
        'Operators must verify authority and privacy expectations for each workspace before use.'
      ],
      policy_hash, recorded_at, recorded_at
    )
  ON CONFLICT (review_id) DO NOTHING;

  -- The source activation trigger requires a complete review set. Record the
  -- v3 approval before promoting the source so a fresh install and an upgrade
  -- follow the same fail-closed ordering.
  UPDATE appsea.sources
     SET current_policy_version = 'manual-owner-import-v3',
         updated_at = recorded_at
   WHERE source_id = 'manual-owner-import'
     AND lifecycle_state NOT IN ('retired', 'disabled_operator');
END
$$;

-- Re-apply the latest owner-import state machine with the v3 snapshot in its
-- immutable allowlist. Historical v1/v2 batches remain readable and deletable.
CREATE OR REPLACE FUNCTION appsea.enforce_manual_import_batch_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  auth_user text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  service_principal text := NULLIF(current_setting('appsea.service_principal', true), '');
  maintenance_fence_asserted boolean :=
    current_setting('appsea.maintenance_fence_asserted', true) = 'true';
  owner_member boolean;
BEGIN
  IF NEW.source_id <> 'manual-owner-import'
     OR NEW.policy_version NOT IN ('manual-owner-import-v1', 'manual-owner-import-v2', 'manual-owner-import-v3')
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
    IF service_principal IN ('appsea-worker', 'appsea-maintenance')
       OR NOT owner_member
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
    ELSIF service_principal = 'appsea-maintenance' AND maintenance_fence_asserted THEN
      IF OLD.state NOT IN ('staged', 'consumed') OR NEW.state <> 'deleted'
         OR NEW.run_id IS DISTINCT FROM OLD.run_id
         OR NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
         OR NEW.deleted_at IS NULL
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
        RAISE EXCEPTION 'manual import retention deletion transition is invalid'
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
  maintenance_fence_asserted boolean :=
    current_setting('appsea.maintenance_fence_asserted', true) = 'true';
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.manual_import_batches batch
     WHERE batch.workspace_id = NEW.workspace_id
       AND batch.batch_id = NEW.batch_id
       AND batch.source_id = 'manual-owner-import'
       AND batch.policy_version IN ('manual-owner-import-v1', 'manual-owner-import-v2', 'manual-owner-import-v3')
       AND batch.state IN ('staged', 'consumed')
  ) THEN
    RAISE EXCEPTION 'manual import batch is unavailable' USING ERRCODE = '42501';
  END IF;
  IF service_principal = 'appsea-worker' THEN
    RAISE EXCEPTION 'worker cannot create or redact staged manual records'
      USING ERRCODE = '42501';
  ELSIF service_principal = 'appsea-maintenance' AND maintenance_fence_asserted THEN
    IF TG_OP <> 'UPDATE'
       OR OLD.workspace_id <> NEW.workspace_id
       OR OLD.batch_id <> NEW.batch_id
       OR OLD.record_ordinal <> NEW.record_ordinal
       OR OLD.source_record_id <> NEW.source_record_id
       OR OLD.content_hash <> NEW.content_hash
       OR OLD.created_at <> NEW.created_at
       OR OLD.record_payload IS NULL
       OR NEW.record_payload IS NOT NULL
       OR OLD.deleted_at IS NOT NULL
       OR NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'manual import retention record deletion transition is invalid'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
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

-- Keep the current-policy read gate on the complete reviewer invariant while
-- allowing v3 to become the current owner-import snapshot.
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
     OR p_policy_version NOT IN ('manual-owner-import-v1', 'manual-owner-import-v2', 'manual-owner-import-v3')
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

-- Extend the existing monotonic redaction operation to clear the opaque author
-- digest without ever copying a raw identity into the evidence projection.
CREATE OR REPLACE FUNCTION appsea.apply_evidence_field_redaction(
  p_workspace_id text,
  p_evidence_id text,
  p_redaction_id text,
  p_fields text[],
  p_reason text
)
RETURNS TABLE (
  redaction_id text,
  evidence_id text,
  fields text[],
  reason text,
  redacted_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  actor_role text;
  canonical_fields text[];
  evidence_fields text[];
  source_fields text[];
  existing_redaction record;
  evidence_row record;
  redacted_at_value timestamptz;
BEGIN
  IF p_workspace_id IS DISTINCT FROM NULLIF(current_setting('appsea.workspace_id', true), '') THEN
    RAISE EXCEPTION 'evidence redaction workspace context is invalid' USING ERRCODE = '42501';
  END IF;
  actor_id := NULLIF(current_setting('appsea.auth_user_id', true), '');
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'evidence redaction requires an authenticated actor' USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
    JOIN appsea.workspaces workspace
      ON workspace.workspace_id = membership.workspace_id
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = actor_id
     AND workspace.status = 'active';
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'evidence redaction requires an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;

  IF p_evidence_id IS NULL
     OR p_redaction_id IS NULL
     OR p_reason IS NULL
     OR p_evidence_id !~ '^[a-z][a-z0-9_:-]{2,239}$'
     OR p_redaction_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_reason NOT IN ('pii', 'legal_request', 'policy_minimization', 'operator_correction')
     OR p_fields IS NULL
     OR cardinality(p_fields) NOT BETWEEN 1 AND 7
     OR EXISTS (
       SELECT 1
         FROM unnest(p_fields) AS input_field(field_value)
        WHERE field_value IS NULL
           OR field_value NOT IN ('text', 'product', 'company', 'feature', 'category', 'canonicalLocator', 'authorFingerprint')
     ) THEN
    RAISE EXCEPTION 'evidence redaction input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(field ORDER BY field)
    INTO canonical_fields
    FROM (
      SELECT DISTINCT field_value
        FROM unnest(p_fields) AS input_field(field_value)
    ) AS distinct_fields(field);
  evidence_fields := ARRAY(
    SELECT field_value
      FROM unnest(canonical_fields) AS canonical_field(field_value)
     WHERE field_value NOT IN ('canonicalLocator', 'authorFingerprint')
  );
  source_fields := ARRAY(
    SELECT field_value
      FROM unnest(canonical_fields) AS canonical_field(field_value)
     WHERE field_value IN ('canonicalLocator', 'authorFingerprint')
  );

  SELECT event.redaction_id, event.evidence_id, event.fields, event.reason,
         event.created_at
    INTO existing_redaction
    FROM appsea.evidence_redaction_events event
   WHERE event.workspace_id = p_workspace_id
     AND event.redaction_id = p_redaction_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_redaction.evidence_id <> p_evidence_id
       OR existing_redaction.fields <> canonical_fields
       OR existing_redaction.reason <> p_reason THEN
      RAISE EXCEPTION 'evidence redaction identifier conflicts with an existing event'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT p_redaction_id, p_evidence_id, canonical_fields, p_reason,
                        existing_redaction.created_at, true;
    RETURN;
  END IF;

  SELECT evidence.evidence_id, evidence.source_item_id, evidence.content_hash,
         evidence.deletion_state AS evidence_state,
         source_item.deletion_state AS source_state,
         source_item.raw_object_ref
    INTO evidence_row
    FROM appsea.evidence_records evidence
    JOIN appsea.source_items source_item
      ON source_item.workspace_id = evidence.workspace_id
     AND source_item.source_item_id = evidence.source_item_id
   WHERE evidence.workspace_id = p_workspace_id
     AND evidence.evidence_id = p_evidence_id
   FOR UPDATE OF evidence, source_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence redaction target was not found' USING ERRCODE = '23503';
  END IF;
  IF evidence_row.evidence_state <> 'active' OR evidence_row.source_state <> 'active' THEN
    RAISE EXCEPTION 'only active evidence can be field-redacted' USING ERRCODE = '23514';
  END IF;
  IF evidence_row.raw_object_ref IS NOT NULL AND 'text' = ANY(canonical_fields) THEN
    RAISE EXCEPTION 'text redaction requires source-object deletion through the source policy path'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('appsea.evidence_redaction_id', p_redaction_id, true);
  UPDATE appsea.evidence_records evidence
     SET normalized_text = CASE
           WHEN 'text' = ANY(canonical_fields)
           THEN '[Content redacted by workspace privacy policy]'
           ELSE evidence.normalized_text
         END,
         product_candidate = CASE
           WHEN 'product' = ANY(canonical_fields)
           THEN '[Field redacted by workspace privacy policy]'
           ELSE evidence.product_candidate
         END,
         company_candidate = CASE
           WHEN 'company' = ANY(canonical_fields)
           THEN '[Field redacted by workspace privacy policy]'
           ELSE evidence.company_candidate
         END,
         feature_candidate = CASE
           WHEN 'feature' = ANY(canonical_fields)
           THEN '[Field redacted by workspace privacy policy]'
           ELSE evidence.feature_candidate
         END,
         category_candidate = CASE
           WHEN 'category' = ANY(canonical_fields)
           THEN '[Field redacted by workspace privacy policy]'
           ELSE evidence.category_candidate
         END,
         redacted = true,
         redacted_fields = (
           SELECT COALESCE(ARRAY_AGG(DISTINCT field ORDER BY field), '{}'::text[])
             FROM unnest(evidence.redacted_fields || evidence_fields) AS evidence_field(field)
         )
   WHERE evidence.workspace_id = p_workspace_id
     AND evidence.evidence_id = p_evidence_id;

  UPDATE appsea.source_items source_item
     SET canonical_locator = CASE
           WHEN 'canonicalLocator' = ANY(canonical_fields) THEN NULL
           ELSE source_item.canonical_locator
         END,
         author_fingerprint = CASE
           WHEN 'authorFingerprint' = ANY(canonical_fields) THEN NULL
           ELSE source_item.author_fingerprint
         END,
         redacted_fields = (
           SELECT COALESCE(ARRAY_AGG(DISTINCT field ORDER BY field), '{}'::text[])
             FROM unnest(
               source_item.redacted_fields || source_fields
             ) AS source_field(field)
         )
   WHERE source_item.workspace_id = p_workspace_id
     AND source_item.source_item_id = evidence_row.source_item_id;

  redacted_at_value := clock_timestamp();
  INSERT INTO appsea.evidence_redaction_events
    (workspace_id, redaction_id, evidence_id, fields, reason,
     original_content_hash, actor_id, created_at)
  VALUES
    (p_workspace_id, p_redaction_id, p_evidence_id, canonical_fields, p_reason,
     evidence_row.content_hash, actor_id, redacted_at_value);

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id,
     'audit:evidence-redaction:' || md5(p_workspace_id || ':' || p_redaction_id),
     'user', actor_id, 'evidence.redacted', 'evidence_record', p_evidence_id,
     p_redaction_id,
     jsonb_build_object(
       'redactionId', p_redaction_id,
       'evidenceId', p_evidence_id,
       'fields', to_jsonb(canonical_fields),
       'reason', p_reason,
       'redactionVersion', 'evidence-redaction-v1'
     ),
     redacted_at_value)
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (p_workspace_id,
     'outbox:evidence-redaction:' || md5(p_workspace_id || ':' || p_redaction_id),
     'evidence.redacted', 'evidence_record', p_evidence_id,
     'evidence-redaction-v1', p_redaction_id,
     jsonb_build_object(
       'workspaceId', p_workspace_id,
       'redactionId', p_redaction_id,
       'evidenceId', p_evidence_id,
       'fields', to_jsonb(canonical_fields),
       'reason', p_reason
     ),
     redacted_at_value)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('appsea.evidence_redaction_id', '', true);
  RETURN QUERY SELECT p_redaction_id, p_evidence_id, canonical_fields, p_reason,
                      redacted_at_value, false;
END
$$;

REVOKE ALL ON FUNCTION appsea.apply_evidence_field_redaction(
  text, text, text, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.apply_evidence_field_redaction(
  text, text, text, text[], text
) TO appsea_service;

-- A completed source deletion must clear the digest even if object storage is
-- unavailable; the database deletion propagation remains the authority.
COMMENT ON COLUMN appsea.source_items.author_fingerprint IS
  'Workspace-scoped opaque author digest; raw author identity is never retained.';

COMMIT;
