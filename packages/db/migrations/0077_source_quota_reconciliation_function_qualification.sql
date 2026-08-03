-- The original reconciliation function used an unqualified conflict target.
-- Because its output table exposes a workspace_id variable, PostgreSQL 18
-- resolves that target as ambiguous in PL/pgSQL. Recreate the function with
-- the primary-key constraint named explicitly; behavior and tenant checks are
-- unchanged.

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
  ON CONFLICT ON CONSTRAINT source_quota_reconciliation_cases_pkey DO UPDATE
    SET last_seen_at = EXCLUDED.last_seen_at
  WHERE appsea.source_quota_reconciliation_cases.state = 'open';

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

REVOKE ALL ON FUNCTION appsea.list_source_quota_reconciliation_cases(text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.list_source_quota_reconciliation_cases(text, integer)
  TO appsea_service, appsea_maintenance;
