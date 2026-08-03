BEGIN;

-- A purge intent is a durable, owner-confirmed handoff to the separately
-- operated object-store/export/backup retention controls. It is deliberately
-- not a deletion queue: this table cannot authorize destructive work by
-- itself, and a request remains awaiting_external_controls until an approved
-- provider boundary exists.
CREATE TABLE appsea.workspace_purge_requests (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  request_id text NOT NULL CHECK (
    request_id ~ '^workspace-purge:[a-f0-9]{32}$'
  ),
  requested_by text NOT NULL REFERENCES appsea.users(user_id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('awaiting_external_controls', 'canceled')),
  readiness_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(readiness_snapshot) = 'object'
    AND readiness_snapshot->>'workspaceId' = workspace_id
    AND readiness_snapshot->>'state' = 'database_ready'
  ),
  requested_at timestamptz NOT NULL,
  canceled_at timestamptz,
  PRIMARY KEY (workspace_id, request_id),
  CHECK ((state = 'canceled') = (canceled_at IS NOT NULL))
);

CREATE UNIQUE INDEX workspace_purge_requests_active_idx
  ON appsea.workspace_purge_requests (workspace_id)
  WHERE state = 'awaiting_external_controls';

CREATE INDEX workspace_purge_requests_history_idx
  ON appsea.workspace_purge_requests (workspace_id, requested_at DESC, request_id);

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
    blockers := blockers || 'workspace_not_archived';
  END IF;
  IF active_work_count > 0 THEN
    blockers := blockers || 'active_work';
  END IF;
  IF raw_source_object_reference_count > 0 THEN
    blockers := blockers || 'raw_source_objects';
  END IF;
  IF analysis_object_reference_count > 0 THEN
    blockers := blockers || 'analysis_objects';
  END IF;
  IF report_object_reference_count > 0 THEN
    blockers := blockers || 'report_objects';
  END IF;
  IF plan_object_reference_count > 0 THEN
    blockers := blockers || 'plan_objects';
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

CREATE OR REPLACE FUNCTION appsea.cancel_workspace_purge(
  p_workspace_id text,
  p_actor_id text,
  p_request_id text
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
  actor_role text;
  request_row appsea.workspace_purge_requests%ROWTYPE;
  canceled_at_value timestamptz;
  event_suffix text;
BEGIN
  IF p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_request_id !~ '^workspace-purge:[a-f0-9]{32}$'
     OR NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'workspace purge cancellation requires the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = p_actor_id
   FOR SHARE;
  IF actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'workspace purge cancellation requires an owner'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.*
    INTO request_row
    FROM appsea.workspace_purge_requests request
   WHERE request.workspace_id = p_workspace_id
     AND request.request_id = p_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace purge request was not found'
      USING ERRCODE = '42501';
  END IF;

  IF request_row.state = 'canceled' THEN
    RETURN QUERY SELECT
      request_row.workspace_id,
      request_row.request_id,
      request_row.state,
      request_row.requested_at,
      request_row.canceled_at,
      request_row.readiness_snapshot,
      true;
    RETURN;
  END IF;

  canceled_at_value := clock_timestamp();
  UPDATE appsea.workspace_purge_requests
     SET state = 'canceled', canceled_at = canceled_at_value
   WHERE workspace_id = p_workspace_id
     AND request_id = p_request_id;

  event_suffix := md5(p_request_id || ':' || p_actor_id || ':' || canceled_at_value::text);
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action,
     target_type, target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id, 'audit:workspace-purge-canceled:' || event_suffix, 'user', p_actor_id,
     'workspace.purge_canceled', 'workspace_purge_request', p_request_id,
     'workspace-purge:' || event_suffix,
     jsonb_build_object('workspaceId', p_workspace_id, 'requestId', p_request_id),
     canceled_at_value)
  ON CONFLICT DO NOTHING;
  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, causation_id, payload, occurred_at)
  VALUES
    (p_workspace_id, 'outbox:workspace-purge-canceled:' || event_suffix,
     'workspace.purge_canceled', 'workspace_purge_request', p_request_id,
     'workspace-purge-v1', 'workspace-purge:' || event_suffix,
     'audit:workspace-purge-canceled:' || event_suffix,
     jsonb_build_object('workspaceId', p_workspace_id, 'requestId', p_request_id,
       'state', 'canceled'), canceled_at_value)
  ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT
    request_row.workspace_id,
    request_row.request_id,
    'canceled',
    request_row.requested_at,
    canceled_at_value,
    request_row.readiness_snapshot,
    false;
END
$$;

ALTER TABLE appsea.workspace_purge_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.workspace_purge_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.workspace_purge_requests
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

REVOKE ALL ON appsea.workspace_purge_requests FROM PUBLIC, appsea_service;
GRANT SELECT ON appsea.workspace_purge_requests TO appsea_service;
REVOKE ALL ON FUNCTION appsea.request_workspace_purge(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.cancel_workspace_purge(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.request_workspace_purge(text, text) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.cancel_workspace_purge(text, text, text) TO appsea_service;

COMMIT;
