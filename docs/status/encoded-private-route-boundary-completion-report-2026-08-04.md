# Encoded private-route boundary completion report

Date: 2026-08-04
Status: complete for this repository tranche; AppSea is not production-ready.

## Outcome

Private workspace pages now accept persistence-safe identifiers such as
`workspace:<hash>` when the App Router preserves their percent encoding. The
server boundary decodes each segment once, leaves malformed input untouched for
schema rejection, and uses the same helper across workspace pages and private
opportunity reads. The local authenticated smoke covers the complete private
page set with encoded workspace/detail parameters.

The members purge-readiness read also has the narrow PostgreSQL privilege it
needs. Migration `0095` grants only `workspace_id` and `state` on
`source_collection_leases` to the authenticated runtime role; forced RLS,
workspace transaction context, and maintenance-only lifecycle operations remain
in force.

## Changed surfaces

- `apps/web/src/server/path-params.ts` and its focused tests provide the shared
  decode-once boundary.
- Private workspace pages for sources, seed reviews, campaigns, imports,
  members, usage, analysis, workflow, campaign runs, and research now decode
  dynamic segments before validation.
- `scripts/smoke_local_stack.mjs` and its test fixture exercise every private
  page with encoded identifiers.
- `packages/db/migrations/0095_workspace_purge_readiness_lease_grant.sql`
  provides the least-privilege lease projection read.
- Session revocation and seed-review approval transitions use a database-clock
  value clamped to `created_at`, preserving PostgreSQL timestamp invariants when
  application and database clocks differ. The operational-alert integration
  fixture uses an explicitly due timestamp so claim/retry proof is not flaky.

## Validation

- `pnpm --filter @appsea/web lint`
- `pnpm --filter @appsea/web typecheck`
- `pnpm --filter @appsea/web test` — 174 tests
- `pnpm --filter @appsea/db lint`
- `pnpm --filter @appsea/db typecheck`
- `pnpm --filter @appsea/db test` — 150 tests
- `pnpm verify:local-stack`
- `pnpm verify:persistence:fresh` — 49 integration tests across 95 migrations
- `node --test scripts/smoke_local_stack.test.mjs`
- `git diff --check`

Hosted GitHub Actions run `30917740935` for commit `b99ffd7` failed before any
job steps in every matrix job because of the account payment/spending-limit
gate; this tranche does not claim hosted green status.

## Scope limits and blockers

This change does not activate CFPB, Stack Exchange, or any other third-party
source; it does not deploy PostgreSQL/Temporal, configure production providers,
perform cloud/export/backup deletion, or produce signed desktop releases.
The active `manual-owner-import-v1` path remains tenant-private and must not be
described as public market research. Production readiness therefore remains
blocked by the external gates listed in
[`known-gaps.md`](known-gaps.md) and the current audit.

No new image asset was necessary: this tranche changes server route parsing,
database privileges, and test harnesses. The repository's image-generation
preference applies to visual assets; native route/database code does not benefit
from generated bitmap geometry.
