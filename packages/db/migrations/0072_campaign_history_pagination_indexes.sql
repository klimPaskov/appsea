-- Keep private campaign history cursor scans bounded as production run volume grows.
CREATE INDEX research_campaign_orchestrations_campaign_history_idx
  ON appsea.research_campaign_orchestrations
     (workspace_id, campaign_id, requested_at DESC, orchestration_id);

CREATE INDEX production_collection_workflow_jobs_campaign_history_idx
  ON appsea.production_collection_workflow_jobs
     (workspace_id, campaign_id, requested_at DESC, workflow_id);
