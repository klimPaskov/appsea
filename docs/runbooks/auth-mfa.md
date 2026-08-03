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
manager. It must be a separate 32-byte base64url key. Every ciphertext carries
`secret_key_version`; legacy rows are version `1`. Production preflight rejects
a missing or malformed current key, an incomplete current/previous pair, a
non-monotonic version, or a reused key before a process starts.

### Reviewed key rotation

Rotation is an operator-approved deployment, not an autonomous action:

1. Generate a new 32-byte base64url key. Set it as
   `APPSEA_AUTH_MFA_ENCRYPTION_KEY`, increment
   `APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION`, and set the old key/version as
   `APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS` and
   `APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION`.
2. Deploy the reviewed configuration and run
   `pnpm worker:auth:mfa:rotation:status` with the service database role. The
   command prints counts only: current, previous, unknown, enabled, and
   pending rows. It never prints key material or encrypted fields.
3. Run the lease-owned, bounded dormant-account batch command:
   `pnpm worker:auth:mfa:rotation:rewrap`. Set
   `APPSEA_AUTH_MFA_ROTATION_BATCH_SIZE` only within the validated 1-1000
   range. The command re-encrypts at most that many previous-key rows in one
   transaction, records an identifier-only `key_rotation_rewrapped` event for
   each committed account, and prints only bounded versions/counts. Repeat it
   until the result reports `completed: true`; a later invocation resumes by
   key version and does not duplicate a committed rewrap.
4. The batch fails closed before changing rows when any ciphertext carries an
   unknown key version, when the previous key is absent, when decryption fails,
   or when the maintenance lease/fence is lost. Keep the previous key
   configured while `previousKeyAccounts` or `unknownKeyAccounts` is non-zero;
   unknown rows are a fail-closed incident, not evidence that the accounts have
   no MFA. Successful TOTP verification and pending-enrollment confirmation
   still opportunistically rewrap active accounts in their own transactions.
5. After an independent review confirms the status counts are zero and the
   batch command has completed, remove the previous key/version in a separate
   deployment. Do not delete or rewrite ciphertext directly. Recovery-code-only
   access no longer leaves dormant accounts behind because the operator batch
   handles them without requiring a login.

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
  requirement and current/previous version rules; authentication retention now
  reports MFA cleanup counters.
- `packages/db/src/auth-mfa-key.test.ts` covers current/previous decryption,
  rewrap metadata, malformed configuration, and unsupported versions.
- `packages/db/integration/db.integration.test.ts` covers the version-one
  migration default, count-only rotation status after enrollment, and a
  previous-key dormant-account rewrap with an identifier-only event.
- `apps/worker/src/auth-mfa-key-rotation-runner.test.ts` covers lease/fence
  propagation and bounded input validation.

TOTP MFA key rotation now includes a bounded dormant-account rewrap command,
but this does not close the remaining OIDC, verified-identity, delivery/DPA,
provider-backed step-up, or production identity-operations gates. Production
still requires an approved deployment procedure, a live status review, and
independent confirmation before removing the previous key.
