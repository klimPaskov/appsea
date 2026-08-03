-- PostgreSQL 18 also treats the output-column workspace_id in the
-- maintenance resolution function as ambiguous when the table column is
-- unqualified. Recreate the function with a table alias at every boundary.

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

  SELECT stored_case.*
    INTO case_row
    FROM appsea.source_quota_reconciliation_cases stored_case
   WHERE stored_case.workspace_id = p_workspace_id
     AND stored_case.reservation_id = p_reservation_id
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

  UPDATE appsea.source_quota_reconciliation_cases target_case
     SET state = 'resolved', resolution_code = p_resolution_code,
         linked_run_id = p_linked_run_id, resolution_actor_id = p_resolution_actor_id,
         resolved_at = now_at, last_seen_at = now_at
   WHERE target_case.workspace_id = p_workspace_id
     AND target_case.reservation_id = p_reservation_id;

  SELECT stored_case.*
    INTO case_row
    FROM appsea.source_quota_reconciliation_cases stored_case
   WHERE stored_case.workspace_id = p_workspace_id
     AND stored_case.reservation_id = p_reservation_id;
  RETURN QUERY SELECT case_row.workspace_id, case_row.reservation_id, case_row.source_id,
    case_row.policy_version, case_row.run_id, case_row.requested_records,
    case_row.requested_cost_micros, case_row.actual_records, case_row.actual_cost_micros,
    case_row.state, case_row.first_seen_at, case_row.last_seen_at,
    case_row.resolution_code, case_row.linked_run_id, case_row.resolution_actor_id,
    case_row.resolved_at;
END
$$;

REVOKE ALL ON FUNCTION appsea.resolve_source_quota_reconciliation_case(
  text, text, text, text, text
) FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.resolve_source_quota_reconciliation_case(
  text, text, text, text, text
) TO appsea_maintenance;
