# ADR 0013: Keep TOTP MFA in the global authentication boundary

Status: accepted

Date: 2026-08-03

## Context

Browser sign-in needs a second factor without allowing a password-only login
to create a bearer session or a workspace RLS context. Enrollment material is
sensitive, while recovery and login challenges must remain replay-resistant,
rate-limited, and auditable without retaining plaintext codes.

## Decision

Migration `0080_auth_mfa.sql` owns four global-auth tables. The application
encrypts TOTP enrollment secrets with the separate
`APPSEA_AUTH_MFA_ENCRYPTION_KEY`; migration `0086` records a
`secret_key_version` for each ciphertext, and migration `0087` adds the
identifier-only `key_rotation_rewrapped` audit event. During a reviewed
rotation, the application accepts one current and one strictly older previous
key, and a successful TOTP verification or enrollment confirmation rewraps the
secret in the current version in the same transaction. A lease-owned,
bounded `pnpm worker:auth:mfa:rotation:rewrap` command handles dormant accounts
without requiring a login; it selects only previous-version rows, fails closed
on unknown versions or decryption errors, and is safe to repeat. PostgreSQL
receives only recovery-code and login-challenge hashes. Password sign-in creates a
ten-minute challenge, and the session is minted only after a current TOTP or
one-time recovery code is verified. Account closure removes active MFA
material; bounded authentication retention removes stale challenges, events,
and abandoned pending enrollments.

Enrollment and disable routes require same-origin requests, an active session,
recent password step-up, schema validation, and durable MFA rate limits. The
public leaderboard remains unchanged and contains no authentication detail.

## Consequences

- MFA state is independent of workspaces and cannot authorize a private read
  before the normal session and membership checks.
- Secret rotation remains a reviewed deployment operation. The count-only
  `pnpm worker:auth:mfa:rotation:status` command exposes current/previous/
  unknown row counts, while the lease-owned rewrap command handles dormant
  accounts in bounded, idempotent batches. Unknown versions, missing previous
  keys, and failed decryption remain fail-closed; a separate independent
  review is still required before removing the previous key.
- TOTP does not provide verified email ownership, OIDC, provider delivery,
  or enforcement for every existing high-risk token action. Those remain
  separate production gates.
- The UI presents a provisioning URI and manual secret once; QR rendering is
  intentionally deferred to avoid another dependency and display boundary.

## Evidence

- `packages/db/migrations/0080_auth_mfa.sql`
- `packages/db/src/auth-mfa.test.ts`
- `packages/db/integration/db.integration.test.ts`
- `apps/web/src/app/mfa-routes.test.ts`
- `docs/runbooks/auth-mfa.md`
