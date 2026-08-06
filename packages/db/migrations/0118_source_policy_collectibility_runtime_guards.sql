-- Close the remaining direct database paths around the shared complete-review
-- invariant. These are forward guards: prior migrations remain immutable, and
-- fixture rows keep their database-free testing path.

CREATE OR REPLACE FUNCTION appsea.enforce_source_policy_version_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.policy_state = 'approved'
     AND EXISTS (
       SELECT 1
         FROM appsea.sources source
        WHERE source.source_id = NEW.source_id
          AND source.source_type <> 'fixture'
     )
     AND NOT appsea.source_policy_has_complete_reviews(
       NEW.source_id, NEW.policy_version, NEW.content_hash
     ) THEN
    RAISE EXCEPTION 'source policy approval requires a complete independent review set'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_source_policy_version_activation() FROM PUBLIC;
DROP TRIGGER IF EXISTS source_policy_version_activation_guard
  ON appsea.source_policy_versions;
CREATE TRIGGER source_policy_version_activation_guard
BEFORE UPDATE OF policy_state, content_hash
ON appsea.source_policy_versions
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_policy_version_activation();

CREATE OR REPLACE FUNCTION appsea.enforce_source_activation_complete_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  policy_hash text;
BEGIN
  IF NEW.source_type <> 'fixture'
     AND NEW.lifecycle_state = 'active'
     AND NEW.current_policy_version IS NOT NULL THEN
    SELECT policy.content_hash::text
      INTO policy_hash
      FROM appsea.source_policy_versions policy
     WHERE policy.source_id = NEW.source_id
       AND policy.policy_version = NEW.current_policy_version;
    IF policy_hash IS NULL
       OR NOT appsea.source_policy_has_complete_reviews(
            NEW.source_id, NEW.current_policy_version, policy_hash
          ) THEN
      RAISE EXCEPTION 'source activation requires a complete independent review set'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_source_activation_complete_policy() FROM PUBLIC;
DROP TRIGGER IF EXISTS source_activation_complete_policy_guard ON appsea.sources;
CREATE TRIGGER source_activation_complete_policy_guard
BEFORE INSERT OR UPDATE OF lifecycle_state, current_policy_version
ON appsea.sources
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_activation_complete_policy();

-- Replace the legacy lease admission and assertion gates. Existing active
-- leases that no longer satisfy the invariant are revoked immediately so a
-- stale row cannot be replayed before the next assertion.
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
       AND appsea.source_policy_has_complete_reviews(
         policy.source_id, policy.policy_version, policy.content_hash
       )
  ) THEN
    RAISE EXCEPTION 'source collection lease requires an approved, active complete policy review'
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
       AND appsea.source_policy_has_complete_reviews(
         policy.source_id, policy.policy_version, policy.content_hash
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

REVOKE ALL ON FUNCTION appsea.acquire_source_collection_lease(
  text, text, text, text, text, timestamptz, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.assert_source_collection_lease(text, text, text) FROM PUBLIC;

UPDATE appsea.source_collection_leases lease
   SET state = 'revoked',
       closed_at = clock_timestamp(),
       updated_at = clock_timestamp()
 WHERE lease.state = 'active'
   AND NOT EXISTS (
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
        AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
        AND appsea.source_policy_has_complete_reviews(
          policy.source_id, policy.policy_version, policy.content_hash
        )
   );

-- Replace the earlier snapshot gate so a queued job cannot become running
-- after policy demotion. Terminal failure transitions remain available for
-- recovery and cleanup.
CREATE OR REPLACE FUNCTION appsea.enforce_source_snapshot_reconciliation_complete_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state = 'running' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM appsea.sources source
        JOIN appsea.source_policy_versions policy
          ON policy.source_id = source.source_id
         AND policy.policy_version = NEW.policy_version
       WHERE source.source_id = NEW.source_id
         AND source.source_type <> 'fixture'
         AND source.lifecycle_state = 'active'
         AND source.current_policy_version = policy.policy_version
         AND policy.policy_state = 'approved'
         AND policy.deletion_required
         AND policy.reviewed_at IS NOT NULL
         AND policy.commercial_use IN ('allowed', 'restricted')
         AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
         AND appsea.source_policy_has_complete_reviews(
           policy.source_id, policy.policy_version, policy.content_hash
         )
    ) THEN
      RAISE EXCEPTION 'source snapshot reconciliation requires a complete approved deletion policy'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_source_snapshot_reconciliation_complete_policy()
  FROM PUBLIC;
DROP TRIGGER IF EXISTS source_snapshot_reconciliation_complete_policy_guard
  ON appsea.source_snapshot_reconciliation_jobs;
CREATE TRIGGER source_snapshot_reconciliation_complete_policy_guard
BEFORE INSERT OR UPDATE OF state ON appsea.source_snapshot_reconciliation_jobs
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_source_snapshot_reconciliation_complete_policy();

UPDATE appsea.source_snapshot_reconciliation_jobs job
   SET state = 'failed',
       claim_token_hash = NULL,
       claim_expires_at = NULL,
       failure_code = 'policy_denied',
       failure_summary = 'Source policy review is no longer complete',
       finished_at = clock_timestamp(),
       updated_at = clock_timestamp()
 WHERE job.state IN ('queued', 'running')
   AND NOT EXISTS (
     SELECT 1
       FROM appsea.sources source
       JOIN appsea.source_policy_versions policy
         ON policy.source_id = source.source_id
        AND policy.policy_version = job.policy_version
      WHERE source.source_id = job.source_id
        AND source.source_type <> 'fixture'
        AND source.lifecycle_state = 'active'
        AND source.current_policy_version = policy.policy_version
        AND policy.policy_state = 'approved'
        AND policy.deletion_required
        AND policy.reviewed_at IS NOT NULL
        AND policy.commercial_use IN ('allowed', 'restricted')
        AND (policy.expires_at IS NULL OR policy.expires_at > clock_timestamp())
        AND appsea.source_policy_has_complete_reviews(
          policy.source_id, policy.policy_version, policy.content_hash
        )
   );

-- Add database-owned complete-review checks to the three historical lineage
-- tables whose original triggers intentionally remain for their detailed
-- provenance checks. Synthetic fixture rows are excluded from the production
-- guards and retain their fixture-only path.
CREATE OR REPLACE FUNCTION appsea.enforce_complete_analysis_policy_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.source_policy_versions policy
     WHERE policy.source_id = NEW.source_id
       AND policy.policy_version = NEW.policy_version
       AND policy.content_hash = NEW.policy_content_hash
       AND appsea.source_policy_has_complete_reviews(
         policy.source_id, policy.policy_version, policy.content_hash
       )
  ) THEN
    RAISE EXCEPTION 'analysis source policy lineage requires a complete review set'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_complete_analysis_policy_lineage() FROM PUBLIC;
DROP TRIGGER IF EXISTS complete_analysis_policy_lineage_guard
  ON appsea.research_analysis_run_source_policies;
CREATE TRIGGER complete_analysis_policy_lineage_guard
BEFORE INSERT OR UPDATE ON appsea.research_analysis_run_source_policies
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_complete_analysis_policy_lineage();

CREATE OR REPLACE FUNCTION appsea.enforce_complete_competitor_observation_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.synthetic THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.source_items item
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = item.source_id
       AND policy.policy_version = item.source_policy_version
     WHERE item.workspace_id = NEW.workspace_id
       AND item.source_item_id = NEW.source_item_id
       AND item.source_id = NEW.source_id
       AND appsea.source_policy_has_complete_reviews(
         policy.source_id, policy.policy_version, policy.content_hash
       )
  ) THEN
    RAISE EXCEPTION 'competitor observation requires a complete source policy review set'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_complete_competitor_observation_policy() FROM PUBLIC;
DROP TRIGGER IF EXISTS complete_competitor_observation_policy_guard
  ON appsea.competitor_research_observations;
CREATE TRIGGER complete_competitor_observation_policy_guard
BEFORE INSERT OR UPDATE ON appsea.competitor_research_observations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_complete_competitor_observation_policy();

CREATE OR REPLACE FUNCTION appsea.enforce_complete_analysis_competitor_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM appsea.source_items item
      JOIN appsea.source_policy_versions policy
        ON policy.source_id = item.source_id
       AND policy.policy_version = item.source_policy_version
     WHERE item.workspace_id = NEW.workspace_id
       AND item.source_item_id = NEW.source_item_id
       AND item.source_id = NEW.source_id
       AND appsea.source_policy_has_complete_reviews(
         policy.source_id, policy.policy_version, policy.content_hash
       )
  ) THEN
    RAISE EXCEPTION 'analysis competitor lineage requires a complete source policy review set'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION appsea.enforce_complete_analysis_competitor_lineage() FROM PUBLIC;
DROP TRIGGER IF EXISTS complete_analysis_competitor_lineage_guard
  ON appsea.research_analysis_run_competitor_observations;
CREATE TRIGGER complete_analysis_competitor_lineage_guard
BEFORE INSERT OR UPDATE ON appsea.research_analysis_run_competitor_observations
FOR EACH ROW EXECUTE FUNCTION appsea.enforce_complete_analysis_competitor_lineage();

COMMENT ON FUNCTION appsea.enforce_source_policy_version_activation() IS
  'Prevents non-fixture source policies from becoming approved without a complete independent review set.';
COMMENT ON FUNCTION appsea.enforce_source_activation_complete_policy() IS
  'Prevents non-fixture sources from becoming active without a complete independent review set.';
COMMENT ON FUNCTION appsea.enforce_complete_analysis_policy_lineage() IS
  'Requires production analysis source-policy lineage to reference a complete immutable review set.';
COMMENT ON FUNCTION appsea.enforce_complete_competitor_observation_policy() IS
  'Requires non-synthetic competitor observations to reference a complete immutable review set.';
COMMENT ON FUNCTION appsea.enforce_complete_analysis_competitor_lineage() IS
  'Requires production analysis competitor lineage to reference a complete immutable review set.';
