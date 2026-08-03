-- Make source-deletion propagation retryable without weakening its provenance
-- or tenant boundaries. Failed rows remain inspectable and retryable until the
-- bounded attempt budget is exhausted; exhausted rows are terminal.

ALTER TABLE appsea.deletion_tombstones
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz;

-- Existing pending rows were written before the retry boundary existed. They
-- are eligible immediately; processing rows keep their lease and are repaired
-- from the server-observed claim time. The table is forced-RLS even for the
-- migration owner, so use a migration-only repair policy and remove it before
-- the migration commits.
DROP POLICY IF EXISTS deletion_tombstone_retry_migration_repair
  ON appsea.deletion_tombstones;
CREATE POLICY deletion_tombstone_retry_migration_repair
  ON appsea.deletion_tombstones
  FOR UPDATE
  TO appsea_owner, appsea_migrator
  USING (true)
  WITH CHECK (true);

UPDATE appsea.deletion_tombstones
   SET next_attempt_at = CASE
     WHEN state = 'processing' THEN NULL
     WHEN state = 'failed' THEN clock_timestamp()
     ELSE clock_timestamp()
   END
 WHERE next_attempt_at IS NULL;

DROP POLICY deletion_tombstone_retry_migration_repair
  ON appsea.deletion_tombstones;

ALTER TABLE appsea.deletion_tombstones
  ADD CONSTRAINT deletion_tombstone_attempt_count_check
    CHECK (attempt_count BETWEEN 0 AND 8),
  ADD CONSTRAINT deletion_tombstone_retry_schedule_check
    CHECK (
      (state IN ('processing', 'completed') AND next_attempt_at IS NULL)
      OR (state = 'pending' AND next_attempt_at IS NOT NULL)
      OR (
        state = 'failed'
        AND (
          (attempt_count < 8 AND next_attempt_at IS NOT NULL)
          OR (attempt_count >= 8 AND next_attempt_at IS NULL)
        )
      )
    );

ALTER TABLE appsea.deletion_tombstones
  ADD CONSTRAINT deletion_tombstone_failure_code_fixed_check
    CHECK (failure_code IS NULL OR failure_code = 'deletion_propagation_failed');

CREATE INDEX deletion_tombstones_due_idx
  ON appsea.deletion_tombstones (workspace_id, state, next_attempt_at, received_at, tombstone_id);

CREATE OR REPLACE FUNCTION appsea.guard_deletion_tombstone_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.tombstone_id IS DISTINCT FROM OLD.tombstone_id
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.source_record_id IS DISTINCT FROM OLD.source_record_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'deletion tombstone identity is immutable' USING ERRCODE = '42501';
  END IF;

  IF OLD.state = 'pending' AND NEW.state NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'pending deletion tombstones may only begin processing'
      USING ERRCODE = '42501';
  ELSIF OLD.state = 'processing' AND NEW.state NOT IN ('processing', 'completed', 'failed') THEN
    RAISE EXCEPTION 'processing deletion tombstones may only complete or fail'
      USING ERRCODE = '42501';
  ELSIF OLD.state = 'failed' AND NEW.state NOT IN ('failed', 'processing') THEN
    RAISE EXCEPTION 'failed deletion tombstones may only retry or remain failed'
      USING ERRCODE = '42501';
  ELSIF OLD.state = 'completed' AND NEW.state <> 'completed' THEN
    RAISE EXCEPTION 'terminal deletion tombstone state is immutable' USING ERRCODE = '42501';
  END IF;

  IF OLD.state = 'failed' AND OLD.attempt_count >= 8 AND NEW.state = 'processing' THEN
    RAISE EXCEPTION 'exhausted deletion tombstones cannot be retried' USING ERRCODE = '42501';
  END IF;

  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'deletion tombstone attempt count cannot decrease' USING ERRCODE = '42501';
  END IF;

  IF OLD.state = 'completed' OR (OLD.state = 'failed' AND OLD.attempt_count >= 8) THEN
    IF NEW.state IS DISTINCT FROM OLD.state
       OR NEW.processing_started_at IS DISTINCT FROM OLD.processing_started_at
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.affected_object_count IS DISTINCT FROM OLD.affected_object_count
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.next_attempt_at IS DISTINCT FROM OLD.next_attempt_at
       OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
       OR NEW.failure_summary IS DISTINCT FROM OLD.failure_summary THEN
      RAISE EXCEPTION 'terminal deletion tombstone payload is immutable' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.state = 'completed' THEN
    IF NEW.completed_at IS NULL
       OR NEW.processing_started_at IS NOT NULL
       OR NEW.next_attempt_at IS NOT NULL
       OR NEW.failure_code IS NOT NULL
       OR NEW.failure_summary IS NOT NULL THEN
      RAISE EXCEPTION 'completed deletion tombstones require only completion metadata'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.affected_object_count < OLD.affected_object_count THEN
      RAISE EXCEPTION 'deletion tombstone affected count cannot decrease'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.state = 'processing' THEN
    IF NEW.processing_started_at IS NULL
       OR NEW.completed_at IS NOT NULL
       OR NEW.next_attempt_at IS NOT NULL
       OR NEW.failure_code IS NOT NULL
       OR NEW.failure_summary IS NOT NULL THEN
      RAISE EXCEPTION 'processing deletion tombstones require an active lease'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.processing_started_at IS NOT NULL THEN
      RAISE EXCEPTION 'non-processing deletion tombstones cannot have an active lease'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'only completed deletion tombstones may have completed_at'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.state = 'pending' AND (NEW.failure_code IS NOT NULL OR NEW.failure_summary IS NOT NULL) THEN
      RAISE EXCEPTION 'pending deletion tombstones cannot have failure metadata'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.state = 'failed'
       AND (NEW.failure_code IS NULL OR NEW.failure_summary IS NULL) THEN
      RAISE EXCEPTION 'failed deletion tombstones require failure metadata'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.state IN ('pending', 'failed')
       AND NEW.attempt_count < 8
       AND NEW.next_attempt_at IS NULL THEN
      RAISE EXCEPTION 'retryable deletion tombstones require a next attempt time'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.state = 'failed'
       AND NEW.attempt_count >= 8
       AND NEW.next_attempt_at IS NOT NULL THEN
      RAISE EXCEPTION 'exhausted deletion tombstones cannot have a next attempt time'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.state <> 'completed'
     AND NEW.affected_object_count IS DISTINCT FROM OLD.affected_object_count THEN
    RAISE EXCEPTION 'affected count may only be finalized on completion'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS deletion_tombstones_transition_guard ON appsea.deletion_tombstones;
CREATE TRIGGER deletion_tombstones_transition_guard
BEFORE UPDATE
ON appsea.deletion_tombstones FOR EACH ROW
EXECUTE FUNCTION appsea.guard_deletion_tombstone_transition();

GRANT UPDATE (
  state, attempt_count, processing_started_at, completed_at, affected_object_count,
  next_attempt_at, failure_code, failure_summary
)
  ON appsea.deletion_tombstones
TO appsea_service;

REVOKE ALL ON FUNCTION appsea.guard_deletion_tombstone_transition() FROM PUBLIC;
