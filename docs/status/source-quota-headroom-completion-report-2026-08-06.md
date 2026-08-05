# Source quota headroom completion report — 2026-08-06

## Outcome

The private source registry now reports bounded current-minute quota headroom
for an approved source policy. The read model distinguishes available,
near-limit, exhausted, unknown, and blocked states and shows only the
requests-per-minute limit, requests used, requests remaining, and the current
window boundary.

The projection is read-only and intentionally does not expose reservation IDs,
workspace-specific reservation rows, provider credentials, or mutation
capability. Quota reservation, settlement, release, expiry, and reconciliation
remain on the existing worker-owned PostgreSQL functions.

## Changed surfaces

- `packages/contracts/src/index.ts` adds the bounded quota-headroom state and
  private read model, including counter-limit validation and compatibility
  defaults for older source-health payloads.
- `packages/db/migrations/0107_source_quota_headroom_read.sql` adds the
  authenticated-workspace-context-required security-definer read function. Direct runtime
  access to `source_quota_windows` remains revoked.
- `packages/db/src/source-quota-headroom.ts` derives safe read states from the
  policy quota and bounded database observation; blocked and unobserved paths
  fail closed.
- `packages/db/src/source-policy-repository.ts` joins the function into the
  existing authenticated source-registry projection without exposing raw quota
  rows.
- `apps/web/src/app/workspace/[workspaceId]/sources/page.tsx` shows a compact
  `Quota now` value beside existing health/freshness facts. The public
  leaderboard is unchanged.
- Backup/restore and fresh/populated migration assertions now target migration
  `0107` instead of the stale `0101` checkpoint.

## Validation

- `pnpm format:check` passed.
- `pnpm --filter @appsea/contracts test` passed: 111 tests.
- `pnpm --filter @appsea/db test` passed: 40 files, 179 tests.
- `pnpm --filter @appsea/web test` passed: 60 files, 216 tests.
- Affected package type checks passed.
- Docker-backed fresh-schema and PostgreSQL integration execution remain
  unavailable in this environment because Docker Desktop's Linux engine is not
  running; the checked-in integration lifecycle now includes `0107` and remains
  the required hosted/local proof when infrastructure is available.

## Remaining gaps and simplifications

- Headroom is a shared source-window capacity indicator, not per-workspace
  billing or usage accounting. It can reflect other authorized workspaces'
  requests because the underlying provider quota is global by source/policy;
  no identifiers or row-level activity cross the boundary.
- No source is activated. CFPB and Stack Exchange still require independent
  legal, privacy, security, and commercial-use approval.
- Provider authentication expiry, scheduler alert ownership, deployment SLOs,
  cloud backup/HA/restore evidence, and hosted CI spending-limit recovery remain
  external production gates.
