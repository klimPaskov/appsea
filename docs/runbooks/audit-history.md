# Private audit history

AppSea keeps immutable, identifier-only audit receipts in
`appsea.audit_events`. Authenticated members of a private workspace can read a
bounded projection through:

```text
GET /api/workspaces/:workspaceId/audit-events?limit=25&cursor=<opaque cursor>
```

The route requires the HttpOnly session and current workspace membership. It
returns events in descending PostgreSQL `occurred_at` order with a stable
`audit_event_id` tie-breaker. `limit` is bounded to 1–100; the cursor is
workspace-bound and must not be edited or reused across workspaces.

The response contains event identifiers, actor type/id, fixed action and target
labels, correlation identifiers, timestamps, and scalar metadata capped by the
shared contract. Nested metadata, source payloads, exception text, and token
secrets are not returned. A dependency failure is a fixed `503` response; a
malformed cursor or query is a fixed `400` response.

This is an inspection boundary only. It does not resolve alerts, export the
ledger, change retention, or delete research. Provider retention, backup
deletion, and destructive workspace purge remain separately reviewed
operations.
