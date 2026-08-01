-- Keep private workspace cost summaries bounded by the workspace/time scan.
-- The ledger remains immutable history; this is only a read-path index.

CREATE INDEX cost_ledger_entries_workspace_recorded_idx
  ON appsea.cost_ledger_entries (workspace_id, recorded_at, currency, cost_type);
