# ADR 0008: Authenticated private workspaces

- Status: accepted for the first private-research tranche
- Date: 2026-07-24

## Decision

AppSea stores users, scrypt password hashes, revocable opaque bearer-session hashes, and workspace memberships in PostgreSQL. Signup creates a private workspace and owner membership. The web app keeps only the opaque session token in an `HttpOnly`, `SameSite=Lax` cookie; read models never contain passwords, password hashes, or tokens.

Every private research read calls `withAuthenticatedWorkspaceTransaction`. That helper validates the user and workspace identifiers, checks membership inside the same transaction, and only then sets the transaction-local workspace context used by forced RLS. Public fixture leaderboard routes do not open a database connection and remain explicitly synthetic.

## Consequences

- Workspace membership is an authorization boundary, while RLS remains defense in depth.
- Member roster reads and role/removal mutations are owner-only. A forward
  database trigger serializes owner-count checks and prevents a workspace from
  losing its last owner; each accepted mutation emits a private audit and
  outbox event with identifiers and roles only.
- Session revocation and expiry are durable and survive web-process restarts.
- Authenticated users can review active session identifiers and lifecycle timestamps
  at `/account/security`; revoking another session requires same-origin password
  step-up, while the current session is protected from self-revocation.
- Owner role/removal mutations require an explicit password step-up. The
  verified session carries only a 15-minute `last_reauthenticated_at` marker;
  the password is never persisted or returned.
- Signup is disabled in production unless `APPSEA_AUTH_ALLOW_SIGNUP=true` is explicitly configured.
- Login/signup/reauthentication throttles and bounded session-retention cleanup are now durable
  PostgreSQL operations, but production still needs an external identity/
  recovery policy, secret rotation, TLS-verified database provisioning, and
  role separation.
- Account closure is an explicit, recent-step-up-protected action at
  `/account/security`. The database refuses closure while the account owns a
  workspace, then revokes sessions/reset material and anonymizes the profile
  while retaining shared workspace research and memberships for provenance.
  This is not a workspace-data or backup purge; those retention obligations
  remain a separate reviewed policy.

## Rejected alternatives

- Caller-supplied workspace IDs without membership checks: rejected because RLS context alone is not authentication.
- Storing plaintext passwords or session tokens: rejected because database backups and logs must not become bearer credentials.
- Adding authentication logic to the Tauri shell: rejected; the shell must reuse the web contract.
