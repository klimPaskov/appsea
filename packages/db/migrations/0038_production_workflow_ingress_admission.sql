-- Authenticated production collection starts need a durable admission boundary
-- before a Temporal workflow is created.  The boundary is workspace-scoped,
-- idempotent by digest, and deliberately separate from the workflow job: a
-- process can crash after Temporal accepts a start but before the workflow's
-- first persistence activity creates its job projection.
CREATE TABLE appsea.production_collection_workflow_start_buckets (
  workspace_id text PRIMARY KEY REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL
);

CREATE TABLE appsea.production_collection_workflow_admissions (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  idempotency_digest char(64) NOT NULL CHECK (idempotency_digest ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
  requested_at timestamptz NOT NULL,
  reservation_expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_digest),
  CHECK (reservation_expires_at > requested_at),
  CHECK ((state = 'reserved') = (consumed_at IS NULL AND released_at IS NULL)),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL AND released_at IS NULL)),
  CHECK ((state = 'released') = (consumed_at IS NULL AND released_at IS NOT NULL)),
  CHECK (consumed_at IS NULL OR consumed_at >= requested_at),
  CHECK (released_at IS NULL OR released_at >= requested_at),
  CHECK (updated_at >= requested_at)
);

CREATE INDEX production_workflow_admission_expiry_idx
  ON appsea.production_collection_workflow_admissions (workspace_id, reservation_expires_at)
  WHERE state = 'reserved';

CREATE INDEX production_workflow_admission_state_idx
  ON appsea.production_collection_workflow_admissions (workspace_id, state, updated_at);

ALTER TABLE appsea.production_collection_workflow_start_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_collection_workflow_start_buckets FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_collection_workflow_start_buckets
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.production_collection_workflow_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_collection_workflow_admissions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_collection_workflow_admissions
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

CREATE OR REPLACE FUNCTION appsea.admit_production_collection_workflow(
  p_workspace_id text,
  p_idempotency_digest text,
  p_input_hash text
)
RETURNS TABLE (
  decision text,
  retry_after_seconds integer,
  reservation_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  auth_user text := NULLIF(current_setting('appsea.auth_user_id', true), '');
  now_at timestamptz := clock_timestamp();
  expiry_at timestamptz;
  existing_job appsea.production_collection_workflow_jobs%ROWTYPE;
  existing_admission appsea.production_collection_workflow_admissions%ROWTYPE;
  bucket appsea.production_collection_workflow_start_buckets%ROWTYPE;
  active_count integer;
  retry_seconds integer;
  max_starts constant integer := 5;
  window_seconds constant integer := 900;
  max_concurrent constant integer := 2;
  reservation_ttl_seconds constant integer := 300;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace OR auth_user IS NULL THEN
    RAISE EXCEPTION 'production workflow admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_idempotency_digest IS NULL
     OR p_input_hash IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_idempotency_digest !~ '^[a-f0-9]{64}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$'
     THEN
    RAISE EXCEPTION 'invalid production workflow admission identity'
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
    RAISE EXCEPTION 'production workflow admission requires an active editor workspace'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize all admission decisions for one workspace. This makes the
  -- active-job count and the rate bucket a single atomic decision even when
  -- several editors click start at the same time.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('production-workflow-admission:' || p_workspace_id, 0)
  );

  SELECT * INTO existing_job
    FROM appsea.production_collection_workflow_jobs
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest
   FOR UPDATE;
  IF existing_job.workflow_id IS NOT NULL THEN
    IF existing_job.input_hash <> p_input_hash THEN
      RAISE EXCEPTION 'production workflow idempotency digest conflicts with prior input'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT 'replayed'::text, 0, now_at;
    RETURN;
  END IF;

  SELECT * INTO existing_admission
    FROM appsea.production_collection_workflow_admissions
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest
   FOR UPDATE;
  IF existing_admission.idempotency_digest IS NOT NULL THEN
    IF existing_admission.input_hash <> p_input_hash THEN
      RAISE EXCEPTION 'production workflow admission conflicts with prior input'
        USING ERRCODE = '23505';
    END IF;
    IF existing_admission.state = 'consumed'
       OR (existing_admission.state = 'reserved' AND existing_admission.reservation_expires_at > now_at) THEN
      RETURN QUERY SELECT 'replayed'::text, 0, existing_admission.reservation_expires_at;
      RETURN;
    END IF;
    -- A caller or process may have disappeared after admission. Reusing the
    -- same digest is safe because Temporal uses the same deterministic ID;
    -- the old reservation is no longer counted toward concurrency.
    UPDATE appsea.production_collection_workflow_admissions
       SET state = 'released', released_at = now_at, updated_at = now_at
     WHERE workspace_id = p_workspace_id
       AND idempotency_digest = p_idempotency_digest;
  END IF;

  SELECT (
    (SELECT count(*)
       FROM appsea.production_collection_workflow_jobs job
      WHERE job.workspace_id = p_workspace_id
        AND job.state IN ('queued', 'running'))
    +
    (SELECT count(*)
       FROM appsea.production_collection_workflow_admissions admission
      WHERE admission.workspace_id = p_workspace_id
        AND admission.state = 'reserved'
        AND admission.reservation_expires_at > now_at)
  )::integer INTO active_count;
  IF active_count >= max_concurrent THEN
    RETURN QUERY SELECT 'concurrency_limited'::text, 60, now_at;
    RETURN;
  END IF;

  SELECT * INTO bucket
    FROM appsea.production_collection_workflow_start_buckets
   WHERE workspace_id = p_workspace_id
   FOR UPDATE;
  IF bucket.workspace_id IS NULL THEN
    INSERT INTO appsea.production_collection_workflow_start_buckets
      (workspace_id, window_started_at, attempt_count, updated_at)
    VALUES (p_workspace_id, now_at, 1, now_at);
  ELSIF bucket.window_started_at <= now_at - make_interval(secs => window_seconds) THEN
    UPDATE appsea.production_collection_workflow_start_buckets
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
      RETURN QUERY SELECT 'rate_limited'::text, retry_seconds, now_at;
      RETURN;
    END IF;
    UPDATE appsea.production_collection_workflow_start_buckets
       SET attempt_count = attempt_count + 1, updated_at = now_at
     WHERE workspace_id = p_workspace_id;
  END IF;

  expiry_at := now_at + make_interval(secs => reservation_ttl_seconds);
  IF existing_admission.idempotency_digest IS NOT NULL THEN
    UPDATE appsea.production_collection_workflow_admissions
       SET state = 'reserved', input_hash = p_input_hash,
           requested_at = now_at, reservation_expires_at = expiry_at,
           consumed_at = NULL, released_at = NULL, updated_at = now_at
     WHERE workspace_id = p_workspace_id
       AND idempotency_digest = p_idempotency_digest;
  ELSE
    INSERT INTO appsea.production_collection_workflow_admissions
      (workspace_id, idempotency_digest, input_hash, state, requested_at,
       reservation_expires_at, updated_at)
    VALUES (p_workspace_id, p_idempotency_digest, p_input_hash, 'reserved',
            now_at, expiry_at, now_at);
  END IF;
  RETURN QUERY SELECT 'admitted'::text, 0, expiry_at;
END
$$;

CREATE OR REPLACE FUNCTION appsea.consume_production_collection_workflow_admission(
  p_workspace_id text,
  p_idempotency_digest text,
  p_input_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  admission appsea.production_collection_workflow_admissions%ROWTYPE;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'production workflow admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_idempotency_digest IS NULL
     OR p_input_hash IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_idempotency_digest !~ '^[a-f0-9]{64}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid production workflow admission identity'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO admission
    FROM appsea.production_collection_workflow_admissions
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest
   FOR UPDATE;
  IF admission.idempotency_digest IS NULL THEN RETURN false; END IF;
  IF admission.input_hash <> p_input_hash THEN
    RAISE EXCEPTION 'production workflow admission input conflicts with prior request'
      USING ERRCODE = '23505';
  END IF;
  IF admission.state = 'consumed' THEN RETURN true; END IF;
  IF admission.state <> 'reserved' OR admission.reservation_expires_at <= now_at THEN
    RETURN false;
  END IF;
  UPDATE appsea.production_collection_workflow_admissions
     SET state = 'consumed', consumed_at = now_at, updated_at = now_at
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.purge_production_collection_workflow_admissions(
  p_workspace_id text,
  p_before timestamptz,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  deleted_count integer;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'production workflow admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR p_before IS NULL OR p_limit IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_before > clock_timestamp()
     OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid production workflow admission purge request'
      USING ERRCODE = '22023';
  END IF;

  WITH stale AS (
    SELECT workspace_id, idempotency_digest
      FROM appsea.production_collection_workflow_admissions
     WHERE workspace_id = p_workspace_id
       AND updated_at <= p_before
       AND (state <> 'reserved' OR reservation_expires_at <= clock_timestamp())
     ORDER BY updated_at, idempotency_digest
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  DELETE FROM appsea.production_collection_workflow_admissions admission
   USING stale
   WHERE admission.workspace_id = stale.workspace_id
     AND admission.idempotency_digest = stale.idempotency_digest;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

REVOKE ALL ON appsea.production_collection_workflow_start_buckets,
  appsea.production_collection_workflow_admissions FROM PUBLIC, appsea_service;
REVOKE ALL ON FUNCTION appsea.admit_production_collection_workflow(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.consume_production_collection_workflow_admission(
  text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.purge_production_collection_workflow_admissions(
  text, timestamptz, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.admit_production_collection_workflow(text, text, text)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.consume_production_collection_workflow_admission(
  text, text, text
) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.purge_production_collection_workflow_admissions(
  text, timestamptz, integer
) TO appsea_service;
