-- Plan packages are a separate private governance boundary from reports.
-- A plan may be reviewed by an editor, approved by an owner, and withdrawn
-- by an owner. Production packages remain object-backed; fixture packages may
-- continue to use their inline file representation.

ALTER TABLE appsea.plan_package_versions
  ADD CONSTRAINT plan_package_object_ref_format CHECK (
    package_object_ref IS NULL
    OR package_object_ref ~ '^appsea-object://[a-z][a-z0-9_:-]*/plan-package/[a-f0-9]{64}$'
    OR (
      deletion_state <> 'active'
      AND NOT synthetic
      AND package_object_ref ~ '^deleted:[a-z][a-z0-9_:-]{2,159}$'
    )
  );

ALTER TABLE appsea.plan_package_versions
  ADD CONSTRAINT plan_package_non_synthetic_object_check CHECK (
    synthetic OR package_object_ref IS NOT NULL
  );

CREATE OR REPLACE FUNCTION appsea.enforce_plan_approval_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  actor_role text;
  report_state text;
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
    RAISE EXCEPTION 'deleted plans cannot change approval state'
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
    RAISE EXCEPTION 'plan approval requires a workspace member actor'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.approval_state = 'reviewed'
     AND OLD.approval_state = 'unreviewed'
     AND actor_role IN ('owner', 'editor') THEN
    event_action := 'plan.reviewed';
  ELSIF NEW.approval_state = 'approved'
     AND OLD.approval_state = 'reviewed'
     AND actor_role = 'owner' THEN
    IF NEW.readiness_state <> 'ready' THEN
      RAISE EXCEPTION 'only ready plans can be approved'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.report_id IS NOT NULL THEN
      SELECT approval_state
        INTO report_state
        FROM appsea.report_versions
       WHERE workspace_id = NEW.workspace_id
         AND report_id = NEW.report_id;
      IF report_state IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'the linked report must be approved before the plan'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    event_action := 'plan.approved';
  ELSIF NEW.approval_state = 'withdrawn'
     AND OLD.approval_state IN ('unreviewed', 'reviewed', 'approved')
     AND actor_role = 'owner' THEN
    event_action := 'plan.withdrawn';
  ELSE
    RAISE EXCEPTION 'plan approval transition is not permitted'
      USING ERRCODE = '23514';
  END IF;

  event_id := 'plan-approval:' || md5(
    concat_ws(
      ':',
      NEW.workspace_id,
      NEW.plan_package_id,
      OLD.approval_state,
      NEW.approval_state,
      txid_current()::text
    )
  );
  payload := jsonb_build_object(
    'workspaceId', NEW.workspace_id,
    'planPackageId', NEW.plan_package_id,
    'opportunityId', NEW.opportunity_id,
    'previousState', OLD.approval_state,
    'nextState', NEW.approval_state
  );

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (NEW.workspace_id, 'audit:' || event_id, 'user', actor_id, event_action,
     'plan_package', NEW.plan_package_id, event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (NEW.workspace_id, 'outbox:' || event_id, event_action, 'plan_package',
     NEW.plan_package_id, 'plan-approval-v1', event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$$;

CREATE TRIGGER plan_approval_transition_guard
BEFORE UPDATE OF approval_state ON appsea.plan_package_versions
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_plan_approval_transition();

REVOKE ALL ON FUNCTION appsea.enforce_plan_approval_transition() FROM PUBLIC;
GRANT UPDATE (approval_state) ON appsea.plan_package_versions TO appsea_service;
