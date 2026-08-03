# TOTP multi-factor authentication

AppSea's browser authentication boundary supports RFC 6238 TOTP MFA without
putting a pending login into a workspace session. This is a product control,
not evidence that an external identity provider, verified email domain, or
OIDC deployment has been approved.

## Data boundary

Migration `0080_auth_mfa.sql` adds four global-auth tables:

- `auth_mfa_totp` stores one encrypted secret per account. The application
  encrypts it with AES-256-GCM before persistence; the secret never appears in
  a session, workspace, report, log, or read model.
- `auth_mfa_recovery_codes` stores SHA-256 hashes of ten random recovery codes.
  A consumed code is permanently unusable.
- `auth_mfa_challenges` stores only a hash of the ten-minute login challenge.
  It is bounded to five failed attempts, locks for ten minutes, and is consumed
  before the new session is issued.
- `auth_mfa_events` records bounded identifiers and fixed event types without
  codes, secrets, IP addresses, or complaint content.

Account closure deletes active MFA material through the database trigger while
retaining only the non-sensitive event history. The authentication-retention
worker purges expired/consumed challenges, old event rows, and abandoned
pending enrollments in its existing bounded maintenance transaction.

Migration `0081_auth_mfa_step_up.sql` adds a nullable
`auth_sessions.last_mfa_reauthenticated_at` marker. It is updated only after a
valid code is consumed and is never returned in a session or workspace read.

## Configuration

Set `APPSEA_AUTH_MFA_ENCRYPTION_KEY` only through the deployment secret
manager. It must be a separate 32-byte base64url key. Production preflight
rejects a missing, malformed, or reused-shape key before a process starts.
Rotation is not automatic: schedule a reviewed key migration or require
affected accounts to re-enroll, then verify that old encrypted secrets are no
longer needed before revoking the old key.

## User flow

1. An authenticated user completes the existing fifteen-minute password
   step-up at `/account/security`.
2. `POST /api/auth/mfa/enroll` creates a pending secret and one-time recovery
   codes. The UI displays them once and asks for a current six-digit code.
3. `POST /api/auth/mfa/enroll/confirm` marks the enrollment enabled and records
   the current TOTP timestep to prevent immediate replay.
4. A password login for an MFA-enabled account returns only a challenge token;
   it does not set the session cookie. `POST /api/auth/mfa/login` accepts the
   current TOTP or one recovery code, then creates the session and sets the
   cookie.
5. Disabling MFA requires both recent password step-up and a current TOTP or
   unused recovery code. The secret and recovery rows are deleted on success.

## Conditional MFA step-up for high-risk mutations

Mutations that already require the existing fifteen-minute password step-up
also require a fresh MFA proof when MFA is enabled. This includes account
closure, revoking another session, owner membership role/removal, invitation
create/revoke, workspace archival, purge-intent request/cancel, evidence
redaction, and issuing or revoking a workspace-scoped read-only MCP bearer at
`/api/workspaces/:workspaceId/agent-tokens`. The server checks both markers
before calling the mutation repository; UI state is never an authorization
grant. Other mutation routes retain their separately reviewed role and policy
boundaries until they receive an explicit step-up contract.

The fresh proof comes from `POST /api/auth/mfa/step-up`:

```json
{ "code": "123456" }
```

The endpoint accepts a current TOTP or one unused recovery code, consumes it at
the database boundary, and returns only `{ "data": { "verified": true } }`.
The session marker expires with the same fifteen-minute window. Accounts that
have not enabled MFA remain protected by the password step-up alone; enabling
MFA automatically activates the additional gate. A stale or missing proof
returns `428 Recent MFA verification required`, and a code is never sent to the
agent-token repository.

Every mutation is same-origin, schema-validated, no-store, and rate-limited.
Codes are never echoed in errors or logs. Clock synchronization is a
deployment responsibility; the verifier accepts only a bounded adjacent
TOTP timestep and rejects a previously used timestep.

## Validation

- `packages/db/src/auth-mfa.test.ts` covers base32, RFC 6238 vectors, replay,
  recovery-code normalization, and provisioning URIs.
- `apps/web/src/app/mfa-routes.test.ts` covers same-origin, step-up, bounded
  status, challenge rate limiting, enrollment, confirmation, and disable; the
  owner/session/workspace route suites cover conditional MFA enforcement for
  each listed mutation.
- `packages/db/integration/db.integration.test.ts` covers enrollment, a
  challenged login, recovery-code consumption, MFA step-up replay rejection,
  and disable behavior when the PostgreSQL integration gate is available.
- `apps/worker/src/production-preflight.test.ts` covers the production key
  requirement, and authentication retention now reports MFA cleanup counters.

TOTP MFA does not close the remaining OIDC, verified-identity, delivery/DPA,
key-rotation, provider-backed step-up, or production identity-operations gates.
