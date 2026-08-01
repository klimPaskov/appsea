-- Authenticated users may request a bounded source snapshot reconciliation,
-- while the existing worker command remains an explicit service admission.
-- The job row is the durable idempotency record: inserting it and consuming
-- the admission decision happen in one transaction, so a crashed caller
-- cannot leave a second hidden reservation behind.

ALTER TABLE appsea.source_snapshot_reconciliation_jobs
  ADD COLUMN requested_by_actor_type text NOT NULL DEFAULT 'service',
  ADD COLUMN requested_by_actor_id text NOT NULL DEFAULT 'appsea-worker',
  ADD CONSTRAINT source_snapshot_reconciliation_actor_type_check CHECK (
    requested_by_actor_type IN ('user', 'service')
  ),
  ADD CONSTRAINT source_snapshot_reconciliation_actor_id_check CHECK (
    requested_by_actor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  ADD CONSTRAINT source_snapshot_reconciliation_actor_pair_check CHECK (
    (requested_by_actor_type = 'service' AND requested_by_actor_id = 'appsea-worker')
    OR requested_by_actor_type = 'user'
  );

CREATE INDEX source_snapshot_reconciliation_actor_idx
  ON appsea.source_snapshot_reconciliation_jobs
     (workspace_id, requested_by_actor_id, requested_at DESC);

CREATE TABLE appsea.source_snapshot_reconciliation_start_buckets (
  workspace_id text PRIMARY KEY REFERENCES appsea.workspaces(workspace_id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 0 AND 5),
  updated_at timestamptz NOT NULL
);

ALTER TABLE appsea.source_snapshot_reconciliation_start_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.source_snapshot_reconciliation_start_buckets FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.source_snapshot_reconciliation_start_buckets
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

CREATE OR REPLACE FUNCTION appsea.enforce_source_snapshot_reconciliation_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  auth_user text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  service_principal text := NULLIF(current_setting('appsea.service_principal', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.requested_by_actor_type IS DISTINCT FROM OLD.requested_by_actor_type
    OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
  ) THEN
    RAISE EXCEPTION 'source snapshot reconciliation requesting actor is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspaces workspace
     WHERE workspace.workspace_id = NEW.workspace_id
       AND workspace.status = 'active'
       AND workspace.visibility = 'private'
       AND workspace.fixture_only = false
  ) THEN
    RAISE EXCEPTION 'source snapshot reconciliation requires an active private workspace'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.requested_by_actor_type = 'service' THEN
    IF NEW.requested_by_actor_id <> 'appsea-worker' OR service_principal <> 'appsea-worker' THEN
      RAISE EXCEPTION 'unsupported source snapshot reconciliation service actor'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.requested_by_actor_type = 'user' THEN
    IF auth_user IS NULL
       OR auth_user <> NEW.requested_by_actor_id
       OR NOT EXISTS (
         SELECT 1
           FROM appsea.workspace_memberships membership
          WHERE membership.workspace_id = NEW.workspace_id
            AND membership.user_id = NEW.requested_by_actor_id
            AND membership.role IN ('owner', 'editor')
       ) THEN
      RAISE EXCEPTION 'source snapshot reconciliation user actor is not an editor or owner'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported source snapshot reconciliation actor type'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_snapshot_reconciliation_actor_guard
  ON appsea.source_snapshot_reconciliation_jobs;
CREATE TRIGGER source_snapshot_reconciliation_actor_guard
BEFORE INSERT OR UPDATE ON appsea.source_snapshot_reconciliation_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_snapshot_reconciliation_actor();

CREATE OR REPLACE FUNCTION appsea.admit_source_snapshot_reconciliation(
  p_workspace_id text,
  p_reconciliation_id text,
  p_source_id text,
  p_policy_version text,
  p_idempotency_key text,
  p_input_hash text,
  p_page_size integer,
  p_max_records integer,
  p_requested_at timestamptz
)
RETURNS TABLE (
  decision text,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  auth_user text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  now_at timestamptz := clock_timestamp();
  bucket appsea.source_snapshot_reconciliation_start_buckets%ROWTYPE;
  existing appsea.source_snapshot_reconciliation_jobs%ROWTYPE;
  active_count integer;
  retry_seconds integer;
  max_starts constant integer := 5;
  window_seconds constant integer := 900;
  max_concurrent constant integer := 1;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace OR auth_user IS NULL THEN
    RAISE EXCEPTION 'source snapshot reconciliation admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_reconciliation_id IS NULL
     OR p_source_id IS NULL
     OR p_policy_version IS NULL
     OR p_idempotency_key IS NULL
     OR p_input_hash IS NULL
     OR p_page_size IS NULL
     OR p_max_records IS NULL
     OR p_requested_at IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_reconciliation_id !~ '^reconciliation:source:[a-f0-9]{32}$'
     OR p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_policy_version !~ '^[a-zA-Z0-9._:-]{1,80}$'
     OR p_idempotency_key !~ '^[a-f0-9]{64}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$'
     OR p_page_size NOT BETWEEN 1 AND 1000
     OR p_max_records NOT BETWEEN 1 AND 1000
     OR p_max_records < p_page_size
     OR p_requested_at > now_at + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid source snapshot reconciliation admission identity'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.workspaces workspace
     WHERE workspace.workspace_id = p_workspace_id
       AND workspace.status = 'active'
       AND workspace.visibility = 'private'
       AND workspace.fixture_only = false
  ) OR NOT EXISTS (
    SELECT 1
      FROM appsea.workspace_memberships membership
     WHERE membership.workspace_id = p_workspace_id
       AND membership.user_id = auth_user
       AND membership.role IN ('owner', 'editor')
  ) THEN
    RAISE EXCEPTION 'source snapshot reconciliation admission requires an active editor workspace'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('source-snapshot-reconciliation-admission:' || p_workspace_id, 0)
  );

  SELECT * INTO existing
    FROM appsea.source_snapshot_reconciliation_jobs job
   WHERE job.workspace_id = p_workspace_id
     AND job.idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF existing.reconciliation_id IS NOT NULL THEN
    IF existing.input_hash <> p_input_hash
       OR existing.reconciliation_id <> p_reconciliation_id
       OR existing.source_id <> p_source_id
       OR existing.policy_version <> p_policy_version
       OR existing.page_size <> p_page_size
       OR existing.max_records <> p_max_records
       OR existing.requested_by_actor_type <> 'user'
       OR existing.requested_by_actor_id <> auth_user THEN
      RAISE EXCEPTION 'source snapshot reconciliation admission conflicts with prior input'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT 'replayed'::text, 0;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO active_count
    FROM appsea.source_snapshot_reconciliation_jobs job
   WHERE job.workspace_id = p_workspace_id
     AND job.state IN ('queued', 'running');
  IF active_count >= max_concurrent THEN
    RETURN QUERY SELECT 'concurrency_limited'::text, 60;
    RETURN;
  END IF;

  SELECT * INTO bucket
    FROM appsea.source_snapshot_reconciliation_start_buckets
   WHERE workspace_id = p_workspace_id
   FOR UPDATE;
  IF bucket.workspace_id IS NULL THEN
    INSERT INTO appsea.source_snapshot_reconciliation_start_buckets
      (workspace_id, window_started_at, attempt_count, updated_at)
    VALUES (p_workspace_id, now_at, 1, now_at);
  ELSIF bucket.window_started_at <= now_at - make_interval(secs => window_seconds) THEN
    UPDATE appsea.source_snapshot_reconciliation_start_buckets
       SET window_started_at = now_at, attempt_count = 1, updated_at = now_at
     WHERE workspace_id = p_workspace_id;
  ELSE
    IF bucket.attempt_count >= max_starts THEN
      retry_seconds := GREATEST(
        1,
        LEAST(
          86400,
          CEIL(EXTRACT(EPOCH FROM ((bucket.window_started_at + make_interval(secs => window_seconds)) - now_at)))::integer
        )
      );
      RETURN QUERY SELECT 'rate_limited'::text, retry_seconds;
      RETURN;
    END IF;
    UPDATE appsea.source_snapshot_reconciliation_start_buckets
       SET attempt_count = attempt_count + 1, updated_at = now_at
     WHERE workspace_id = p_workspace_id;
  END IF;

  INSERT INTO appsea.source_snapshot_reconciliation_jobs
    (workspace_id, reconciliation_id, source_id, policy_version, idempotency_key,
     input_hash, page_size, max_records, requested_at, state, next_attempt_at,
     requested_by_actor_type, requested_by_actor_id, updated_at)
  VALUES (p_workspace_id, p_reconciliation_id, p_source_id, p_policy_version,
          p_idempotency_key, p_input_hash, p_page_size, p_max_records,
          p_requested_at, 'queued', now_at, 'user', auth_user, now_at);
  RETURN QUERY SELECT 'admitted'::text, 0;
END
$$;

REVOKE ALL ON appsea.source_snapshot_reconciliation_start_buckets FROM PUBLIC, appsea_service;
REVOKE ALL ON FUNCTION appsea.enforce_source_snapshot_reconciliation_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.admit_source_snapshot_reconciliation(
  text, text, text, text, text, text, integer, integer, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.admit_source_snapshot_reconciliation(
  text, text, text, text, text, text, integer, integer, timestamptz
) TO appsea_service;
