-- A source collection lease binds one external fetch to an approved policy
-- snapshot and a stable server-observed timestamp.  Runtime workers may call
-- the functions below, but cannot rewrite lease rows directly.  The lease is
-- intentionally identifier/digest-only: source text and personal data remain
-- in the existing provenance-preserving collection tables.
CREATE TABLE appsea.source_collection_leases (
  workspace_id text NOT NULL REFERENCES appsea.workspaces(workspace_id) ON DELETE RESTRICT,
  lease_id text NOT NULL CHECK (
    char_length(lease_id) BETWEEN 3 AND 240
    AND lease_id ~ '^[a-z][a-z0-9_:-]*$'
  ),
  source_id text NOT NULL,
  policy_version text NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'released', 'expired', 'revoked')),
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, lease_id),
  FOREIGN KEY (source_id, policy_version)
    REFERENCES appsea.source_policy_versions(source_id, policy_version) ON DELETE RESTRICT,
  CHECK (expires_at > acquired_at),
  CHECK ((state = 'active') = (closed_at IS NULL)),
  CHECK (closed_at IS NULL OR closed_at >= acquired_at),
  CHECK (updated_at >= acquired_at)
);

CREATE INDEX source_collection_leases_state_idx
  ON appsea.source_collection_leases (workspace_id, state, updated_at);
CREATE INDEX source_collection_leases_expiry_idx
  ON appsea.source_collection_leases (workspace_id, expires_at)
  WHERE state = 'active';

ALTER TABLE appsea.source_collection_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE appsea.source_collection_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_scope ON appsea.source_collection_leases
  USING (workspace_id = appsea.current_workspace_id())
  WITH CHECK (workspace_id = appsea.current_workspace_id());

CREATE OR REPLACE FUNCTION appsea.acquire_source_collection_lease(
  p_workspace_id text,
  p_lease_id text,
  p_source_id text,
  p_policy_version text,
  p_input_hash text,
  p_observed_at timestamptz,
  p_expires_at timestamptz
)
RETURNS TABLE (
  decision text,
  observed_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  now_at timestamptz := clock_timestamp();
  existing appsea.source_collection_leases%ROWTYPE;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source collection lease workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_lease_id IS NULL
     OR p_source_id IS NULL
     OR p_policy_version IS NULL
     OR p_input_hash IS NULL
     OR p_observed_at IS NULL
     OR p_expires_at IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_lease_id !~ '^[a-z][a-z0-9_:-]{2,239}$'
     OR p_source_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_policy_version !~ '^[a-zA-Z0-9._:-]{1,80}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$'
     OR p_observed_at > now_at + interval '5 minutes'
     OR p_expires_at <= now_at
     OR p_expires_at > now_at + interval '1 hour' THEN
    RAISE EXCEPTION 'invalid source collection lease request'
      USING ERRCODE = '22023';
  END IF;

  -- One lease identity is serialized so two worker retries cannot fetch the
  -- same source/policy request with different capture timestamps.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('source-collection-lease:' || p_workspace_id || ':' || p_lease_id, 0)
  );

  IF NOT EXISTS (
    SELECT 1
      FROM appsea.sources source
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = source.source_id
       AND policy.policy_version = p_policy_version
     WHERE source.source_id = p_source_id
       AND source.source_type <> 'fixture'
       AND source.lifecycle_state = 'active'
       AND source.current_policy_version = p_policy_version
       AND policy.policy_state = 'approved'
       AND policy.reviewed_at IS NOT NULL
       AND policy.commercial_use IN ('allowed', 'restricted')
       AND (policy.expires_at IS NULL OR policy.expires_at > now_at)
       AND EXISTS (
         SELECT 1
           FROM appsea.source_policy_reviews review
          WHERE review.source_id = policy.source_id
            AND review.policy_version = policy.policy_version
            AND review.decision = 'approved'
            AND review.content_hash = policy.content_hash
       )
  ) THEN
    RAISE EXCEPTION 'source collection lease requires an approved, active policy review'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing
    FROM appsea.source_collection_leases lease
   WHERE lease.workspace_id = p_workspace_id
     AND lease.lease_id = p_lease_id
   FOR UPDATE;

  IF existing.lease_id IS NOT NULL THEN
    IF existing.source_id <> p_source_id
       OR existing.policy_version <> p_policy_version
       OR existing.input_hash <> p_input_hash THEN
      RAISE EXCEPTION 'source collection lease conflicts with prior input'
        USING ERRCODE = '23505';
    END IF;
    IF existing.state = 'active' AND existing.expires_at > now_at THEN
      RETURN QUERY SELECT 'replayed'::text, existing.observed_at, existing.expires_at;
      RETURN;
    END IF;
    IF existing.state = 'active' THEN
      UPDATE appsea.source_collection_leases
         SET state = 'expired', closed_at = now_at, updated_at = now_at
       WHERE workspace_id = p_workspace_id AND lease_id = p_lease_id;
      RETURN QUERY SELECT 'expired'::text, existing.observed_at, existing.expires_at;
      RETURN;
    END IF;
    RETURN QUERY SELECT existing.state, existing.observed_at, existing.expires_at;
    RETURN;
  END IF;

  INSERT INTO appsea.source_collection_leases
    (workspace_id, lease_id, source_id, policy_version, input_hash, observed_at,
     state, acquired_at, expires_at, updated_at)
  VALUES
    (p_workspace_id, p_lease_id, p_source_id, p_policy_version, p_input_hash,
     p_observed_at, 'active', now_at, p_expires_at, now_at);
  RETURN QUERY SELECT 'acquired'::text, p_observed_at, p_expires_at;
END
$$;

CREATE OR REPLACE FUNCTION appsea.assert_source_collection_lease(
  p_workspace_id text,
  p_lease_id text,
  p_input_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  now_at timestamptz := clock_timestamp();
  lease appsea.source_collection_leases%ROWTYPE;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source collection lease workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_lease_id IS NULL
     OR p_input_hash IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_lease_id !~ '^[a-z][a-z0-9_:-]{2,239}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid source collection lease assertion'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO lease
    FROM appsea.source_collection_leases
   WHERE workspace_id = p_workspace_id AND lease_id = p_lease_id
   FOR UPDATE;
  IF lease.lease_id IS NULL THEN RETURN false; END IF;
  IF lease.input_hash <> p_input_hash THEN
    RAISE EXCEPTION 'source collection lease assertion conflicts with prior input'
      USING ERRCODE = '23505';
  END IF;
  IF lease.state <> 'active' THEN RETURN false; END IF;
  IF lease.expires_at <= now_at THEN
    UPDATE appsea.source_collection_leases
       SET state = 'expired', closed_at = now_at, updated_at = now_at
     WHERE workspace_id = p_workspace_id AND lease_id = p_lease_id;
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.sources source
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = source.source_id
       AND policy.policy_version = lease.policy_version
     WHERE source.source_id = lease.source_id
       AND source.source_type <> 'fixture'
       AND source.lifecycle_state = 'active'
       AND source.current_policy_version = lease.policy_version
       AND policy.policy_state = 'approved'
       AND policy.reviewed_at IS NOT NULL
       AND policy.commercial_use IN ('allowed', 'restricted')
       AND (policy.expires_at IS NULL OR policy.expires_at > now_at)
       AND EXISTS (
         SELECT 1
           FROM appsea.source_policy_reviews review
          WHERE review.source_id = policy.source_id
            AND review.policy_version = policy.policy_version
            AND review.decision = 'approved'
            AND review.content_hash = policy.content_hash
       )
  ) THEN
    UPDATE appsea.source_collection_leases
       SET state = 'revoked', closed_at = now_at, updated_at = now_at
     WHERE workspace_id = p_workspace_id AND lease_id = p_lease_id;
    RETURN false;
  END IF;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.release_source_collection_lease(
  p_workspace_id text,
  p_lease_id text,
  p_input_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  now_at timestamptz := clock_timestamp();
  lease appsea.source_collection_leases%ROWTYPE;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source collection lease workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_lease_id IS NULL
     OR p_input_hash IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_lease_id !~ '^[a-z][a-z0-9_:-]{2,239}$'
     OR p_input_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid source collection lease release'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO lease
    FROM appsea.source_collection_leases
   WHERE workspace_id = p_workspace_id AND lease_id = p_lease_id
   FOR UPDATE;
  IF lease.lease_id IS NULL THEN RETURN false; END IF;
  IF lease.input_hash <> p_input_hash THEN
    RAISE EXCEPTION 'source collection lease release conflicts with prior input'
      USING ERRCODE = '23505';
  END IF;
  IF lease.state = 'active' THEN
    IF lease.expires_at <= now_at THEN
      UPDATE appsea.source_collection_leases
         SET state = 'expired', closed_at = now_at, updated_at = now_at
       WHERE workspace_id = p_workspace_id AND lease_id = p_lease_id;
    ELSE
      UPDATE appsea.source_collection_leases
         SET state = 'released', closed_at = now_at, updated_at = now_at
       WHERE workspace_id = p_workspace_id AND lease_id = p_lease_id;
    END IF;
  END IF;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.purge_source_collection_leases(
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
    RAISE EXCEPTION 'source collection lease workspace context is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR p_before IS NULL OR p_limit IS NULL
     OR p_workspace_id !~ '^[a-z][a-z0-9_:-]{2,159}$'
     OR p_before > clock_timestamp()
     OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid source collection lease purge request'
      USING ERRCODE = '22023';
  END IF;

  WITH stale AS (
    SELECT workspace_id, lease_id
      FROM appsea.source_collection_leases
     WHERE workspace_id = p_workspace_id
       AND updated_at <= p_before
       AND (state <> 'active' OR expires_at <= clock_timestamp())
     ORDER BY updated_at, lease_id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  DELETE FROM appsea.source_collection_leases lease
   USING stale
   WHERE lease.workspace_id = stale.workspace_id
     AND lease.lease_id = stale.lease_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

REVOKE ALL ON appsea.source_collection_leases FROM PUBLIC, appsea_service;
REVOKE ALL ON FUNCTION appsea.acquire_source_collection_lease(
  text, text, text, text, text, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.assert_source_collection_lease(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.release_source_collection_lease(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.purge_source_collection_leases(text, timestamptz, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.acquire_source_collection_lease(
  text, text, text, text, text, timestamptz, timestamptz
) TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.assert_source_collection_lease(text, text, text)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.release_source_collection_lease(text, text, text)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.purge_source_collection_leases(text, timestamptz, integer)
  TO appsea_service;
