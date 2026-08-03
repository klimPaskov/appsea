# MFA agent-token step-up — 2026-08-03

Implemented the AppSea-owned high-risk MFA gate for workspace-scoped coding-
agent bearer mutations.

- Added migration `0081_auth_mfa_step_up.sql` with
  `auth_sessions.last_mfa_reauthenticated_at` and a narrow runtime update grant.
- Added strict shared MFA step-up input/result contracts.
- Added `PostgresAuthRepository.reauthenticateMfaSession` and
  `hasRecentMfaReauthentication`. The transaction locks the session/MFA rows,
  consumes a TOTP or one recovery code, rejects replay, and stores only a
  fifteen-minute marker. Accounts without enabled MFA retain the password-only
  compatibility path.
- Added same-origin, rate-limited `POST /api/auth/mfa/step-up` and enforced it
  server-side for agent-token issue/revoke after the existing password step-up.
- Updated ADR, architecture/security, auth-MFA and PostgreSQL runbooks, private
  workspace docs, current/known-gap/audit/active-plan status, and memory.

Focused checks passed: contracts 89, database 135, web 144; affected
typechecks passed. The disposable PostgreSQL integration case covers step-up
success and recovery-code replay but needs Docker or GitHub Actions. The broad
AppSea goal remains open: no live source is active, production DB/Temporal,
provider identity/delivery/key rotation, cloud/backup/export purge, scheduler
operations, and signed desktop release remain deployment or approval gates.
