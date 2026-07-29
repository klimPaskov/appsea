-- Source quotas are shared across workspaces. Reservation state is kept in a
-- workspace-scoped table for auditability while minute windows remain global.
-- Runtime code may call only the security-definer functions below; it cannot
-- rewrite counters or policy payloads directly.
CREATE TABLE appsea.source_quota_windows (
  source_id text NOT NULL,
  policy_version text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  record_count integer NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (source_id, policy_version, window_started_at),
  FOREIGN KEY (source_id, policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version) ON DELETE RESTRICT
);

CREATE TABLE appsea.source_quota_reservations (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  reservation_id text NOT NULL CHECK (
    char_length(reservation_id) BETWEEN 3 AND 240
    AND reservation_id ~ '^[a-z][a-z0-9_:-]*$'
  ),
  source_id text NOT NULL,
  policy_version text NOT NULL,
  run_id text NOT NULL CHECK (run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  idempotency_key char(64) NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  requested_records integer NOT NULL CHECK (requested_records BETWEEN 1 AND 5000),
  requested_cost_micros bigint NOT NULL CHECK (requested_cost_micros BETWEEN 0 AND 1000000000000),
  actual_records integer,
  actual_cost_micros bigint,
  status text NOT NULL CHECK (status IN ('reserved', 'committed', 'released', 'expired')),
  reserved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  PRIMARY KEY (workspace_id, reservation_id),
  UNIQUE (workspace_id, source_id, policy_version, idempotency_key),
  FOREIGN KEY (source_id, policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version) ON DELETE RESTRICT,
  CHECK (expires_at > reserved_at),
  CHECK (actual_records IS NULL OR actual_records BETWEEN 0 AND requested_records),
  CHECK (actual_cost_micros IS NULL OR actual_cost_micros BETWEEN 0 AND requested_cost_micros),
  CHECK ((status = 'reserved') = (settled_at IS NULL)),
  CHECK (status = 'reserved' OR settled_at IS NOT NULL)
);

CREATE INDEX source_quota_reservations_expiry_idx
  ON appsea.source_quota_reservations (expires_at)
  WHERE status = 'reserved';
CREATE INDEX source_quota_reservations_run_idx
  ON appsea.source_quota_reservations (workspace_id, source_id, policy_version, run_id, status);

ALTER TABLE appsea.source_quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.source_quota_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.source_quota_reservations
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

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

  SELECT * INTO source_row
    FROM appsea.sources
   WHERE source_id = p_source_id
   FOR UPDATE;
  SELECT * INTO policy_row
    FROM appsea.source_policy_versions
   WHERE source_id = p_source_id AND policy_version = p_policy_version
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

  SELECT * INTO existing
    FROM appsea.source_quota_reservations
   WHERE workspace_id = p_workspace_id
     AND source_id = p_source_id
     AND policy_version = p_policy_version
     AND idempotency_key = p_idempotency_key
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
    FROM appsea.source_quota_windows
   WHERE source_id = p_source_id
     AND policy_version = p_policy_version
     AND window_started_at = window_start
   FOR UPDATE;

  IF (SELECT request_count + 1
        FROM appsea.source_quota_windows
       WHERE source_id = p_source_id
         AND policy_version = p_policy_version
         AND window_started_at = window_start) > max_requests THEN
    RAISE EXCEPTION 'source requests-per-minute quota exceeded' USING ERRCODE = '54000';
  END IF;

  SELECT COALESCE(sum(requested_records), 0)::integer INTO used_records
    FROM appsea.source_quota_reservations
   WHERE workspace_id = p_workspace_id
     AND source_id = p_source_id
     AND policy_version = p_policy_version
     AND run_id = p_run_id
     AND status IN ('reserved', 'committed');
  IF used_records + p_requested_records > max_records_per_run THEN
    RAISE EXCEPTION 'source per-run record quota exceeded' USING ERRCODE = '54000';
  END IF;

  INSERT INTO appsea.source_quota_reservations
    (workspace_id, reservation_id, source_id, policy_version, run_id, idempotency_key,
     window_started_at, requested_records, requested_cost_micros, status, reserved_at, expires_at)
  VALUES
    (p_workspace_id, p_reservation_id, p_source_id, p_policy_version, p_run_id, p_idempotency_key,
     window_start, p_requested_records, p_requested_cost_micros, 'reserved', now_at, p_expires_at);
  UPDATE appsea.source_quota_windows
     SET request_count = request_count + 1,
         record_count = record_count + p_requested_records,
         updated_at = now_at
   WHERE source_id = p_source_id
     AND policy_version = p_policy_version
     AND window_started_at = window_start;
  RETURN QUERY SELECT p_reservation_id, 'reserved'::text, false,
                      p_requested_records, p_requested_cost_micros;
END
$$;

CREATE OR REPLACE FUNCTION appsea.commit_source_quota_reservation(
  p_workspace_id text,
  p_reservation_id text,
  p_actual_records integer,
  p_actual_cost_micros bigint,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  reservation appsea.source_quota_reservations%ROWTYPE;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source quota workspace context is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_actual_records < 0 OR p_actual_cost_micros < 0 THEN
    RAISE EXCEPTION 'invalid source quota settlement' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO reservation
    FROM appsea.source_quota_reservations
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id
   FOR UPDATE;
  IF reservation.reservation_id IS NULL THEN
    RAISE EXCEPTION 'source quota reservation does not exist' USING ERRCODE = '23503';
  END IF;
  IF reservation.status = 'committed' THEN
    IF reservation.actual_records <> p_actual_records
       OR reservation.actual_cost_micros <> p_actual_cost_micros THEN
      RAISE EXCEPTION 'source quota settlement conflicts with prior commit' USING ERRCODE = '23505';
    END IF;
    RETURN;
  END IF;
  IF reservation.status <> 'reserved'
     OR p_actual_records > reservation.requested_records
     OR p_actual_cost_micros > reservation.requested_cost_micros THEN
    RAISE EXCEPTION 'source quota reservation cannot be committed' USING ERRCODE = '23514';
  END IF;
  UPDATE appsea.source_quota_reservations
     SET status = 'committed', actual_records = p_actual_records,
         actual_cost_micros = p_actual_cost_micros, settled_at = clock_timestamp()
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.release_source_quota_reservation(
  p_workspace_id text,
  p_reservation_id text,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  reservation appsea.source_quota_reservations%ROWTYPE;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source quota workspace context is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO reservation
    FROM appsea.source_quota_reservations
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id
   FOR UPDATE;
  IF reservation.reservation_id IS NULL THEN
    RAISE EXCEPTION 'source quota reservation does not exist' USING ERRCODE = '23503';
  END IF;
  IF reservation.status <> 'reserved' THEN RETURN; END IF;
  UPDATE appsea.source_quota_windows
     SET request_count = GREATEST(0, request_count - 1),
         record_count = GREATEST(0, record_count - reservation.requested_records),
         updated_at = clock_timestamp()
   WHERE source_id = reservation.source_id
     AND policy_version = reservation.policy_version
     AND window_started_at = reservation.window_started_at;
  UPDATE appsea.source_quota_reservations
     SET status = 'released', settled_at = clock_timestamp()
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.expire_source_quota_reservations(
  p_before timestamptz,
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  reservation appsea.source_quota_reservations%ROWTYPE;
  expired_count integer := 0;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid source quota expiry batch size' USING ERRCODE = '22023';
  END IF;
  FOR reservation IN
    SELECT *
      FROM appsea.source_quota_reservations
     WHERE status = 'reserved' AND expires_at <= p_before
     ORDER BY expires_at, reservation_id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE appsea.source_quota_windows
       SET request_count = GREATEST(0, request_count - 1),
           record_count = GREATEST(0, record_count - reservation.requested_records),
           updated_at = clock_timestamp()
     WHERE source_id = reservation.source_id
       AND policy_version = reservation.policy_version
       AND window_started_at = reservation.window_started_at;
    UPDATE appsea.source_quota_reservations
       SET status = 'expired', settled_at = clock_timestamp()
     WHERE workspace_id = reservation.workspace_id AND reservation_id = reservation.reservation_id;
    expired_count := expired_count + 1;
  END LOOP;
  RETURN expired_count;
END
$$;

REVOKE ALL ON appsea.source_quota_windows, appsea.source_quota_reservations FROM PUBLIC;
REVOKE ALL ON appsea.source_quota_windows, appsea.source_quota_reservations FROM appsea_service;
GRANT SELECT ON appsea.source_quota_reservations TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.reserve_source_quota(
  text, text, text, text, text, text, integer, bigint, timestamptz, timestamptz
) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.commit_source_quota_reservation(
  text, text, integer, bigint, timestamptz
) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.release_source_quota_reservation(
  text, text, timestamptz
) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.expire_source_quota_reservations(timestamptz, integer)
  TO appsea_service;
REVOKE ALL ON FUNCTION appsea.reserve_source_quota(
  text, text, text, text, text, text, integer, bigint, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.commit_source_quota_reservation(
  text, text, integer, bigint, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.release_source_quota_reservation(
  text, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.expire_source_quota_reservations(timestamptz, integer)
  FROM PUBLIC;
