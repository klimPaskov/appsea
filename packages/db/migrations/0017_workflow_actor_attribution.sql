ALTER TABLE appsea.workflow_job_executions
  ADD COLUMN requested_by_actor_type text NOT NULL DEFAULT 'service',
  ADD COLUMN requested_by_actor_id text NOT NULL DEFAULT 'appsea-worker',
  ADD CONSTRAINT workflow_job_requested_by_actor_type_check CHECK (
    requested_by_actor_type IN ('user', 'service')
  ),
  ADD CONSTRAINT workflow_job_requested_by_actor_id_check CHECK (
    requested_by_actor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  ADD CONSTRAINT workflow_job_requested_by_actor_pair_check CHECK (
    (requested_by_actor_type = 'service' AND requested_by_actor_id = 'appsea-worker')
    OR requested_by_actor_type = 'user'
  );

CREATE INDEX workflow_job_executions_actor_idx
  ON appsea.workflow_job_executions (workspace_id, requested_by_actor_id, requested_at DESC);

CREATE OR REPLACE FUNCTION appsea.enforce_workflow_job_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.requested_by_actor_type IS DISTINCT FROM OLD.requested_by_actor_type
       OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
     ) THEN
    RAISE EXCEPTION 'workflow requesting actor is immutable'
      USING ERRCODE = '23514';
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

CREATE TRIGGER workflow_job_actor_guard
BEFORE INSERT OR UPDATE ON appsea.workflow_job_executions
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_workflow_job_actor();

REVOKE ALL ON FUNCTION appsea.enforce_workflow_job_actor() FROM PUBLIC;
