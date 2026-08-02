BEGIN;

-- Expose only bounded operational state for the existing deletion/correction
-- repair queue. The maintenance role must not receive direct table access or
-- raw failure summaries, identifiers, or source/evidence lineage.
CREATE OR REPLACE FUNCTION appsea.list_production_analysis_recompute_alerts(
  p_workspace_id text,
  p_limit integer
)
RETURNS TABLE (
  state text,
  attempt_count integer,
  requested_at timestamptz,
  next_attempt_at timestamptz,
  updated_at timestamptz
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
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'invalid production analysis recomputation alert input'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspaces workspace
     WHERE workspace.workspace_id = p_workspace_id
       AND workspace.status = 'active'
  ) THEN
    RAISE EXCEPTION 'production analysis recomputation workspace is not active'
      USING ERRCODE = '42501';
  END IF;

  IF current_workspace IS NULL THEN
    PERFORM set_config('appsea.workspace_id', p_workspace_id, true);
  ELSIF current_workspace <> p_workspace_id THEN
    RAISE EXCEPTION 'production analysis recomputation workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT job.state,
         job.attempt_count,
         job.requested_at,
         job.next_attempt_at,
         job.updated_at
    FROM appsea.production_analysis_recompute_jobs job
   WHERE job.workspace_id = p_workspace_id
     AND job.state <> 'satisfied'
   ORDER BY job.updated_at ASC, job.recompute_id ASC
   LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION appsea.list_production_analysis_recompute_alerts(text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.list_production_analysis_recompute_alerts(text, integer)
  TO appsea_maintenance;

COMMENT ON FUNCTION appsea.list_production_analysis_recompute_alerts(text, integer) IS
  'Returns only bounded state and timestamps for active workspace recomputation alert inspection.';

COMMIT;
