-- Workspace membership administration stays behind the private workspace
-- boundary. The web repository performs the user-facing authorization check;
-- this trigger is a second line of defense for the shared runtime role and
-- emits the durable audit/outbox receipt for every runtime membership change.
CREATE OR REPLACE FUNCTION appsea.enforce_workspace_membership_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  actor_id text;
  target_workspace_id text;
  target_user_id text;
  previous_role text;
  next_role text;
  event_action text;
  event_id text;
  payload jsonb;
  owner_count integer;
BEGIN
  -- The migration owner is used only for migrations and disposable database
  -- setup. It must be able to repair rows without pretending to be a user.
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  target_workspace_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.workspace_id ELSE OLD.workspace_id END;
  target_user_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id ELSE OLD.user_id END;

  IF TG_OP = 'UPDATE'
     AND (
       NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
     ) THEN
    RAISE EXCEPTION 'workspace membership identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  -- Serialize owner-count checks per workspace so concurrent owner actions
  -- cannot both observe the same last-owner state and remove all owners.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('workspace-membership:' || target_workspace_id, 0)
  );

  actor_id := NULLIF(current_setting('appsea.auth_user_id', true), '');
  IF NOT (
    TG_OP = 'INSERT'
    AND actor_id IS NOT NULL
    AND NEW.user_id = actor_id
    AND NEW.role = 'owner'
    AND NOT EXISTS (
      SELECT 1
        FROM appsea.workspace_memberships membership
       WHERE membership.workspace_id = target_workspace_id
    )
    AND EXISTS (
      SELECT 1
        FROM appsea.workspaces workspace
       WHERE workspace.workspace_id = target_workspace_id
         AND workspace.status = 'active'
    )
  ) THEN
    IF actor_id IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM appsea.workspace_memberships actor_membership
           JOIN appsea.workspaces workspace
             ON workspace.workspace_id = actor_membership.workspace_id
          WHERE actor_membership.workspace_id = target_workspace_id
            AND actor_membership.user_id = actor_id
            AND actor_membership.role = 'owner'
            AND workspace.status = 'active'
       ) THEN
      RAISE EXCEPTION 'workspace membership administration requires an owner actor'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP <> 'INSERT'
     AND OLD.role = 'owner'
     AND (
       (TG_OP = 'UPDATE' AND NEW.role <> 'owner')
       OR TG_OP = 'DELETE'
     ) THEN
    SELECT count(*) INTO owner_count
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = target_workspace_id
       AND membership.role = 'owner';
    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'workspace must retain an owner'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    event_action := 'workspace.membership.created';
    previous_role := NULL;
    next_role := NEW.role;
  ELSIF TG_OP = 'UPDATE' THEN
    event_action := 'workspace.membership.role_changed';
    previous_role := OLD.role;
    next_role := NEW.role;
  ELSE
    event_action := 'workspace.membership.removed';
    previous_role := OLD.role;
    next_role := NULL;
  END IF;

  event_id := 'membership:' || md5(
    concat_ws(
      ':',
      target_workspace_id,
      target_user_id,
      event_action,
      coalesce(previous_role, '<none>'),
      coalesce(next_role, '<deleted>'),
      txid_current()::text
    )
  );
  payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'userId', target_user_id,
    'previousRole', previous_role,
    'nextRole', next_role
  );
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (target_workspace_id, 'audit:' || event_id, 'user', actor_id, event_action,
     'workspace_membership', target_user_id, event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;
  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (target_workspace_id, 'outbox:' || event_id, event_action, 'workspace_membership',
     target_user_id, 'workspace-membership-v1', event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION appsea.enforce_workspace_owner_presence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  scoped_workspace_id text;
BEGIN
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    RETURN NULL;
  END IF;
  scoped_workspace_id := appsea.current_workspace_id();
  IF scoped_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = scoped_workspace_id
       AND membership.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'workspace must retain an owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER workspace_membership_admin_guard
BEFORE INSERT OR UPDATE OR DELETE ON appsea.workspace_memberships
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_workspace_membership_admin();

CREATE TRIGGER workspace_membership_owner_presence_guard
AFTER INSERT OR UPDATE OR DELETE ON appsea.workspace_memberships
FOR EACH STATEMENT EXECUTE FUNCTION appsea.enforce_workspace_owner_presence();

REVOKE ALL ON FUNCTION appsea.enforce_workspace_membership_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_workspace_owner_presence() FROM PUBLIC;
GRANT UPDATE (role, updated_at) ON appsea.workspace_memberships TO appsea_service;
