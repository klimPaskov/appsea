# Manual import runbook

Use the private workspace API when a workspace owner has an export they are authorized to analyze. The endpoint stages normalized rows and starts the durable production collection workflow in one idempotent request.

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

The campaign must be private, non-fixture, and explicitly include `manual-owner-import` with excerpt display mode. The body is bounded to 2 MiB; the normalized batch is bounded to 5,000 records and the campaign source-item budget. A successful response contains the private batch model, workflow ID, run ID, and hashes. Reuse the same idempotency key to safely retry a response lost after staging.

Supported columns/keys are `source_record_id` (or `id`), `canonical_locator` (or `url`/`link`), `captured_at`, `published_at`, `query`, `product`, `company`, `feature`, `category`, `text` (or `complaint`/`body`/`message`), and `language`. JSON may be an array or `{ "records": [] }`.

Inspect batches with `GET /api/workspaces/{workspaceId}/imports` or `GET /api/workspaces/{workspaceId}/imports/{batchId}`. Delete with the owner-only `DELETE` endpoint. Deletion is idempotent and returns the number of source tombstones recorded. Do not treat an owner export as broad public coverage, and do not paste secrets or unredacted personal data into an import.
