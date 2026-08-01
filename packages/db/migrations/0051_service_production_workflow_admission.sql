-- Direct production source commands are worker-owned operations, not a
-- second unauthenticated ingress. Reuse the existing admission ledger and
-- limits, but authorize this branch only from a transaction-local
-- appsea-worker service principal on the runtime service role.
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
  service_principal text := NULLIF(current_setting('appsea.service_principal', true), '');
  worker_request boolean := service_principal = 'appsea-worker';
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
  IF current_workspace IS NULL
     OR p_workspace_id <> current_workspace
     OR (auth_user IS NULL AND NOT worker_request) THEN
    RAISE EXCEPTION 'production workflow admission workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF worker_request AND session_user <> 'appsea_service' THEN
    RAISE EXCEPTION 'production workflow service admission requires the runtime service role'
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

  IF worker_request THEN
    IF NOT EXISTS (
      SELECT 1
        FROM appsea.workspaces workspace
       WHERE workspace.workspace_id = p_workspace_id
         AND workspace.status = 'active'
         AND workspace.visibility = 'private'
         AND workspace.fixture_only = false
    ) THEN
      RAISE EXCEPTION 'production workflow service admission requires an active private workspace'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
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

  -- Serialize all admission decisions for one workspace. The service path
  -- deliberately shares the user path's rate and concurrency counters.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('production-workflow-admission:' || p_workspace_id, 0)
  );

  SELECT * INTO existing_job
    FROM appsea.production_collection_workflow_jobs
   WHERE workspace_id = p_workspace_id
     AND idempotency_digest = p_idempotency_digest
   FOR UPDATE;
  IF existing_job.workflow_id IS NOT NULL THEN
    IF worker_request THEN
      RAISE EXCEPTION 'production workflow service admission conflicts with an existing workflow execution'
        USING ERRCODE = '23505';
    END IF;
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

-- Preserve the existing least-privilege function boundary after replacement.
REVOKE ALL ON FUNCTION appsea.admit_production_collection_workflow(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.admit_production_collection_workflow(text, text, text)
  TO appsea_service;
