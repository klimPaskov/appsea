-- Harden the durable quota and deletion boundaries before any source is
-- activated. This migration is deliberately forward-only: existing rows keep
-- their audit identity while maintenance and propagation become fail-closed.

DROP FUNCTION IF EXISTS appsea.expire_source_quota_reservations(timestamptz, integer);

CREATE OR REPLACE FUNCTION appsea.expire_source_quota_reservations(
  p_workspace_id text,
  p_before timestamptz,
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  reservation appsea.source_quota_reservations%ROWTYPE;
  expired_count integer := 0;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF current_workspace IS NULL OR p_workspace_id IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source quota expiry workspace context is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_before IS NULL OR p_before > now_at THEN
    RAISE EXCEPTION 'source quota expiry cannot target the future' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid source quota expiry batch size' USING ERRCODE = '22023';
  END IF;
  FOR reservation IN
    SELECT *
      FROM appsea.source_quota_reservations
     WHERE workspace_id = p_workspace_id
       AND status = 'reserved'
       AND expires_at <= p_before
     ORDER BY expires_at, reservation_id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE appsea.source_quota_windows
       SET request_count = GREATEST(0, request_count - 1),
           record_count = GREATEST(0, record_count - reservation.requested_records),
           updated_at = clock_timestamp()
     WHERE source_id = reservation.source_id
       AND policy_version = reservation.policy_version
       AND window_started_at = reservation.window_started_at;
    UPDATE appsea.source_quota_reservations
       SET status = 'expired', settled_at = clock_timestamp()
     WHERE workspace_id = reservation.workspace_id
       AND reservation_id = reservation.reservation_id
       AND status = 'reserved';
    expired_count := expired_count + 1;
  END LOOP;
  RETURN expired_count;
END
$$;

CREATE OR REPLACE FUNCTION appsea.purge_source_quota_reservations(
  p_workspace_id text,
  p_before timestamptz,
  p_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  purged_count integer := 0;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source quota purge workspace context is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_before IS NULL OR p_before > clock_timestamp() THEN
    RAISE EXCEPTION 'source quota purge cannot target the future' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid source quota purge batch size' USING ERRCODE = '22023';
  END IF;
  WITH candidates AS (
    SELECT workspace_id, reservation_id
      FROM appsea.source_quota_reservations
     WHERE workspace_id = p_workspace_id
       AND status <> 'reserved'
       AND settled_at IS NOT NULL
       AND settled_at <= p_before
     ORDER BY settled_at, reservation_id
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM appsea.source_quota_reservations reservation
   USING candidates
   WHERE reservation.workspace_id = candidates.workspace_id
     AND reservation.reservation_id = candidates.reservation_id;
  GET DIAGNOSTICS purged_count = ROW_COUNT;
  RETURN purged_count;
END
$$;

CREATE OR REPLACE FUNCTION appsea.commit_source_quota_reservation(
  p_workspace_id text,
  p_reservation_id text,
  p_actual_records integer,
  p_actual_cost_micros bigint,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  current_workspace text := NULLIF(current_setting('appsea.workspace_id', true), '');
  reservation appsea.source_quota_reservations%ROWTYPE;
BEGIN
  IF current_workspace IS NULL OR p_workspace_id <> current_workspace THEN
    RAISE EXCEPTION 'source quota workspace context is not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_actual_records IS NULL OR p_actual_cost_micros IS NULL
     OR p_actual_records < 0 OR p_actual_cost_micros < 0 THEN
    RAISE EXCEPTION 'invalid source quota settlement' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO reservation
    FROM appsea.source_quota_reservations
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id
   FOR UPDATE;
  IF reservation.reservation_id IS NULL THEN
    RAISE EXCEPTION 'source quota reservation does not exist' USING ERRCODE = '23503';
  END IF;
  IF reservation.status = 'committed' THEN
    IF reservation.actual_records <> p_actual_records
       OR reservation.actual_cost_micros <> p_actual_cost_micros THEN
      RAISE EXCEPTION 'source quota settlement conflicts with prior commit'
        USING ERRCODE = '23505';
    END IF;
    RETURN;
  END IF;
  IF reservation.status <> 'reserved'
     OR p_actual_records > reservation.requested_records
     OR p_actual_cost_micros > reservation.requested_cost_micros THEN
    RAISE EXCEPTION 'source quota reservation cannot be committed' USING ERRCODE = '23514';
  END IF;
  UPDATE appsea.source_quota_reservations
     SET status = 'committed', actual_records = p_actual_records,
         actual_cost_micros = p_actual_cost_micros, settled_at = clock_timestamp()
   WHERE workspace_id = p_workspace_id AND reservation_id = p_reservation_id;
END
$$;

ALTER TABLE appsea.source_quota_reservations
  ADD CONSTRAINT source_quota_committed_values_check CHECK (
    status <> 'committed' OR (actual_records IS NOT NULL AND actual_cost_micros IS NOT NULL)
  );

ALTER TABLE appsea.source_items
  ADD CONSTRAINT source_items_deleted_requires_tombstone CHECK (
    deletion_state <> 'source_deleted' OR deletion_tombstone_id IS NOT NULL
  );
ALTER TABLE appsea.evidence_records
  ADD CONSTRAINT evidence_deleted_requires_tombstone CHECK (
    deletion_state <> 'source_deleted' OR deletion_tombstone_id IS NOT NULL
  );
ALTER TABLE appsea.report_versions
  ADD CONSTRAINT reports_deleted_requires_tombstone CHECK (
    deletion_state <> 'source_deleted' OR deletion_tombstone_id IS NOT NULL
  );
ALTER TABLE appsea.plan_package_versions
  ADD CONSTRAINT plans_deleted_requires_tombstone CHECK (
    deletion_state <> 'source_deleted' OR deletion_tombstone_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION appsea.guard_source_item_deletion_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.deletion_state <> 'active' AND NEW.deletion_state = 'active' THEN
    RAISE EXCEPTION 'source item deletion state cannot be restored' USING ERRCODE = '42501';
  END IF;
  IF OLD.deletion_tombstone_id IS NOT NULL
     AND NEW.deletion_tombstone_id IS DISTINCT FROM OLD.deletion_tombstone_id THEN
    RAISE EXCEPTION 'source item deletion tombstone is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.deletion_state <> 'active' AND NEW.raw_object_ref IS NOT NULL THEN
    RAISE EXCEPTION 'non-active source items cannot retain raw objects' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION appsea.guard_evidence_deletion_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.deletion_state <> 'active' AND NEW.deletion_state = 'active' THEN
    RAISE EXCEPTION 'evidence deletion state cannot be restored' USING ERRCODE = '42501';
  END IF;
  IF OLD.redacted AND NOT NEW.redacted THEN
    RAISE EXCEPTION 'evidence redaction cannot be reversed' USING ERRCODE = '42501';
  END IF;
  IF OLD.deletion_tombstone_id IS NOT NULL
     AND NEW.deletion_tombstone_id IS DISTINCT FROM OLD.deletion_tombstone_id THEN
    RAISE EXCEPTION 'evidence deletion tombstone is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.deletion_state <> 'active'
     AND (NOT NEW.redacted
       OR NEW.normalized_text <> '[Content removed under source deletion policy]') THEN
    RAISE EXCEPTION 'non-active evidence must remain redacted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION appsea.guard_report_deletion_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.deletion_state = 'active'
     AND NEW.deletion_state = 'active'
     AND (
       NEW.structured_report IS DISTINCT FROM OLD.structured_report
       OR NEW.markdown_object_ref IS DISTINCT FROM OLD.markdown_object_ref
     ) THEN
    RAISE EXCEPTION 'active report payloads are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.deletion_state <> 'active' AND NEW.deletion_state = 'active' THEN
    RAISE EXCEPTION 'report deletion state cannot be restored' USING ERRCODE = '42501';
  END IF;
  IF OLD.deletion_tombstone_id IS NOT NULL
     AND NEW.deletion_tombstone_id IS DISTINCT FROM OLD.deletion_tombstone_id THEN
    RAISE EXCEPTION 'report deletion tombstone is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.deletion_state <> 'active'
     AND (NEW.structured_report -> '_deletion' IS NULL OR NEW.markdown_object_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'non-active reports must not retain report content' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION appsea.guard_plan_deletion_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF OLD.deletion_state = 'active'
     AND NEW.deletion_state = 'active'
     AND (
       NEW.fixture_files IS DISTINCT FROM OLD.fixture_files
       OR NEW.package_object_ref IS DISTINCT FROM OLD.package_object_ref
     ) THEN
    RAISE EXCEPTION 'active plan payloads are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.deletion_state <> 'active' AND NEW.deletion_state = 'active' THEN
    RAISE EXCEPTION 'plan deletion state cannot be restored' USING ERRCODE = '42501';
  END IF;
  IF OLD.deletion_tombstone_id IS NOT NULL
     AND NEW.deletion_tombstone_id IS DISTINCT FROM OLD.deletion_tombstone_id THEN
    RAISE EXCEPTION 'plan deletion tombstone is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.deletion_state <> 'active'
     AND (
       (NEW.synthetic AND (NEW.fixture_files -> '_deletion' IS NULL OR NEW.package_object_ref IS NOT NULL))
       OR (NOT NEW.synthetic AND (NEW.package_object_ref IS NULL OR NEW.package_object_ref NOT LIKE 'deleted:%'))
     ) THEN
    RAISE EXCEPTION 'non-active plans must not retain plan content' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_items_deletion_guard ON appsea.source_items;
CREATE TRIGGER source_items_deletion_guard
BEFORE UPDATE OF raw_object_ref, deletion_state, deletion_tombstone_id
ON appsea.source_items FOR EACH ROW
EXECUTE FUNCTION appsea.guard_source_item_deletion_state();

DROP TRIGGER IF EXISTS evidence_records_deletion_guard ON appsea.evidence_records;
CREATE TRIGGER evidence_records_deletion_guard
BEFORE UPDATE OF normalized_text, redacted, deletion_state, deletion_tombstone_id
ON appsea.evidence_records FOR EACH ROW
EXECUTE FUNCTION appsea.guard_evidence_deletion_state();

DROP TRIGGER IF EXISTS report_versions_deletion_guard ON appsea.report_versions;
CREATE TRIGGER report_versions_deletion_guard
BEFORE UPDATE OF structured_report, markdown_object_ref, deletion_state,
  deletion_tombstone_id ON appsea.report_versions FOR EACH ROW
EXECUTE FUNCTION appsea.guard_report_deletion_state();

DROP TRIGGER IF EXISTS plan_package_versions_deletion_guard ON appsea.plan_package_versions;
CREATE TRIGGER plan_package_versions_deletion_guard
BEFORE UPDATE OF fixture_files, package_object_ref, deletion_state,
  deletion_tombstone_id ON appsea.plan_package_versions FOR EACH ROW
EXECUTE FUNCTION appsea.guard_plan_deletion_state();

REVOKE ALL ON FUNCTION appsea.expire_source_quota_reservations(text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.purge_source_quota_reservations(text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appsea.expire_source_quota_reservations(text, timestamptz, integer)
  TO appsea_service;
GRANT EXECUTE ON FUNCTION appsea.purge_source_quota_reservations(text, timestamptz, integer)
  TO appsea_service;
GRANT UPDATE (structured_report, markdown_object_ref)
  ON appsea.report_versions TO appsea_service;
GRANT UPDATE (fixture_files, package_object_ref)
  ON appsea.plan_package_versions TO appsea_service;
REVOKE ALL ON FUNCTION appsea.guard_source_item_deletion_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_evidence_deletion_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_report_deletion_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION appsea.guard_plan_deletion_state() FROM PUBLIC;
