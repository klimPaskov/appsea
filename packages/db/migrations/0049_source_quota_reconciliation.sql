-- Make a settled source request without a persisted production result visible
-- and operator-resolvable.  This table records only bounded identifiers and
-- accounting values; it never stores the source request, complaint content, or
-- a caller secret.  Resolution does not refund quota or authorize a re-fetch.

CREATE TABLE appsea.source_quota_reconciliation_cases (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  reservation_id text NOT NULL CHECK (
    char_length(reservation_id) BETWEEN 3 AND 240
    AND reservation_id ~ '^[a-z][a-z0-9_:-]*$'
  ),
  source_id text NOT NULL CHECK (source_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  policy_version text NOT NULL CHECK (
    char_length(policy_version) BETWEEN 1 AND 80
    AND policy_version ~ '^[a-zA-Z0-9._:-]+$'
  ),
  run_id text NOT NULL CHECK (run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  requested_records integer NOT NULL CHECK (requested_records BETWEEN 1 AND 5000),
  requested_cost_micros bigint NOT NULL CHECK (requested_cost_micros BETWEEN 0 AND 1000000000000),
  actual_records integer CHECK (actual_records IS NULL OR actual_records BETWEEN 0 AND 5000),
  actual_cost_micros bigint CHECK (
    actual_cost_micros IS NULL OR actual_cost_micros BETWEEN 0 AND 1000000000000
  ),
  state text NOT NULL CHECK (state IN ('open', 'resolved')),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  resolution_code text CHECK (resolution_code IN ('linked_result', 'voided_no_result')),
  linked_run_id text CHECK (linked_run_id IS NULL OR linked_run_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  resolution_actor_id text CHECK (
    resolution_actor_id IS NULL
    OR (
      char_length(resolution_actor_id) BETWEEN 3 AND 160
      AND resolution_actor_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
    )
  ),
  resolved_at timestamptz,
  PRIMARY KEY (workspace_id, reservation_id),
  CHECK (last_seen_at >= first_seen_at),
  CHECK ((state = 'open') = (
    resolution_code IS NULL
    AND linked_run_id IS NULL
    AND resolution_actor_id IS NULL
    AND resolved_at IS NULL
  )),
  CHECK ((state = 'resolved') = (
    resolution_code IS NOT NULL
    AND resolution_actor_id IS NOT NULL
    AND resolved_at IS NOT NULL
  )),
  CHECK ((resolution_code = 'linked_result') = (linked_run_id IS NOT NULL)),
  CHECK (resolution_code <> 'voided_no_result' OR linked_run_id IS NULL)
);

CREATE INDEX source_quota_reconciliation_cases_open_idx
  ON appsea.source_quota_reconciliation_cases (workspace_id, state, first_seen_at, reservation_id)
  WHERE state = 'open';

ALTER TABLE appsea.source_quota_reconciliation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.source_quota_reconciliation_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.source_quota_reconciliation_cases
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

CREATE OR REPLACE FUNCTION appsea.list_source_quota_reconciliation_cases(
  p_workspace_id text,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  workspace_id text,
  reservation_id text,
  source_id text,
  policy_version text,
  run_id text,
  requested_records integer,
  requested_cost_micros bigint,
  actual_records integer,
  actual_cost_micros bigint,
  state text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  resolution_code text,
  linked_run_id text,
  resolution_actor_id text,
  resolved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  now_at timestamptz := clock_timestamp();
BEGIN
  IF current_workspace IS NULL OR p_workspace_id IS NULL OR p_workspace_id <> current_workspace
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid source quota reconciliation list input' USING ERRCODE = '22023';
  END IF;

  -- Discovery is idempotent and bounded.  The committed reservation remains
  -- immutable; only the separate inspection case is created or refreshed.
  INSERT INTO appsea.source_quota_reconciliation_cases
    (workspace_id, reservation_id, source_id, policy_version, run_id,
     requested_records, requested_cost_micros, actual_records, actual_cost_micros,
     state, first_seen_at, last_seen_at)
  SELECT reservation.workspace_id, reservation.reservation_id, reservation.source_id,
         reservation.policy_version, reservation.run_id, reservation.requested_records,
         reservation.requested_cost_micros, reservation.actual_records,
         reservation.actual_cost_micros, 'open', now_at, now_at
    FROM appsea.source_quota_reservations reservation
   WHERE reservation.workspace_id = p_workspace_id
     AND reservation.status = 'committed'
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.research_runs run
        WHERE run.workspace_id = reservation.workspace_id
          AND run.run_id = reservation.run_id
          AND run.mode = 'production'
          AND run.state = 'completed'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM appsea.source_snapshot_reconciliation_jobs snapshot
        WHERE snapshot.workspace_id = reservation.workspace_id
          AND snapshot.reconciliation_id = reservation.run_id
     )
   ORDER BY reservation.settled_at, reservation.reservation_id
   LIMIT p_limit
  ON CONFLICT (workspace_id, reservation_id) DO UPDATE
    SET last_seen_at = EXCLUDED.last_seen_at
  WHERE appsea.source_quota_reconciliation_cases.state = 'open';

  -- A late, idempotent result is evidence that the case no longer needs
  -- human action.  Keep the resolution actor explicit and do not reopen it.
  UPDATE appsea.source_quota_reconciliation_cases case_row
     SET state = 'resolved',
         resolution_code = 'linked_result',
         linked_run_id = case_row.run_id,
         resolution_actor_id = 'system:reconciliation',
         resolved_at = now_at,
         last_seen_at = now_at
    FROM appsea.research_runs run
   WHERE case_row.workspace_id = p_workspace_id
     AND case_row.state = 'open'
     AND run.workspace_id = case_row.workspace_id
     AND run.run_id = case_row.run_id
     AND run.mode = 'production'
     AND run.state = 'completed';

  RETURN QUERY
  SELECT case_row.workspace_id, case_row.reservation_id, case_row.source_id,
         case_row.policy_version, case_row.run_id, case_row.requested_records,
         case_row.requested_cost_micros, case_row.actual_records,
         case_row.actual_cost_micros, case_row.state, case_row.first_seen_at,
         case_row.last_seen_at, case_row.resolution_code, case_row.linked_run_id,
         case_row.resolution_actor_id, case_row.resolved_at
    FROM appsea.source_quota_reconciliation_cases case_row
   WHERE case_row.workspace_id = p_workspace_id
     AND case_row.state = 'open'
   ORDER BY case_row.first_seen_at, case_row.reservation_id
   LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION appsea.resolve_source_quota_reconciliation_case(
  p_workspace_id text,
  p_reservation_id text,
  p_resolution_code text,
  p_linked_run_id text,
  p_resolution_actor_id text
)
RETURNS TABLE (
  workspace_id text,
  reservation_id text,
  source_id text,
  policy_version text,
  run_id text,
  requested_records integer,
  requested_cost_micros bigint,
  actual_records integer,
  actual_cost_micros bigint,
  state text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  resolution_code text,
  linked_run_id text,
  resolution_actor_id text,
  resolved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  case_row appsea.source_quota_reconciliation_cases%ROWTYPE;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_workspace_id IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_reservation_id IS NULL
     OR p_reservation_id !~ '^[a-z][a-z0-9_:-]{2,239}$'
     OR p_resolution_code NOT IN ('linked_result', 'voided_no_result')
     OR p_resolution_actor_id IS NULL
     OR p_resolution_actor_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR char_length(p_resolution_actor_id) NOT BETWEEN 3 AND 160
     OR (p_resolution_code = 'linked_result' AND p_linked_run_id IS NULL)
     OR (p_resolution_code = 'voided_no_result' AND p_linked_run_id IS NOT NULL)
     OR (p_linked_run_id IS NOT NULL AND p_linked_run_id !~ '^[a-z][a-z0-9_:-]{2,159}$') THEN
    RAISE EXCEPTION 'invalid source quota reconciliation resolution input'
      USING ERRCODE = '22023';
  END IF;

  IF current_workspace IS NULL THEN
    PERFORM set_config('appsea.workspace_id', p_workspace_id, true);
  ELSIF current_workspace <> p_workspace_id THEN
    RAISE EXCEPTION 'source quota reconciliation workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO case_row
    FROM appsea.source_quota_reconciliation_cases
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id
   FOR UPDATE;
  IF case_row.reservation_id IS NULL THEN
    RAISE EXCEPTION 'source quota reconciliation case does not exist' USING ERRCODE = '23503';
  END IF;

  IF case_row.state = 'resolved' THEN
    IF case_row.resolution_code <> p_resolution_code
       OR case_row.linked_run_id IS DISTINCT FROM p_linked_run_id THEN
      RAISE EXCEPTION 'source quota reconciliation case already has a different resolution'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT case_row.workspace_id, case_row.reservation_id, case_row.source_id,
      case_row.policy_version, case_row.run_id, case_row.requested_records,
      case_row.requested_cost_micros, case_row.actual_records, case_row.actual_cost_micros,
      case_row.state, case_row.first_seen_at, case_row.last_seen_at,
      case_row.resolution_code, case_row.linked_run_id, case_row.resolution_actor_id,
      case_row.resolved_at;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.source_quota_reservations reservation
     WHERE reservation.workspace_id = p_workspace_id
       AND reservation.reservation_id = p_reservation_id
       AND reservation.status = 'committed'
  ) THEN
    RAISE EXCEPTION 'settled source quota reservation is no longer retained'
      USING ERRCODE = '23503';
  END IF;

  IF p_resolution_code = 'linked_result' AND NOT EXISTS (
    SELECT 1
      FROM appsea.research_runs run
     WHERE run.workspace_id = p_workspace_id
       AND run.run_id = p_linked_run_id
       AND run.mode = 'production'
       AND run.state = 'completed'
       AND run.run_id = case_row.run_id
  ) THEN
    RAISE EXCEPTION 'linked production result does not match the settled reservation'
      USING ERRCODE = '23514';
  END IF;

  UPDATE appsea.source_quota_reconciliation_cases
     SET state = 'resolved', resolution_code = p_resolution_code,
         linked_run_id = p_linked_run_id, resolution_actor_id = p_resolution_actor_id,
         resolved_at = now_at, last_seen_at = now_at
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id;

  SELECT * INTO case_row
    FROM appsea.source_quota_reconciliation_cases
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id;
  RETURN QUERY SELECT case_row.workspace_id, case_row.reservation_id, case_row.source_id,
    case_row.policy_version, case_row.run_id, case_row.requested_records,
    case_row.requested_cost_micros, case_row.actual_records, case_row.actual_cost_micros,
    case_row.state, case_row.first_seen_at, case_row.last_seen_at,
    case_row.resolution_code, case_row.linked_run_id, case_row.resolution_actor_id,
    case_row.resolved_at;
END
$$;

REVOKE ALL ON appsea.source_quota_reconciliation_cases FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.list_source_quota_reconciliation_cases(text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.resolve_source_quota_reconciliation_case(
  text, text, text, text, text
) FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.list_source_quota_reconciliation_cases(text, integer)
  TO appsea_service, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.resolve_source_quota_reconciliation_case(
  text, text, text, text, text
) TO appsea_maintenance;
