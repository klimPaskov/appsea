-- Migration 0097: bind MCP tokens to current membership and add durable
-- per-token request admission. The limits are deliberately repository-owned:
-- 60 requests per 60-second server-clock window, four in-flight requests, and
-- a 30-second lease for crash recovery. No caller-supplied clock is trusted.

ALTER TABLE appsea.agent_access_tokens
  ADD COLUMN rate_window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN rate_window_request_count integer NOT NULL DEFAULT 0
    CHECK (rate_window_request_count >= 0);

CREATE TABLE appsea.agent_access_request_leases (
  admission_id text PRIMARY KEY
    CHECK (admission_id ~ '^mcp-admission:[a-z0-9_-]{16,96}$'),
  token_id text NOT NULL REFERENCES appsea.agent_access_tokens(token_id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  admitted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > admitted_at),
  UNIQUE (admission_id, token_id)
);

CREATE INDEX agent_access_request_leases_token_idx
  ON appsea.agent_access_request_leases (token_id, expires_at, admission_id);

ALTER TABLE appsea.agent_access_request_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.agent_access_request_leases FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_scope ON appsea.agent_access_request_leases
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

REVOKE ALL ON appsea.agent_access_request_leases FROM PUBLIC, appsea_service;

-- Re-state authentication as a forward repair so a revoked workspace
-- membership invalidates an otherwise-live token. The membership check is
-- intentionally after the token-bound workspace context is set.
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
  ) OR NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = token_row.workspace_id
       AND membership.user_id = token_row.user_id
  ) THEN
    RETURN;
  END IF;

  UPDATE appsea.agent_access_tokens token
     SET last_used_at = clock_timestamp()
   WHERE token.token_id = token_row.token_id;
  RETURN QUERY SELECT token_row.token_id, token_row.workspace_id,
                      token_row.user_id, token_row.scopes;
END
$$;

CREATE OR REPLACE FUNCTION appsea.admit_agent_access_request(
  p_token_id text,
  p_workspace_id text,
  p_user_id text,
  p_admission_id text
)
RETURNS TABLE(
  admitted boolean,
  reason text,
  retry_after_seconds integer,
  admission_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  token_row appsea.agent_access_tokens%ROWTYPE;
  now_value timestamptz;
  window_started timestamptz;
  request_count integer;
  in_flight integer;
  retry_after integer;
BEGIN
  IF p_token_id IS NULL OR p_token_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_workspace_id IS NULL OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_user_id IS NULL OR p_user_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_admission_id IS NULL OR p_admission_id !~ '^mcp-admission:[a-z0-9_-]{16,96}$' THEN
    RETURN QUERY SELECT false, 'not_authorized', 0, NULL::text;
    RETURN;
  END IF;

  SELECT token.*
    INTO token_row
    FROM appsea.agent_access_tokens token
   WHERE token.token_id = p_token_id
   FOR UPDATE;
  IF token_row.token_id IS NULL
     OR token_row.workspace_id IS DISTINCT FROM p_workspace_id
     OR token_row.user_id IS DISTINCT FROM p_user_id
     OR token_row.revoked_at IS NOT NULL
     OR token_row.expires_at <= clock_timestamp() THEN
    RETURN QUERY SELECT false, 'not_authorized', 0, NULL::text;
    RETURN;
  END IF;

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
  ) OR NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = token_row.workspace_id
       AND membership.user_id = token_row.user_id
  ) THEN
    RETURN QUERY SELECT false, 'not_authorized', 0, NULL::text;
    RETURN;
  END IF;

  now_value := clock_timestamp();
  DELETE FROM appsea.agent_access_request_leases lease
   WHERE lease.token_id = token_row.token_id
     AND lease.expires_at <= now_value;

  SELECT count(*)::integer
    INTO in_flight
    FROM appsea.agent_access_request_leases lease
   WHERE lease.token_id = token_row.token_id;

  window_started := token_row.rate_window_started_at;
  request_count := token_row.rate_window_request_count;
  IF window_started <= now_value - interval '60 seconds' THEN
    window_started := now_value;
    request_count := 0;
  END IF;

  IF request_count >= 60 THEN
    retry_after := GREATEST(
      1,
      LEAST(60, ceil(extract(epoch FROM (window_started + interval '60 seconds') - now_value))::integer)
    );
    RETURN QUERY SELECT false, 'rate_limited', retry_after, NULL::text;
    RETURN;
  END IF;
  IF in_flight >= 4 THEN
    RETURN QUERY SELECT false, 'concurrency_limited', 1, NULL::text;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM appsea.agent_access_request_leases lease
     WHERE lease.admission_id = p_admission_id
  ) THEN
    RETURN QUERY SELECT false, 'not_authorized', 0, NULL::text;
    RETURN;
  END IF;

  INSERT INTO appsea.agent_access_request_leases
    (admission_id, token_id, workspace_id, user_id, admitted_at, expires_at)
  VALUES
    (p_admission_id, token_row.token_id, token_row.workspace_id, token_row.user_id,
     now_value, now_value + interval '30 seconds');

  UPDATE appsea.agent_access_tokens token
     SET rate_window_started_at = window_started,
         rate_window_request_count = request_count + 1,
         last_used_at = now_value
   WHERE token.token_id = token_row.token_id;

  RETURN QUERY SELECT true, 'admitted', 0, p_admission_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.release_agent_access_request(
  p_token_id text,
  p_workspace_id text,
  p_user_id text,
  p_admission_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  removed boolean;
BEGIN
  IF p_token_id IS NULL OR p_workspace_id IS NULL OR p_user_id IS NULL
     OR p_admission_id IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM appsea.agent_access_request_leases lease
   WHERE lease.admission_id = p_admission_id
     AND lease.token_id = p_token_id
     AND lease.workspace_id = p_workspace_id
     AND lease.user_id = p_user_id
   RETURNING true INTO removed;
  RETURN COALESCE(removed, false);
END
$$;

REVOKE ALL ON FUNCTION appsea.authenticate_agent_access_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.admit_agent_access_request(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.release_agent_access_request(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.authenticate_agent_access_token(text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.admit_agent_access_request(text, text, text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.release_agent_access_request(text, text, text, text) TO appsea_service;
