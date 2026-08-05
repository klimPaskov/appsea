BEGIN;

-- Human curation is append-only. Cluster versions and membership rows remain
-- the immutable analysis lineage; this ledger records the reviewed state and
-- any split/merge relationship without copying complaint text.
CREATE TABLE appsea.cluster_review_events (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  review_id text NOT NULL CHECK (review_id ~ '^[a-z][a-z0-9_:-]{2,159}$'),
  opportunity_id text NOT NULL,
  cluster_version_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL REFERENCES appsea.users(user_id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('confirm', 'reject', 'split', 'merge')),
  previous_state text NOT NULL CHECK (
    previous_state IN ('provisional', 'reviewed', 'confirmed', 'split', 'merged', 'rejected')
  ),
  next_state text NOT NULL CHECK (
    next_state IN ('provisional', 'reviewed', 'confirmed', 'split', 'merged', 'rejected')
  ),
  expected_input_hash char(64) NOT NULL CHECK (expected_input_hash ~ '^[a-f0-9]{64}$'),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 2_000),
  related_cluster_version_ids text[] NOT NULL DEFAULT '{}',
  review_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(review_snapshot) = 'object' AND pg_column_size(review_snapshot) <= 256000),
  review_snapshot_hash char(64) NOT NULL CHECK (review_snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, review_id),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES appsea.opportunities(workspace_id, opportunity_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, cluster_version_id)
    REFERENCES appsea.complaint_cluster_versions(workspace_id, cluster_version_id) ON DELETE RESTRICT,
  CHECK (previous_state <> next_state),
  CHECK ((action = 'confirm' AND next_state = 'confirmed')
    OR (action = 'reject' AND next_state = 'rejected')
    OR (action = 'split' AND next_state = 'split')
    OR (action = 'merge' AND next_state = 'merged'))
);

CREATE INDEX cluster_review_events_history_idx
  ON appsea.cluster_review_events (workspace_id, opportunity_id, cluster_version_id, created_at DESC, review_id DESC);

ALTER TABLE appsea.cluster_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.cluster_review_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.cluster_review_events
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

CREATE OR REPLACE FUNCTION appsea.enforce_cluster_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  authenticated_actor text;
  actor_role text;
  cluster_row record;
  expected_next_state text;
  related_id text;
  event_id text;
  payload jsonb;
BEGIN
  IF session_user IN ('appsea_migrator', 'appsea_owner') THEN
    RETURN NEW;
  END IF;

  authenticated_actor := NULLIF(current_setting('appsea.auth_user_id', true), '');
  IF authenticated_actor IS NULL OR NEW.actor_id <> authenticated_actor THEN
    RAISE EXCEPTION 'cluster review actor must be the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.role
    INTO actor_role
    FROM appsea.workspace_memberships membership
    JOIN appsea.workspaces workspace
      ON workspace.workspace_id = membership.workspace_id
   WHERE membership.workspace_id = NEW.workspace_id
     AND membership.user_id = authenticated_actor
     AND workspace.status = 'active';
  IF actor_role IS NULL OR actor_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION 'cluster reviews require an editor or owner actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT cluster.cluster_version_id, cluster.cluster_id, cluster.run_id,
         cluster.review_state, cluster.input_hash, cluster.synthetic
    INTO cluster_row
    FROM appsea.complaint_cluster_versions cluster
    JOIN appsea.opportunity_clusters relation
      ON relation.workspace_id = cluster.workspace_id
     AND relation.cluster_version_id = cluster.cluster_version_id
     AND relation.opportunity_id = NEW.opportunity_id
   WHERE cluster.workspace_id = NEW.workspace_id
     AND cluster.cluster_version_id = NEW.cluster_version_id
     AND cluster.synthetic = false
   FOR UPDATE OF cluster;
  IF cluster_row.cluster_version_id IS NULL THEN
    RAISE EXCEPTION 'cluster is missing, inactive, or synthetic'
      USING ERRCODE = '23503';
  END IF;
  IF cluster_row.review_state IS DISTINCT FROM NEW.previous_state
     OR cluster_row.input_hash IS DISTINCT FROM NEW.expected_input_hash THEN
    RAISE EXCEPTION 'cluster review snapshot is stale'
      USING ERRCODE = '40001';
  END IF;

  expected_next_state := CASE NEW.action
    WHEN 'confirm' THEN 'confirmed'
    WHEN 'reject' THEN 'rejected'
    WHEN 'split' THEN 'split'
    WHEN 'merge' THEN 'merged'
    ELSE NULL
  END;
  IF NEW.next_state IS DISTINCT FROM expected_next_state THEN
    RAISE EXCEPTION 'cluster review action does not match next state'
      USING ERRCODE = '23514';
  END IF;
  IF (NEW.review_snapshot ->> 'workspaceId') IS NOT NULL THEN
    IF (NEW.review_snapshot ->> 'workspaceId') IS DISTINCT FROM NEW.workspace_id
       OR (NEW.review_snapshot ->> 'clusterVersionId') IS DISTINCT FROM NEW.cluster_version_id
       OR (NEW.review_snapshot ->> 'opportunityId') IS DISTINCT FROM NEW.opportunity_id
       OR (NEW.review_snapshot ->> 'runId') IS DISTINCT FROM cluster_row.run_id
       OR (NEW.review_snapshot ->> 'previousReviewState') IS DISTINCT FROM NEW.previous_state
       OR (NEW.review_snapshot ->> 'nextReviewState') IS DISTINCT FROM NEW.next_state
       OR (NEW.review_snapshot ->> 'inputHash') IS DISTINCT FROM NEW.expected_input_hash
       OR (NEW.review_snapshot ->> 'snapshotHash') IS DISTINCT FROM NEW.review_snapshot_hash THEN
      RAISE EXCEPTION 'cluster review snapshot does not match the current cluster'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'cluster review snapshot must identify its workspace lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.action IN ('confirm', 'reject') THEN
    IF cardinality(NEW.related_cluster_version_ids) <> 0 THEN
      RAISE EXCEPTION 'confirm and reject reviews cannot include related clusters'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF cardinality(NEW.related_cluster_version_ids) < 2
       OR NEW.cluster_version_id = ANY(NEW.related_cluster_version_ids)
       OR cardinality(NEW.related_cluster_version_ids) <> cardinality(
         ARRAY(SELECT DISTINCT unnest(NEW.related_cluster_version_ids))
       ) THEN
      RAISE EXCEPTION 'split and merge reviews require distinct related clusters'
        USING ERRCODE = '23514';
    END IF;
    FOREACH related_id IN ARRAY NEW.related_cluster_version_ids LOOP
      IF NOT EXISTS (
        SELECT 1
          FROM appsea.research_run_cluster_versions relation
         WHERE relation.workspace_id = NEW.workspace_id
           AND relation.opportunity_id = NEW.opportunity_id
           AND relation.run_id = cluster_row.run_id
           AND relation.cluster_version_id = related_id
      ) THEN
        RAISE EXCEPTION 'related cluster is not part of the same opportunity run'
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  UPDATE appsea.complaint_cluster_versions
     SET review_state = NEW.next_state
   WHERE workspace_id = NEW.workspace_id
     AND cluster_version_id = NEW.cluster_version_id;

  UPDATE appsea.cluster_memberships
     SET review_state = CASE NEW.action
       WHEN 'confirm' THEN 'confirmed'
       WHEN 'reject' THEN 'rejected'
       ELSE 'corrected'
     END
   WHERE workspace_id = NEW.workspace_id
     AND cluster_version_id = NEW.cluster_version_id;

  event_id := 'cluster-review:' || md5(concat_ws(':', NEW.workspace_id, NEW.review_id));
  payload := jsonb_build_object(
    'workspaceId', NEW.workspace_id,
    'opportunityId', NEW.opportunity_id,
    'clusterVersionId', NEW.cluster_version_id,
    'reviewId', NEW.review_id,
    'action', NEW.action,
    'previousState', NEW.previous_state,
    'nextState', NEW.next_state,
    'snapshotHash', NEW.review_snapshot_hash
  );
  INSERT INTO appsea.audit_events
    (workspace_id, audit_event_id, actor_type, actor_id, action, target_type,
     target_id, correlation_id, metadata, occurred_at)
  VALUES
    (NEW.workspace_id, 'audit:' || event_id, 'user', authenticated_actor,
     'cluster.' || NEW.action, 'complaint_cluster', NEW.cluster_version_id,
     event_id, payload, clock_timestamp())
  ON CONFLICT DO NOTHING;
  INSERT INTO appsea.outbox_events
    (workspace_id, outbox_event_id, event_type, aggregate_type, aggregate_id,
     schema_version, correlation_id, payload, occurred_at)
  VALUES
    (NEW.workspace_id, 'outbox:' || event_id, 'cluster.' || NEW.action,
     'complaint_cluster', NEW.cluster_version_id, 'cluster-review-v1', event_id,
     payload, clock_timestamp())
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END
$$;

CREATE TRIGGER cluster_review_guard
BEFORE INSERT ON appsea.cluster_review_events
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_cluster_review();

CREATE OR REPLACE FUNCTION appsea.prevent_cluster_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  RAISE EXCEPTION 'cluster review events are append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER cluster_review_immutable
BEFORE UPDATE OR DELETE ON appsea.cluster_review_events
FOR EACH ROW EXECUTE FUNCTION appsea.prevent_cluster_review_mutation();

REVOKE ALL ON FUNCTION appsea.enforce_cluster_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.prevent_cluster_review_mutation() FROM PUBLIC;
REVOKE ALL ON appsea.cluster_review_events FROM PUBLIC, appsea_service;
GRANT SELECT, INSERT ON appsea.cluster_review_events TO appsea_service;

COMMENT ON TABLE appsea.cluster_review_events IS
  'Append-only human curation ledger for complaint clusters; snapshots contain identifiers and review states, never raw complaint text.';

COMMIT;
