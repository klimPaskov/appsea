-- The private manifest read repository runs in a read-only transaction.
-- PostgreSQL rejects a row-locking SELECT there, so keep the owner
-- membership check snapshot-consistent without requesting a write lock.

CREATE OR REPLACE FUNCTION appsea.read_workspace_purge_manifest(
  p_workspace_id text,
  p_actor_id text
)
RETURNS TABLE(
  workspace_id text,
  manifest_id text,
  generated_by text,
  generated_at timestamptz,
  expires_at timestamptz,
  manifest_hash text,
  object_count integer,
  object_entries jsonb,
  external_requirements text[],
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_role text;
BEGIN
  IF p_workspace_id IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_actor_id IS NULL
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'workspace purge manifest read requires the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = p_actor_id;

  IF actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'workspace purge manifest read requires an owner'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT manifest.workspace_id,
         manifest.manifest_id,
         manifest.generated_by,
         manifest.generated_at,
         manifest.expires_at,
         manifest.manifest_hash::text,
         manifest.object_count,
         manifest.object_entries,
         manifest.external_requirements,
         false
    FROM appsea.workspace_purge_manifests manifest
   WHERE manifest.workspace_id = p_workspace_id
   ORDER BY manifest.generated_at DESC, manifest.manifest_id DESC
   LIMIT 1;
END
$$;

REVOKE ALL ON FUNCTION appsea.read_workspace_purge_manifest(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.read_workspace_purge_manifest(text, text) TO appsea_service;
