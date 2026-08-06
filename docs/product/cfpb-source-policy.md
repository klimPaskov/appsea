# CFPB Consumer Complaint Database source policy

- Source ID: `cfpb-consumer-complaints`
- Policy state: `pending_review`
- Connector enabled: no
- Engineering review date: 2026-07-24
- Policy owner: AppSea source-policy review queue
- Activation owner: explicitly assigned legal, privacy, and security reviewers
- Required reviewer roles: `legal`, `privacy`, and `security` (all three)

This is an engineering policy record, not legal advice or an activation approval.
The connector remains disabled until the review owner confirms commercial use,
privacy, retention, display, and deletion obligations for the intended AppSea
deployment.

The source-policy registry now makes that boundary executable. Drafts are
registered as disabled rows by an operator connection, and activation requires
an immutable review record through `appsea.approve_source_policy`. Migration
`0054_source_policy_review_integrity.sql` binds each new approval to a
lowercase reviewer identity, an independent role, and an explicit independence
attestation; the policy owner cannot approve its own policy. The policy itself
declares the required `legal`, `privacy`, and `security` roles. Migrations
`0114_source_policy_reviewer_roles.sql` and
`0115_source_policy_reviewer_role_completeness.sql` reject undeclared roles and
keep the source disabled until all three roles approve the same policy hash.
Runtime workers can read only the resulting active snapshot; they cannot insert
policy rows or change lifecycle state. Pre-0054 approvals remain audit history
but are returned to pending review until re-approved. The repository does not
seed or auto-approve this CFPB policy.

## Permitted route

The implementation uses only the CFPB's official public JSON search API:

`https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/`

The route is documented by CFPB Open Tech at
[`cfpb.github.io/ccdb5-api`](https://cfpb.github.io/ccdb5-api/) and the official
database page says the published data is freely available to use, analyze, and
build on. No credentials, browser automation, scraping, or access-restriction
workaround is used. The connector sends `search_term`, `field`, `frm`, `size`,
and `format=json` parameters only. Filtered collection may send `search_term`;
identifier-only reconciliation deliberately omits it and sends only the
bounded offset/size traversal parameters.
After a completed deletion tombstone, the reviewed re-collection path uses the
same API origin with the complaint identifier as the exact path segment. It
fetches one record, retains no raw response, and emits no deletion tombstone;
the path is private, explicit, and disabled until this source policy is
approved.

On 2026-08-06 the engineering review refreshed its first-party references in
[`cfpb-source-policy-evidence-handoff-2026-08-06.md`](../status/cfpb-source-policy-evidence-handoff-2026-08-06.md).
The current CFPB Open Tech API page documents the public API, and its linked
OpenAPI page exposes search and complaint-by-ID routes. The CFPB's current
complaint-program page continues to describe opt-in narrative publication and
personal-information removal. These facts support the connector's
consent/scrubbing and provenance assumptions only; they do not replace the
independent commercial-use, privacy, and security approval required before
activation.

## Policy metadata

The typed record is `cfpbSourcePolicy` in
`packages/connectors/src/index.ts`.

- Purpose: opportunity research, identifier-only deletion reconciliation,
  development, and testing after approval. It does not currently authorize the
  `competitor-research` purpose; CFPB records cannot be attached to a
  non-synthetic competitor observation until a separately reviewed policy
  version explicitly lists that purpose.
- Commercial-use state: `allowed` as an engineering reading of the public-data
  statement; counsel must confirm the intended commercial product use.
- Display: `excerpt`, and only for narratives returned through the public API.
- Retention: AppSea keeps a maximum of 30 days before policy-driven redaction or
  tombstoning; the upstream agency's records schedule is not AppSea permission
  to retain a local copy indefinitely.
- Freshness: the engineering draft declares a 24-hour expected collection
  interval plus a 24-hour allowed delay. This is an operational read-model
  threshold, not a provider guarantee or activation approval.
- Attribution: required; reports must identify the CFPB Consumer Complaint
  Database and link to the official route.
- Quota: AppSea self-imposes six requests per minute, 1,000 records per request,
  and 1,000 records per run at zero recorded API cost. These limits are a safety
  budget, not a claim about CFPB's undisclosed service ceiling. The connector
  accepts only the PostgreSQL-backed reservation capability outside tests;
  reservations are hashed, idempotent, shared across workspaces, and expired
  and purged by the all-workspace source-maintenance job. A live source still
  requires an approved policy version and deployment-level quota monitoring.
  Every completed collection preserves the settled reservation cost in its
  snapshot, result, workflow checkpoint, and audit/outbox metadata. CFPB is
  currently modeled as zero-cost by policy; the propagation is retained so a
  reviewed source-policy revision with a non-zero request cost cannot disappear
  between quota settlement and workflow accounting.
  The production workflow also compares the approved request cost with the
  caller-owned cost budget before acquiring a source lease; a known overage is a
  bounded budget rejection and never reaches the external API.
- Credentials: none. A future proxy must keep service identity and secrets
  outside connector code and workflow history.
- Response safety: the connector enforces a 30-second request/body timeout and
  rejects responses larger than 32 MiB before JSON expansion. This is an
  engineering resource limit, not a guarantee about upstream availability.

## Narrative and privacy rules

The connector accepts a record only when it has a public complaint narrative,
valid complaint ID/product fields, a valid AppSea capture timestamp, and the API
representation is `excerpt`. CFPB's intake date is not treated as a publication
date and is not retained as `publishedAt`.
It marks the normalized complaint as non-synthetic and source-redacted. Records
without a consented/scrubbed public narrative are skipped and counted in a visible
coverage warning; metadata-only rows are not silently converted into narrative
evidence. CFPB's `date_received` is an intake date rather than a publication
timestamp, so the current contract leaves `publishedAt` unset and preserves the
distinction in the collection warning.

Campaign date windows are enforced at the official API boundary with
`date_received_min` and `date_received_max` (inclusive calendar dates). The
window is therefore an intake-date filter, not a publication-date claim. A
filtered collection still cannot establish deletion absence or represent the
full complaint population; the persisted snapshot and coverage warnings retain
that limitation. Exact complaint-by-ID re-collection is intentionally not
filtered by the campaign window and says so in its warning.

The source's own publication and scrubbing statements are the reason for this
minimum. AppSea does not infer that a published complaint is representative,
verified, or a measure of total market harm.

## Deletion synchronization

The source exposes no deletion webhook or tombstone feed in the approved route.
Filtered pages therefore emit no deletion claim. The durable reconciliation job
uses only unfiltered identifier pages with the separate
`deletion-reconciliation` purpose, and it emits tombstones only after a bounded
traversal observes a short, warning-free page. A capped or malformed traversal
is recorded as an incomplete coverage gap and emits no deletion tombstones.
`syncCfpbDeletions` remains the pure comparison helper for fixture and adapter
tests; the production repository performs the comparison and tombstone insert
in one lease-asserted transaction. The event carries the source record ID,
observation time, and reason. The source-maintenance worker turns those events
into `deletion_tombstones`, redacts
source-item raw references and normalized evidence, and marks dependent
reports/plans unavailable while retaining provenance. Invalidated production
analysis outputs now enter the retention-aware object purge queue, but
complaint/cluster recomputation, cloud/export object purge, and backup expiry
verification remain release blockers before activation.

## Production collection checkpoint

Once a policy version is explicitly approved, the worker command or the
production-collection Temporal workflow can run bounded collection with a
PostgreSQL quota ledger. Both paths normalize the caller key into one hashed
idempotency domain and persist non-synthetic source items, redacted evidence,
unreviewed complaint observations, policy lineage, deletion tombstones,
coverage gaps, and identifier-only audit/outbox events through
`PostgresProductionCollectionRepository`. A quota reservation that is settled
before the collection result is committed creates a durable reconciliation case;
automatic retries are blocked at that boundary. Members can inspect the case at
`GET /api/workspaces/:workspaceId/research/quota-reconciliation`, while only
the standalone maintenance role may record an exact linked result or explicit
no-result resolution. This checkpoint is not an
opportunity ranking or report and does not make the public leaderboard
non-synthetic.

The private inspection route is
`/workspace/:workspaceId/research/:runId` (API:
`/api/workspaces/:workspaceId/research/production/:runId`). It displays only
the source-policy-allowed representation and the recorded gaps.

The worker acquires migration `0039`'s short-lived source collection lease before
the external request. The lease binds the source, policy version, and request
digest, records one server-observed capture timestamp, and is rechecked against
policy approval and expiry immediately before persistence. A retry reuses the
stored timestamp; an expired or revoked lease becomes terminal and requires
operator reconciliation. This repository-level boundary is not a deployment
approval: the CFPB connector remains disabled until legal/privacy/security
owners approve the policy and the production scheduler/Temporal infrastructure.

## Coverage gaps and review triggers

- The database excludes complaints referred to other regulators and is not a
  statistical sample of consumer experiences.
- Recent records and narratives can lag publication and scrubbing.
- Missing narrative means missing public evidence, not absence of a complaint.
- Product/issue taxonomy changes require a new policy/version review.
- CFPB terms, API behavior, publication, scrubbing, or deletion behavior changes
  expire this record and disable the connector until re-reviewed.

Official references:

- [Consumer Complaint Database](https://www.consumerfinance.gov/data-research/consumer-complaints/)
- [How CFPB shares complaint data](https://www.consumerfinance.gov/complaint/data-use/)
- [CFPB API field reference](https://cfpb.github.io/api/ccdb/fields.html)
- [CFPB narrative scrubbing standard](https://files.consumerfinance.gov/f/documents/cfpb_narrative-scrubbing-standard_2023-05.pdf)
