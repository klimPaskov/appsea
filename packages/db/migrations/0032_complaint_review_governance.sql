-- Production complaint observations remain unreviewed until a workspace
-- editor or owner explicitly confirms or rejects them. The review transition
-- is separate from collection and analysis so no partial collection can be
-- published as a complete opportunity signal.

CREATE OR REPLACE FUNCTION appsea.enforce_complaint_review_transition()
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
  -- Migration and owner repair sessions may reconcile historical rows.
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    RETURN NEW;
  END IF;

  IF NEW.review_state IS NOT DISTINCT FROM OLD.review_state THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.evidence_records evidence
      JOIN appsea.source_items source_item
        ON source_item.workspace_id = evidence.workspace_id
       AND source_item.source_item_id = evidence.source_item_id
     WHERE evidence.workspace_id = NEW.workspace_id
       AND evidence.evidence_id = NEW.evidence_id
       AND evidence.deletion_state = 'active'
       AND source_item.deletion_state = 'active'
  ) THEN
    RAISE EXCEPTION 'deleted complaint evidence cannot be reviewed'
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

  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'complaint review requires an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.review_state = 'unreviewed'
     AND NEW.review_state IN ('confirmed', 'rejected') THEN
    event_action := CASE NEW.review_state
      WHEN 'confirmed' THEN 'complaint.review.confirmed'
      ELSE 'complaint.review.rejected'
    END;
  ELSIF OLD.review_state = 'confirmed' AND NEW.review_state = 'rejected' THEN
    event_action := 'complaint.review.rejected';
  ELSE
    RAISE EXCEPTION 'complaint review transition is not permitted'
      USING ERRCODE = '23514';
  END IF;

  event_id := 'complaint-review:' || md5(
    concat_ws(
      ':',
      NEW.workspace_id,
      NEW.complaint_id,
      OLD.review_state,
      NEW.review_state,
      txid_current()::text
    )
  );
  payload := jsonb_build_object(
    'workspaceId', NEW.workspace_id,
    'complaintId', NEW.complaint_id,
    'evidenceId', NEW.evidence_id,
    'previousState', OLD.review_state,
    'nextState', NEW.review_state
  );

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (NEW.workspace_id, 'audit:' || event_id, 'user', actor_id, event_action,
     'complaint_observation', NEW.complaint_id, event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (NEW.workspace_id, 'outbox:' || event_id, event_action, 'complaint_observation',
     NEW.complaint_id, 'complaint-review-v1', event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS complaint_review_transition_guard ON appsea.complaint_observations;
CREATE TRIGGER complaint_review_transition_guard
BEFORE UPDATE OF review_state ON appsea.complaint_observations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_complaint_review_transition();

REVOKE ALL ON FUNCTION appsea.enforce_complaint_review_transition() FROM PUBLIC;
GRANT UPDATE (review_state) ON appsea.complaint_observations TO appsea_service;
