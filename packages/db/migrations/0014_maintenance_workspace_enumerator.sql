-- Maintenance workers need a bounded cross-workspace view, but the runtime
-- role must not receive a general-purpose RLS bypass.  The migration owner is
-- the only role allowed to see active workspace identifiers in this boundary;
-- the service role can execute the narrow function but cannot select the table.

CREATE POLICY workspace_maintenance_scope ON appsea.workspaces
  FOR SELECT
  TO appsea_owner
  USING (status = 'active');

CREATE OR REPLACE FUNCTION appsea.list_active_workspaces_for_maintenance()
RETURNS TABLE (workspace_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
  SELECT workspace.workspace_id
    FROM appsea.workspaces AS workspace
   WHERE workspace.status = 'active'
   ORDER BY workspace.workspace_id
$$;

REVOKE ALL ON FUNCTION appsea.list_active_workspaces_for_maintenance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.list_active_workspaces_for_maintenance() TO appsea_service;
