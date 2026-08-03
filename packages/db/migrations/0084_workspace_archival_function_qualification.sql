-- PostgreSQL 18 resolves the RETURNS TABLE workspace_id output variable
-- against unqualified UPDATE predicates in the archival function. Recreate
-- the already-shipped function with table aliases at every workspace boundary
-- so owner archival remains executable for purge-manifest preparation.

CREATE OR REPLACE FUNCTION appsea.archive_workspace(
  p_workspace_id text,
  p_actor_id text
)
RETURNS TABLE(
  workspace_id text,
  state text,
  archived_at timestamptz,
  active_work_count integer,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_state text;
  current_archived_at timestamptz;
  actor_role text;
  active_count bigint;
  archive_time timestamptz;
  event_suffix text;
BEGIN
  IF p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR NULLIF(current_setting('appsea.auth_user_id', true), '') IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'workspace archival requires the authenticated account'
      USING ERRCODE = '42501';
  END IF;

  SELECT workspace.status, workspace.archived_at
    INTO current_state, current_archived_at
    FROM appsea.workspaces workspace
   WHERE workspace.workspace_id = p_workspace_id
   FOR UPDATE;

  IF current_state IS NULL THEN
    RAISE EXCEPTION 'workspace archival target was not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = p_actor_id
   FOR SHARE;

  IF actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'workspace archival requires an owner'
      USING ERRCODE = '42501';
  END IF;

  IF current_state = 'archived' THEN
    RETURN QUERY
      SELECT p_workspace_id, 'archived', current_archived_at, 0, true;
    RETURN;
  END IF;

  IF current_state <> 'active' THEN
    RAISE EXCEPTION 'workspace archival requires an active workspace'
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
  ) INTO active_count;

  IF active_count > 0 THEN
    RETURN QUERY
      SELECT p_workspace_id, 'blocked', NULL::timestamptz, active_count::integer, false;
    RETURN;
  END IF;

  archive_time := clock_timestamp();
  event_suffix := md5(p_workspace_id || ':' || p_actor_id || ':' || archive_time::text);

  UPDATE appsea.workspaces AS workspace
     SET status = 'archived',
         archived_at = archive_time,
         updated_at = archive_time
   WHERE workspace.workspace_id = p_workspace_id;

  UPDATE appsea.research_campaigns AS campaign
     SET state = 'archived',
         refresh_next_due_at = NULL,
         refresh_claim_owner = NULL,
         refresh_claim_token = NULL,
         refresh_claim_until = NULL,
         refresh_pending_due_at = NULL,
         refresh_pending_run_id = NULL,
         refresh_pending_workflow_id = NULL,
         refresh_pending_idempotency_digest = NULL,
         refresh_pending_input_hash = NULL,
         refresh_pending_request = NULL,
         refresh_updated_at = archive_time,
         updated_at = archive_time
   WHERE campaign.workspace_id = p_workspace_id
     AND campaign.state <> 'archived';

  UPDATE appsea.workspace_invitations AS invitation
     SET state = 'revoked',
         revoked_at = archive_time
   WHERE invitation.workspace_id = p_workspace_id
     AND invitation.state = 'pending';

  UPDATE appsea.workspace_invitation_deliveries AS delivery
     SET state = 'discarded',
         lease_started_at = NULL
   WHERE delivery.workspace_id = p_workspace_id
     AND delivery.state IN ('pending', 'sending', 'failed')
     AND EXISTS (
       SELECT 1
         FROM appsea.workspace_invitations invitation
        WHERE invitation.invitation_id = delivery.invitation_id
          AND invitation.state = 'revoked'
     );

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action,
     target_type, target_id, correlation_id, metadata, occurred_at)
  VALUES
    (p_workspace_id, 'audit:workspace-archived:' || event_suffix, 'user', p_actor_id,
     'workspace.archived', 'workspace', p_workspace_id,
     'workspace-archive:' || event_suffix,
     jsonb_build_object('researchLineage', 'retained', 'destructivePurge', 'not_requested'),
     archive_time);

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, causation_id, payload, occurred_at)
  VALUES
    (p_workspace_id, 'outbox:workspace-archived:' || event_suffix,
     'workspace.archived', 'workspace', p_workspace_id, 'workspace-archive-v1',
     'workspace-archive:' || event_suffix, 'audit:workspace-archived:' || event_suffix,
     jsonb_build_object('workspaceId', p_workspace_id, 'archivedAt', archive_time,
       'researchLineage', 'retained'), archive_time);

  RETURN QUERY
    SELECT p_workspace_id, 'archived', archive_time, 0, false;
END
$$;

REVOKE ALL ON FUNCTION appsea.archive_workspace(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.archive_workspace(text, text) TO appsea_service;
