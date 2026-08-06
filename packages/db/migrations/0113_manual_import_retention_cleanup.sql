-- Expire tenant-private owner-import staging through the same fenced service
-- transaction as the rest of source maintenance. The immutable policy snapshot
-- controls the cutoff; deletion still propagates through source tombstones.

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
       AND batch.policy_version IN ('manual-owner-import-v1', 'manual-owner-import-v2')
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

CREATE OR REPLACE FUNCTION appsea.purge_expired_manual_import_batches(
  p_workspace_id text,
  p_occurred_at timestamptz,
  p_batch_size integer,
  p_scheduler_name text,
  p_owner_id text,
  p_lease_token text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  candidate record;
  purged_count integer := 0;
  effective_received_at timestamptz;
  effective_cutoff_at timestamptz;
  fence_valid boolean;
BEGIN
  IF session_user <> 'appsea_service'
     OR p_workspace_id IS NULL
     OR p_workspace_id IS DISTINCT FROM NULLIF(current_setting('appsea.workspace_id', true), '') THEN
    RAISE EXCEPTION 'manual import retention requires a service workspace context'
      USING ERRCODE = '42501';
  END IF;
  IF p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'manual import retention batch size is outside the supported range'
      USING ERRCODE = '22023';
  END IF;
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'manual import retention occurrence time is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT appsea.assert_maintenance_scheduler_lease(
    p_scheduler_name, p_owner_id, p_lease_token
  ) INTO fence_valid;
  IF fence_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'manual import retention scheduler fence was rejected'
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('appsea.service_principal', 'appsea-maintenance', true);
  PERFORM set_config('appsea.maintenance_fence_asserted', 'true', true);

  effective_received_at := clock_timestamp();
  effective_cutoff_at := LEAST(p_occurred_at, effective_received_at);

  FOR candidate IN
    SELECT batch.workspace_id, batch.batch_id, batch.campaign_id,
           batch.policy_version, policy.retention_days
      FROM appsea.manual_import_batches batch
      JOIN appsea.sources source
        ON source.source_id = batch.source_id
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = batch.source_id
       AND policy.policy_version = batch.policy_version
     WHERE batch.workspace_id = p_workspace_id
       AND batch.source_id = 'manual-owner-import'
       AND batch.state IN ('staged', 'consumed')
       AND policy.policy_state = 'approved'
       AND policy.deletion_required
       AND policy.retention_days > 0
       AND COALESCE(policy.policy_payload #>> '{deletion,retentionAction}', 'tombstone')
           IN ('redact', 'tombstone')
       AND batch.created_at <= effective_cutoff_at - policy.retention_days * interval '1 day'
     ORDER BY batch.created_at, batch.batch_id
     LIMIT p_batch_size
     FOR UPDATE OF batch SKIP LOCKED
  LOOP
    -- Link tombstones through the completed run snapshot rather than parsing
    -- the scoped source ID. Batch IDs may contain ':' and long record IDs use
    -- a connector-side SHA-256 projection that PostgreSQL does not need to
    -- reproduce here.
    INSERT INTO appsea.deletion_tombstones
      (workspace_id, tombstone_id, source_id, source_record_id, reason, state,
       received_at, next_attempt_at)
    SELECT DISTINCT item.workspace_id,
           'manual-retention:' || md5(
             item.workspace_id || ':' || item.source_id || ':' || item.source_record_id
             || ':owner-import-retention'
           ),
           item.source_id,
           item.source_record_id,
           'owner-import-retention-expired',
           'pending',
           effective_received_at,
           effective_received_at
      FROM appsea.source_items item
      JOIN appsea.research_run_source_items run_item
        ON run_item.workspace_id = item.workspace_id
       AND run_item.source_item_id = item.source_item_id
      JOIN appsea.research_runs run
        ON run.workspace_id = run_item.workspace_id
       AND run.run_id = run_item.run_id
     WHERE item.workspace_id = candidate.workspace_id
       AND item.source_id = 'manual-owner-import'
       AND item.source_policy_version = candidate.policy_version
       AND run.campaign_id = candidate.campaign_id
       AND run.artifact_snapshot #>> '{manualImportBatchId}' = candidate.batch_id
       AND item.deletion_state NOT IN ('source_deleted', 'workspace_deleted')
    ON CONFLICT (workspace_id, source_id, source_record_id, reason) DO NOTHING;

    UPDATE appsea.manual_import_records
       SET record_payload = NULL, deleted_at = effective_received_at
     WHERE workspace_id = candidate.workspace_id
       AND batch_id = candidate.batch_id;

    UPDATE appsea.manual_import_batches
       SET state = 'deleted', deleted_at = effective_received_at
     WHERE workspace_id = candidate.workspace_id
       AND batch_id = candidate.batch_id;

    INSERT INTO appsea.audit_events
      (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
       target_id, correlation_id, metadata, occurred_at)
    VALUES (
      candidate.workspace_id,
      'manual-retention-audit:' || md5(candidate.workspace_id || ':' || candidate.batch_id),
      'system',
      'appsea-source-maintenance-v1',
      'research.manual_import.retention_expired',
      'manual_import_batch',
      candidate.batch_id,
      candidate.batch_id,
      jsonb_build_object(
        'policyVersion', candidate.policy_version,
        'retentionDays', candidate.retention_days,
        'stagedPayloadPurged', true
      ),
      effective_received_at
    )
    ON CONFLICT DO NOTHING;

    purged_count := purged_count + 1;
  END LOOP;

  RETURN purged_count;
END
$$;

REVOKE ALL ON FUNCTION appsea.purge_expired_manual_import_batches(
  text, timestamptz, integer, text, text, text
) FROM PUBLIC, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.purge_expired_manual_import_batches(
  text, timestamptz, integer, text, text, text
) TO appsea_service;
