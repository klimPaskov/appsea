-- Report approval is a private-workspace governance boundary. The application
-- checks role and transition order for clear errors; this trigger is the
-- database second line of defense and records an identifier-only receipt.
CREATE OR REPLACE FUNCTION appsea.enforce_report_approval_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  actor_role text;
  event_action text;
  event_id text;
  payload jsonb;
BEGIN
  -- Migrations and disposable fixture setup may repair rows without a user
  -- actor. Runtime writes always use appsea_service.
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_state IS NOT DISTINCT FROM OLD.approval_state THEN
    RETURN NEW;
  END IF;

  IF OLD.deletion_state <> 'active' OR NEW.deletion_state <> 'active' THEN
    RAISE EXCEPTION 'deleted reports cannot change approval state'
      USING ERRCODE = '23514';
  END IF;

  actor_id := NULLIF(current_setting('appsea.auth_user_id', true), '');
  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
    JOIN appsea.workspaces workspace
      ON workspace.workspace_id = membership.workspace_id
   WHERE membership.workspace_id = NEW.workspace_id
     AND membership.user_id = actor_id
     AND workspace.status = 'active';

  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'report approval requires a workspace member actor'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.approval_state = 'reviewed'
     AND OLD.approval_state = 'draft'
     AND actor_role IN ('owner', 'editor') THEN
    event_action := 'report.reviewed';
  ELSIF NEW.approval_state = 'approved'
     AND OLD.approval_state = 'reviewed'
     AND actor_role = 'owner' THEN
    event_action := 'report.approved';
  ELSIF NEW.approval_state = 'withdrawn'
     AND OLD.approval_state IN ('draft', 'reviewed', 'approved')
     AND actor_role = 'owner' THEN
    event_action := 'report.withdrawn';
  ELSE
    RAISE EXCEPTION 'report approval transition is not permitted'
      USING ERRCODE = '23514';
  END IF;

  event_id := 'report-approval:' || md5(
    concat_ws(
      ':',
      NEW.workspace_id,
      NEW.report_id,
      OLD.approval_state,
      NEW.approval_state,
      txid_current()::text
    )
  );
  payload := jsonb_build_object(
    'workspaceId', NEW.workspace_id,
    'reportId', NEW.report_id,
    'opportunityId', NEW.opportunity_id,
    'previousState', OLD.approval_state,
    'nextState', NEW.approval_state
  );

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (NEW.workspace_id, 'audit:' || event_id, 'user', actor_id, event_action,
     'report', NEW.report_id, event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (NEW.workspace_id, 'outbox:' || event_id, event_action, 'report',
     NEW.report_id, 'report-approval-v1', event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$$;

CREATE TRIGGER report_approval_transition_guard
BEFORE UPDATE OF approval_state ON appsea.report_versions
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_report_approval_transition();

REVOKE ALL ON FUNCTION appsea.enforce_report_approval_transition() FROM PUBLIC;
GRANT UPDATE (approval_state) ON appsea.report_versions TO appsea_service;
