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

The campaign must be private, non-fixture, and explicitly include `manual-owner-import` with excerpt display mode. New collection uses the reviewed `manual-owner-import-v2` snapshot; `manual-owner-import-v1` remains readable only for historical batches. The body is bounded to 2 MiB; the normalized batch is bounded to 5,000 records and the campaign source-item budget. A successful response contains the private batch model, workflow ID, run ID, and hashes. Reuse the same idempotency key to safely retry a response lost after staging.

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

Supported columns/keys are `source_record_id` (or `id`), `canonical_locator` (or `url`/`link`), `captured_at`, `published_at`, `query`, `product`, `company`, `feature`, `category`, `text` (or `complaint`/`body`/`message`), and `language`. JSON may be an array or `{ "records": [] }`.

Inspect batches with `GET /api/workspaces/{workspaceId}/imports` or `GET /api/workspaces/{workspaceId}/imports/{batchId}`. Delete with the owner-only `DELETE` endpoint. Deletion is idempotent, records immediately due retryable source tombstones, and returns the number of tombstones recorded. Do not treat an owner export as broad public coverage, and do not paste secrets or unredacted personal data into an import.
