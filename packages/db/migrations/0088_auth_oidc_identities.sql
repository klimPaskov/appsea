-- Optional OIDC identities are a separate global-auth boundary. A provider
-- subject is linkable only after an existing AppSea account completes the
-- password/MFA step-up; email equality is intentionally not an identity key.
CREATE TABLE appsea.auth_identities (
  identity_id text PRIMARY KEY CHECK (identity_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  user_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'oidc'),
  issuer text NOT NULL CHECK (
    char_length(issuer) BETWEEN 8 AND 512
    AND position('@' IN issuer) = 0
    AND position('?' IN issuer) = 0
    AND position('#' IN issuer) = 0
    AND (
      issuer ~ '^https://[^[:space:]/?#]+(/[^[:space:]?#]*)?$'
      OR issuer ~ '^http://(localhost|127[.]0[.]0[.]1|[[]::1[]])(:[0-9]+)?/?$'
    )
  ),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
  email text NOT NULL CHECK (
    char_length(email) BETWEEN 3 AND 320
    AND email = lower(email)
  ),
  verified_at timestamptz NOT NULL,
  linked_at timestamptz NOT NULL,
  last_authenticated_at timestamptz,
  UNIQUE (provider, issuer, subject),
  UNIQUE (user_id, provider, issuer)
);

CREATE INDEX auth_identities_user_idx
  ON appsea.auth_identities (user_id, linked_at, identity_id);

-- Preserve the OIDC identity binding across the MFA handoff so a successful
-- second factor can be audited without trusting a browser cookie claim.
ALTER TABLE appsea.auth_mfa_challenges
  ADD COLUMN oidc_identity_id text,
  ADD COLUMN oidc_issuer text;
ALTER TABLE appsea.auth_mfa_challenges
  ADD CONSTRAINT auth_mfa_challenges_oidc_identity_binding_check CHECK (
    (oidc_identity_id IS NULL AND oidc_issuer IS NULL)
    OR (
      oidc_identity_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
      AND (
        char_length(oidc_issuer) BETWEEN 8 AND 512
        AND (
          oidc_issuer ~ '^https://[^@[:space:]/?#]+(/[^[:space:]?#]*)?$'
          OR oidc_issuer ~ '^http://(localhost|127[.]0[.]0[.]1|[[]::1[]])(:[0-9]+)?/?$'
        )
      )
    )
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
      'account_closed',
      'oidc_identity_linked',
      'oidc_identity_unlinked',
      'oidc_sign_in'
    )
  );

REVOKE ALL ON appsea.auth_identities FROM PUBLIC;
GRANT SELECT ON appsea.auth_identities TO appsea_service;

-- Keep the existing security-event table behind a narrow function boundary;
-- the runtime role cannot fabricate recovery or account-closure events.
CREATE OR REPLACE FUNCTION appsea.record_oidc_security_event(
  p_event_id text,
  p_event_type text,
  p_user_id text,
  p_identity_id text,
  p_issuer text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  identity_user_id text;
  identity_issuer text;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_event_type IS NULL
     OR p_event_type NOT IN ('oidc_identity_linked', 'oidc_identity_unlinked', 'oidc_sign_in')
     OR p_user_id IS NULL OR p_user_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_identity_id IS NULL OR p_identity_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_issuer IS NULL OR char_length(p_issuer) NOT BETWEEN 8 AND 512
     OR position('@' IN p_issuer) > 0
     OR position('?' IN p_issuer) > 0
     OR position('#' IN p_issuer) > 0
     OR (
       p_issuer !~ '^https://[^[:space:]/?#]+(/[^[:space:]?#]*)?$'
       AND p_issuer !~ '^http://(localhost|127[.]0[.]0[.]1|[[]::1[]])(:[0-9]+)?/?$'
     ) THEN
    RAISE EXCEPTION 'OIDC security event is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT identity.user_id, identity.issuer
    INTO identity_user_id, identity_issuer
    FROM appsea.auth_identities identity
   WHERE identity.identity_id = p_identity_id
   FOR SHARE;
  IF identity_user_id IS NULL
     OR identity_user_id <> p_user_id
     OR identity_issuer <> p_issuer THEN
    RAISE EXCEPTION 'OIDC security event identity binding is invalid'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO appsea.auth_security_events
    (event_id, event_type, user_id, metadata, occurred_at)
  VALUES
    (p_event_id, p_event_type, p_user_id,
     jsonb_build_object(
       'provider', 'oidc',
       'identityId', p_identity_id,
       'issuerHost', split_part(split_part(p_issuer, '://', 2), '/', 1)
     ),
     clock_timestamp());
END
$$;

REVOKE ALL ON FUNCTION appsea.record_oidc_security_event(text, text, text, text, text)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION appsea.touch_oidc_identity_sign_in(
  p_event_id text,
  p_user_id text,
  p_identity_id text,
  p_issuer text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user <> 'appsea_service'
     OR p_event_id IS NULL OR p_user_id IS NULL OR p_identity_id IS NULL
     OR p_issuer IS NULL OR char_length(p_issuer) NOT BETWEEN 8 AND 512
     OR position('@' IN p_issuer) > 0
     OR position('?' IN p_issuer) > 0 OR position('#' IN p_issuer) > 0
     OR (
       p_issuer !~ '^https://[^[:space:]/?#]+(/[^[:space:]?#]*)?$'
       AND p_issuer !~ '^http://(localhost|127[.]0[.]0[.]1|[[]::1[]])(:[0-9]+)?/?$'
     ) THEN
    RAISE EXCEPTION 'OIDC sign-in identity is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
    FROM appsea.auth_identities identity
   WHERE identity.identity_id = p_identity_id
     AND identity.user_id = p_user_id
     AND identity.issuer = p_issuer
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OIDC sign-in identity binding is invalid'
      USING ERRCODE = '42501';
  END IF;
  UPDATE appsea.auth_identities
     SET last_authenticated_at = clock_timestamp()
   WHERE identity_id = p_identity_id;
  PERFORM appsea.record_oidc_security_event(
    p_event_id, 'oidc_sign_in', p_user_id, p_identity_id, p_issuer
  );
END
$$;

CREATE OR REPLACE FUNCTION appsea.link_oidc_identity(
  p_event_id text,
  p_session_hash text,
  p_identity_id text,
  p_issuer text,
  p_subject text,
  p_email text
)
RETURNS TABLE(
  identity_id text,
  user_id text,
  provider text,
  issuer text,
  subject text,
  email text,
  linked_at timestamptz,
  last_authenticated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  session_user_id text;
  session_email text;
  mfa_allowed boolean;
  existing_row record;
  linked_at_value timestamptz;
BEGIN
  IF session_user <> 'appsea_service'
     OR p_event_id IS NULL OR p_event_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$'
     OR p_identity_id IS NULL OR p_identity_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_issuer IS NULL OR char_length(p_issuer) NOT BETWEEN 8 AND 512
     OR position('@' IN p_issuer) > 0
     OR position('?' IN p_issuer) > 0
     OR position('#' IN p_issuer) > 0
     OR (
       p_issuer !~ '^https://[^[:space:]/?#]+(/[^[:space:]?#]*)?$'
       AND p_issuer !~ '^http://(localhost|127[.]0[.]0[.]1|[[]::1[]])(:[0-9]+)?/?$'
     )
     OR p_subject IS NULL OR char_length(p_subject) NOT BETWEEN 1 AND 512
     OR p_email IS NULL OR char_length(p_email) NOT BETWEEN 3 AND 320
     OR p_email <> lower(p_email) THEN
    RAISE EXCEPTION 'OIDC link identity is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT session.user_id, app_user.email,
         (
           NOT EXISTS (
             SELECT 1 FROM appsea.auth_mfa_totp mfa
              WHERE mfa.user_id = session.user_id
                AND mfa.status = 'enabled'
           )
           OR (
             session.last_mfa_reauthenticated_at IS NOT NULL
             AND session.last_mfa_reauthenticated_at >
                 clock_timestamp() - interval '15 minutes'
           )
         )
    INTO session_user_id, session_email, mfa_allowed
    FROM appsea.auth_sessions session
    JOIN appsea.users app_user
      ON app_user.user_id = session.user_id
     AND app_user.account_state = 'active'
   WHERE session.token_hash = p_session_hash
     AND session.revoked_at IS NULL
     AND session.expires_at > clock_timestamp()
     AND session.last_reauthenticated_at > clock_timestamp() - interval '15 minutes'
   FOR UPDATE OF session;

  IF session_user_id IS NULL OR NOT mfa_allowed OR session_email <> p_email THEN
    RAISE EXCEPTION 'OIDC link requires a recent password and MFA step-up'
      USING ERRCODE = '42501';
  END IF;

  SELECT identity.identity_id, identity.user_id, identity.provider,
         identity.issuer, identity.subject, identity.email,
         identity.linked_at, identity.last_authenticated_at
    INTO existing_row
    FROM appsea.auth_identities identity
   WHERE identity.provider = 'oidc'
     AND identity.issuer = p_issuer
     AND identity.subject = p_subject
   FOR UPDATE;
  IF FOUND THEN
    IF existing_row.user_id <> session_user_id OR existing_row.email <> p_email THEN
      RAISE EXCEPTION 'OIDC identity is already linked' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT existing_row.identity_id, existing_row.user_id,
                        existing_row.provider, existing_row.issuer,
                        existing_row.subject, existing_row.email,
                        existing_row.linked_at, existing_row.last_authenticated_at;
    RETURN;
  END IF;

  linked_at_value := clock_timestamp();
  INSERT INTO appsea.auth_identities
    (identity_id, user_id, provider, issuer, subject, email, verified_at, linked_at)
  VALUES
    (p_identity_id, session_user_id, 'oidc', p_issuer, p_subject, p_email,
     linked_at_value, linked_at_value);
  PERFORM appsea.record_oidc_security_event(
    p_event_id, 'oidc_identity_linked', session_user_id, p_identity_id, p_issuer
  );
  RETURN QUERY
    SELECT identity.identity_id, identity.user_id, identity.provider,
           identity.issuer, identity.subject, identity.email,
           identity.linked_at, identity.last_authenticated_at
      FROM appsea.auth_identities identity
     WHERE identity.identity_id = p_identity_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.unlink_oidc_identity(
  p_event_id text,
  p_session_hash text,
  p_identity_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  session_user_id text;
  mfa_allowed boolean;
  identity_issuer text;
BEGIN
  IF session_user <> 'appsea_service'
     OR p_event_id IS NULL OR p_event_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$'
     OR p_identity_id IS NULL OR p_identity_id !~ '^[a-z][a-z0-9_:-]{2,159}$' THEN
    RAISE EXCEPTION 'OIDC unlink identity is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT session.user_id,
         (
           NOT EXISTS (
             SELECT 1 FROM appsea.auth_mfa_totp mfa
              WHERE mfa.user_id = session.user_id
                AND mfa.status = 'enabled'
           )
           OR (
             session.last_mfa_reauthenticated_at IS NOT NULL
             AND session.last_mfa_reauthenticated_at >
                 clock_timestamp() - interval '15 minutes'
           )
         )
    INTO session_user_id, mfa_allowed
    FROM appsea.auth_sessions session
    JOIN appsea.users app_user
      ON app_user.user_id = session.user_id
     AND app_user.account_state = 'active'
   WHERE session.token_hash = p_session_hash
     AND session.revoked_at IS NULL
     AND session.expires_at > clock_timestamp()
     AND session.last_reauthenticated_at > clock_timestamp() - interval '15 minutes'
   FOR UPDATE OF session;
  IF session_user_id IS NULL OR NOT mfa_allowed THEN
    RAISE EXCEPTION 'OIDC unlink requires a recent password and MFA step-up'
      USING ERRCODE = '42501';
  END IF;

  SELECT identity.issuer
    INTO identity_issuer
    FROM appsea.auth_identities identity
   WHERE identity.identity_id = p_identity_id
     AND identity.user_id = session_user_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM appsea.record_oidc_security_event(
    p_event_id, 'oidc_identity_unlinked', session_user_id, p_identity_id, identity_issuer
  );
  DELETE FROM appsea.auth_identities WHERE identity_id = p_identity_id;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION appsea.touch_oidc_identity_sign_in(text, text, text, text)
  FROM PUBLIC, appsea_maintenance, appsea_migrator;
REVOKE ALL ON FUNCTION appsea.link_oidc_identity(text, text, text, text, text, text)
  FROM PUBLIC, appsea_maintenance, appsea_migrator;
REVOKE ALL ON FUNCTION appsea.unlink_oidc_identity(text, text, text)
  FROM PUBLIC, appsea_maintenance, appsea_migrator;

GRANT EXECUTE ON FUNCTION appsea.touch_oidc_identity_sign_in(text, text, text, text)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.link_oidc_identity(text, text, text, text, text, text)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.unlink_oidc_identity(text, text, text)
  TO appsea_service;

-- Account closure must remove provider subjects and email claims immediately;
-- the research workspace remains retained by the existing closure contract.
CREATE OR REPLACE FUNCTION appsea.clear_auth_identities_on_account_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.account_state = 'closed' AND OLD.account_state <> 'closed' THEN
    DELETE FROM appsea.auth_identities WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS users_clear_auth_identities_on_closure ON appsea.users;
CREATE TRIGGER users_clear_auth_identities_on_closure
  AFTER UPDATE OF account_state ON appsea.users
  FOR EACH ROW
  EXECUTE FUNCTION appsea.clear_auth_identities_on_account_closure();

REVOKE ALL ON FUNCTION appsea.clear_auth_identities_on_account_closure() FROM PUBLIC, appsea_service;
