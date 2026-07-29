-- Enqueue bounded retention tombstones from the immutable policy snapshot.
-- Propagation remains the single path that redacts evidence and marks
-- dependent report/plan versions unavailable.
CREATE INDEX source_items_retention_scan_idx
  ON appsea.source_items (workspace_id, deletion_state, captured_at)
  WHERE deletion_state = 'active' AND synthetic = false;

CREATE OR REPLACE FUNCTION appsea.enqueue_expired_source_tombstones(
  p_workspace_id text,
  p_occurred_at timestamptz,
  p_batch_size integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  inserted_count integer;
  effective_received_at timestamptz;
  effective_cutoff_at timestamptz;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'retention batch size is outside the supported range'
      USING ERRCODE = '22023';
  END IF;
  IF session_user <> 'appsea_owner'
     AND p_workspace_id IS DISTINCT FROM NULLIF(current_setting('appsea.workspace_id', true), '') THEN
    RAISE EXCEPTION 'retention maintenance workspace context is required'
      USING ERRCODE = '42501';
  END IF;
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'retention occurrence time is required' USING ERRCODE = '22023';
  END IF;
  -- Audit timestamps come from the database clock. A caller may provide a
  -- historical cutoff for a replay, but cannot backdate the tombstone receipt.
  effective_received_at := clock_timestamp();
  effective_cutoff_at := LEAST(p_occurred_at, effective_received_at);

  WITH candidates AS (
    SELECT item.workspace_id, item.source_id, item.source_record_id,
           policy.retention_days
      FROM appsea.source_items item
      JOIN appsea.sources source
        ON source.source_id = item.source_id
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = item.source_id
       AND policy.policy_version = item.source_policy_version
     WHERE item.workspace_id = p_workspace_id
       AND item.synthetic = false
       AND item.deletion_state = 'active'
       AND source.source_type <> 'fixture'
       AND policy.deletion_required
       AND policy.retention_days > 0
       AND COALESCE(policy.policy_payload #>> '{deletion,retentionAction}', 'tombstone')
           IN ('redact', 'tombstone')
       AND item.captured_at <= effective_cutoff_at - policy.retention_days * interval '1 day'
     ORDER BY item.captured_at, item.source_id, item.source_record_id
     LIMIT p_batch_size
     FOR UPDATE OF item SKIP LOCKED
  ), inserted AS (
    INSERT INTO appsea.deletion_tombstones
      (workspace_id, tombstone_id, source_id, source_record_id, reason, state, received_at)
    SELECT workspace_id,
           'retention:' || md5(workspace_id || ':' || source_id || ':' || source_record_id),
           source_id,
           source_record_id,
           'Source retention window elapsed under the recorded policy.',
           'pending',
           effective_received_at
      FROM candidates
    ON CONFLICT (workspace_id, source_id, source_record_id, reason) DO NOTHING
    RETURNING tombstone_id
  )
  SELECT count(*) INTO inserted_count FROM inserted;
  RETURN inserted_count;
END
$$;

REVOKE ALL ON FUNCTION appsea.enqueue_expired_source_tombstones(text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.enqueue_expired_source_tombstones(text, timestamptz, integer)
  TO appsea_service;
