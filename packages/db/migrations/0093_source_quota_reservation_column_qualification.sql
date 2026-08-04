-- The original reservation function used unqualified `status` and
-- `requested_records` in an aggregate query while those names are also
-- OUT parameters of the function. PostgreSQL resolves that collision as
-- 42702 (ambiguous_column), so a valid connector request failed after the
-- source lease was acquired. Keep the repair forward-only and qualify every
-- reservation/window column in the function's quota checks.

CREATE OR REPLACE FUNCTION appsea.reserve_source_quota(
  p_workspace_id text,
  p_reservation_id text,
  p_source_id text,
  p_policy_version text,
  p_run_id text,
  p_idempotency_key text,
  p_requested_records integer,
  p_requested_cost_micros bigint,
  p_expires_at timestamptz,
  p_occurred_at timestamptz
)
RETURNS TABLE (
  reservation_id text,
  status text,
  replayed boolean,
  requested_records integer,
  requested_cost_micros bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  source_row appsea.sources%ROWTYPE;
  policy_row appsea.source_policy_versions%ROWTYPE;
  window_start timestamptz;
  now_at timestamptz := clock_timestamp();
  max_requests integer;
  max_records_per_run integer;
  existing appsea.source_quota_reservations%ROWTYPE;
  used_records integer;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source quota workspace context is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_reservation_id !~ '^[a-z][a-z0-9_:-]{2,239}$'
     OR p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_policy_version IS NULL
     OR char_length(p_policy_version) NOT BETWEEN 1 AND 80
     OR p_run_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_idempotency_key !~ '^[a-f0-9]{64}$'
     OR p_requested_records NOT BETWEEN 1 AND 5000
     OR p_requested_cost_micros NOT BETWEEN 0 AND 1000000000000
     OR p_expires_at <= now_at
     OR p_expires_at > now_at + interval '1 hour' THEN
    RAISE EXCEPTION 'invalid source quota reservation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('source-quota:' || p_source_id || ':' || p_policy_version, 0)
  );

  SELECT source.* INTO source_row
    FROM appsea.sources AS source
   WHERE source.source_id = p_source_id
   FOR UPDATE;
  SELECT policy.* INTO policy_row
    FROM appsea.source_policy_versions AS policy
   WHERE policy.source_id = p_source_id
     AND policy.policy_version = p_policy_version
   FOR UPDATE;
  IF source_row.source_id IS NULL OR policy_row.source_id IS NULL
     OR source_row.lifecycle_state <> 'active'
     OR source_row.current_policy_version <> p_policy_version
     OR policy_row.policy_state <> 'approved'
     OR policy_row.commercial_use NOT IN ('allowed', 'restricted')
     OR policy_row.reviewed_at IS NULL
     OR (policy_row.expires_at IS NOT NULL AND policy_row.expires_at <= now_at) THEN
    RAISE EXCEPTION 'source policy does not permit quota reservation' USING ERRCODE = '42501';
  END IF;

  max_requests := (policy_row.policy_payload #>> '{quota,requestsPerMinute}')::integer;
  max_records_per_run := (policy_row.policy_payload #>> '{quota,maxRecordsPerRun}')::integer;
  IF max_requests IS NULL OR max_requests < 1
     OR max_records_per_run IS NULL OR max_records_per_run < 1 THEN
    RAISE EXCEPTION 'source policy quota metadata is incomplete' USING ERRCODE = '42501';
  END IF;

  SELECT reservation.* INTO existing
    FROM appsea.source_quota_reservations AS reservation
   WHERE reservation.workspace_id = p_workspace_id
     AND reservation.source_id = p_source_id
     AND reservation.policy_version = p_policy_version
     AND reservation.idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF existing.reservation_id IS NOT NULL THEN
    IF existing.reservation_id <> p_reservation_id
       OR existing.run_id <> p_run_id
       OR existing.requested_records <> p_requested_records
       OR existing.requested_cost_micros <> p_requested_cost_micros THEN
      RAISE EXCEPTION 'source quota idempotency key conflicts with prior request'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing.reservation_id, existing.status, true,
                        existing.requested_records, existing.requested_cost_micros;
    RETURN;
  END IF;

  window_start := date_trunc('minute', now_at);
  INSERT INTO appsea.source_quota_windows
    (source_id, policy_version, window_started_at, request_count, record_count, updated_at)
  VALUES (p_source_id, p_policy_version, window_start, 0, 0, now_at)
  ON CONFLICT (source_id, policy_version, window_started_at) DO NOTHING;
  PERFORM 1
    FROM appsea.source_quota_windows AS quota_window
   WHERE quota_window.source_id = p_source_id
     AND quota_window.policy_version = p_policy_version
     AND quota_window.window_started_at = window_start
   FOR UPDATE;

  IF (SELECT quota_window.request_count + 1
        FROM appsea.source_quota_windows AS quota_window
       WHERE quota_window.source_id = p_source_id
         AND quota_window.policy_version = p_policy_version
         AND quota_window.window_started_at = window_start) > max_requests THEN
    RAISE EXCEPTION 'source requests-per-minute quota exceeded' USING ERRCODE = '54000';
  END IF;

  SELECT COALESCE(sum(reservation.requested_records), 0)::integer INTO used_records
    FROM appsea.source_quota_reservations AS reservation
   WHERE reservation.workspace_id = p_workspace_id
     AND reservation.source_id = p_source_id
     AND reservation.policy_version = p_policy_version
     AND reservation.run_id = p_run_id
     AND reservation.status IN ('reserved', 'committed');
  IF used_records + p_requested_records > max_records_per_run THEN
    RAISE EXCEPTION 'source per-run record quota exceeded' USING ERRCODE = '54000';
  END IF;

  INSERT INTO appsea.source_quota_reservations
    (workspace_id, reservation_id, source_id, policy_version, run_id, idempotency_key,
     window_started_at, requested_records, requested_cost_micros, status, reserved_at, expires_at)
  VALUES
    (p_workspace_id, p_reservation_id, p_source_id, p_policy_version, p_run_id, p_idempotency_key,
     window_start, p_requested_records, p_requested_cost_micros, 'reserved', now_at, p_expires_at);
  UPDATE appsea.source_quota_windows AS quota_window
     SET request_count = quota_window.request_count + 1,
         record_count = quota_window.record_count + p_requested_records,
         updated_at = now_at
   WHERE quota_window.source_id = p_source_id
     AND quota_window.policy_version = p_policy_version
     AND quota_window.window_started_at = window_start;
  RETURN QUERY SELECT p_reservation_id, 'reserved'::text, false,
                      p_requested_records, p_requested_cost_micros;
END
$$;

