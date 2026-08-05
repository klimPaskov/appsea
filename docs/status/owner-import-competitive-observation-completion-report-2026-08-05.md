# Owner-import competitive observation completion report

Date: 2026-08-05

## Delivered

- Added forward-only migrations `0102_manual_owner_import_v2.sql` and
  `0103_competitor_observation_contrary_purpose.sql`. The
  immutable `manual-owner-import-v1` snapshot remains valid for history while
  current collection uses the independently reviewed `manual-owner-import-v2`
  snapshot.
- Added private `competitor-research` and `contrary-evidence` purposes to v2.
  The policy remains owner-attested, excerpt-only, quota-bounded, tombstone-
  aware, and explicitly non-public.
- Updated the route and active tests to use the exported policy-version
  constant. Batch triggers continue to support v1 history and v2 state
  transitions; the collectible read gate remains current-policy based.
- Added a stable private competitor-target projection and an evidence-linked
  observation form on the Competitors route. New claims start `unreviewed` and
  still require the existing step-up, membership, source-policy, evidence, and
  editor/owner review boundaries.
- Updated contracts, source-policy/runbook/architecture docs, current status,
  known gaps, plan, and project memory.

## Evidence

- `pnpm --filter @appsea/contracts test` — 105 passed.
- `pnpm --filter @appsea/connectors test` — 29 passed.
- `pnpm --filter @appsea/db test` — 159 passed.
- `pnpm --filter @appsea/web test` — 203 passed.
- `pnpm --filter @appsea/workflows test` — 31 passed.
- `pnpm --filter @appsea/worker test` — 124 passed.
- `pnpm lint` — 14 packages passed.
- `pnpm --filter @appsea/web typecheck` — passed.

## Remaining gates

Fresh PostgreSQL/Temporal/backup integration proof through migration `0103`
could not be rerun in this environment because Docker Desktop's
`dockerDesktopLinuxEngine` named pipe is unavailable. The migration remains
forward-only and statically covered by the database migration test. No
third-party public source was activated, and this slice does not establish
public market coverage.
