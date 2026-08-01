# Production source collection checkpoint

This procedure runs the approved CFPB connector against an already provisioned
private, non-fixture workspace. It is a durable collection checkpoint, not a
complete opportunity research run.

Prerequisites:

- the source policy version is active and approved through
  [`source-policy-review.md`](source-policy-review.md)
- the database quota/deletion migrations are applied
- the workspace is active, private, and not `fixture_only`
- the worker has a dedicated runtime database role and the official CFPB API
  remains reachable over HTTPS

Set a stable request timestamp so retrying the same idempotency key is a true
replay:

```powershell
$env:APPSEA_PRODUCTION_WORKSPACE_ID = 'workspace:research'
$env:APPSEA_PRODUCTION_CAMPAIGN_ID = 'campaign:cfpb:2026-07'
$env:APPSEA_PRODUCTION_RUN_ID = 'run:cfpb:2026-07-01'
$env:APPSEA_PRODUCTION_IDEMPOTENCY_KEY = 'cfpb-2026-07-01-query-v1'
$env:APPSEA_PRODUCTION_REQUESTED_AT = '2026-07-25T00:00:00.000Z'
$env:APPSEA_PRODUCTION_CFPB_POLICY_VERSION = 'cfpb-2026-07-v1'
$env:APPSEA_PRODUCTION_CFPB_QUERY = 'credit card'
$env:APPSEA_PRODUCTION_CFPB_LIMIT = '100'
$env:APPSEA_PRODUCTION_CFPB_MAX_SOURCE_ITEMS = '100'
pnpm worker:source:cfpb
```

The command refuses missing approval, exceeds no more than the approved quota,
stores no raw response payload, and emits bounded JSON counters. Before the
external request, the worker acquires a digest-only lease through migration
`0039`. Acquisition requires the active non-fixture source, the requested
policy version, and a matching operator approval review. The lease records one
server-observed collection timestamp; Temporal retries replay that timestamp so
complaint `capturedAt`, quota occurrence, and the collection snapshot remain
stable. PostgreSQL
persists the source-native record identity, policy version, capture/published
times, redacted evidence, unreviewed complaint observation, coverage gaps, and
an outbox/audit receipt. A filtered collection does not emit deletion events;
full-snapshot deletion reconciliation is a separate durable maintenance job;
see [`source-reconciliation.md`](source-reconciliation.md). A
repeated request with a different input is an idempotency conflict.

The persistence repository asserts the lease and current policy inside the same
transaction as the collection write and locks the lease row through commit. An
expired or revoked lease is terminal and fails closed; the lease is released
only after the collection transaction commits. If quota was settled or
the lease became inactive without a completed result, do not start a new fetch:
retain the digest and use operator reconciliation.

Before starting downstream analysis, an authenticated workspace editor or
owner must review each active complaint observation on the private collection
page. `Confirm` makes the observation eligible for the reviewed analysis input;
`Reject` excludes it. The database transition guard in migration `0032` allows
only those forward review transitions, records identifier-only receipts, and
rejects reviews after source deletion.

Inspect the result only through the authenticated private route:

- page: `/workspace/:workspaceId/research/:runId`
- API: `/api/workspaces/:workspaceId/research/production/:runId`

The page intentionally calls out that clustering, competitor research,
contrary-evidence review, scoring, reports, and coding plans are not produced
by this checkpoint. Do not copy its counts into the public leaderboard or call
them market estimates.

## Optional automatic analysis handoff

The collection request may include `analysisSeedReviewId` when an owner-approved
seed should be analyzed after the collection commits. The web gateway resolves
the seed through the private workspace boundary, and migration `0034` repeats
the approved-state gate for service-originated starts. Collection completion
then inserts one deterministic `production_analysis_handoffs` row in the same
transaction as the terminal workflow projection. The row stores only the seed
identifier and derived analysis identity; it never stores complaint text.

The durable worker claims queued handoffs with `FOR UPDATE SKIP LOCKED`, rebuilds
the analysis input from active policy/evidence rows plus the approved seed, and
starts the existing idempotent `productionAnalysisWorkflow`. A crashed dispatch
claim is reclaimable after 15 minutes. Handoffs that arrive before complaint
review remain queued with bounded retry; reviewers can still use the explicit
analysis route below when the retry window expires. A deployed scheduler,
Temporal authentication, and production alerting are still required for
reliable multi-worker operation.

The private collection read model and API include an `analysisHandoff` status
when one exists. It exposes only bounded identifiers, state, attempt count,
timestamps, and safe failure summaries; the raw idempotency key, complaint text,
and source payload never cross this status boundary. A collection started
without an approved seed returns `analysisHandoff: null` and remains on the
manual analysis path.

## Explicit reviewed analysis start

After complaint review, an editor or owner may start the downstream analysis
checkpoint by selecting an approved workspace seed review:

`POST /api/workspaces/:workspaceId/research/production/:runId/analysis`

The body contains `analysisRunId`, a 16–200 character `idempotencyKey`,
`requestedAt`, and the strict `seedReviewId`. The server resolves the approved
seed content, reconstructs the request and approved source-policy snapshot from
PostgreSQL, and the durable repository rechecks the seed hash/version before
persisting. Callers cannot submit complaint payloads, substitute a policy, or
inline an unapproved seed. The route rejects collections without active
confirmed excerpt evidence and returns a Temporal workflow ID. It is available
as a manual fallback when collection was started without
`analysisSeedReviewId` or when a reviewer chooses a different approved seed.

Seed review lifecycle:

- `POST /api/workspaces/:workspaceId/seed-reviews` creates an immutable
  `unreviewed` record from validated seed JSON.
- `PATCH /api/workspaces/:workspaceId/seed-reviews/:seedReviewId` lets an
  editor or owner mark it `reviewed`; only an owner can mark it `approved` or
  `withdrawn`.
- `GET /api/workspaces/:workspaceId/seed-reviews` and the item route expose
  bounded private read models. The page is `/workspace/:workspaceId/seed-reviews`.

## Authenticated workflow gateway

The private web boundary also exposes the same checkpoint through an
authenticated owner/editor gateway:

- `POST /api/workspaces/:workspaceId/research/production` starts the Temporal
  workflow after binding `requestedBy` to the session user. Before contacting
  Temporal, migration `0038` authorizes the same workspace in PostgreSQL and
  admits at most five distinct starts per 15-minute window and two active
  starts per workspace. The decision is serialized under a workspace advisory
  lock; only the idempotency and input digests are stored. A replay of the same
  digest returns the existing admission without consuming another slot. A new
  request receives `429` with a bounded `Retry-After` value when either limit
  is reached. The workflow initialization transaction consumes the short-lived
  reservation, and source maintenance purges terminal or expired admission
  rows. These limits are fixed in reviewed migration `0038`; request payloads
  cannot raise them.
  The workflow activity then acquires the migration `0039` source lease before
  contacting the connector; admission and collection leases are separate
  boundaries and both replay by digest.
- `GET /api/workspaces/:workspaceId/research/production/workflow/:workflowId`
  queries Temporal and falls back to the RLS-protected PostgreSQL workflow
  projection during worker/service interruption. The degraded projection
  response is checkpoint-only (`result` is null) until Temporal is available;
  use the collection run route for persisted evidence details.

Both routes reject fixture workspaces and workspace mismatches. They are not a
replacement for Temporal namespace authorization, source-policy approval, or a
production deployment with TLS and role separation.
