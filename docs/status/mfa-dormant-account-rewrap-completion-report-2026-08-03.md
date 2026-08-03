# MFA dormant-account rewrap tranche completion report

Status: repository tranche complete; production rollout remains operator- and
deployment-gated.

## Implemented

- Migration `0087_auth_mfa_rotation_events.sql` extends the global MFA event
  allowlist with the identifier-only `key_rotation_rewrapped` event.
- `authMfaKeyRotationRewrapInput` and `authMfaKeyRotationRewrapResult` are
  bounded shared contracts. The result carries only key versions and counts.
- `PostgresAuthRepository.rewrapMfaKeyBatch()` requires a current/previous key
  pair, asserts the maintenance scheduler fence inside the transaction, locks a
  bounded previous-version batch with `SKIP LOCKED`, decrypts and re-encrypts
  each secret with the current key, records one fixed event per committed
  account, and fails closed on unknown versions, decryption errors, or a lost
  fence. A committed row cannot be selected again because its key version has
  changed.
- `pnpm worker:auth:mfa:rotation:rewrap` runs one lease-owned batch and emits
  only bounded, secret-free progress. Repeating it resumes dormant accounts;
  the existing status command remains the independent count-only gate before
  removing the previous key.
- `.env.example`, the MFA runbook, ADR, active plan, status, known-gaps, and
  PostgreSQL runbook now describe the new boundary and its remaining external
  approval requirements.

## Validation

- `pnpm --filter @appsea/contracts test` — 94 passed.
- `pnpm --filter @appsea/db test` — 143 passed.
- `pnpm --filter @appsea/worker test` — 118 passed.
- Contracts, database, and worker typechecks passed.
- Focused repository tests cover bounded input, lease/fence propagation,
  encrypted previous-key rewrap, no plaintext logging, and the migration
  catalog. PostgreSQL integration covers a real enrolled account's rotation
  path. GitHub Actions run `30816541495` passed fresh PostgreSQL persistence,
  fresh Temporal workflows, and the full repository verification job for
  commit `8b9b19a`; local Docker Desktop remains unavailable.

## Remaining gates and simplifications

- The command is deliberately one bounded batch per invocation; scheduling,
  repeated invocation, secret-manager operation, and independent zero-count
  review remain deployment responsibilities.
- No automatic key deletion, source activation, identity-provider change,
  production migration, or deployment was performed.
- OIDC/verified identity, delivery/DPA, provider-backed step-up, production
  role provisioning, cloud purge, and signed desktop release remain outside
  this tranche and outside any AppSea completion claim.
