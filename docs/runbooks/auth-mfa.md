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

Every mutation is same-origin, schema-validated, no-store, and rate-limited.
Codes are never echoed in errors or logs. Clock synchronization is a
deployment responsibility; the verifier accepts only a bounded adjacent
TOTP timestep and rejects a previously used timestep.

## Validation

- `packages/db/src/auth-mfa.test.ts` covers base32, RFC 6238 vectors, replay,
  recovery-code normalization, and provisioning URIs.
- `apps/web/src/app/mfa-routes.test.ts` covers same-origin, step-up, bounded
  status, challenge rate limiting, enrollment, confirmation, and disable paths.
- `packages/db/integration/db.integration.test.ts` covers enrollment, a
  challenged login, recovery-code consumption, and disable behavior when the
  PostgreSQL integration gate is available.
- `apps/worker/src/production-preflight.test.ts` covers the production key
  requirement, and authentication retention now reports MFA cleanup counters.

TOTP MFA does not close the remaining OIDC, verified-identity, delivery/DPA,
key-rotation, or production identity-operations gates.
