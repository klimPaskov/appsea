-- Account closure keeps workspace research provenance intact while removing
-- authentication material and personal profile fields. A user cannot close
-- while still owning a workspace; ownership must be transferred through the
-- existing step-up-protected membership administration path first.
ALTER TABLE appsea.users
  ADD COLUMN account_state text NOT NULL DEFAULT 'active',
  ADD COLUMN closed_at timestamptz,
  ADD CONSTRAINT users_account_state_check CHECK (
    (account_state = 'active' AND closed_at IS NULL)
    OR (account_state = 'closed' AND closed_at IS NOT NULL)
  );

ALTER TABLE appsea.auth_security_events
  DROP CONSTRAINT IF EXISTS auth_security_events_event_type_check;
ALTER TABLE appsea.auth_security_events
  ADD CONSTRAINT auth_security_events_event_type_check CHECK (
    event_type IN (
      'password_reset_requested',
      'password_reset_delivery_sent',
      'password_reset_delivery_failed',
      'password_reset_consumed',
      'account_closed'
    )
  );

CREATE OR REPLACE FUNCTION appsea.close_user_account(p_user_id text)
RETURNS TABLE(closed boolean, blocking_workspace_ids text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  owner_workspaces text[];
  account_state_value text;
  closed_at_value timestamptz;
BEGIN
  IF p_user_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'account closure requires the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_row.account_state, user_row.closed_at
    INTO account_state_value, closed_at_value
    FROM appsea.users user_row
   WHERE user_row.user_id = p_user_id
   FOR UPDATE;

  IF account_state_value IS NULL THEN
    RAISE EXCEPTION 'account closure target was not found'
      USING ERRCODE = '42501';
  END IF;

  IF account_state_value = 'closed' THEN
    RETURN QUERY SELECT true, ARRAY[]::text[];
    RETURN;
  END IF;

  WITH locked_memberships AS (
    SELECT membership.workspace_id, membership.role
      FROM appsea.workspace_memberships membership
     WHERE membership.user_id = p_user_id
     ORDER BY membership.workspace_id
     FOR UPDATE
  )
  SELECT COALESCE(
           array_agg(locked_memberships.workspace_id ORDER BY locked_memberships.workspace_id)
             FILTER (WHERE locked_memberships.role = 'owner'),
           ARRAY[]::text[]
         )
    INTO owner_workspaces
    FROM locked_memberships;

  IF cardinality(owner_workspaces) > 0 THEN
    RETURN QUERY SELECT false, owner_workspaces;
    RETURN;
  END IF;

  -- Do not retain a bearer token or a recoverable profile after closure. The
  -- placeholder email is deterministic and unique but cannot receive mail.
  UPDATE appsea.users
     SET account_state = 'closed',
         closed_at = clock_timestamp(),
         email = 'closed+' || md5(p_user_id) || '@invalid.appsea.local',
         display_name = 'Closed account',
         password_hash = repeat('0', 64),
         updated_at = clock_timestamp()
   WHERE user_id = p_user_id;

  UPDATE appsea.auth_sessions
     SET revoked_at = COALESCE(revoked_at, clock_timestamp())
   WHERE user_id = p_user_id
     AND revoked_at IS NULL;

  UPDATE appsea.auth_password_reset_tokens
     SET invalidated_at = COALESCE(invalidated_at, clock_timestamp())
   WHERE user_id = p_user_id
     AND consumed_at IS NULL
     AND invalidated_at IS NULL;

  UPDATE appsea.auth_password_reset_deliveries
     SET state = 'discarded',
         reset_token_id = NULL,
         user_id = NULL,
         token_ciphertext = NULL,
         token_nonce = NULL,
         token_tag = NULL,
         last_failure_code = 'APPSEA_ACCOUNT_CLOSED'
   WHERE user_id = p_user_id
     AND state <> 'discarded';

  INSERT INTO appsea.auth_security_events
    (event_id, event_type, user_id, metadata, occurred_at)
  VALUES
    ('account-closed:' || md5(p_user_id || ':' || clock_timestamp()::text),
     'account_closed', p_user_id,
     jsonb_build_object('authenticationMaterial', 'revoked', 'workspaceData', 'retained'),
     clock_timestamp());

  RETURN QUERY SELECT true, ARRAY[]::text[];
END
$$;

REVOKE ALL ON FUNCTION appsea.close_user_account(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.close_user_account(text) TO appsea_service;
