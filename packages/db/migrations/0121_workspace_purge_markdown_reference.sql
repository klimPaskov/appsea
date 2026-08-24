BEGIN;

-- Keep the owner-confirmed purge gate in lockstep with the complete analysis
-- output set. Migration 0120 added a durable report-Markdown reference to
-- production analysis runs; this forward replacement prevents that reference
-- from being omitted when a purge request is evaluated directly in PostgreSQL.
CREATE OR REPLACE FUNCTION appsea.request_workspace_purge(
  p_workspace_id text,
  p_actor_id text
)
RETURNS TABLE(
  workspace_id text,
  request_id text,
  state text,
  requested_at timestamptz,
  canceled_at timestamptz,
  readiness_snapshot jsonb,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  workspace_row appsea.workspaces%ROWTYPE;
  actor_role text;
  active_work_count bigint;
  raw_source_object_reference_count bigint;
  analysis_object_reference_count bigint;
  report_object_reference_count bigint;
  plan_object_reference_count bigint;
  blockers text[] := ARRAY[]::text[];
  checked_at timestamptz := clock_timestamp();
  readiness jsonb;
  existing_request appsea.workspace_purge_requests%ROWTYPE;
  generated_request_id text;
  event_suffix text;
BEGIN
  IF p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'workspace purge request requires the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO workspace_row
    FROM appsea.workspaces workspace
   WHERE workspace.workspace_id = p_workspace_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace purge request target was not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = p_actor_id
   FOR SHARE;
  IF actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'workspace purge request requires an owner'
      USING ERRCODE = '42501';
  END IF;

  SELECT LEAST(
    2147483647::bigint,
    (SELECT count(*) FROM appsea.workflow_job_executions workflow_execution
      WHERE workflow_execution.workspace_id = p_workspace_id
        AND workflow_execution.state IN ('queued', 'running'))
    + (SELECT count(*) FROM appsea.research_runs run
      WHERE run.workspace_id = p_workspace_id
        AND run.state IN ('queued', 'running', 'paused'))
    + (SELECT count(*) FROM appsea.production_collection_workflow_jobs workflow
      WHERE workflow.workspace_id = p_workspace_id
        AND workflow.state IN ('queued', 'running'))
    + (SELECT count(*) FROM appsea.production_analysis_runs analysis
      WHERE analysis.workspace_id = p_workspace_id
        AND analysis.state IN ('queued', 'running'))
    + (SELECT count(*) FROM appsea.production_analysis_handoffs handoff
      WHERE handoff.workspace_id = p_workspace_id
        AND handoff.state IN ('queued', 'dispatching', 'started'))
    + (SELECT count(*) FROM appsea.production_analysis_recompute_jobs recompute
      WHERE recompute.workspace_id = p_workspace_id
        AND recompute.state IN ('queued', 'dispatching', 'started'))
    + (SELECT count(*) FROM appsea.source_snapshot_reconciliation_jobs snapshot
      WHERE snapshot.workspace_id = p_workspace_id
        AND snapshot.state IN ('queued', 'running'))
    + (SELECT count(*) FROM appsea.source_collection_leases lease
      WHERE lease.workspace_id = p_workspace_id
        AND lease.state = 'active')
  ) INTO active_work_count;

  SELECT count(*) INTO raw_source_object_reference_count
    FROM appsea.source_items source_item
   WHERE source_item.workspace_id = p_workspace_id
     AND source_item.raw_object_ref IS NOT NULL;
  SELECT count(*) INTO analysis_object_reference_count
    FROM appsea.production_analysis_runs analysis
   WHERE analysis.workspace_id = p_workspace_id
     AND (analysis.artifact_object_ref IS NOT NULL
       OR analysis.report_object_ref IS NOT NULL
       OR analysis.report_markdown_object_ref IS NOT NULL
       OR analysis.plan_object_ref IS NOT NULL);
  SELECT count(*) INTO report_object_reference_count
    FROM appsea.report_versions report
   WHERE report.workspace_id = p_workspace_id
     AND (report.structured_object_ref IS NOT NULL
       OR report.markdown_object_ref IS NOT NULL);
  SELECT count(*) INTO plan_object_reference_count
    FROM appsea.plan_package_versions plan
   WHERE plan.workspace_id = p_workspace_id
     AND plan.package_object_ref IS NOT NULL;

  IF workspace_row.archived_at IS NULL THEN
    blockers := blockers || ARRAY['workspace_not_archived'];
  END IF;
  IF active_work_count > 0 THEN
    blockers := blockers || ARRAY['active_work'];
  END IF;
  IF raw_source_object_reference_count > 0 THEN
    blockers := blockers || ARRAY['raw_source_objects'];
  END IF;
  IF analysis_object_reference_count > 0 THEN
    blockers := blockers || ARRAY['analysis_objects'];
  END IF;
  IF report_object_reference_count > 0 THEN
    blockers := blockers || ARRAY['report_objects'];
  END IF;
  IF plan_object_reference_count > 0 THEN
    blockers := blockers || ARRAY['plan_objects'];
  END IF;

  readiness := jsonb_build_object(
    'workspaceId', p_workspace_id,
    'state', CASE WHEN cardinality(blockers) = 0 THEN 'database_ready' ELSE 'blocked' END,
    'archivedAt', workspace_row.archived_at,
    'activeWorkCount', active_work_count,
    'rawSourceObjectReferenceCount', raw_source_object_reference_count,
    'analysisObjectReferenceCount', analysis_object_reference_count,
    'reportObjectReferenceCount', report_object_reference_count,
    'planObjectReferenceCount', plan_object_reference_count,
    'blockers', to_jsonb(blockers),
    'externalRequirements', to_jsonb(ARRAY[
      'cloud_object_store_purge',
      'export_retention_purge',
      'backup_deletion_verification'
    ]::text[]),
    'checkedAt', checked_at
  );

  IF cardinality(blockers) > 0 THEN
    RETURN QUERY SELECT
      p_workspace_id,
      NULL::text,
      'blocked',
      NULL::timestamptz,
      NULL::timestamptz,
      readiness,
      false;
    RETURN;
  END IF;

  SELECT request.*
    INTO existing_request
    FROM appsea.workspace_purge_requests request
   WHERE request.workspace_id = p_workspace_id
     AND request.state = 'awaiting_external_controls'
   ORDER BY request.requested_at DESC, request.request_id DESC
   LIMIT 1
   FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT
      existing_request.workspace_id,
      existing_request.request_id,
      existing_request.state,
      existing_request.requested_at,
      existing_request.canceled_at,
      existing_request.readiness_snapshot,
      true;
    RETURN;
  END IF;

  generated_request_id := 'workspace-purge:' || md5(
    p_workspace_id || ':' || p_actor_id || ':' || checked_at::text
  );
  INSERT INTO appsea.workspace_purge_requests
    (workspace_id, request_id, requested_by, state, readiness_snapshot, requested_at)
  VALUES
    (p_workspace_id, generated_request_id, p_actor_id, 'awaiting_external_controls', readiness, checked_at);

  event_suffix := md5(generated_request_id || ':' || p_actor_id);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action,
     target_type, target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id, 'audit:workspace-purge-requested:' || event_suffix, 'user', p_actor_id,
     'workspace.purge_requested', 'workspace_purge_request', generated_request_id,
     'workspace-purge:' || event_suffix,
     jsonb_build_object('workspaceId', p_workspace_id, 'state', 'awaiting_external_controls',
       'externalRequirements', readiness->'externalRequirements'), checked_at)
  ON CONFLICT DO NOTHING;
  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, causation_id, payload, occurred_at)
  VALUES
    (p_workspace_id, 'outbox:workspace-purge-requested:' || event_suffix,
     'workspace.purge_requested', 'workspace_purge_request', generated_request_id,
     'workspace-purge-v1', 'workspace-purge:' || event_suffix,
     'audit:workspace-purge-requested:' || event_suffix,
     jsonb_build_object('workspaceId', p_workspace_id, 'requestId', generated_request_id,
       'state', 'awaiting_external_controls', 'readiness', readiness), checked_at)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT
    p_workspace_id,
    generated_request_id,
    'awaiting_external_controls',
    checked_at,
    NULL::timestamptz,
    readiness,
    false;
END
$$;

COMMENT ON FUNCTION appsea.request_workspace_purge(text, text) IS
  'Owner-confirmed purge gate including structured, Markdown, plan, and workflow output references.';

COMMIT;
