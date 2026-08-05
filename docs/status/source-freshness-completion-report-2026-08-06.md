# Source freshness observability completion report — 2026-08-06

## Outcome

The private source-registry health projection now distinguishes connector
health from reviewed source freshness. A policy may declare a scheduled
interval plus allowed delay or explicitly declare an on-demand source. The
projection derives bounded `fresh`, `stale`, `unknown`, `on_demand`, or
`blocked` state from the latest retained workspace observation and keeps the
observation age and reviewed threshold visible on the private source page.

This is an observational slice. It does not activate a connector, schedule or
retry collection, settle quota, expose provider errors, or infer complaint
absence from stale or missing observations.

## Changed surfaces

- `packages/contracts/src/index.ts` adds optional `sourceFreshnessPolicySchema`
  metadata plus bounded freshness read models. The optional policy field keeps
  legacy immutable JSONB policy hashes readable; any threshold change still
  requires a new reviewed policy version.
- `packages/connectors/src/index.ts` records explicit schedules for disabled
  CFPB and Stack Exchange candidates. The tenant-private owner import remains
  operationally on demand, but its legacy v2 payload declares no freshness SLA
  and therefore stays `unknown` until a new reviewed policy version adds one.
- `packages/db/src/source-freshness.ts` derives the fixed freshness projection;
  `source-policy-repository.ts` maps it from retained observation timestamps
  without a schema migration or write capability.
- `apps/web/src/app/workspace/[workspaceId]/sources/page.tsx` shows freshness
  state, reviewed window, last observation, and age alongside connector health.
  The route remains private and read-only.

## Validation

- Contract tests cover scheduled/on-demand validation and legacy payloads.
- Connector tests verify the three policy freshness declarations and disabled
  third-party states.
- Database tests cover fresh/stale boundaries, blocked and on-demand behavior,
  legacy unknown state, safe health mapping, and bounded counters.
- Web route tests and type checking pass with the private source read model.
- Direct local HTTP checks remain the runtime evidence path; no browser control
  or browser debugging is required.

## Remaining gaps and simplifications

- No source connector is newly enabled. CFPB and Stack Exchange still require
  independent legal, privacy, security, and commercial-use review.
- There is no quota-remaining ledger projection, provider-auth expiry state,
  scheduler alert delivery, or deployment SLO ownership in this slice.
- Docker-backed fresh-schema and backup/restore proof remains dependent on the
  unavailable local Docker Desktop Linux engine and hosted provider gates.
