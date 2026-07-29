CREATE OR REPLACE FUNCTION appsea.enforce_workflow_job_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (
      NEW.requested_by_actor_type IS DISTINCT FROM OLD.requested_by_actor_type
      OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
    ) THEN
      RAISE EXCEPTION 'workflow requesting actor is immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspaces workspace
     WHERE workspace.workspace_id = NEW.workspace_id
       AND workspace.fixture_only
       AND workspace.status = 'active'
  ) THEN
    RAISE EXCEPTION 'workflow workspace must be active and fixture-enabled'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.requested_by_actor_type = 'service' THEN
    IF NEW.requested_by_actor_id <> 'appsea-worker' THEN
      RAISE EXCEPTION 'unsupported workflow service actor'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.requested_by_actor_type = 'user' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM appsea.workspace_memberships membership
       WHERE membership.workspace_id = NEW.workspace_id
         AND membership.user_id = NEW.requested_by_actor_id
         AND membership.role IN ('owner', 'editor')
    ) THEN
      RAISE EXCEPTION 'workflow user actor is not an editor or owner of the workspace'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported workflow actor type'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_workflow_job_actor() FROM PUBLIC;
