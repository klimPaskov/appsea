BEGIN;

-- Workspace-scoped, read-only credentials for coding-agent access.
-- Raw bearer tokens never enter PostgreSQL; only SHA-256 hashes are stored.
CREATE TABLE appsea.agent_access_tokens (
  token_id text PRIMARY KEY CHECK (token_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) BETWEEN 1 AND 5
    AND scopes <@ ARRAY[
      'opportunities:read',
      'evidence:read',
      'reports:read',
      'plans:read',
      'sources:read'
    ]::text[]
  ),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (last_used_at IS NULL OR last_used_at >= created_at),
  UNIQUE (token_hash)
);

CREATE INDEX agent_access_tokens_workspace_idx
  ON appsea.agent_access_tokens (workspace_id, created_at DESC, token_id);

ALTER TABLE appsea.agent_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.agent_access_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_scope ON appsea.agent_access_tokens
  USING (
    current_user = 'appsea_owner'
    OR (
      workspace_id = appsea.current_workspace_id()
      AND user_id = NULLIF(current_setting('appsea.auth_user_id', true), '')
    )
  )
  WITH CHECK (
    current_user = 'appsea_owner'
    OR (
      workspace_id = appsea.current_workspace_id()
      AND user_id = NULLIF(current_setting('appsea.auth_user_id', true), '')
    )
  );

REVOKE ALL ON appsea.agent_access_tokens FROM PUBLIC, appsea_service;

CREATE OR REPLACE FUNCTION appsea.issue_agent_access_token(
  p_workspace_id text,
  p_actor_id text,
  p_token_id text,
  p_token_hash text,
  p_label text,
  p_scopes text[],
  p_expires_at timestamptz
)
RETURNS TABLE(token_id text, label text, scopes text[], expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  now_value timestamptz;
  event_id text;
  distinct_scopes text[];
BEGIN
  IF p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_token_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_label IS NULL OR char_length(p_label) NOT BETWEEN 1 AND 120
     OR p_scopes IS NULL OR cardinality(p_scopes) NOT BETWEEN 1 AND 5
     OR p_scopes <@ ARRAY[
       'opportunities:read',
       'evidence:read',
       'reports:read',
       'plans:read',
       'sources:read'
     ]::text[]
     OR p_expires_at IS NULL THEN
    RAISE EXCEPTION 'agent access token request is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT requested_scope ORDER BY requested_scope)
    INTO distinct_scopes
    FROM unnest(p_scopes) AS scopes(requested_scope);
  IF cardinality(distinct_scopes) <> cardinality(p_scopes) THEN
    RAISE EXCEPTION 'agent access token scopes must be unique' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_actor_id
     OR appsea.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'agent access token actor context is invalid' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
      JOIN appsea.workspaces workspace ON workspace.workspace_id = membership.workspace_id
     WHERE membership.workspace_id = p_workspace_id
       AND membership.user_id = p_actor_id
       AND membership.role = 'owner'
       AND workspace.visibility = 'private'
       AND workspace.status = 'active'
  ) THEN
    RAISE EXCEPTION 'agent access token requires a private workspace owner' USING ERRCODE = '42501';
  END IF;

  now_value := clock_timestamp();
  IF p_expires_at <= now_value OR p_expires_at > now_value + interval '90 days' THEN
    RAISE EXCEPTION 'agent access token expiry is outside the permitted window'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO appsea.agent_access_tokens
    (token_id, workspace_id, user_id, token_hash, label, scopes, created_at, expires_at)
  VALUES
    (p_token_id, p_workspace_id, p_actor_id, p_token_hash, p_label, distinct_scopes,
     now_value, p_expires_at);

  event_id := 'agent-access-token:' || md5(p_token_id || ':' || txid_current()::text);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id, 'audit:' || event_id, 'user', p_actor_id,
     'agent.access_token.created', 'agent_access_token', p_token_id,
     event_id, jsonb_build_object('scopes', distinct_scopes, 'expiresAt', p_expires_at), now_value)
  ON CONFLICT DO NOTHING;
  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (p_workspace_id, 'outbox:' || event_id, 'agent.access_token.created',
     'agent_access_token', p_token_id, 'agent-access-token-v1', event_id,
     jsonb_build_object('scopes', distinct_scopes), now_value)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT p_token_id, p_label, distinct_scopes, p_expires_at;
END
$$;

CREATE OR REPLACE FUNCTION appsea.list_agent_access_tokens(
  p_workspace_id text,
  p_actor_id text
)
RETURNS TABLE(
  token_id text,
  label text,
  scopes text[],
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_actor_id
     OR appsea.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT EXISTS (
       SELECT 1
         FROM appsea.workspace_memberships membership
         JOIN appsea.workspaces workspace ON workspace.workspace_id = membership.workspace_id
        WHERE membership.workspace_id = p_workspace_id
          AND membership.user_id = p_actor_id
          AND membership.role = 'owner'
          AND workspace.visibility = 'private'
          AND workspace.status = 'active'
     ) THEN
    RAISE EXCEPTION 'agent access token listing requires the workspace owner'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT token.token_id, token.label, token.scopes, token.created_at,
         token.expires_at, token.revoked_at, token.last_used_at
    FROM appsea.agent_access_tokens token
   WHERE token.workspace_id = p_workspace_id
     AND token.user_id = p_actor_id
   ORDER BY token.created_at DESC, token.token_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.revoke_agent_access_token(
  p_workspace_id text,
  p_actor_id text,
  p_token_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  changed boolean;
  event_id text;
BEGIN
  IF NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_actor_id
     OR appsea.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT EXISTS (
       SELECT 1
         FROM appsea.workspace_memberships membership
         JOIN appsea.workspaces workspace ON workspace.workspace_id = membership.workspace_id
        WHERE membership.workspace_id = p_workspace_id
          AND membership.user_id = p_actor_id
          AND membership.role = 'owner'
          AND workspace.visibility = 'private'
          AND workspace.status = 'active'
     ) THEN
    RAISE EXCEPTION 'agent access token revocation requires the workspace owner'
      USING ERRCODE = '42501';
  END IF;

  UPDATE appsea.agent_access_tokens token
     SET revoked_at = COALESCE(token.revoked_at, clock_timestamp())
   WHERE token.workspace_id = p_workspace_id
     AND token.user_id = p_actor_id
     AND token.token_id = p_token_id
  RETURNING true INTO changed;
  IF changed IS NULL THEN RETURN false; END IF;

  event_id := 'agent-access-token-revoked:' || md5(p_token_id || ':' || txid_current()::text);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id, 'audit:' || event_id, 'user', p_actor_id,
     'agent.access_token.revoked', 'agent_access_token', p_token_id,
     event_id, '{}'::jsonb, clock_timestamp())
  ON CONFLICT DO NOTHING;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.authenticate_agent_access_token(p_token_hash text)
RETURNS TABLE(token_id text, workspace_id text, user_id text, scopes text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  token_row appsea.agent_access_tokens%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN;
  END IF;

  -- The token table permits the security-definer owner to locate the token
  -- without a workspace GUC. Establish that GUC before reading the forced-RLS
  -- workspace row, then apply the active-user/private-workspace checks.
  SELECT token.*
    INTO token_row
    FROM appsea.agent_access_tokens token
   WHERE token.token_hash = p_token_hash
     AND token.revoked_at IS NULL
     AND token.expires_at > clock_timestamp()
   FOR UPDATE;
  IF token_row.token_id IS NULL THEN RETURN; END IF;

  PERFORM set_config('appsea.workspace_id', token_row.workspace_id, true);
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.users user_row
     WHERE user_row.user_id = token_row.user_id
       AND user_row.account_state = 'active'
  ) OR NOT EXISTS (
    SELECT 1
      FROM appsea.workspaces workspace
     WHERE workspace.workspace_id = token_row.workspace_id
       AND workspace.visibility = 'private'
       AND workspace.status = 'active'
  ) THEN
    RETURN;
  END IF;

  UPDATE appsea.agent_access_tokens
     SET last_used_at = clock_timestamp()
   WHERE token_id = token_row.token_id;
  RETURN QUERY SELECT token_row.token_id, token_row.workspace_id,
                      token_row.user_id, token_row.scopes;
END
$$;

REVOKE ALL ON FUNCTION appsea.issue_agent_access_token(text, text, text, text, text, text[], timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.list_agent_access_tokens(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.revoke_agent_access_token(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.authenticate_agent_access_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.issue_agent_access_token(text, text, text, text, text, text[], timestamptz) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.list_agent_access_tokens(text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.revoke_agent_access_token(text, text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.authenticate_agent_access_token(text) TO appsea_service;

COMMIT;
