BEGIN;

-- Expose only bounded aggregate cost state for deployment-owned alert
-- inspection. The maintenance role must not receive direct ledger reads,
-- source identifiers, run identifiers, or workspace-wide detail.
CREATE OR REPLACE FUNCTION appsea.list_workspace_cost_alerts(
  p_workspace_id text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_limit integer
)
RETURNS TABLE (
  currency text,
  entry_count bigint,
  total_cost_micros numeric,
  estimated_cost_micros numeric,
  actual_cost_micros numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_workspace_id IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_period_start IS NULL
     OR p_period_end IS NULL
     OR p_period_start >= p_period_end
     OR p_period_end - p_period_start > interval '365 days'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 16 THEN
    RAISE EXCEPTION 'invalid workspace cost alert input'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspaces workspace
     WHERE workspace.workspace_id = p_workspace_id
       AND workspace.status = 'active'
  ) THEN
    RAISE EXCEPTION 'workspace cost alert workspace is not active'
      USING ERRCODE = '42501';
  END IF;

  IF current_workspace IS NULL THEN
    PERFORM set_config('appsea.workspace_id', p_workspace_id, true);
  ELSIF current_workspace <> p_workspace_id THEN
    RAISE EXCEPTION 'workspace cost alert workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT btrim(ledger.currency)::text,
         count(*)::bigint,
         COALESCE(sum(round(ledger.amount * 1000000)), 0)::numeric,
         COALESCE(sum(CASE WHEN ledger.estimate THEN round(ledger.amount * 1000000) ELSE 0 END), 0)::numeric,
         COALESCE(sum(CASE WHEN NOT ledger.estimate THEN round(ledger.amount * 1000000) ELSE 0 END), 0)::numeric
    FROM appsea.cost_ledger_entries ledger
   WHERE ledger.workspace_id = p_workspace_id
     AND ledger.recorded_at >= p_period_start
     AND ledger.recorded_at < p_period_end
   GROUP BY ledger.currency
   ORDER BY btrim(ledger.currency)
   LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION appsea.list_workspace_cost_alerts(text, timestamptz, timestamptz, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.list_workspace_cost_alerts(text, timestamptz, timestamptz, integer)
  TO appsea_maintenance;

COMMENT ON FUNCTION appsea.list_workspace_cost_alerts(text, timestamptz, timestamptz, integer) IS
  'Returns only bounded currency aggregates for deployment cost-alert inspection.';

COMMIT;
