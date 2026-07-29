# CFPB Consumer Complaint Database source policy

- Source ID: `cfpb-consumer-complaints`
- Policy state: `pending_review`
- Connector enabled: no
- Engineering review date: 2026-07-24
- Policy owner: AppSea source-policy review queue
- Activation owner: an explicitly assigned legal/privacy/security reviewer

This is an engineering policy record, not legal advice or an activation approval.
The connector remains disabled until the review owner confirms commercial use,
privacy, retention, display, and deletion obligations for the intended AppSea
deployment.

The source-policy registry now makes that boundary executable. Drafts are
registered as disabled rows by an operator connection, and activation requires
an immutable review record through `appsea.approve_source_policy`. Runtime
workers can read only the resulting active snapshot; they cannot insert policy
rows or change lifecycle state. The repository does not seed or auto-approve
this CFPB policy.

## Permitted route

The implementation uses only the CFPB's official public JSON search API:

`https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/`

The route is documented by CFPB Open Tech at
[`cfpb.github.io/ccdb5-api`](https://cfpb.github.io/ccdb5-api/) and the official
database page says the published data is freely available to use, analyze, and
build on. No credentials, browser automation, scraping, or access-restriction
workaround is used. The connector sends `search_term`, `field`, `frm`, `size`,
and `format=json` parameters only.

## Policy metadata

The typed record is `cfpbSourcePolicy` in
`packages/connectors/src/index.ts`.

- Purpose: opportunity research, development, and testing after approval.
- Commercial-use state: `allowed` as an engineering reading of the public-data
  statement; counsel must confirm the intended commercial product use.
- Display: `excerpt`, and only for narratives returned through the public API.
- Retention: AppSea keeps a maximum of 30 days before policy-driven redaction or
  tombstoning; the upstream agency's records schedule is not AppSea permission
  to retain a local copy indefinitely.
- Attribution: required; reports must identify the CFPB Consumer Complaint
  Database and link to the official route.
- Quota: AppSea self-imposes six requests per minute, 1,000 records per request,
  and 1,000 records per run at zero recorded API cost. These limits are a safety
  budget, not a claim about CFPB's undisclosed service ceiling. The connector
  accepts only the PostgreSQL-backed reservation capability outside tests;
  reservations are hashed, idempotent, shared across workspaces, and expired
  and purged by the all-workspace source-maintenance job. A live source still
  requires an approved policy version and deployment-level quota monitoring.
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

The source's own publication and scrubbing statements are the reason for this
minimum. AppSea does not infer that a published complaint is representative,
verified, or a measure of total market harm.

## Deletion synchronization

The source exposes no deletion webhook or tombstone feed in the approved route.
Filtered pages therefore emit no deletion claim. `syncCfpbDeletions` can emit a
source deletion event only after an operator-approved full snapshot comparison;
the event carries the source record ID, observation time, and reason. The
source-maintenance worker turns those events into `deletion_tombstones`, redacts
source-item raw references and normalized evidence, and marks dependent
reports/plans unavailable while retaining provenance. Complaint/cluster
recomputation, export/object-store purge, and backup expiry verification remain
release blockers before activation.

## Production collection checkpoint

Once a policy version is explicitly approved, the worker command or the
production-collection Temporal workflow can run bounded collection with a
PostgreSQL quota ledger. Both paths normalize the caller key into one hashed
idempotency domain and persist non-synthetic source items, redacted evidence,
unreviewed complaint observations, policy lineage, deletion tombstones,
coverage gaps, and identifier-only audit/outbox events through
`PostgresProductionCollectionRepository`. A quota reservation that is settled
before the collection result is committed requires operator reconciliation;
automatic retries are blocked at that boundary. This checkpoint is not an
opportunity ranking or report and does not make the public leaderboard
non-synthetic.

The private inspection route is
`/workspace/:workspaceId/research/:runId` (API:
`/api/workspaces/:workspaceId/research/production/:runId`). It displays only
the source-policy-allowed representation and the recorded gaps.

The worker rechecks the active approved policy before persistence. A deployment
must add a short-lived policy revocation lease across the external request
before activation; until then, a revoke/expiry can race with an already-started
fetch and the run will fail closed at persistence.

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
