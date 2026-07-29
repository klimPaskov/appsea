-- Durable, single-use password-reset records. Only the SHA-256 token hash is
-- persisted; the raw token exists briefly at the delivery boundary.
CREATE TABLE appsea.auth_password_reset_tokens (
  reset_token_id text PRIMARY KEY CHECK (reset_token_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  user_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  invalidated_at timestamptz,
  CHECK (expires_at > requested_at),
  CHECK (consumed_at IS NULL OR consumed_at >= requested_at),
  CHECK (invalidated_at IS NULL OR invalidated_at >= requested_at),
  UNIQUE (token_hash)
);

CREATE INDEX auth_password_reset_user_idx
  ON appsea.auth_password_reset_tokens (user_id, requested_at DESC);
CREATE INDEX auth_password_reset_active_idx
  ON appsea.auth_password_reset_tokens (expires_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

-- Runtime access is deliberately withheld until migration 0024 installs the
-- security-definer recovery functions and their narrow EXECUTE grants.
REVOKE ALL ON appsea.auth_password_reset_tokens FROM PUBLIC, appsea_service;
