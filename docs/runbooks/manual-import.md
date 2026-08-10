# Manual import runbook

Use the private workspace screen at `/workspace/{workspaceId}/imports`, or the API below, when a workspace owner has an export they are authorized to analyze. The screen stages normalized rows and starts the durable production collection workflow in one idempotent request; it shows batch metadata only and links to the private collection inspection page after a run is consumed.

`POST /api/workspaces/{workspaceId}/imports`

```json
{
  "campaignId": "campaign:acme-support",
  "filename": "support-export.csv",
  "format": "csv",
  "content": "source_record_id,text,captured_at\nticket-1,The handoff history disappears,2026-08-01",
  "idempotencyKey": "owner-import-2026-08-03-001",
  "authorizationAttested": true
}
```

The campaign must be private, non-fixture, and explicitly include `manual-owner-import` with excerpt display mode. New collection uses the reviewed `manual-owner-import-v3` snapshot; `manual-owner-import-v1` and `manual-owner-import-v2` remain readable only for historical batches. The body is bounded to 2 MiB; the normalized batch is bounded to 5,000 records and the campaign source-item budget. The route admits the durable workflow start before persisting normalized rows, so rate- or concurrency-rejected requests do not create staged payloads. If bounded staging fails, a newly admitted still-reserved row is released through the authenticated database function; an idempotent replay is not released. If Temporal startup fails after staging, the reservation remains protected by the server-owned five-minute TTL and maintenance purge, because the start outcome may be uncertain. A successful response contains the private batch model, workflow ID, run ID, and hashes. Reuse the same idempotency key to safely retry a response lost after staging.

The campaign `dateRange` is inclusive. During collection, records are filtered
by `published_at` when supplied and otherwise by normalized `captured_at`, then
the source-item limit is applied. The worker reads the bounded staged batch
before filtering so late in-range rows are not hidden by an early out-of-range
row. The result keeps a coverage warning for filtered rows and never treats
records outside the window as deletion evidence.

For competitor or weak-market work, use a campaign purpose of
`competitor-research` or `contrary-evidence`, then create a private evidence
observation from the Competitors route. The observation keeps source-item and
evidence identifiers, starts `unreviewed`, and must be confirmed by an editor
or owner before it can contribute to source-backed research. This remains
tenant-private owner-authorized evidence, not public coverage.

After an observation is confirmed, rerun the reviewed production analysis
explicitly for the collection run to refresh the report and coding plan. The
worker includes only the current confirmed evidence-linked snapshot; it keeps
observation/evidence hashes and source identifiers in migration `0104` lineage
and fails closed if review, deletion, source policy, competitor relation, or
collection membership changed. This is not an automatic refresh and does not
change the reviewed seed score. The report and plan keep the tenant-private
scope and remaining coverage gaps visible.

Supported columns/keys are `source_record_id` (or `id`), `canonical_locator` (or `url`/`link`), `captured_at`, `published_at`, `query`, `product`, `company`, `feature`, `category`, `text` (or `complaint`/`body`/`message`), `language`, and optional opaque `author_key`/`author_id`/`author_fingerprint`. JSON may be an array or `{ "records": [] }`. Author keys require the workspace namespace, are hashed before staging, and are never returned as raw identity.

Inspect batches with `GET /api/workspaces/{workspaceId}/imports` or `GET /api/workspaces/{workspaceId}/imports/{batchId}`. Delete with the owner-only `DELETE` endpoint. Deletion is idempotent, records immediately due retryable source tombstones, and returns the number of tombstones recorded. Do not treat an owner export as broad public coverage, and do not paste secrets or unredacted personal data into an import.
