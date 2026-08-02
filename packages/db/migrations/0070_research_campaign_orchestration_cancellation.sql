BEGIN;

-- Cancellation is a durable user intent, not an optimistic Temporal side
-- effect.  A request survives a web/worker crash and prevents new child
-- dispatches while the worker retries cancellation of already-started child
-- workflows.  The request is intentionally separate from terminal state:
-- state becomes canceled only after child reconciliation observes a safe
-- terminal boundary.
ALTER TABLE appsea.research_campaign_orchestrations
  ADD COLUMN cancellation_requested_at timestamptz,
  ADD COLUMN cancellation_requested_by text,
  ADD COLUMN cancellation_request_id text,
  ADD CONSTRAINT research_campaign_orchestration_cancellation_fields_check
    CHECK (
      (cancellation_requested_at IS NULL
        AND cancellation_requested_by IS NULL
        AND cancellation_request_id IS NULL)
      OR (
        cancellation_requested_at IS NOT NULL
        AND cancellation_requested_by IS NOT NULL
        AND cancellation_request_id IS NOT NULL
      )
    ),
  ADD CONSTRAINT research_campaign_orchestration_cancellation_actor_check
    CHECK (
      cancellation_requested_by IS NULL
      OR cancellation_requested_by ~ '^[a-z][a-z0-9_:-]{2,159}$'
    ),
  ADD CONSTRAINT research_campaign_orchestration_cancellation_id_check
    CHECK (
      cancellation_request_id IS NULL
      OR cancellation_request_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
    ),
  ADD CONSTRAINT research_campaign_orchestration_cancellation_time_check
    CHECK (
      cancellation_requested_at IS NULL
      OR cancellation_requested_at >= requested_at
    );

CREATE INDEX research_campaign_orchestration_cancellation_idx
  ON appsea.research_campaign_orchestrations (workspace_id, cancellation_requested_at)
  WHERE cancellation_requested_at IS NOT NULL
    AND state IN ('queued', 'running');

CREATE OR REPLACE FUNCTION appsea.enforce_research_campaign_orchestration_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  authenticated_user text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  service_principal text := NULLIF(current_setting('appsea.service_principal', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.cancellation_requested_at IS NOT NULL AND (
    NEW.cancellation_requested_at IS DISTINCT FROM OLD.cancellation_requested_at
    OR NEW.cancellation_requested_by IS DISTINCT FROM OLD.cancellation_requested_by
    OR NEW.cancellation_request_id IS DISTINCT FROM OLD.cancellation_request_id
  ) THEN
    RAISE EXCEPTION 'campaign orchestration cancellation request is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.cancellation_requested_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.cancellation_requested_at IS NULL) THEN
    IF authenticated_user IS NULL
       OR service_principal IS NOT NULL
       OR NEW.cancellation_requested_by IS DISTINCT FROM authenticated_user
       OR NOT EXISTS (
         SELECT 1
           FROM appsea.workspace_memberships membership
           JOIN appsea.workspaces workspace
             ON workspace.workspace_id = membership.workspace_id
          WHERE membership.workspace_id = NEW.workspace_id
            AND membership.user_id = authenticated_user
            AND membership.role IN ('owner', 'editor')
            AND workspace.status = 'active'
            AND workspace.visibility = 'private'
            AND workspace.fixture_only = false
       ) THEN
      RAISE EXCEPTION 'campaign orchestration cancellation requires an owner or editor'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.state IN ('completed', 'partial', 'failed', 'canceled') THEN
      RAISE EXCEPTION 'terminal campaign orchestration cannot accept cancellation'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER research_campaign_orchestration_cancellation_guard
BEFORE INSERT OR UPDATE ON appsea.research_campaign_orchestrations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_research_campaign_orchestration_cancellation();

REVOKE ALL ON FUNCTION appsea.enforce_research_campaign_orchestration_cancellation() FROM PUBLIC;

GRANT UPDATE (
  cancellation_requested_at, cancellation_requested_by, cancellation_request_id
) ON appsea.research_campaign_orchestrations TO appsea_service;

COMMIT;
