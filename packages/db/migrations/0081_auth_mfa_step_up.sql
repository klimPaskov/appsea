-- High-risk bearer-token mutations require a separate, recent MFA proof when
-- the account has MFA enabled. The marker lives on the authenticated session,
-- is not part of any read model, and is written only after the auth boundary
-- consumes a valid TOTP or one-time recovery code.
ALTER TABLE appsea.auth_sessions
  ADD COLUMN last_mfa_reauthenticated_at timestamptz;

GRANT UPDATE (last_mfa_reauthenticated_at) ON appsea.auth_sessions TO appsea_service;
