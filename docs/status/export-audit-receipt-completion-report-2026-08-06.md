# Approved export audit receipt completion report

## Outcome

Approved private report and coding-plan JSON exports now leave a durable,
identifier-only audit receipt in the same authenticated PostgreSQL transaction
that validates membership, approval, redaction, and object hydration.

The receipt actions are `report.exported` and `plan.exported`. Their metadata is
limited to the target artifact's manifest hash and `json` representation. A
deterministic event ID includes the workspace, artifact/version identity,
manifest, and authenticated actor, so a replay by the same actor is a no-op.
The export payload and HTTP response headers are unchanged.

## Changed surfaces

- `packages/db/src/auth-repository.ts` records the audit row only after the
  schema-validated export model has been hydrated and redacted. Export
  transactions are read-write and serializable; actor attribution comes from
  `appsea.auth_user_id` rather than request metadata.
- `packages/db/src/auth-repository.test.ts` covers approved report and plan
  receipts, scalar metadata, the deterministic ID shape, and the no-receipt
  path for an unapproved plan.
- `packages/db/integration/db.integration.test.ts` now proves report and plan
  receipts, actor attribution, manifest metadata, and the pre-approval denial
  path when the PostgreSQL integration environment is available.
- Product, architecture, status, plan, start-here, and memory documentation
  now distinguish export accountability from provider retention and purge.

## Validation

- `pnpm --filter @appsea/db test` — passed (40 files, 181 tests).
- `pnpm --filter @appsea/db lint` — passed.
- `pnpm --filter @appsea/db typecheck` — passed.
- The PostgreSQL integration test is present but could not execute on this host
  because the Docker Desktop Linux engine is unavailable.

## Boundaries and remaining gaps

This slice does not add an export object store, download revocation, cloud
retention/lifecycle enforcement, workspace/export/backup purge, an outbox
fan-out, or provider incident controls. Those remain reviewed deployment and
retention work. The receipt records that an approved export occurred; it does
not authorize deletion or imply that the provider has retained or purged it.
