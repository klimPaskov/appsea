-- Workspace invitations are scoped access grants for existing AppSea accounts.
-- The raw token is held only in the encrypted delivery outbox and never in a
-- read model or audit payload. Delivery remains provider-neutral and can be
-- disabled independently of membership administration.
CREATE TABLE appsea.workspace_invitations (
  invitation_id text PRIMARY KEY CHECK (invitation_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE CASCADE,
  invited_by text REFERENCES appsea.users(user_id) ON DELETE SET NULL,
  accepted_by text REFERENCES appsea.users(user_id) ON DELETE SET NULL,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  email_hash char(64) NOT NULL CHECK (email_hash ~ '^[a-f0-9]{64}$'),
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR accepted_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  UNIQUE (token_hash)
);

CREATE UNIQUE INDEX workspace_invitations_active_email_idx
  ON appsea.workspace_invitations (workspace_id, lower(email))
  WHERE state = 'pending';
CREATE INDEX workspace_invitations_workspace_idx
  ON appsea.workspace_invitations (workspace_id, created_at DESC, invitation_id);

CREATE TABLE appsea.workspace_invitation_deliveries (
  delivery_id text PRIMARY KEY CHECK (delivery_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  invitation_id text NOT NULL REFERENCES appsea.workspace_invitations(invitation_id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  token_ciphertext text NOT NULL CHECK (token_ciphertext ~ '^[A-Za-z0-9_-]{1,4096}$'),
  token_nonce text NOT NULL CHECK (token_nonce ~ '^[A-Za-z0-9_-]{1,128}$'),
  token_tag text NOT NULL CHECK (token_tag ~ '^[A-Za-z0-9_-]{1,128}$'),
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  state text NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'discarded')),
  created_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  lease_started_at timestamptz,
  sent_at timestamptz,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 10),
  last_failure_code text CHECK (last_failure_code IS NULL OR last_failure_code ~ '^[A-Z0-9_:-]{1,80}$')
);

CREATE INDEX workspace_invitation_delivery_claim_idx
  ON appsea.workspace_invitation_deliveries (available_at, created_at)
  WHERE state IN ('pending', 'sending', 'failed');

ALTER TABLE appsea.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.workspace_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_invitation_owner_scope ON appsea.workspace_invitations
  USING (
    current_user = 'appsea_owner'
    OR (
      workspace_id = appsea.current_workspace_id()
      AND EXISTS (
        SELECT 1
          FROM appsea.workspace_memberships membership
         WHERE membership.workspace_id = appsea.current_workspace_id()
           AND membership.user_id = NULLIF(current_setting('appsea.auth_user_id', true), '')
           AND membership.role = 'owner'
      )
    )
  )
  WITH CHECK (
    current_user = 'appsea_owner'
    OR (
      workspace_id = appsea.current_workspace_id()
      AND EXISTS (
        SELECT 1
          FROM appsea.workspace_memberships membership
         WHERE membership.workspace_id = appsea.current_workspace_id()
           AND membership.user_id = NULLIF(current_setting('appsea.auth_user_id', true), '')
           AND membership.role = 'owner'
      )
    )
  );

REVOKE ALL ON appsea.workspace_invitations, appsea.workspace_invitation_deliveries FROM PUBLIC;
GRANT SELECT ON appsea.workspace_invitations TO appsea_service;
REVOKE ALL ON appsea.workspace_invitation_deliveries FROM appsea_service;

CREATE OR REPLACE FUNCTION appsea.issue_workspace_invitation(
  p_workspace_id text,
  p_actor_id text,
  p_invitation_id text,
  p_delivery_id text,
  p_email text,
  p_email_hash text,
  p_token_hash text,
  p_token_ciphertext text,
  p_token_nonce text,
  p_token_tag text,
  p_role text
)
RETURNS TABLE(invitation_id text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  now_value timestamptz;
  expires_at_value timestamptz;
  event_id text;
BEGIN
  IF p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_invitation_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_delivery_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_email IS NULL OR char_length(p_email) NOT BETWEEN 3 AND 320
     OR p_email_hash !~ '^[a-f0-9]{64}$'
     OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_token_ciphertext !~ '^[A-Za-z0-9_-]{1,4096}$'
     OR p_token_nonce !~ '^[A-Za-z0-9_-]{1,128}$'
     OR p_token_tag !~ '^[A-Za-z0-9_-]{1,128}$'
     OR p_role NOT IN ('editor', 'viewer') THEN
    RAISE EXCEPTION 'workspace invitation request is invalid' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(current_setting('appsea.auth_user_id', true), '') <> p_actor_id
     OR appsea.current_workspace_id() <> p_workspace_id THEN
    RAISE EXCEPTION 'workspace invitation actor context is invalid' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
      JOIN appsea.workspaces workspace ON workspace.workspace_id = membership.workspace_id
     WHERE membership.workspace_id = p_workspace_id
       AND membership.user_id = p_actor_id
       AND membership.role = 'owner'
       AND workspace.status = 'active'
  ) THEN
    RAISE EXCEPTION 'workspace invitation requires an owner actor' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
      JOIN appsea.users user_row ON user_row.user_id = membership.user_id
     WHERE membership.workspace_id = p_workspace_id
       AND lower(user_row.email) = lower(p_email)
  ) THEN
    RAISE EXCEPTION 'email is already a workspace member' USING ERRCODE = '23505';
  END IF;

  now_value := clock_timestamp();
  expires_at_value := now_value + interval '3 days';
  WITH revoked AS (
    UPDATE appsea.workspace_invitations
       SET state = 'revoked', revoked_at = COALESCE(revoked_at, now_value)
     WHERE workspace_id = p_workspace_id
       AND lower(email) = lower(p_email)
       AND state = 'pending'
     RETURNING invitation_id
  )
  UPDATE appsea.workspace_invitation_deliveries delivery
     SET state = 'discarded', lease_started_at = NULL
    FROM revoked
   WHERE delivery.invitation_id = revoked.invitation_id
     AND delivery.state IN ('pending', 'sending', 'failed');

  INSERT INTO appsea.workspace_invitations
    (invitation_id, workspace_id, invited_by, email, email_hash, token_hash,
     role, state, created_at, expires_at)
  VALUES
    (p_invitation_id, p_workspace_id, p_actor_id, lower(p_email), p_email_hash,
     p_token_hash, p_role, 'pending', now_value, expires_at_value);
  INSERT INTO appsea.workspace_invitation_deliveries
    (delivery_id, invitation_id, workspace_id, email, token_ciphertext,
     token_nonce, token_tag, role, state, created_at, available_at, expires_at)
  VALUES
    (p_delivery_id, p_invitation_id, p_workspace_id, lower(p_email),
     p_token_ciphertext, p_token_nonce, p_token_tag, p_role, 'pending',
     now_value, now_value, expires_at_value);

  event_id := 'workspace-invitation:' || md5(p_invitation_id || ':' || txid_current()::text);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id, 'audit:' || event_id, 'user', p_actor_id,
     'workspace.invitation.created', 'workspace_invitation', p_invitation_id,
     event_id, jsonb_build_object('role', p_role), now_value)
  ON CONFLICT DO NOTHING;
  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (p_workspace_id, 'outbox:' || event_id, 'workspace.invitation.created',
     'workspace_invitation', p_invitation_id, 'workspace-invitation-v1', event_id,
     jsonb_build_object('role', p_role), now_value)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT p_invitation_id, expires_at_value;
END
$$;

CREATE OR REPLACE FUNCTION appsea.revoke_workspace_invitation(
  p_workspace_id text,
  p_actor_id text,
  p_invitation_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  invitation_row appsea.workspace_invitations%ROWTYPE;
  now_value timestamptz;
  event_id text;
BEGIN
  IF p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_invitation_id !~ '^[a-z][a-z0-9_:-]{2,159}$' THEN
    RETURN false;
  END IF;
  IF NULLIF(current_setting('appsea.auth_user_id', true), '') <> p_actor_id
     OR appsea.current_workspace_id() <> p_workspace_id THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM appsea.workspace_memberships
     WHERE workspace_id = p_workspace_id AND user_id = p_actor_id AND role = 'owner'
  ) THEN
    RETURN false;
  END IF;
  SELECT * INTO invitation_row
    FROM appsea.workspace_invitations
   WHERE workspace_id = p_workspace_id AND invitation_id = p_invitation_id
   FOR UPDATE;
  IF invitation_row.invitation_id IS NULL THEN RETURN false; END IF;
  IF invitation_row.state <> 'pending' THEN
    RETURN invitation_row.state = 'revoked';
  END IF;

  now_value := clock_timestamp();
  UPDATE appsea.workspace_invitations
     SET state = 'revoked', revoked_at = now_value
   WHERE invitation_id = p_invitation_id;
  UPDATE appsea.workspace_invitation_deliveries
     SET state = 'discarded', lease_started_at = NULL
   WHERE invitation_id = p_invitation_id AND state IN ('pending', 'sending', 'failed');

  event_id := 'workspace-invitation-revoked:' || md5(p_invitation_id || ':' || txid_current()::text);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id, 'audit:' || event_id, 'user', p_actor_id,
     'workspace.invitation.revoked', 'workspace_invitation', p_invitation_id,
     event_id, '{}'::jsonb, now_value)
  ON CONFLICT DO NOTHING;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.accept_workspace_invitation(
  p_token_hash text,
  p_user_id text
)
RETURNS TABLE(accepted boolean, workspace_id text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  invitation_row appsea.workspace_invitations%ROWTYPE;
  user_email text;
  now_value timestamptz;
  event_id text;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' OR p_user_id !~ '^[a-z][a-z0-9_:-]{2,159}$' THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO invitation_row
    FROM appsea.workspace_invitations
   WHERE token_hash = p_token_hash
   FOR UPDATE;
  IF invitation_row.invitation_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF invitation_row.state = 'accepted' THEN
    IF invitation_row.accepted_by = p_user_id AND EXISTS (
      SELECT 1
        FROM appsea.workspace_memberships
       WHERE workspace_id = invitation_row.workspace_id
         AND user_id = p_user_id
    ) THEN
      RETURN QUERY SELECT true, invitation_row.workspace_id, invitation_row.role;
    ELSE
      RETURN QUERY SELECT false, NULL::text, NULL::text;
    END IF;
    RETURN;
  END IF;
  IF invitation_row.state <> 'pending' OR invitation_row.expires_at <= clock_timestamp() THEN
    UPDATE appsea.workspace_invitations
       SET state = CASE WHEN state = 'pending' THEN 'expired' ELSE state END
     WHERE invitation_id = invitation_row.invitation_id;
    UPDATE appsea.workspace_invitation_deliveries
       SET state = 'discarded', lease_started_at = NULL
     WHERE invitation_id = invitation_row.invitation_id AND state IN ('pending', 'sending', 'failed');
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT email INTO user_email FROM appsea.users WHERE user_id = p_user_id;
  IF user_email IS NULL OR lower(user_email) <> lower(invitation_row.email) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF invitation_row.invited_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM appsea.workspace_memberships
     WHERE workspace_id = invitation_row.workspace_id
       AND user_id = invitation_row.invited_by
       AND role = 'owner'
  ) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- The inviter remains the authorized actor for the membership trigger; the
  -- accepting user is recorded separately in the invitation audit event.
  PERFORM set_config('appsea.auth_user_id', invitation_row.invited_by, true);
  PERFORM set_config('appsea.workspace_id', invitation_row.workspace_id, true);
  INSERT INTO appsea.workspace_memberships
    (workspace_id, user_id, role, created_at, updated_at)
  VALUES
    (invitation_row.workspace_id, p_user_id, invitation_row.role, clock_timestamp(), clock_timestamp())
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  now_value := clock_timestamp();
  UPDATE appsea.workspace_invitations
     SET state = 'accepted', accepted_by = p_user_id, accepted_at = now_value
   WHERE invitation_id = invitation_row.invitation_id;
  UPDATE appsea.workspace_invitation_deliveries
     SET state = 'discarded', lease_started_at = NULL
   WHERE invitation_id = invitation_row.invitation_id AND state IN ('pending', 'sending', 'failed');
  event_id := 'workspace-invitation-accepted:' || md5(invitation_row.invitation_id || ':' || txid_current()::text);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (invitation_row.workspace_id, 'audit:' || event_id, 'user', p_user_id,
     'workspace.invitation.accepted', 'workspace_invitation', invitation_row.invitation_id,
     event_id, jsonb_build_object('role', invitation_row.role), now_value)
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT true, invitation_row.workspace_id, invitation_row.role;
END
$$;

CREATE OR REPLACE FUNCTION appsea.claim_workspace_invitation_deliveries(p_batch_size integer)
RETURNS TABLE(
  delivery_id text,
  workspace_id text,
  email text,
  token_ciphertext text,
  token_nonce text,
  token_tag text,
  role text,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
  WITH candidates AS (
    SELECT delivery_id
      FROM appsea.workspace_invitation_deliveries
     WHERE attempt_count < 10
       AND expires_at > clock_timestamp()
       AND (
         (state IN ('pending', 'failed') AND available_at <= clock_timestamp())
         OR (state = 'sending' AND lease_started_at <= clock_timestamp() - interval '5 minutes')
       )
     ORDER BY delivery_id
     LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 1), 1), 100)
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE appsea.workspace_invitation_deliveries delivery
       SET state = 'sending',
           lease_started_at = clock_timestamp(),
           attempt_count = delivery.attempt_count + 1,
           last_failure_code = NULL
      FROM candidates
     WHERE delivery.delivery_id = candidates.delivery_id
     RETURNING delivery.delivery_id, delivery.workspace_id, delivery.email,
               delivery.token_ciphertext, delivery.token_nonce, delivery.token_tag,
               delivery.role, delivery.expires_at
  )
  SELECT delivery_id, workspace_id, email, token_ciphertext, token_nonce,
         token_tag, role, expires_at
    FROM claimed
$$;

CREATE OR REPLACE FUNCTION appsea.complete_workspace_invitation_delivery(p_delivery_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  delivery_row appsea.workspace_invitation_deliveries%ROWTYPE;
  now_value timestamptz;
  event_id text;
BEGIN
  UPDATE appsea.workspace_invitation_deliveries
     SET state = 'sent', sent_at = clock_timestamp(), lease_started_at = NULL
   WHERE delivery_id = p_delivery_id AND state = 'sending'
   RETURNING * INTO delivery_row;
  IF NOT FOUND THEN
    RETURN EXISTS (
      SELECT 1 FROM appsea.workspace_invitation_deliveries
       WHERE delivery_id = p_delivery_id AND state = 'sent'
    );
  END IF;
  now_value := clock_timestamp();
  event_id := 'workspace-invitation-sent:' || md5(p_delivery_id || ':' || txid_current()::text);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (delivery_row.workspace_id, 'audit:' || event_id, 'system', 'appsea-worker',
     'workspace.invitation.delivery_sent', 'workspace_invitation', delivery_row.invitation_id,
     event_id, jsonb_build_object('deliveryId', p_delivery_id), now_value)
  ON CONFLICT DO NOTHING;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.fail_workspace_invitation_delivery(
  p_delivery_id text,
  p_failure_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  delivery_row appsea.workspace_invitation_deliveries%ROWTYPE;
  now_value timestamptz;
  event_id text;
BEGIN
  IF p_failure_code <> 'APPSEA_WORKSPACE_INVITATION_DELIVERY_FAILED' THEN RETURN false; END IF;
  UPDATE appsea.workspace_invitation_deliveries
     SET state = 'failed',
         available_at = clock_timestamp() + interval '5 minutes',
         lease_started_at = NULL,
         last_failure_code = p_failure_code
   WHERE delivery_id = p_delivery_id AND state = 'sending'
   RETURNING * INTO delivery_row;
  IF NOT FOUND THEN RETURN false; END IF;
  now_value := clock_timestamp();
  event_id := 'workspace-invitation-failed:' || md5(p_delivery_id || ':' || txid_current()::text);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (delivery_row.workspace_id, 'audit:' || event_id, 'system', 'appsea-worker',
     'workspace.invitation.delivery_failed', 'workspace_invitation', delivery_row.invitation_id,
     event_id, jsonb_build_object('deliveryId', p_delivery_id, 'failureCode', p_failure_code), now_value)
  ON CONFLICT DO NOTHING;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.purge_workspace_invitations(
  p_retention_days integer,
  p_batch_size integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  deleted_invitations integer;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650
     OR p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 10_000 THEN
    RETURN 0;
  END IF;
  DELETE FROM appsea.workspace_invitations
   WHERE invitation_id IN (
     SELECT invitation_id
       FROM appsea.workspace_invitations
      WHERE (state = 'pending' AND expires_at <= clock_timestamp())
         OR (state IN ('accepted', 'revoked', 'expired')
             AND COALESCE(accepted_at, revoked_at, expires_at)
                 <= clock_timestamp() - (p_retention_days::bigint * interval '1 day'))
      ORDER BY expires_at, invitation_id
      LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 1), 1), 10_000)
   );
  GET DIAGNOSTICS deleted_invitations = ROW_COUNT;
  RETURN deleted_invitations;
END
$$;

REVOKE ALL ON FUNCTION appsea.issue_workspace_invitation(text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.revoke_workspace_invitation(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.accept_workspace_invitation(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.claim_workspace_invitation_deliveries(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.complete_workspace_invitation_delivery(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.fail_workspace_invitation_delivery(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.purge_workspace_invitations(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.issue_workspace_invitation(text, text, text, text, text, text, text, text, text, text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.revoke_workspace_invitation(text, text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.accept_workspace_invitation(text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.claim_workspace_invitation_deliveries(integer) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.complete_workspace_invitation_delivery(text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.fail_workspace_invitation_delivery(text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.purge_workspace_invitations(integer, integer) TO appsea_service;
