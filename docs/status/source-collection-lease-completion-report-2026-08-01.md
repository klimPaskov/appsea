# Source collection lease completion report — 2026-08-01

## Outcome

The production-shaped CFPB collection boundary now has a durable, policy-bound
lease before the external request. Migration `0039` stores only workspace/source
identifiers, policy version, request digest, lifecycle timestamps, and the
stable observed collection timestamp. The runtime role cannot write the lease
table directly.

The worker acquires or replays the lease, passes its observed timestamp to the
connector for complaint capture and quota provenance, asserts the lease and
current approval immediately before persistence, and releases it only after the
collection transaction commits. A terminal lease, inactive policy, or uncertain
quota settlement fails closed and requires operator reconciliation. The CFPB
policy remains disabled and pending review.

## Changed surfaces

- `packages/contracts`: lease decision/result contracts, required
  `observedAt` on production persistence input, and bounded maintenance count.
- `packages/db/migrations/0039_source_collection_leases.sql`: forced-RLS lease
  table plus security-definer acquire/assert/release/purge functions with
  matching `source_policy_reviews` approval checks.
- `packages/db/src/source-collection-lease-repository.ts`: validated worker
  capability, conflict/terminal/policy errors, and bounded purge.
- `apps/worker`: runner/workflow lease lifecycle, stable capture provenance,
  persistence timestamps, maintenance purge, and secret-free observability.
- Tests cover contract shape, repository decisions/validation, migration
  assertions, maintenance budgeting, observability, and a Docker-backed
  PostgreSQL replay/policy fixture.

## Validation

Passed on 2026-08-01:

- `pnpm --filter @appsea/contracts test`
- `pnpm --filter @appsea/db test`
- `pnpm --filter @appsea/worker test`
- affected package lint and typecheck
- `git diff --check`
- `pnpm verify` (including fixture worker, plan generation, analysis sample,
  web smoke, and repository checks)

`pnpm verify:persistence` and `pnpm verify:workflows` were attempted, but this
environment currently cannot start the Docker Desktop Linux engine
(`//./pipe/dockerDesktopLinuxEngine`), so fresh/upgrade PostgreSQL and Temporal
crash/replay execution remain unproven here.

## Security and source-policy notes

The lease contains no complaint text, raw provider payload, personal data, or
caller idempotency key. It is digest-only and workspace-scoped. Acquisition and
the pre-persistence assertion both require an active non-fixture source, the
current approved policy version, a non-expired reviewed policy, and an immutable
approved review whose content hash matches the policy. No connector was
activated and no legal or commercial-use claim was changed.

## Simplifications and remaining gaps

- The observed timestamp is issued by the worker/workflow boundary and
  immutably retained by the database lease; a future deployment may additionally
  expose database-clock telemetry, but callers cannot overwrite the stored value
  on replay.
- Lease retention reuses the bounded source-maintenance retention cutoff rather
  than adding a second scheduler. A deployed scheduler and alert ownership are
  still required.
- If quota has settled but the collection result is absent, the worker leaves
  the lease terminal/uncertain and does not automatically re-fetch. Operator
  reconciliation and crash/failure drills remain release work.
- Docker-backed integration, production PostgreSQL/Temporal provisioning,
  identity-provider approval, source legal approval, cloud object/backup purge,
  and desktop release packaging remain open.
