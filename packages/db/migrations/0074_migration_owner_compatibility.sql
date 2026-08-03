-- Migration-only access is explicit rather than relying on a role-level RLS
-- bypass.  The owner role is NOLOGIN and is reachable only through the
-- reviewed migration credential, so it can repair rows across workspaces while
-- runtime service roles remain workspace-scoped.
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT relation.relname
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'appsea'
       AND relation.relkind = 'r'
       AND relation.relrowsecurity
       AND EXISTS (
         SELECT 1
           FROM pg_attribute attribute
          WHERE attribute.attrelid = relation.oid
            AND attribute.attname = 'workspace_id'
            AND NOT attribute.attisdropped
       )
  LOOP
    EXECUTE format(
      'CREATE POLICY migration_owner_scope ON appsea.%I
         USING (current_user = ''appsea_owner'')
         WITH CHECK (current_user = ''appsea_owner'')',
      table_name
    );
  END LOOP;
END
$$;

-- Older callers may not know the lifecycle completion timestamp introduced by
-- migration 0004. Derive it at the database boundary before the lifecycle
-- constraint is evaluated, preserving the terminal-state invariant.
CREATE OR REPLACE FUNCTION appsea.default_research_run_finished_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.state IN ('completed', 'partial', 'failed', 'canceled')
     AND NEW.finished_at IS NULL THEN
    NEW.finished_at := COALESCE(NEW.completed_at, NEW.started_at, NEW.requested_at);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS research_run_finished_at_default ON appsea.research_runs;
CREATE TRIGGER research_run_finished_at_default
BEFORE INSERT OR UPDATE OF state, finished_at, completed_at, started_at, requested_at
ON appsea.research_runs
FOR EACH ROW
EXECUTE FUNCTION appsea.default_research_run_finished_at();

GRANT EXECUTE ON FUNCTION appsea.default_research_run_finished_at() TO appsea_owner, appsea_migrator, appsea_service;
