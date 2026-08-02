# Research campaigns

Research campaigns are private workspace configuration records. They define a
research question and the source allowlist that a later, reviewed workflow may
use; creating a campaign does not collect evidence or activate a connector.

## Private boundary

Workspace members can list and read campaigns at
`GET /api/workspaces/:workspaceId/campaigns` and
`GET /api/workspaces/:workspaceId/campaigns/:campaignId`. Owners and editors
can create a draft through the same-origin `POST` route. The page is
`/workspace/:workspaceId/campaigns` and is linked from the private workspace
home. All responses are authenticated, membership-checked, and private
no-store responses.

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

The current production workflow boundary intentionally accepts exactly one
configured non-synthetic source. Before admission, the route re-reads source
policy readiness, expiry, approved purpose, display mode, campaign state, and
budget, and verifies any optional seed review is approved for the workspace.
The digest-only admission ledger is committed before Temporal is contacted, so
rate, concurrency, and idempotency failures do not start a workflow. A pending
or mismatched policy remains a visible coverage gap and returns a bounded
validation error. Multi-source orchestration, scheduling, and connector
activation remain separate reviewed work.
