-- Password recovery crosses the global-auth boundary, not a workspace
-- outbox. Keep delivery state and security events separate from research data.
CREATE TABLE appsea.auth_password_reset_deliveries (
  delivery_id text PRIMARY KEY CHECK (delivery_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  reset_token_id text REFERENCES appsea.auth_password_reset_tokens(reset_token_id) ON DELETE CASCADE,
  user_id text REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  email_hash char(64) NOT NULL CHECK (email_hash ~ '^[a-f0-9]{64}$'),
  token_ciphertext text,
  token_nonce text,
  token_tag text,
  state text NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'failed', 'discarded')),
  created_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  lease_started_at timestamptz,
  sent_at timestamptz,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 10),
  last_failure_code text,
  CHECK (token_ciphertext IS NULL OR token_ciphertext ~ '^[A-Za-z0-9_-]{1,4096}$'),
  CHECK (token_nonce IS NULL OR token_nonce ~ '^[A-Za-z0-9_-]{1,128}$'),
  CHECK (token_tag IS NULL OR token_tag ~ '^[A-Za-z0-9_-]{1,128}$'),
  CHECK (last_failure_code IS NULL OR last_failure_code ~ '^[A-Z0-9_:-]{1,80}$'),
  CHECK (
    (state = 'discarded' AND reset_token_id IS NULL AND user_id IS NULL
      AND token_ciphertext IS NULL AND token_nonce IS NULL AND token_tag IS NULL)
    OR (state <> 'discarded' AND reset_token_id IS NOT NULL AND user_id IS NOT NULL
      AND token_ciphertext IS NOT NULL AND token_nonce IS NOT NULL AND token_tag IS NOT NULL)
  )
);

CREATE INDEX auth_password_reset_delivery_claim_idx
  ON appsea.auth_password_reset_deliveries (available_at, created_at)
  WHERE state IN ('pending', 'sending', 'failed');

CREATE TABLE appsea.auth_security_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  event_type text NOT NULL CHECK (
    event_type IN (
      'password_reset_requested',
      'password_reset_delivery_sent',
      'password_reset_delivery_failed',
      'password_reset_consumed'
    )
  ),
  user_id text REFERENCES appsea.users(user_id) ON DELETE SET NULL,
  delivery_id text,
  email_hash char(64) CHECK (email_hash IS NULL OR email_hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL
);

CREATE INDEX auth_security_events_occurred_idx
  ON appsea.auth_security_events (occurred_at DESC, event_id);

-- If a pre-boundary deployment had multiple active rows, retain only the
-- newest row before enforcing latest-token semantics for concurrent requests.
WITH ranked AS (
  SELECT reset_token_id,
         row_number() OVER (PARTITION BY user_id ORDER BY requested_at DESC, reset_token_id DESC) AS position
    FROM appsea.auth_password_reset_tokens
   WHERE consumed_at IS NULL AND invalidated_at IS NULL
)
UPDATE appsea.auth_password_reset_tokens token
   SET invalidated_at = clock_timestamp()
  FROM ranked
 WHERE token.reset_token_id = ranked.reset_token_id
   AND ranked.position > 1;

CREATE UNIQUE INDEX auth_password_reset_active_user_idx
  ON appsea.auth_password_reset_tokens (user_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

-- The shared runtime role may execute narrow functions but cannot read or
-- mutate password-reset rows or password hashes directly.
REVOKE ALL ON appsea.auth_password_reset_tokens FROM appsea_service;
REVOKE UPDATE (password_hash, updated_at) ON appsea.users FROM appsea_service;
REVOKE ALL ON appsea.auth_password_reset_deliveries FROM PUBLIC, appsea_service;
REVOKE ALL ON appsea.auth_security_events FROM PUBLIC, appsea_service;

CREATE OR REPLACE FUNCTION appsea.issue_password_reset(
  p_email text,
  p_reset_token_id text,
  p_token_hash text,
  p_delivery_id text,
  p_email_hash text,
  p_token_ciphertext text,
  p_token_nonce text,
  p_token_tag text
)
RETURNS TABLE(issued boolean, reset_token_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  target_user_id text;
  issued_at timestamptz;
  expires_at_value timestamptz;
  account_found boolean;
BEGIN
  IF p_email IS NULL OR char_length(p_email) < 3 OR char_length(p_email) > 320
     OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_email_hash !~ '^[a-f0-9]{64}$'
     OR p_reset_token_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_delivery_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR char_length(p_token_ciphertext) NOT BETWEEN 1 AND 4096
     OR char_length(p_token_nonce) NOT BETWEEN 1 AND 128
     OR char_length(p_token_tag) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'password reset request is invalid' USING ERRCODE = '22023';
  END IF;

  issued_at := clock_timestamp();
  expires_at_value := issued_at + interval '30 minutes';
  SELECT user_id INTO target_user_id
    FROM appsea.users
   WHERE email = p_email
   FOR UPDATE;
  account_found := target_user_id IS NOT NULL;

  IF account_found THEN
    UPDATE appsea.auth_password_reset_tokens
       SET invalidated_at = COALESCE(invalidated_at, issued_at)
     WHERE user_id = target_user_id
       AND consumed_at IS NULL
       AND invalidated_at IS NULL;

    INSERT INTO appsea.auth_password_reset_tokens
      (reset_token_id, user_id, token_hash, requested_at, expires_at)
    VALUES
      (p_reset_token_id, target_user_id, p_token_hash, issued_at, expires_at_value);

    INSERT INTO appsea.auth_password_reset_deliveries
      (delivery_id, reset_token_id, user_id, email_hash, token_ciphertext,
       token_nonce, token_tag, state, created_at, available_at, expires_at)
    VALUES
      (p_delivery_id, p_reset_token_id, target_user_id, p_email_hash,
       p_token_ciphertext, p_token_nonce, p_token_tag, 'pending', issued_at,
       issued_at, expires_at_value);
  ELSE
    -- A decoy row makes known and unknown addresses follow the same durable
    -- database path while retaining only a one-way email marker.
    INSERT INTO appsea.auth_password_reset_deliveries
      (delivery_id, email_hash, state, created_at, available_at, expires_at)
    VALUES
      (p_delivery_id, p_email_hash, 'discarded', issued_at, issued_at, expires_at_value);
  END IF;

  INSERT INTO appsea.auth_security_events
    (event_id, event_type, user_id, delivery_id, email_hash, occurred_at)
  VALUES
    ('auth-event:' || md5(p_delivery_id || ':' || txid_current()::text),
     'password_reset_requested', target_user_id, p_delivery_id, p_email_hash, issued_at);

  RETURN QUERY SELECT account_found, expires_at_value;
END
$$;

CREATE OR REPLACE FUNCTION appsea.password_reset_token_is_active(p_token_hash text)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
  SELECT p_token_hash ~ '^[a-f0-9]{64}$'
     AND EXISTS (
    SELECT 1
      FROM appsea.auth_password_reset_tokens
     WHERE token_hash = p_token_hash
       AND consumed_at IS NULL
       AND invalidated_at IS NULL
       AND expires_at > clock_timestamp()
  )
$$;

CREATE OR REPLACE FUNCTION appsea.consume_password_reset(
  p_token_hash text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  reset_row appsea.auth_password_reset_tokens%ROWTYPE;
  consumed_at_value timestamptz;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_password_hash IS NULL
     OR char_length(p_password_hash) < 32
     OR char_length(p_password_hash) > 512 THEN
    RETURN false;
  END IF;

  SELECT * INTO reset_row
    FROM appsea.auth_password_reset_tokens
   WHERE token_hash = p_token_hash
     AND consumed_at IS NULL
     AND invalidated_at IS NULL
     AND expires_at > clock_timestamp()
   FOR UPDATE;
  IF reset_row.reset_token_id IS NULL THEN RETURN false; END IF;

  consumed_at_value := clock_timestamp();
  UPDATE appsea.users
     SET password_hash = p_password_hash,
         updated_at = consumed_at_value
   WHERE user_id = reset_row.user_id;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE appsea.auth_sessions
     SET revoked_at = COALESCE(revoked_at, consumed_at_value),
         last_reauthenticated_at = NULL
   WHERE user_id = reset_row.user_id
     AND revoked_at IS NULL;
  UPDATE appsea.auth_password_reset_tokens
     SET consumed_at = consumed_at_value
   WHERE reset_token_id = reset_row.reset_token_id;
  UPDATE appsea.auth_password_reset_tokens
     SET invalidated_at = COALESCE(invalidated_at, consumed_at_value)
   WHERE user_id = reset_row.user_id
     AND reset_token_id <> reset_row.reset_token_id
     AND consumed_at IS NULL;

  INSERT INTO appsea.auth_security_events
    (event_id, event_type, user_id, occurred_at)
  VALUES
    ('auth-event:' || md5(reset_row.reset_token_id || ':consumed:' || txid_current()::text),
     'password_reset_consumed', reset_row.user_id, consumed_at_value);
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.invalidate_password_reset(p_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
  UPDATE appsea.auth_password_reset_tokens
     SET invalidated_at = COALESCE(invalidated_at, clock_timestamp())
   WHERE p_token_hash ~ '^[a-f0-9]{64}$'
     AND token_hash = p_token_hash
     AND consumed_at IS NULL
$$;

CREATE OR REPLACE FUNCTION appsea.claim_password_reset_deliveries(p_batch_size integer)
RETURNS TABLE(
  delivery_id text,
  email text,
  token_ciphertext text,
  token_nonce text,
  token_tag text,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
  WITH candidates AS (
    SELECT delivery_id
      FROM appsea.auth_password_reset_deliveries
     WHERE attempt_count < 10
       AND expires_at > clock_timestamp()
       AND (
         (state IN ('pending', 'failed') AND available_at <= clock_timestamp())
         OR (state = 'sending'
             AND lease_started_at <= clock_timestamp() - interval '5 minutes')
       )
     ORDER BY delivery_id
     LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 1), 1), 100)
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE appsea.auth_password_reset_deliveries delivery
       SET state = 'sending',
           lease_started_at = clock_timestamp(),
           attempt_count = delivery.attempt_count + 1,
           last_failure_code = NULL
      FROM candidates
     WHERE delivery.delivery_id = candidates.delivery_id
     RETURNING delivery.delivery_id, delivery.user_id,
               delivery.token_ciphertext, delivery.token_nonce,
               delivery.token_tag, delivery.expires_at
  )
  SELECT claimed.delivery_id, users.email, claimed.token_ciphertext,
         claimed.token_nonce, claimed.token_tag, claimed.expires_at
    FROM claimed
    JOIN appsea.users users ON users.user_id = claimed.user_id
$$;

CREATE OR REPLACE FUNCTION appsea.complete_password_reset_delivery(p_delivery_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  target_user_id text;
BEGIN
  UPDATE appsea.auth_password_reset_deliveries
     SET state = 'sent', sent_at = clock_timestamp(), lease_started_at = NULL
   WHERE delivery_id = p_delivery_id AND state = 'sending'
   RETURNING user_id INTO target_user_id;
  IF NOT FOUND THEN
    RETURN EXISTS (
      SELECT 1 FROM appsea.auth_password_reset_deliveries
       WHERE delivery_id = p_delivery_id AND state = 'sent'
    );
  END IF;
  INSERT INTO appsea.auth_security_events
    (event_id, event_type, user_id, delivery_id, occurred_at)
  VALUES
    ('auth-event:' || md5(p_delivery_id || ':sent:' || txid_current()::text),
     'password_reset_delivery_sent', target_user_id, p_delivery_id, clock_timestamp());
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.fail_password_reset_delivery(
  p_delivery_id text,
  p_failure_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  target_user_id text;
BEGIN
  UPDATE appsea.auth_password_reset_deliveries
     SET state = 'failed',
         available_at = clock_timestamp() + interval '5 minutes',
         lease_started_at = NULL,
         last_failure_code = left(p_failure_code, 80)
   WHERE delivery_id = p_delivery_id AND state = 'sending'
   RETURNING user_id INTO target_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO appsea.auth_security_events
    (event_id, event_type, user_id, delivery_id, metadata, occurred_at)
  VALUES
    ('auth-event:' || md5(p_delivery_id || ':failed:' || txid_current()::text),
     'password_reset_delivery_failed', target_user_id,
     p_delivery_id, jsonb_build_object('failureCode', left(p_failure_code, 80)), clock_timestamp());
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.purge_password_reset_tokens(
  p_retention_days integer,
  p_batch_size integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  deleted_tokens integer;
BEGIN
  DELETE FROM appsea.auth_password_reset_tokens
   WHERE reset_token_id IN (
     SELECT reset_token_id
       FROM appsea.auth_password_reset_tokens
      WHERE expires_at <= clock_timestamp()
         OR (consumed_at IS NOT NULL
             AND consumed_at <= clock_timestamp() - (p_retention_days::bigint * interval '1 day'))
         OR (invalidated_at IS NOT NULL
             AND invalidated_at <= clock_timestamp() - (p_retention_days::bigint * interval '1 day'))
      ORDER BY expires_at, reset_token_id
      LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 1), 1), 10_000)
   );
  GET DIAGNOSTICS deleted_tokens = ROW_COUNT;
  DELETE FROM appsea.auth_password_reset_deliveries
   WHERE created_at <= clock_timestamp() - (p_retention_days::bigint * interval '1 day')
      OR (state = 'discarded' AND expires_at <= clock_timestamp());
  DELETE FROM appsea.auth_security_events
   WHERE occurred_at <= clock_timestamp() - (p_retention_days::bigint * interval '1 day');
  RETURN deleted_tokens;
END
$$;

REVOKE ALL ON FUNCTION appsea.issue_password_reset(text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.password_reset_token_is_active(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.consume_password_reset(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.invalidate_password_reset(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.claim_password_reset_deliveries(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.complete_password_reset_delivery(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.fail_password_reset_delivery(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.purge_password_reset_tokens(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.issue_password_reset(text, text, text, text, text, text, text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.password_reset_token_is_active(text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.consume_password_reset(text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.invalidate_password_reset(text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.claim_password_reset_deliveries(integer) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.complete_password_reset_delivery(text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.fail_password_reset_delivery(text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.purge_password_reset_tokens(integer, integer) TO appsea_service;
