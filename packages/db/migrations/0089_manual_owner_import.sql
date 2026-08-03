-- Owner-authorized, tenant-private imports are the first usable non-fixture
-- source. This migration does not activate a third-party provider: the source
-- accepts only a workspace-owner attestation and stores normalized rows, never
-- raw upload bytes.

CREATE TABLE appsea.manual_import_batches (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  batch_id text NOT NULL CHECK (batch_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  campaign_id text NOT NULL,
  source_id text NOT NULL,
  policy_version text NOT NULL,
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 120),
  requested_display_mode text NOT NULL CHECK (requested_display_mode = 'excerpt'),
  idempotency_digest char(64) NOT NULL CHECK (idempotency_digest ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  format text NOT NULL CHECK (format IN ('csv', 'json')),
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 240),
  record_count integer NOT NULL CHECK (record_count BETWEEN 1 AND 5000),
  warning_count integer NOT NULL CHECK (warning_count BETWEEN 0 AND 500),
  warnings text[] NOT NULL DEFAULT '{}',
  authorization_attested boolean NOT NULL CHECK (authorization_attested),
  attested_by text NOT NULL CHECK (attested_by ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  attested_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('staged', 'consumed', 'deleted', 'failed')),
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  run_id text CHECK (run_id IS NULL OR run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, batch_id),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES appsea.research_campaigns(workspace_id, campaign_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version) ON DELETE RESTRICT,
  UNIQUE (workspace_id, idempotency_digest),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL)),
  CHECK ((state = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (cardinality(warnings) = warning_count),
  CHECK (cardinality(warnings) <= 500)
);

CREATE TABLE appsea.manual_import_records (
  workspace_id text NOT NULL,
  batch_id text NOT NULL,
  record_ordinal integer NOT NULL CHECK (record_ordinal BETWEEN 1 AND 5000),
  source_record_id text NOT NULL CHECK (char_length(source_record_id) BETWEEN 1 AND 200),
  record_payload jsonb,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, batch_id, record_ordinal),
  FOREIGN KEY (workspace_id, batch_id)
    REFERENCES appsea.manual_import_batches(workspace_id, batch_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, batch_id, source_record_id),
  CHECK ((deleted_at IS NULL) = (record_payload IS NOT NULL))
);

CREATE INDEX manual_import_batches_campaign_idx
  ON appsea.manual_import_batches (workspace_id, campaign_id, created_at DESC);
CREATE INDEX manual_import_batches_state_idx
  ON appsea.manual_import_batches (workspace_id, state, created_at DESC);
CREATE INDEX manual_import_records_batch_idx
  ON appsea.manual_import_records (workspace_id, batch_id, record_ordinal);

ALTER TABLE appsea.manual_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.manual_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.manual_import_batches
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.manual_import_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.manual_import_records FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.manual_import_records
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

-- The trigger keeps the owner attestation and state transitions fail-closed
-- even if a future repository accidentally exposes a broader SQL grant.
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
     OR NEW.policy_version <> 'manual-owner-import-v1'
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
       AND batch.policy_version = 'manual-owner-import-v1'
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

DROP TRIGGER IF EXISTS manual_import_batch_boundary_guard
  ON appsea.manual_import_batches;
CREATE TRIGGER manual_import_batch_boundary_guard
BEFORE INSERT OR UPDATE ON appsea.manual_import_batches
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_manual_import_batch_boundary();

DROP TRIGGER IF EXISTS manual_import_record_boundary_guard
  ON appsea.manual_import_records;
CREATE TRIGGER manual_import_record_boundary_guard
BEFORE INSERT OR UPDATE ON appsea.manual_import_records
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_manual_import_record_boundary();

REVOKE ALL ON appsea.manual_import_batches, appsea.manual_import_records FROM PUBLIC;
GRANT SELECT, INSERT ON appsea.manual_import_batches TO appsea_service;
GRANT SELECT, INSERT ON appsea.manual_import_records TO appsea_service;
GRANT UPDATE (state, run_id, consumed_at, deleted_at) ON appsea.manual_import_batches TO appsea_service;
GRANT UPDATE (record_payload, deleted_at) ON appsea.manual_import_records TO appsea_service;

-- Fixed, auditable policy snapshot. The hash is the SHA-256 of the canonical
-- policy payload represented below and is checked by the TypeScript registry.
DO $$
DECLARE
  policy_hash constant text := 'e14fc011ce684f44a0b8a165e2fe2bf6006ba3c0965da4f61aeee5ede6a057d6';
  recorded_at constant timestamptz := '2026-08-03T00:00:00Z';
  source_state text;
BEGIN
  INSERT INTO appsea.sources
    (source_id, display_name, source_type, lifecycle_state, current_policy_version,
     created_at, updated_at)
  VALUES
    ('manual-owner-import', 'Owner-authorized private import', 'manual', 'active',
     'manual-owner-import-v1', recorded_at, recorded_at)
  ON CONFLICT (source_id) DO NOTHING;

  SELECT lifecycle_state INTO source_state
    FROM appsea.sources
   WHERE source_id = 'manual-owner-import'
   FOR UPDATE;
  IF source_state IN ('retired', 'disabled_operator') THEN
    RAISE EXCEPTION 'manual owner-import source is blocked by an operator decision'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO appsea.source_policy_versions
    (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
     access_method, retention_days, deletion_required, attribution_required,
     display_mode, coverage_notes, policy_document_ref, expires_at, policy_payload,
     content_hash, reviewed_at, created_at)
  VALUES
    (
      'manual-owner-import', 'manual-owner-import-v1', 'approved',
      ARRAY['opportunity-research', 'customer-authorized-analysis', 'development', 'testing'],
      'allowed',
      'Authenticated workspace owner uploads a bounded CSV or JSON export they are authorized to analyze; no server-side URL fetching',
      30, true, false, 'excerpt',
      ARRAY[
        'Tenant-private owner-authorized evidence only; it is not public market coverage.',
        'The operator must attest that the workspace is authorized to analyze the imported records.',
        'Only normalized, PII-scrubbed complaint fields are retained; raw upload bytes are discarded.',
        'URL fields are retained only as validated HTTP(S) locators and are never fetched by AppSea.',
        'Deleting a batch clears staged records and propagates tombstones through downstream evidence.'
      ],
      'https://github.com/klimPaskov/appsea/blob/main/docs/product/manual-import-source-policy.md',
      '2026-11-03T00:00:00Z',
      '{
        "sourceId": "manual-owner-import",
        "displayName": "Owner-authorized private import",
        "sourceType": "manual",
        "enabled": true,
        "policyState": "approved",
        "permittedPurposes": ["opportunity-research", "customer-authorized-analysis", "development", "testing"],
        "commercialUse": "allowed",
        "accessMethod": "Authenticated workspace owner uploads a bounded CSV or JSON export they are authorized to analyze; no server-side URL fetching",
        "retentionDays": 30,
        "deletionRequired": true,
        "attributionRequired": false,
        "displayMode": "excerpt",
        "coverageNotes": [
          "Tenant-private owner-authorized evidence only; it is not public market coverage.",
          "The operator must attest that the workspace is authorized to analyze the imported records.",
          "Only normalized, PII-scrubbed complaint fields are retained; raw upload bytes are discarded.",
          "URL fields are retained only as validated HTTP(S) locators and are never fetched by AppSea.",
          "Deleting a batch clears staged records and propagates tombstones through downstream evidence."
        ],
        "reviewedAt": "2026-08-03T00:00:00.000Z",
        "policyOwner": "AppSea internal source-policy review queue",
        "policyDocumentRef": "https://github.com/klimPaskov/appsea/blob/main/docs/product/manual-import-source-policy.md",
        "expiresAt": "2026-11-03T00:00:00.000Z",
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
       AND policy_version = 'manual-owner-import-v1'
       AND policy_state = 'approved'
       AND content_hash = policy_hash
  ) THEN
    RAISE EXCEPTION 'manual owner-import policy snapshot conflicts with immutable content'
      USING ERRCODE = '23505';
  END IF;

  UPDATE appsea.sources
     SET display_name = 'Owner-authorized private import',
         source_type = 'manual',
         lifecycle_state = 'active',
         current_policy_version = 'manual-owner-import-v1',
         updated_at = recorded_at
   WHERE source_id = 'manual-owner-import';

  INSERT INTO appsea.source_policy_reviews
    (review_id, source_id, policy_version, decision, reviewer,
     reviewer_identity, reviewer_role, independence_attested,
     approval_reference, notes, content_hash, reviewed_at, recorded_at)
  VALUES
    (
      'manual-owner-import-review-v1', 'manual-owner-import', 'manual-owner-import-v1',
      'approved', 'AppSea internal source-policy review queue',
      'internal-independent-operator', 'independent_operator', true,
      'https://github.com/klimPaskov/appsea/blob/main/docs/product/manual-import-source-policy.md',
      ARRAY[
        'This is an owner-attested tenant-private intake path, not approval of any third-party source.',
        'Operators must verify authority and privacy expectations for each workspace before use.'
      ],
      policy_hash, recorded_at, recorded_at
    )
  ON CONFLICT (review_id) DO NOTHING;
END
$$;
