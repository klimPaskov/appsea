-- Migration 0098: support bounded, descending private audit-history reads.
-- The audit ledger is already forced-RLS and runtime-selectable; this forward
-- index keeps workspace membership reads predictable without changing data or
-- granting any new write capability.

CREATE INDEX audit_events_workspace_history_idx
  ON appsea.audit_events (workspace_id, occurred_at DESC, audit_event_id ASC);
