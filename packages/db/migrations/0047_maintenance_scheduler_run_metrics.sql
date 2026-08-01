-- Persist bounded, secret-free scheduler outcomes for operator inspection and
-- deployment alerting.  Runtime roles cannot read or write this table
-- directly; the standalone maintenance role uses narrow SECURITY DEFINER
-- functions so lease tokens, source content, and exception messages never
-- become durable telemetry.

CREATE TABLE appsea.maintenance_scheduler_runs (
  run_id text PRIMARY KEY
    CHECK (run_id ~ '^maintenance:[a-z0-9_:-]+$' AND length(run_id) BETWEEN 3 AND 160),
  scheduler_name text NOT NULL
    CHECK (scheduler_name IN (
      'appsea-source-maintenance-v1',
      'appsea-auth-maintenance-v1',
      'appsea-auth-recovery-v1',
      'appsea-workspace-invitations-v1'
    )),
  owner_id text NOT NULL
    CHECK (owner_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$' AND length(owner_id) BETWEEN 3 AND 160),
  state text NOT NULL CHECK (state IN ('contended', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
  failure_code text,
  counters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT maintenance_scheduler_run_window_check CHECK (finished_at >= started_at),
  CONSTRAINT maintenance_scheduler_run_failure_check CHECK (
    (state = 'failed' AND failure_code IS NOT NULL)
    OR (state <> 'failed' AND failure_code IS NULL)
  ),
  CONSTRAINT maintenance_scheduler_run_failure_code_check CHECK (
    failure_code IS NULL
    OR (failure_code ~ '^[A-Z][A-Z0-9_:-]+$' AND length(failure_code) <= 80)
  ),
  CONSTRAINT maintenance_scheduler_run_counters_check CHECK (
    jsonb_typeof(counters) = 'object'
  )
);

CREATE INDEX maintenance_scheduler_runs_scheduler_idx
  ON appsea.maintenance_scheduler_runs (scheduler_name, finished_at DESC, run_id);

DO $$
DECLARE
  maintenance_role pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO maintenance_role FROM pg_roles WHERE rolname = 'appsea_maintenance';
  IF maintenance_role.rolname IS NULL THEN
    RAISE EXCEPTION
      'appsea_maintenance role must be provisioned before migration 0047'
      USING ERRCODE = '42704';
  END IF;
  IF maintenance_role.rolsuper
     OR maintenance_role.rolbypassrls
     OR maintenance_role.rolcreaterole
     OR maintenance_role.rolcreatedb
     OR maintenance_role.rolreplication
     OR NOT maintenance_role.rolcanlogin
     OR maintenance_role.rolinherit
     OR EXISTS (
       SELECT 1
         FROM pg_auth_members membership
        WHERE membership.member = maintenance_role.oid
           OR membership.roleid = maintenance_role.oid
     ) THEN
    RAISE EXCEPTION
      'appsea_maintenance role must be a standalone least-privilege login role'
      USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON appsea.maintenance_scheduler_runs FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT USAGE ON SCHEMA appsea TO appsea_maintenance;

CREATE OR REPLACE FUNCTION appsea.record_maintenance_scheduler_run(
  p_run_id text,
  p_scheduler_name text,
  p_owner_id text,
  p_state text,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_duration_ms integer,
  p_failure_code text,
  p_counters jsonb
)
RETURNS TABLE (recorded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  counter_entry record;
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_run_id IS NULL
     OR p_run_id !~ '^maintenance:[a-z0-9_:-]+$'
     OR length(p_run_id) NOT BETWEEN 3 AND 160
     OR p_scheduler_name IS NULL
     OR p_scheduler_name NOT IN (
       'appsea-source-maintenance-v1',
       'appsea-auth-maintenance-v1',
       'appsea-auth-recovery-v1',
       'appsea-workspace-invitations-v1'
     )
     OR p_owner_id IS NULL
     OR p_owner_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_owner_id) NOT BETWEEN 3 AND 160
     OR p_state NOT IN ('contended', 'succeeded', 'failed')
     OR p_started_at IS NULL
     OR p_finished_at IS NULL
     OR p_finished_at < p_started_at
     OR p_duration_ms NOT BETWEEN 0 AND 86400000
     OR (p_state = 'failed' AND p_failure_code IS NULL)
     OR (p_state <> 'failed' AND p_failure_code IS NOT NULL)
     OR (p_failure_code IS NOT NULL
         AND (p_failure_code !~ '^[A-Z][A-Z0-9_:-]+$'
              OR length(p_failure_code) > 80))
     OR p_counters IS NULL
     OR jsonb_typeof(p_counters) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_counters)) > 64 THEN
    RAISE EXCEPTION 'invalid maintenance scheduler run metric'
      USING ERRCODE = '22023';
  END IF;

  FOR counter_entry IN SELECT key, value FROM jsonb_each(p_counters) LOOP
    IF counter_entry.key !~ '^[a-z][a-zA-Z0-9_]*$'
       OR length(counter_entry.key) > 64
       OR jsonb_typeof(counter_entry.value) <> 'number'
       OR counter_entry.value::text !~ '^[0-9]+$'
       OR (counter_entry.value::text)::numeric > 10000000 THEN
      RAISE EXCEPTION 'invalid maintenance scheduler run counter'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO appsea.maintenance_scheduler_runs
    (run_id, scheduler_name, owner_id, state, started_at, finished_at, duration_ms,
     failure_code, counters)
  VALUES
    (p_run_id, p_scheduler_name, p_owner_id, p_state, p_started_at, p_finished_at,
     p_duration_ms, p_failure_code, p_counters)
  ON CONFLICT (run_id) DO NOTHING;

  RETURN QUERY SELECT FOUND;
END
$$;

CREATE OR REPLACE FUNCTION appsea.purge_maintenance_scheduler_runs(
  p_before timestamptz,
  p_limit integer
)
RETURNS TABLE (purged integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_before IS NULL
     OR p_before > clock_timestamp()
     OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid maintenance scheduler run purge input'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM appsea.maintenance_scheduler_runs
   WHERE run_id IN (
     SELECT run_id
       FROM appsea.maintenance_scheduler_runs
      WHERE finished_at < p_before
      ORDER BY finished_at, run_id
      LIMIT p_limit
   );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN QUERY SELECT deleted_count;
END
$$;

CREATE OR REPLACE FUNCTION appsea.list_maintenance_scheduler_runs(
  p_scheduler_name text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  run_id text,
  scheduler_name text,
  owner_id text,
  state text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  failure_code text,
  counters jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR (p_scheduler_name IS NOT NULL AND p_scheduler_name NOT IN (
       'appsea-source-maintenance-v1',
       'appsea-auth-maintenance-v1',
       'appsea-auth-recovery-v1',
       'appsea-workspace-invitations-v1'
     ))
     OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid maintenance scheduler run list input'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT run.run_id, run.scheduler_name, run.owner_id, run.state,
         run.started_at, run.finished_at, run.duration_ms,
         run.failure_code, run.counters
    FROM appsea.maintenance_scheduler_runs run
   WHERE p_scheduler_name IS NULL OR run.scheduler_name = p_scheduler_name
   ORDER BY run.finished_at DESC, run.run_id DESC
   LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION appsea.record_maintenance_scheduler_run(
  text, text, text, text, timestamptz, timestamptz, integer, text, jsonb
) FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.purge_maintenance_scheduler_runs(timestamptz, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.list_maintenance_scheduler_runs(text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;

GRANT EXECUTE ON FUNCTION appsea.record_maintenance_scheduler_run(
  text, text, text, text, timestamptz, timestamptz, integer, text, jsonb
) TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.purge_maintenance_scheduler_runs(timestamptz, integer)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.list_maintenance_scheduler_runs(text, integer)
  TO appsea_maintenance;
