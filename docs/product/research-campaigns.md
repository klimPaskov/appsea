# Research campaigns

Research campaigns are private workspace configuration records. They define a
research question and the source allowlist that a later, reviewed workflow may
use; creating a campaign does not collect evidence or activate a connector.

## Private boundary

Workspace members can list and read campaigns at
`GET /api/workspaces/:workspaceId/campaigns` and
`GET /api/workspaces/:workspaceId/campaigns/:campaignId`. Owners and editors
can create a draft through the same-origin `POST` route, replace a draft
through `PATCH /api/workspaces/:workspaceId/campaigns/:campaignId`, and archive
a campaign through same-origin `DELETE` on that route. The page is
`/workspace/:workspaceId/campaigns` and is linked from the private workspace
home. All responses are authenticated, membership-checked, and private
no-store responses.

Campaign edits are full replacements of the name, purpose, validated
`campaign-v1` configuration, and USD budget. An idempotent replacement with the
same content is a read-only replay; a changed validated campaign returns to
`draft` so a later admission re-checks its inputs. Queued, running, paused,
completed, failed, partial, and canceled campaign history is not rewritten.
DELETE is intentionally a soft archive transition. It rejects active runs,
preserves every run/evidence/audit lineage, and leaves the archived record
visible as a coverage and history boundary.

The private workspace home also links to
`/workspace/:workspaceId/sources`, a read-only source-coverage registry. Use it
to inspect policy readiness, quotas, deletion duties, and visible gaps before
choosing a source identifier. The registry does not activate connectors or
expose policy payloads, approval hashes, or reviewer identities.

## Configuration contract

New records use the strict `campaign-v1` configuration contract in
`packages/contracts`:

- goal, query, seeds, languages, geographies, exclusions, and an optional date
  range describe the research question;
- `sourceIds` is a unique, bounded allowlist of registry identifiers;
- `maxEvidenceCount`, `refreshPolicy`, `sensitiveTopicPolicy`, and
  `requestedDisplayMode` constrain collection and presentation; and
- the USD budget caps source items, cost micros, and activity attempts.

The repository resolves every source identifier against the global source
registry and returns its lifecycle state, policy version/state, permitted
purposes, synthetic flag, review/expiry timestamps, and coverage notes. A
fixture-only workspace cannot mix with non-fixture sources. A reviewed policy
whose permitted-purpose list excludes the campaign purpose is rejected. Pending
or otherwise unavailable policies remain visible as readiness gaps so absence
of access is not interpreted as absence of complaints.

The existing JSONB columns already support this additive shape. Legacy fixture
and workflow-created campaign configurations remain readable through a bounded
legacy read union; new writes are always validated `campaign-v1` drafts.

## Workflow boundary

Campaign creation writes identifier-only audit and outbox receipts. It never
starts Temporal, performs a source request, changes source policy state, or
marks a connector enabled. A later collection job must re-check the current
source policy, quota, deletion obligations, and campaign budget at its own
admission and persistence boundaries. Live source activation remains an
explicitly reviewed operator action.

## Starting a collection run

An authenticated owner or editor can start a run from the campaign page or the
same-origin `POST /api/workspaces/:workspaceId/campaigns/:campaignId/run`
route. The request contains only a run identifier, idempotency key, timestamp,
and an optional approved seed-review identifier. The server derives the source,
query, purpose, display mode, evidence limit, and budget from the persisted
campaign; callers cannot override those values.

The one-source production workflow re-reads source policy readiness, expiry,
approved purpose, display mode, campaign state, and budget before admission,
and verifies any optional seed review is approved for the workspace. The
digest-only admission ledger is committed before Temporal is contacted, so
rate, concurrency, and idempotency failures do not start a workflow. A pending
or mismatched policy remains a visible coverage gap and returns a bounded
validation error. A campaign with two to sixteen configured non-fixture sources
uses migration `0068` instead: the route creates an idempotent parent
orchestration and one durable child per source, while the lease-backed worker
rechecks each policy, admits and starts the existing one-source workflow, and
reconciles child/parent/campaign state. Policy denial is recorded on that child;
it is not interpreted as evidence absence. Connector activation remains a
separate reviewed operation. Non-manual refresh policies and orchestration
children are dispatched by the existing lease-backed source-maintenance
worker, not by a browser request.

## Scheduled refresh

`daily`, `weekly`, and `monthly` policies persist a server-owned due timestamp
on the campaign. The maintenance worker claims one due campaign at a time with
a bounded lease, derives the source-policy-bound production request, stores its
idempotency/input digests, and admits it through the same per-workspace gate as
manual starts before contacting Temporal. A stale claim can be reclaimed; a
policy denial, unsupported source, admission limit, or Temporal failure clears
or retries the pending request with a fixed code and bounded delay. The private
campaign read model exposes `manual`, `scheduled`, `dispatching`, or `failed`
state and any visible failure summary. The scheduler never activates a source,
uses fixture data as production evidence, or hides a coverage gap.

## Run history and inspection

Private members can list the latest 100 production runs at
`GET /api/workspaces/:workspaceId/campaigns/:campaignId/runs`. The read model
contains only the campaign/run/workflow identifiers, source and policy IDs,
state, checkpoint, bounded counters, and timestamps. It deliberately excludes
idempotency digests, input hashes, actor details, and source payloads. The
campaign page links each run to the private workflow-status page
`/workspace/:workspaceId/research/workflows/:workflowId`; completed runs also
link to the existing evidence and coverage page at
`/workspace/:workspaceId/research/:runId`.

Multi-source parent/child history is available only inside the private campaign
surface. `GET /api/workspaces/:workspaceId/campaigns/:campaignId/orchestrations`
lists at most 100 parent requests, and the detail route adds bounded child
state, attempt count, policy/workflow identifiers, and fixed failure summaries.
These read models omit caller keys, hashes, policy-review hashes, raw source
payloads, and imported instructions. The public leaderboard remains a ranked
list only; research detail belongs on private campaign and opportunity routes.

Owners and editors can request cancellation for a multi-source orchestration
with same-origin `POST` to its detail route. The database commits an immutable
cancellation intent before the server attempts Temporal cancellation. Queued
children are stopped in the workspace transaction; a child that has already
started remains active until its workflow reaches a safe terminal cancellation
boundary. The lease-backed worker retries external cancellation and reconciles
the parent, while the private page shows the pending state. Cancellation does
not delete evidence, reports, plans, exports, objects, or backups.

Owners and editors can request cancellation for a one-source production run
from its private status/history surface with same-origin `POST` to
`/api/workspaces/:workspaceId/research/production/workflow/:workflowId`.
Migration `0071` stores an immutable, member-bound intent and
identifier-only audit/outbox receipt before the route attempts Temporal cancel.
The leased source-maintenance worker retries that external call; the workflow's
non-cancellable termination activity remains the authority for the safe
terminal state and reconciles a collection that already crossed persistence.
Repeated requests are idempotent, terminal jobs return `already_terminal`, and
the UI keeps pending safe-boundary state visible. Cancellation never deletes
evidence or changes source-policy state.

## Reviewed analysis handoff

The collection page is also the explicit boundary between collection and
analysis. Owners and editors can start analysis only by selecting an approved
workspace seed review. The server validates that review, reconstructs the
input from the completed collection, and sends only identifiers and immutable
digests to `production-analysis-v2`; it never treats fixture content as live
research or lets a browser supply source payloads.

The response links to
`/workspace/:workspaceId/research/analysis/:analysisRunId`. That page and
`GET /api/workspaces/:workspaceId/analysis/:analysisRunId/status` expose a
workspace-bound, no-store status projection with safe checkpoints, bounded
attempts, availability, failure summaries, and timestamps. Temporal is the
fresh path and PostgreSQL is the durable fallback. Invalid or foreign workflow
identifiers fail closed. The completed package remains behind the existing
private opportunity/report/plan approval boundaries.
