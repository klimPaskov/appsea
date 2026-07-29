-- Opportunity seeds are workspace-owned, human-reviewed input. They are
-- immutable records: a changed thesis, competitor set, contrary signal, or
-- score factor creates a new seed_review_id and content hash.

CREATE TABLE appsea.opportunity_seed_reviews (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  seed_review_id text NOT NULL CHECK (seed_review_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  seed_version text NOT NULL CHECK (seed_version ~ '^[a-zA-Z0-9._:-]+$' AND char_length(seed_version) <= 80),
  seed_payload jsonb NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  review_state text NOT NULL DEFAULT 'unreviewed' CHECK (
    review_state IN ('unreviewed', 'reviewed', 'approved', 'withdrawn')
  ),
  created_by text NOT NULL REFERENCES appsea.users(user_id) ON DELETE RESTRICT,
  reviewed_by text REFERENCES appsea.users(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  approved_by text REFERENCES appsea.users(user_id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, seed_review_id),
  UNIQUE (workspace_id, content_hash),
  CHECK ((review_state IN ('reviewed', 'approved') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
      OR review_state IN ('unreviewed', 'withdrawn')),
  CHECK ((review_state = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
      OR review_state <> 'approved'),
  CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
  CHECK (approved_at IS NULL OR approved_at >= created_at)
);

CREATE INDEX opportunity_seed_reviews_state_idx
  ON appsea.opportunity_seed_reviews (workspace_id, review_state, updated_at DESC);

ALTER TABLE appsea.opportunity_seed_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.opportunity_seed_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.opportunity_seed_reviews
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

CREATE OR REPLACE FUNCTION appsea.enforce_opportunity_seed_review_mutation()
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
  -- Migrations and reviewed repair sessions may reconcile historical rows.
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    RETURN NEW;
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
    RAISE EXCEPTION 'opportunity seed review requires an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.review_state <> 'unreviewed' OR NEW.created_by <> actor_id
       OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL
       OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'new opportunity seed reviews must start unreviewed'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.seed_review_id IS DISTINCT FROM OLD.seed_review_id
     OR NEW.seed_version IS DISTINCT FROM OLD.seed_version
     OR NEW.seed_payload IS DISTINCT FROM OLD.seed_payload
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'opportunity seed review content is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.review_state IS NOT DISTINCT FROM OLD.review_state THEN
    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'opportunity seed review decision metadata is immutable'
        USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.review_state = 'unreviewed'
     AND NEW.review_state = 'reviewed'
     AND actor_role IN ('owner', 'editor') THEN
    IF NEW.reviewed_by <> actor_id OR NEW.reviewed_at IS NULL
       OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'reviewed seeds require the reviewing actor and timestamp'
        USING ERRCODE = '23514';
    END IF;
    event_action := 'opportunity.seed.reviewed';
  ELSIF OLD.review_state = 'reviewed'
     AND NEW.review_state = 'approved'
     AND actor_role = 'owner' THEN
    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
       OR NEW.approved_by <> actor_id OR NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'approved seeds require a reviewed seed and owner approval'
        USING ERRCODE = '23514';
    END IF;
    event_action := 'opportunity.seed.approved';
  ELSIF NEW.review_state = 'withdrawn'
     AND OLD.review_state IN ('unreviewed', 'reviewed', 'approved')
     AND actor_role = 'owner' THEN
    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'withdrawn seed review metadata is immutable'
        USING ERRCODE = '23514';
    END IF;
    event_action := 'opportunity.seed.withdrawn';
  ELSE
    RAISE EXCEPTION 'opportunity seed review transition is not permitted'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := clock_timestamp();
  event_id := 'seed-review:' || md5(
    concat_ws(':', NEW.workspace_id, NEW.seed_review_id,
              OLD.review_state, NEW.review_state, txid_current()::text)
  );
  payload := jsonb_build_object(
    'workspaceId', NEW.workspace_id,
    'seedReviewId', NEW.seed_review_id,
    'seedId', NEW.seed_payload ->> 'id',
    'contentHash', NEW.content_hash,
    'previousState', OLD.review_state,
    'nextState', NEW.review_state
  );

  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (NEW.workspace_id, 'audit:' || event_id, 'user', actor_id, event_action,
     'opportunity_seed_review', NEW.seed_review_id, event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (NEW.workspace_id, 'outbox:' || event_id, event_action, 'opportunity_seed_review',
     NEW.seed_review_id, 'opportunity-seed-review-v1', event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS opportunity_seed_review_mutation_guard
  ON appsea.opportunity_seed_reviews;
CREATE TRIGGER opportunity_seed_review_mutation_guard
BEFORE INSERT OR UPDATE ON appsea.opportunity_seed_reviews
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_opportunity_seed_review_mutation();

REVOKE ALL ON FUNCTION appsea.enforce_opportunity_seed_review_mutation() FROM PUBLIC;
REVOKE ALL ON appsea.opportunity_seed_reviews FROM appsea_service;
GRANT SELECT, INSERT ON appsea.opportunity_seed_reviews TO appsea_service;
GRANT UPDATE (
  review_state, reviewed_by, reviewed_at, approved_by, approved_at, updated_at
) ON appsea.opportunity_seed_reviews TO appsea_service;
