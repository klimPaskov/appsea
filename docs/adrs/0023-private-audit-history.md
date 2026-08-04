# ADR 0023: private audit history projection

Status: accepted

## Context

AppSea already records identifier-only audit events for membership, source,
workflow, evidence, report, plan, agent-token, and workspace lifecycle
changes. Operators and private workspace members had no authenticated way to
inspect that immutable ledger. Directly returning JSONB metadata would also
make future untrusted or nested values too easy to expose.

## Decision

Expose a read-only `GET /api/workspaces/:workspaceId/audit-events` projection
through `PostgresAuditEventRepository`. Every read uses the authenticated
workspace transaction, forced RLS, a bounded limit, and an opaque cursor over
PostgreSQL `occurred_at` plus `audit_event_id`. The contract returns only
bounded identifiers, actor/action/target fields, and scalar metadata. The
repository filters nested or oversized metadata rather than returning it.

Migration `0098_audit_event_history_index.sql` adds the matching
`(workspace_id, occurred_at DESC, audit_event_id ASC)` index. It changes no
retention, deletion, or write permissions.

## Consequences

- Private members can inspect durable security and research receipts without
  direct table access or raw source payloads.
- Pagination is stable under equal timestamps and cannot cross workspace
  boundaries because the cursor is decoded inside the workspace transaction.
- The projection is not an export or destructive-retention workflow. Provider,
  backup, and workspace purge controls remain separate release gates.
- No public leaderboard or third-party source behavior changes.
