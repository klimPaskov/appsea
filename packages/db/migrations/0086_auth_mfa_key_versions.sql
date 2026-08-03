-- Version the application-owned MFA ciphertext so a reviewed deployment can
-- keep a previous key long enough to rewrap active accounts. Existing rows are
-- version one for compatibility with the original single-key implementation.
ALTER TABLE appsea.auth_mfa_totp
  ADD COLUMN secret_key_version smallint NOT NULL DEFAULT 1;

ALTER TABLE appsea.auth_mfa_totp
  ADD CONSTRAINT auth_mfa_totp_secret_key_version_check
  CHECK (secret_key_version BETWEEN 1 AND 32767);

CREATE INDEX auth_mfa_totp_key_version_idx
  ON appsea.auth_mfa_totp (secret_key_version, status, user_id);
