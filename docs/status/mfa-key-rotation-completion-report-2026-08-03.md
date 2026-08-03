# MFA key-rotation tranche completion report

Status: repository tranche complete; production deployment rollout remains
operator-gated.

## Implemented

- Migration `0086_auth_mfa_key_versions.sql` adds a checked `secret_key_version`
  with a version-one default for existing encrypted TOTP rows and an index for
  rotation inspection.
- `packages/db/src/auth-mfa-key.ts` validates a current key plus an optional
  strictly older previous key, encrypts with the current version, and fails
  closed for malformed or unsupported versions.
- TOTP enrollment confirmation and successful TOTP verification re-encrypt an
  old-version secret in the current version inside the existing transaction.
  Recovery-code-only access does not silently rewrap dormant secrets.
- `PostgresAuthRepository.readMfaKeyRotationStatus()` and
  `pnpm worker:auth:mfa:rotation:status` expose aggregate current/previous/
  unknown/enabled/pending counts only; key material, ciphertext, and plaintext
  never cross the status boundary.
- Production preflight and `.env.example` validate/document the versioned
  current/previous configuration. The auth runbooks, ADR, plan, known-gaps,
  status, audit, and project memory record the operator procedure and limits.

## Validation

- `pnpm --filter @appsea/contracts test` — 94 passed.
- `pnpm --filter @appsea/db test` — 142 passed, including key crypto and
  migration assertions.
- `pnpm --filter @appsea/worker test` — 116 passed.
- Affected lint/typecheck suites, `pnpm format:check`, `pnpm memory:check`,
  and `pnpm repo:check --docs-only` passed locally.
- Fresh PostgreSQL/Temporal execution is delegated to the pushed CI proof;
  local Docker Desktop is unavailable. The latest green release-proof run is
  GitHub Actions `30813209982` for commit `39e8bcd`.

## Remaining gates and simplifications

- No automatic key rotation, bulk rewrap job, or destructive key deletion was
  added. Operators must keep the previous key until the count-only status is
  reviewed at zero and dormant-account handling is approved.
- OIDC/verified identity, delivery/DPA, provider-backed step-up, production
  role provisioning, source activation, cloud purge, and signed desktop release
  remain outside this tranche and outside any completion claim for AppSea.
