-- Preserve deletion provenance and make mutable content/lifecycle boundaries
-- fail closed for the runtime role. This is forward-only; prior migrations stay
-- immutable.

ALTER TABLE appsea.plan_package_versions
  ADD CONSTRAINT plan_package_non_synthetic_fixture_files_check
  CHECK (synthetic OR fixture_files IS NULL);

CREATE OR REPLACE FUNCTION appsea.guard_active_source_item_payload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.deletion_state = 'active'
     AND NEW.deletion_state = 'active'
     AND NEW.raw_object_ref IS DISTINCT FROM OLD.raw_object_ref THEN
    RAISE EXCEPTION 'active source item raw object references are immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION appsea.guard_active_evidence_payload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.deletion_state = 'active'
     AND NEW.deletion_state = 'active'
     AND (
       NEW.normalized_text IS DISTINCT FROM OLD.normalized_text
       OR NEW.redacted IS DISTINCT FROM OLD.redacted
     ) THEN
    RAISE EXCEPTION 'active evidence content is immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

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
  ELSIF OLD.state IN ('completed', 'failed') AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'terminal deletion tombstone state is immutable' USING ERRCODE = '42501';
  END IF;

  IF OLD.state IN ('completed', 'failed') AND (
    NEW.processing_started_at IS DISTINCT FROM OLD.processing_started_at
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.affected_object_count IS DISTINCT FROM OLD.affected_object_count
    OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
    OR NEW.failure_summary IS DISTINCT FROM OLD.failure_summary
  ) THEN
    RAISE EXCEPTION 'terminal deletion tombstone payload is immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.state = 'completed' THEN
    IF NEW.completed_at IS NULL
       OR NEW.failure_code IS NOT NULL
       OR NEW.failure_summary IS NOT NULL THEN
      RAISE EXCEPTION 'completed deletion tombstones require only completion metadata'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.affected_object_count < OLD.affected_object_count THEN
      RAISE EXCEPTION 'deletion tombstone affected count cannot decrease'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.state = 'pending' AND NEW.processing_started_at IS NOT NULL THEN
      RAISE EXCEPTION 'pending deletion tombstones cannot have processing metadata'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'only completed deletion tombstones may have completed_at'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.state <> 'failed'
       AND (NEW.failure_code IS NOT NULL OR NEW.failure_summary IS NOT NULL) THEN
      RAISE EXCEPTION 'only failed deletion tombstones may have failure metadata'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.state = 'failed'
     AND (NEW.failure_code IS NULL OR NEW.failure_summary IS NULL) THEN
    RAISE EXCEPTION 'failed deletion tombstones require failure metadata'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.state <> 'completed'
     AND NEW.affected_object_count IS DISTINCT FROM OLD.affected_object_count THEN
    RAISE EXCEPTION 'affected count may only be finalized on completion'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_items_active_payload_guard ON appsea.source_items;
CREATE TRIGGER source_items_active_payload_guard
BEFORE UPDATE OF raw_object_ref, deletion_state
ON appsea.source_items FOR EACH ROW
EXECUTE FUNCTION appsea.guard_active_source_item_payload();

DROP TRIGGER IF EXISTS evidence_records_active_payload_guard ON appsea.evidence_records;
CREATE TRIGGER evidence_records_active_payload_guard
BEFORE UPDATE OF normalized_text, redacted, deletion_state
ON appsea.evidence_records FOR EACH ROW
EXECUTE FUNCTION appsea.guard_active_evidence_payload();

DROP TRIGGER IF EXISTS deletion_tombstones_transition_guard ON appsea.deletion_tombstones;
CREATE TRIGGER deletion_tombstones_transition_guard
BEFORE UPDATE
ON appsea.deletion_tombstones FOR EACH ROW
EXECUTE FUNCTION appsea.guard_deletion_tombstone_transition();

REVOKE ALL ON FUNCTION appsea.guard_active_source_item_payload() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_active_evidence_payload() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_deletion_tombstone_transition() FROM PUBLIC;
