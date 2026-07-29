# Account session lifecycle tranche

## Outcome

Authenticated users can inspect their active sessions at `/account/security` and
revoke another session after a same-origin password step-up. The current session
is explicitly non-revocable from this surface. Session summaries contain only a
stable identifier and created, last-seen, and expiry timestamps; bearer tokens,
hashes, passwords, and password hashes never cross the contract or web boundary.

## Implementation

- `packages/contracts` defines strict session-summary and session-list read models.
- `PostgresAuthRepository` lists non-expired, non-revoked sessions for the user
  identified by the current token hash and atomically revokes a target only when
  it belongs to that same user.
- `GET /api/auth/sessions` and same-origin `DELETE
/api/auth/sessions/:sessionId` are private, no-store routes. Revocation requires
  the existing 15-minute password reauthentication marker and maps current,
  missing, and infrastructure failures to distinct safe responses.
- `/account/security` provides a responsive session review page and an accessible
  reauthentication/revocation panel. The public leaderboard remains unchanged.
- No migration was required: `auth_sessions` already stores lifecycle timestamps,
  `revoked_at`, `last_reauthenticated_at`, and the least-privilege grants needed
  by these operations.

## Validation

- Contract tests reject extra token fields and invalid current flags.
- Database unit tests cover hashed-token lookup, session mapping, current-session
  protection, same-user target updates, missing sessions, and secret exclusion.
- PostgreSQL integration coverage now creates a second session, verifies ordered
  inventory, revokes only that user's other session, and rejects current-session
  self-revocation (the disposable Docker database is unavailable in this run).
- Web route tests cover authentication, same-origin, step-up, conflict, not-found,
  and successful responses.
- `pnpm lint`, `pnpm typecheck`, focused contracts/db/web tests, and the full
  `pnpm verify` gate pass, including fixture generation, plan generation, web
  smoke, and repository validation.
- `pnpm verify:persistence` and `pnpm verify:workflows` remain environment-blocked
  because Docker Desktop's `dockerDesktopLinuxEngine` pipe is unavailable; no
  implementation failure was observed in the package or unit gates.

## Remaining identity gaps

Invitation delivery was outside the scope of this session-lifecycle tranche;
account recovery mechanics now exist behind a kill switch. Account deletion, MFA/OIDC, production
identity-provider policy, distributed retention operations, and deployment
provisioning remain open.
