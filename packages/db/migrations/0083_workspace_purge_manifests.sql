BEGIN;

-- A purge manifest is an owner-visible, metadata-only inventory for the
-- separately operated object-store/export/backup controls. It is deliberately
-- not a deletion queue and it does not change a workspace's purge intent.
CREATE TABLE appsea.workspace_purge_manifests (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  manifest_id text NOT NULL CHECK (
    manifest_id ~ '^workspace-purge-manifest:[a-f0-9]{32}$'
  ),
  generated_by text NOT NULL REFERENCES appsea.users(user_id) ON DELETE RESTRICT,
  generated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  object_count integer NOT NULL CHECK (object_count BETWEEN 0 AND 10000),
  object_entries jsonb NOT NULL,
  external_requirements text[] NOT NULL DEFAULT ARRAY[
    'cloud_object_store_purge',
    'export_retention_purge',
    'backup_deletion_verification'
  ]::text[],
  PRIMARY KEY (workspace_id, manifest_id),
  UNIQUE (workspace_id, manifest_hash),
  CHECK (expires_at > generated_at),
  CHECK (
    external_requirements = ARRAY[
      'cloud_object_store_purge',
      'export_retention_purge',
      'backup_deletion_verification'
    ]::text[]
  ),
  CHECK (jsonb_typeof(object_entries) = 'array')
);

CREATE INDEX workspace_purge_manifests_latest_idx
  ON appsea.workspace_purge_manifests (workspace_id, generated_at DESC, manifest_id DESC);

ALTER TABLE appsea.workspace_purge_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.workspace_purge_manifests FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.workspace_purge_manifests
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.workspace_purge_manifests FROM PUBLIC, appsea_service;

CREATE OR REPLACE FUNCTION appsea.validate_workspace_purge_manifest_entries(
  p_workspace_id text,
  p_object_entries jsonb,
  p_object_count integer
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  entry jsonb;
  object_uri text;
  object_kind text;
BEGIN
  IF p_object_entries IS NULL
     OR jsonb_typeof(p_object_entries) <> 'array'
     OR p_object_count IS NULL
     OR p_object_count < 0
     OR p_object_count > 10000
     OR jsonb_array_length(p_object_entries) <> p_object_count THEN
    RAISE EXCEPTION 'workspace purge manifest object list is invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_object_entries)
  LOOP
    IF jsonb_typeof(entry) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(entry)) <> 2
       OR NOT (entry ? 'uri')
       OR NOT (entry ? 'kind') THEN
      RAISE EXCEPTION 'workspace purge manifest entries must contain only uri and kind'
        USING ERRCODE = '22023';
    END IF;
    object_uri := entry->>'uri';
    object_kind := entry->>'kind';
    IF object_kind NOT IN (
         'evidence', 'report-json', 'report-markdown', 'plan-package',
         'workflow-artifact', 'export'
       )
       OR object_uri !~ '^appsea-object://[a-z][a-z0-9_:-]*/(?:evidence|report-json|report-markdown|plan-package|workflow-artifact|export)/[a-f0-9]{64}$'
       OR split_part(object_uri, '/', 3) <> p_workspace_id
       OR position('/' || object_kind || '/' IN object_uri) = 0 THEN
      RAISE EXCEPTION 'workspace purge manifest contains an invalid or foreign object URI'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT value->>'uri'
      FROM jsonb_array_elements(p_object_entries)
     GROUP BY value->>'uri'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'workspace purge manifest object URIs must be unique'
      USING ERRCODE = '23505';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION appsea.guard_workspace_purge_manifest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  PERFORM appsea.validate_workspace_purge_manifest_entries(
    NEW.workspace_id, NEW.object_entries, NEW.object_count
  );
  IF NEW.manifest_id <> 'workspace-purge-manifest:' || md5(NEW.workspace_id || ':' || NEW.manifest_hash)
     OR NEW.generated_by IS NULL
     OR NEW.expires_at <= NEW.generated_at
     OR NEW.expires_at > NEW.generated_at + INTERVAL '7 days' THEN
    RAISE EXCEPTION 'workspace purge manifest identity or expiry is invalid'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER workspace_purge_manifest_guard
BEFORE INSERT OR UPDATE ON appsea.workspace_purge_manifests
FOR EACH ROW EXECUTE FUNCTION appsea.guard_workspace_purge_manifest();

CREATE OR REPLACE FUNCTION appsea.create_workspace_purge_manifest(
  p_workspace_id text,
  p_actor_id text,
  p_manifest_id text,
  p_manifest_hash text,
  p_object_entries jsonb,
  p_generated_at timestamptz,
  p_expires_at timestamptz
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
  workspace_row appsea.workspaces%ROWTYPE;
  existing appsea.workspace_purge_manifests%ROWTYPE;
  object_count_value integer;
  event_suffix text;
BEGIN
  IF p_workspace_id IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_actor_id IS NULL
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_actor_id
     OR p_manifest_hash IS NULL
     OR p_manifest_hash !~ '^[a-f0-9]{64}$'
     OR p_manifest_id IS DISTINCT FROM
        'workspace-purge-manifest:' || md5(p_workspace_id || ':' || p_manifest_hash)
     OR p_generated_at IS NULL
     OR p_expires_at IS NULL
     OR p_generated_at > clock_timestamp()
     OR p_expires_at <= p_generated_at
     OR p_expires_at > p_generated_at + INTERVAL '7 days' THEN
    RAISE EXCEPTION 'invalid workspace purge manifest input'
      USING ERRCODE = '22023';
  END IF;

  object_count_value := jsonb_array_length(p_object_entries);
  PERFORM appsea.validate_workspace_purge_manifest_entries(
    p_workspace_id, p_object_entries, object_count_value
  );

  SELECT * INTO workspace_row
    FROM appsea.workspaces workspace
   WHERE workspace.workspace_id = p_workspace_id
   FOR UPDATE;
  IF NOT FOUND OR workspace_row.archived_at IS NULL THEN
    RAISE EXCEPTION 'workspace purge manifests require an archived workspace'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.role INTO actor_role
    FROM appsea.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = p_actor_id
   FOR SHARE;
  IF actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'workspace purge manifests require an owner'
      USING ERRCODE = '42501';
  END IF;

  SELECT manifest.* INTO existing
    FROM appsea.workspace_purge_manifests manifest
   WHERE manifest.workspace_id = p_workspace_id
     AND manifest.manifest_id = p_manifest_id
   FOR UPDATE;
  IF FOUND THEN
    IF existing.manifest_hash <> p_manifest_hash
       OR existing.object_entries <> p_object_entries
       OR existing.generated_by <> p_actor_id THEN
      RAISE EXCEPTION 'workspace purge manifest identity conflicts with an existing manifest'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT
      existing.workspace_id,
      existing.manifest_id,
      existing.generated_by,
      existing.generated_at,
      existing.expires_at,
      existing.manifest_hash::text,
      existing.object_count,
      existing.object_entries,
      existing.external_requirements,
      true;
    RETURN;
  END IF;

  INSERT INTO appsea.workspace_purge_manifests
    (workspace_id, manifest_id, generated_by, generated_at, expires_at,
     manifest_hash, object_count, object_entries)
  VALUES
    (p_workspace_id, p_manifest_id, p_actor_id, p_generated_at, p_expires_at,
     p_manifest_hash, object_count_value, p_object_entries);

  event_suffix := md5(p_manifest_id || ':' || p_actor_id);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action,
     target_type, target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id, 'audit:workspace-purge-manifest:' || event_suffix, 'user', p_actor_id,
     'workspace.purge_manifest_prepared', 'workspace_purge_manifest', p_manifest_id,
     'workspace-purge-manifest:' || event_suffix,
     jsonb_build_object('workspaceId', p_workspace_id, 'manifestId', p_manifest_id,
       'manifestHash', p_manifest_hash, 'objectCount', object_count_value,
       'expiresAt', p_expires_at), p_generated_at)
  ON CONFLICT DO NOTHING;
  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, causation_id, payload, occurred_at)
  VALUES
    (p_workspace_id, 'outbox:workspace-purge-manifest:' || event_suffix,
     'workspace.purge_manifest_prepared', 'workspace_purge_manifest', p_manifest_id,
     'workspace-purge-manifest-v1', 'workspace-purge-manifest:' || event_suffix,
     'audit:workspace-purge-manifest:' || event_suffix,
     jsonb_build_object('workspaceId', p_workspace_id, 'manifestId', p_manifest_id,
       'manifestHash', p_manifest_hash, 'objectCount', object_count_value,
       'expiresAt', p_expires_at), p_generated_at)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT
    p_workspace_id,
    p_manifest_id,
    p_actor_id,
    p_generated_at,
    p_expires_at,
    p_manifest_hash,
    object_count_value,
    p_object_entries,
    ARRAY[
      'cloud_object_store_purge',
      'export_retention_purge',
      'backup_deletion_verification'
    ]::text[],
    false;
END
$$;

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
  SELECT membership.role INTO actor_role
    FROM appsea.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = p_actor_id
   FOR SHARE;
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

REVOKE ALL ON FUNCTION appsea.validate_workspace_purge_manifest_entries(text, jsonb, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_workspace_purge_manifest() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.create_workspace_purge_manifest(
  text, text, text, text, jsonb, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.read_workspace_purge_manifest(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.create_workspace_purge_manifest(
  text, text, text, text, jsonb, timestamptz, timestamptz
) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.read_workspace_purge_manifest(text, text) TO appsea_service;

COMMIT;
