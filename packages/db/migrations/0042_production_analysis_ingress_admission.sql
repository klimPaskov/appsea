-- User-triggered production analysis has its own bounded admission ledger.
-- Collection admissions are intentionally separate: analysis does not acquire
-- source records, but it still needs a durable workspace rate/concurrency gate
-- before a caller can start a Temporal execution.

ALTER TABLE appsea.production_analysis_runs
  ADD COLUMN requested_by_actor_type text NOT NULL DEFAULT 'service',
  ADD COLUMN requested_by_actor_id text NOT NULL DEFAULT 'appsea-worker',
  ADD CONSTRAINT production_analysis_requested_by_actor_type_check CHECK (
    requested_by_actor_type IN ('user', 'service')
  ),
  ADD CONSTRAINT production_analysis_requested_by_actor_id_check CHECK (
    requested_by_actor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  ADD CONSTRAINT production_analysis_requested_by_actor_pair_check CHECK (
    (requested_by_actor_type = 'service' AND requested_by_actor_id = 'appsea-worker')
    OR requested_by_actor_type = 'user'
  );

CREATE INDEX production_analysis_runs_actor_idx
  ON appsea.production_analysis_runs (workspace_id, requested_by_actor_id, requested_at DESC);

CREATE TABLE appsea.production_analysis_workflow_start_buckets (
  workspace_id text PRIMARY KEY REFERENCES appsea.workspaces(workspace_id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 0 AND 5),
  updated_at timestamptz NOT NULL
);

CREATE TABLE appsea.production_analysis_workflow_admissions (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE CASCADE,
  idempotency_digest char(64) NOT NULL CHECK (idempotency_digest ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  requested_by_actor_type text NOT NULL CHECK (requested_by_actor_type = 'user'),
  requested_by_actor_id text NOT NULL CHECK (
    requested_by_actor_id ~ '^[a-z][a-z0-9_:-]{2,159}$'
  ),
  state text NOT NULL CHECK (state IN ('reserved', 'consumed', 'released', 'expired')),
  requested_at timestamptz NOT NULL,
  reservation_expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_digest),
  CHECK (reservation_expires_at > requested_at),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL)),
  CHECK (state <> 'released' OR released_at IS NOT NULL),
  CHECK (updated_at >= requested_at)
);

CREATE INDEX production_analysis_workflow_admissions_due_idx
  ON appsea.production_analysis_workflow_admissions
     (workspace_id, state, reservation_expires_at, updated_at);

ALTER TABLE appsea.production_analysis_workflow_start_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_analysis_workflow_start_buckets FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_analysis_workflow_start_buckets
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

ALTER TABLE appsea.production_analysis_workflow_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.production_analysis_workflow_admissions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.production_analysis_workflow_admissions
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

CREATE OR REPLACE FUNCTION appsea.enforce_production_analysis_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.requested_by_actor_type IS DISTINCT FROM OLD.requested_by_actor_type
    OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
  ) THEN
    RAISE EXCEPTION 'production analysis requesting actor is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.requested_by_actor_type = 'service' THEN
    IF NEW.requested_by_actor_id <> 'appsea-worker' THEN
      RAISE EXCEPTION 'unsupported production analysis service actor'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.requested_by_actor_type = 'user' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM appsea.workspace_memberships membership
       WHERE membership.workspace_id = NEW.workspace_id
         AND membership.user_id = NEW.requested_by_actor_id
         AND membership.role IN ('owner', 'editor')
    ) THEN
      RAISE EXCEPTION 'production analysis user actor is not an editor or owner'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported production analysis actor type'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER production_analysis_actor_guard
BEFORE INSERT OR UPDATE ON appsea.production_analysis_runs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_production_analysis_actor();

CREATE OR REPLACE FUNCTION appsea.admit_production_analysis_workflow(
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
  existing appsea.production_analysis_workflow_admissions%ROWTYPE;
  bucket appsea.production_analysis_workflow_start_buckets%ROWTYPE;
  active_count integer;
  retry_seconds integer;
  max_starts constant integer := 5;
  window_seconds constant integer := 900;
  max_concurrent constant integer := 2;
  reservation_ttl_seconds constant integer := 300;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace OR auth_user IS NULL THEN
    RAISE EXCEPTION 'production analysis admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_idempotency_digest IS NULL
     OR p_input_hash IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_idempotency_digest !~ '^[a-f0-9]{64}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid production analysis admission identity'
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
    RAISE EXCEPTION 'production analysis admission requires an active editor workspace'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('production-analysis-admission:' || p_workspace_id, 0)
  );

  SELECT * INTO existing
    FROM appsea.production_analysis_workflow_admissions admission
   WHERE admission.workspace_id = p_workspace_id
     AND admission.idempotency_digest = p_idempotency_digest
   FOR UPDATE;
  IF existing.idempotency_digest IS NOT NULL THEN
    IF existing.input_hash <> p_input_hash
       OR existing.requested_by_actor_id <> auth_user THEN
      RAISE EXCEPTION 'production analysis admission conflicts with prior input'
        USING ERRCODE = '23505';
    END IF;
    -- A consumed or released admission already has a durable workflow/run
    -- outcome. Replaying it must not consume another rate or concurrency slot;
    -- only an expired reservation (where initialization never reached the
    -- worker) may be reclaimed for the same digest.
    IF existing.state IN ('consumed', 'released')
       OR (existing.state = 'reserved' AND existing.reservation_expires_at > now_at) THEN
      RETURN QUERY SELECT 'replayed'::text, 0, existing.reservation_expires_at;
      RETURN;
    END IF;
    UPDATE appsea.production_analysis_workflow_admissions
       SET state = 'expired', released_at = COALESCE(released_at, now_at), updated_at = now_at
     WHERE workspace_id = p_workspace_id
       AND idempotency_digest = p_idempotency_digest
       AND state = 'reserved';
  END IF;

  SELECT (
    (SELECT count(*)
       FROM appsea.production_analysis_runs analysis
      WHERE analysis.workspace_id = p_workspace_id
        AND analysis.state IN ('queued', 'running'))
    +
    (SELECT count(*)
       FROM appsea.production_analysis_workflow_admissions admission
      WHERE admission.workspace_id = p_workspace_id
        AND admission.state = 'reserved'
        AND admission.reservation_expires_at > now_at)
  )::integer INTO active_count;
  IF active_count >= max_concurrent THEN
    RETURN QUERY SELECT 'concurrency_limited'::text, 60, now_at;
    RETURN;
  END IF;

  SELECT * INTO bucket
    FROM appsea.production_analysis_workflow_start_buckets
   WHERE workspace_id = p_workspace_id
   FOR UPDATE;
  IF bucket.workspace_id IS NULL THEN
    INSERT INTO appsea.production_analysis_workflow_start_buckets
      (workspace_id, window_started_at, attempt_count, updated_at)
    VALUES (p_workspace_id, now_at, 1, now_at);
  ELSIF bucket.window_started_at <= now_at - make_interval(secs => window_seconds) THEN
    UPDATE appsea.production_analysis_workflow_start_buckets
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
    UPDATE appsea.production_analysis_workflow_start_buckets
       SET attempt_count = attempt_count + 1, updated_at = now_at
     WHERE workspace_id = p_workspace_id;
  END IF;

  expiry_at := now_at + make_interval(secs => reservation_ttl_seconds);
  IF existing.idempotency_digest IS NOT NULL THEN
    UPDATE appsea.production_analysis_workflow_admissions
       SET requested_by_actor_type = 'user', requested_by_actor_id = auth_user,
           state = 'reserved', input_hash = p_input_hash, requested_at = now_at,
           reservation_expires_at = expiry_at, consumed_at = NULL, released_at = NULL,
           updated_at = now_at
     WHERE workspace_id = p_workspace_id
       AND idempotency_digest = p_idempotency_digest;
  ELSE
    INSERT INTO appsea.production_analysis_workflow_admissions
      (workspace_id, idempotency_digest, input_hash, requested_by_actor_type,
       requested_by_actor_id, state, requested_at, reservation_expires_at, updated_at)
    VALUES (p_workspace_id, p_idempotency_digest, p_input_hash, 'user', auth_user,
            'reserved', now_at, expiry_at, now_at);
  END IF;
  RETURN QUERY SELECT 'admitted'::text, 0, expiry_at;
END
$$;

CREATE OR REPLACE FUNCTION appsea.consume_production_analysis_workflow_admission(
  p_workspace_id text,
  p_idempotency_digest text,
  p_input_hash text,
  p_actor_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  admission appsea.production_analysis_workflow_admissions%ROWTYPE;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'production analysis admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_idempotency_digest IS NULL
     OR p_input_hash IS NULL
     OR p_actor_id IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_idempotency_digest !~ '^[a-f0-9]{64}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$'
     OR p_actor_id !~ '^[a-z][a-z0-9_:-]{2,159}$' THEN
    RAISE EXCEPTION 'invalid production analysis admission consumption request'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO admission
    FROM appsea.production_analysis_workflow_admissions
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest
   FOR UPDATE;
  IF admission.idempotency_digest IS NULL THEN RETURN false; END IF;
  IF admission.input_hash <> p_input_hash OR admission.requested_by_actor_id <> p_actor_id THEN
    RAISE EXCEPTION 'production analysis admission input conflicts with prior request'
      USING ERRCODE = '23505';
  END IF;
  IF admission.state = 'consumed' THEN RETURN true; END IF;
  IF admission.state <> 'reserved' OR admission.reservation_expires_at <= now_at THEN
    RETURN false;
  END IF;
  UPDATE appsea.production_analysis_workflow_admissions
     SET state = 'consumed', consumed_at = now_at, updated_at = now_at
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.release_production_analysis_workflow_admission(
  p_workspace_id text,
  p_idempotency_digest text,
  p_input_hash text,
  p_actor_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  admission appsea.production_analysis_workflow_admissions%ROWTYPE;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'production analysis admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO admission
    FROM appsea.production_analysis_workflow_admissions
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest
   FOR UPDATE;
  IF admission.idempotency_digest IS NULL THEN RETURN false; END IF;
  IF admission.input_hash <> p_input_hash OR admission.requested_by_actor_id <> p_actor_id THEN
    RAISE EXCEPTION 'production analysis admission release conflicts with prior request'
      USING ERRCODE = '23505';
  END IF;
  IF admission.state = 'released' OR admission.state = 'expired' THEN RETURN true; END IF;
  IF admission.state <> 'consumed' THEN RETURN false; END IF;
  UPDATE appsea.production_analysis_workflow_admissions
     SET state = 'released', released_at = now_at, updated_at = now_at
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.purge_production_analysis_workflow_admissions(
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
    RAISE EXCEPTION 'production analysis admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR p_before IS NULL OR p_limit IS NULL
     OR p_before > clock_timestamp()
     OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid production analysis admission purge request'
      USING ERRCODE = '22023';
  END IF;
  WITH stale AS (
    SELECT workspace_id, idempotency_digest
      FROM appsea.production_analysis_workflow_admissions
     WHERE workspace_id = p_workspace_id
       AND updated_at <= p_before
       AND (state <> 'reserved' OR reservation_expires_at <= clock_timestamp())
     ORDER BY updated_at, idempotency_digest
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  DELETE FROM appsea.production_analysis_workflow_admissions admission
   USING stale
   WHERE admission.workspace_id = stale.workspace_id
     AND admission.idempotency_digest = stale.idempotency_digest;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

REVOKE ALL ON appsea.production_analysis_workflow_start_buckets,
  appsea.production_analysis_workflow_admissions FROM PUBLIC, appsea_service;
REVOKE ALL ON FUNCTION appsea.admit_production_analysis_workflow(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.consume_production_analysis_workflow_admission(
  text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.release_production_analysis_workflow_admission(
  text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.purge_production_analysis_workflow_admissions(
  text, timestamptz, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.enforce_production_analysis_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.admit_production_analysis_workflow(text, text, text)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.consume_production_analysis_workflow_admission(
  text, text, text, text
) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.release_production_analysis_workflow_admission(
  text, text, text, text
) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.purge_production_analysis_workflow_admissions(
  text, timestamptz, integer
) TO appsea_service;
