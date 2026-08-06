-- A user request may reserve a production collection start before a bounded
-- owner-import payload is staged. Release only that still-reserved, actor-bound
-- reservation when staging fails; an uncertain Temporal start remains reserved
-- until workflow initialization or the existing server-owned TTL/purge path.
CREATE OR REPLACE FUNCTION appsea.release_production_collection_workflow_admission(
  p_workspace_id text,
  p_idempotency_digest text,
  p_input_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  auth_user text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  now_at timestamptz := clock_timestamp();
  admission appsea.production_collection_workflow_admissions%ROWTYPE;
BEGIN
  IF current_workspace IS NULL
     OR p_workspace_id <> current_workspace
     OR auth_user IS NULL THEN
    RAISE EXCEPTION 'production workflow admission release requires an authenticated workspace context'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_idempotency_digest IS NULL
     OR p_input_hash IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_idempotency_digest !~ '^[a-f0-9]{64}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid production workflow admission release identity'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspaces workspace
      JOIN appsea.workspace_memberships membership
        ON membership.workspace_id = workspace.workspace_id
       AND membership.user_id = auth_user
       AND membership.role IN ('owner', 'editor')
     WHERE workspace.workspace_id = p_workspace_id
       AND workspace.status = 'active'
       AND workspace.visibility = 'private'
       AND workspace.fixture_only = false
  ) THEN
    RAISE EXCEPTION 'production workflow admission release requires an active editor workspace'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO admission
    FROM appsea.production_collection_workflow_admissions
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest
   FOR UPDATE;
  IF admission.idempotency_digest IS NULL THEN RETURN false; END IF;
  IF admission.input_hash <> p_input_hash THEN
    RAISE EXCEPTION 'production workflow admission release conflicts with prior request'
      USING ERRCODE = '23505';
  END IF;
  IF admission.state = 'released' THEN RETURN true; END IF;
  -- Never release a consumed row: it may correspond to a Temporal execution
  -- whose first persistence transaction has not become visible yet.
  IF admission.state <> 'reserved' OR admission.reservation_expires_at <= now_at THEN
    RETURN false;
  END IF;
  UPDATE appsea.production_collection_workflow_admissions
     SET state = 'released', released_at = now_at, updated_at = now_at
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION appsea.release_production_collection_workflow_admission(
  text, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.release_production_collection_workflow_admission(
  text, text, text
) TO appsea_service;
