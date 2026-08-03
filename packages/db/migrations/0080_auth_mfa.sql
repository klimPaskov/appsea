-- TOTP MFA is a global-auth boundary. The secret is encrypted by the
-- application before it reaches PostgreSQL; recovery codes and challenge
-- tokens are stored only as one-way hashes. No workspace row contains MFA
-- material, and pending login challenges cannot authorize a workspace read.
CREATE TABLE appsea.auth_mfa_totp (
  user_id text PRIMARY KEY REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  secret_ciphertext text NOT NULL CHECK (secret_ciphertext ~ '^[A-Za-z0-9_-]{1,255}$'),
  secret_nonce text NOT NULL CHECK (secret_nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  secret_tag text NOT NULL CHECK (secret_tag ~ '^[A-Za-z0-9_-]{16,64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'enabled')),
  created_at timestamptz NOT NULL,
  verified_at timestamptz,
  last_used_step bigint,
  CHECK ((status = 'pending' AND verified_at IS NULL) OR
         (status = 'enabled' AND verified_at IS NOT NULL)),
  CHECK (last_used_step IS NULL OR last_used_step >= 0)
);

CREATE TABLE appsea.auth_mfa_recovery_codes (
  recovery_code_id text PRIMARY KEY CHECK (recovery_code_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  user_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (user_id, code_hash)
);

CREATE INDEX auth_mfa_recovery_user_idx
  ON appsea.auth_mfa_recovery_codes (user_id, consumed_at, recovery_code_id);

CREATE TABLE appsea.auth_mfa_challenges (
  challenge_id text PRIMARY KEY CHECK (challenge_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  user_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  challenge_hash char(64) NOT NULL CHECK (challenge_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  locked_until timestamptz,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (locked_until IS NULL OR locked_until >= created_at),
  UNIQUE (challenge_hash)
);

CREATE INDEX auth_mfa_challenges_expiry_idx
  ON appsea.auth_mfa_challenges (expires_at, challenge_id);

CREATE TABLE appsea.auth_mfa_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  event_type text NOT NULL CHECK (
    event_type IN (
      'enrollment_started',
      'enrollment_completed',
      'disabled',
      'challenge_created',
      'challenge_succeeded',
      'challenge_failed',
      'recovery_code_used'
    )
  ),
  user_id text REFERENCES appsea.users(user_id) ON DELETE SET NULL,
  challenge_id text,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX auth_mfa_events_occurred_idx
  ON appsea.auth_mfa_events (occurred_at DESC, event_id);

REVOKE ALL ON appsea.auth_mfa_totp,
  appsea.auth_mfa_recovery_codes,
  appsea.auth_mfa_challenges,
  appsea.auth_mfa_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON appsea.auth_mfa_totp TO appsea_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON appsea.auth_mfa_recovery_codes TO appsea_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON appsea.auth_mfa_challenges TO appsea_service;
GRANT SELECT, INSERT ON appsea.auth_mfa_events TO appsea_service;

-- Account closure retains shared workspace research but must remove the
-- account's encrypted MFA secret and recovery material immediately.
CREATE OR REPLACE FUNCTION appsea.clear_auth_mfa_on_account_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.account_state = 'closed' AND OLD.account_state <> 'closed' THEN
    DELETE FROM appsea.auth_mfa_recovery_codes WHERE user_id = NEW.user_id;
    DELETE FROM appsea.auth_mfa_challenges WHERE user_id = NEW.user_id;
    DELETE FROM appsea.auth_mfa_totp WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS users_clear_auth_mfa_on_closure ON appsea.users;
CREATE TRIGGER users_clear_auth_mfa_on_closure
  AFTER UPDATE OF account_state ON appsea.users
  FOR EACH ROW
  EXECUTE FUNCTION appsea.clear_auth_mfa_on_account_closure();

REVOKE ALL ON FUNCTION appsea.clear_auth_mfa_on_account_closure()
  FROM PUBLIC, appsea_service;

-- Bounded auth retention is exposed only through the maintenance-fenced
-- runtime call. The application role may not delete old challenge/event
-- history merely by presenting a user token.
CREATE OR REPLACE FUNCTION appsea.purge_auth_mfa_material(
  p_before timestamptz,
  p_limit integer
)
RETURNS TABLE(
  challenges_deleted integer,
  events_deleted integer,
  pending_enrollments_deleted integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  challenge_count integer;
  event_count integer;
  pending_enrollment_count integer;
BEGIN
  IF p_before IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'MFA retention parameters are invalid' USING ERRCODE = '22023';
  END IF;

  WITH stale AS (
    SELECT challenge_id
      FROM appsea.auth_mfa_challenges
     WHERE expires_at <= p_before
        OR (consumed_at IS NOT NULL AND consumed_at <= p_before)
     ORDER BY expires_at, challenge_id
     LIMIT p_limit
  )
  DELETE FROM appsea.auth_mfa_challenges challenge_row
   USING stale
   WHERE challenge_row.challenge_id = stale.challenge_id;
  GET DIAGNOSTICS challenge_count = ROW_COUNT;

  WITH stale AS (
    SELECT event_id
      FROM appsea.auth_mfa_events
     WHERE occurred_at <= p_before
     ORDER BY occurred_at, event_id
     LIMIT p_limit
  )
  DELETE FROM appsea.auth_mfa_events event_row
   USING stale
   WHERE event_row.event_id = stale.event_id;
  GET DIAGNOSTICS event_count = ROW_COUNT;

  -- Abandoned enrollments are sensitive material too. Remove their recovery
  -- hashes first, then the pending encrypted secret, using a bounded and
  -- locked user set so a concurrent enrollment cannot be torn down midway.
  WITH stale_pending AS (
    SELECT user_id
      FROM appsea.auth_mfa_totp
     WHERE status = 'pending'
       AND created_at <= p_before
     ORDER BY created_at, user_id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM appsea.auth_mfa_recovery_codes recovery
   USING stale_pending
   WHERE recovery.user_id = stale_pending.user_id;

  WITH stale_pending AS (
    SELECT user_id
      FROM appsea.auth_mfa_totp
     WHERE status = 'pending'
       AND created_at <= p_before
     ORDER BY created_at, user_id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM appsea.auth_mfa_totp totp
   USING stale_pending
   WHERE totp.user_id = stale_pending.user_id
     AND totp.status = 'pending';
  GET DIAGNOSTICS pending_enrollment_count = ROW_COUNT;

  RETURN QUERY SELECT challenge_count, event_count, pending_enrollment_count;
END
$$;

REVOKE ALL ON FUNCTION appsea.purge_auth_mfa_material(timestamptz, integer)
  FROM PUBLIC, appsea_service;
GRANT EXECUTE ON FUNCTION appsea.purge_auth_mfa_material(timestamptz, integer)
  TO appsea_service, appsea_maintenance;
