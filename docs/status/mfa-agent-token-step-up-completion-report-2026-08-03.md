# MFA agent-token step-up completion report — 2026-08-03

Status: repository-complete for the AppSea-owned MFA gate on agent-token
issue/revoke; external identity and deployment controls remain open.

## Delivered

- Added migration `0081_auth_mfa_step_up.sql`, which stores a nullable,
  session-bound `last_mfa_reauthenticated_at` marker and grants the runtime
  role only that update column.
- Added strict shared input/result contracts for MFA step-up.
- Added `PostgresAuthRepository.reauthenticateMfaSession` with transactionally
  locked session/MFA rows, TOTP replay protection, one-time recovery-code
  consumption, and bounded recent-marker inspection. Accounts without enabled
  MFA preserve the existing password-only path.
- Added same-origin, no-store, rate-limited `POST /api/auth/mfa/step-up`.
- Added server-side MFA enforcement to owner agent-token issue and revoke
  routes. A stale or missing second-factor marker blocks the mutation with
  `428 Recent MFA verification required`.
- Kept the MCP surface read-only and unchanged; the new endpoint cannot issue
  workflows, activate sources, change policy, delete research, or deploy code.

## Evidence

- Contracts: 89 tests passed, including strict step-up input/output cases.
- Database package: 135 tests passed, including migration, repository, and
  hash/non-echo assertions.
- Web package: 144 tests passed, including MFA step-up and agent-token route
  enforcement.
- Contracts, database, and web typechecks passed.
- PostgreSQL integration coverage now exercises step-up success, recent-marker
  inspection, and recovery-code replay rejection; the disposable PostgreSQL
  job passed in GitHub Actions run `30785696385` for commit `1b45c8a`.

## Deliberate boundaries and remaining blockers

- This slice covers agent-token issue/revoke only. Other high-risk mutations
  retain their existing password step-up until separately reviewed.
- MFA remains an AppSea-owned TOTP factor, not OIDC, verified email, provider
  delivery, or provider-backed step-up. Key rotation, identity/DPA approval,
  production secret operations, and identity monitoring remain open.
- The local Docker Desktop Linux engine is unavailable in this environment, so
  fresh PostgreSQL role/RLS execution remains a remote-CI-only proof here; the
  current remote gate is green.

This report does not claim AppSea is production-ready or that fixture research
is real market evidence.
