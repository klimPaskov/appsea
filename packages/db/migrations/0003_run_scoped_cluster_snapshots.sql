ALTER TABLE appsea.complaint_cluster_versions
  DROP CONSTRAINT complaint_cluster_versions_workspace_id_cluster_id_cluster__key;

ALTER TABLE appsea.complaint_cluster_versions
  ADD CONSTRAINT complaint_cluster_versions_run_snapshot_unique
  UNIQUE (workspace_id, run_id, cluster_id, cluster_version, input_hash);

