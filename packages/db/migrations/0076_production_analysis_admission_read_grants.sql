-- Admission decisions are written through the security-definer functions, but
-- authenticated workspace callers still need to inspect their own durable
-- replay state. RLS keeps these reads tenant-scoped.
GRANT SELECT ON appsea.production_analysis_workflow_start_buckets,
  appsea.production_analysis_workflow_admissions TO appsea_service;
