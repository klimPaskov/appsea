BEGIN;

-- Expose only the bounded current-minute quota observation needed by the
-- authenticated source registry. The quota window is global across workspaces,
-- so the runtime must not read the window table directly through workspace RLS.
-- This function is read-only and never reserves, settles, releases, or refunds
-- quota. A workspace context is still mandatory so an unscoped caller cannot
-- use it as a global operational probe.
CREATE OR REPLACE FUNCTION appsea.read_source_quota_headroom(
  p_source_id text,
  p_policy_version text
)
RETURNS TABLE (
  window_started_at timestamptz,
  window_ends_at timestamptz,
  requests_used integer,
  requests_remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := appsea.current_workspace_id();
  authenticated_actor text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  source_lifecycle text;
  current_policy_version text;
  policy_state text;
  policy_commercial_use text;
  policy_reviewed_at timestamptz;
  policy_expires_at timestamptz;
  policy_payload jsonb;
  quota_value text;
  max_requests integer;
  window_start timestamptz;
  used_requests integer := 0;
BEGIN
  IF current_workspace IS NULL OR authenticated_actor IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM appsea.workspace_memberships membership
         JOIN appsea.workspaces workspace
           ON workspace.workspace_id = membership.workspace_id
        WHERE membership.workspace_id = current_workspace
          AND membership.user_id = authenticated_actor
          AND workspace.status = 'active'
     ) THEN
    RAISE EXCEPTION 'source quota headroom requires an authenticated workspace context'
      USING ERRCODE = '42501';
  END IF;
  IF p_source_id IS NULL
     OR p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_policy_version IS NULL
     OR char_length(p_policy_version) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid source quota headroom input' USING ERRCODE = '22023';
  END IF;

  SELECT source.lifecycle_state,
         source.current_policy_version,
         policy.policy_state,
         policy.commercial_use,
         policy.reviewed_at,
         policy.expires_at,
         policy.policy_payload
    INTO source_lifecycle,
         current_policy_version,
         policy_state,
         policy_commercial_use,
         policy_reviewed_at,
         policy_expires_at,
         policy_payload
    FROM appsea.sources source
    LEFT JOIN appsea.source_policy_versions policy
      ON policy.source_id = source.source_id
     AND policy.policy_version = p_policy_version
   WHERE source.source_id = p_source_id;

  -- Pending, expired, retired, or mismatched policies do not receive an
  -- operational headroom read. The caller maps this to a visible blocked or
  -- unknown state rather than presenting a limit as usable capacity.
  IF source_lifecycle IS DISTINCT FROM 'active'
     OR current_policy_version IS DISTINCT FROM p_policy_version
     OR policy_state IS DISTINCT FROM 'approved'
     OR policy_commercial_use IS NULL
     OR policy_commercial_use NOT IN ('allowed', 'restricted')
     OR policy_reviewed_at IS NULL
     OR (policy_expires_at IS NOT NULL AND policy_expires_at <= clock_timestamp())
     OR policy_payload IS NULL THEN
    RETURN;
  END IF;

  quota_value := policy_payload #>> '{quota,requestsPerMinute}';
  IF quota_value IS NULL OR quota_value !~ '^[0-9]+$' THEN
    RETURN;
  END IF;
  max_requests := quota_value::integer;
  IF max_requests < 1 OR max_requests > 10000 THEN
    RETURN;
  END IF;

  window_start := date_trunc('minute', clock_timestamp());
  SELECT quota_window.request_count
    INTO used_requests
    FROM appsea.source_quota_windows quota_window
   WHERE quota_window.source_id = p_source_id
     AND quota_window.policy_version = p_policy_version
     AND quota_window.window_started_at = window_start;
  used_requests := LEAST(GREATEST(COALESCE(used_requests, 0), 0), max_requests);

  RETURN QUERY
  SELECT window_start,
         window_start + interval '1 minute',
         used_requests,
         GREATEST(max_requests - used_requests, 0);
END
$$;

REVOKE ALL ON FUNCTION appsea.read_source_quota_headroom(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.read_source_quota_headroom(text, text) TO appsea_service;

COMMENT ON FUNCTION appsea.read_source_quota_headroom(text, text) IS
  'Returns bounded current-minute quota headroom for an authenticated workspace source registry read; never mutates quota.';

COMMIT;
