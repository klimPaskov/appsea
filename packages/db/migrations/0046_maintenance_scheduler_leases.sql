-- Scheduled maintenance is safe to retry, but two scheduler instances must
-- not perform the same bounded pass concurrently.  This lease is deliberately
-- a narrow service boundary: runtime code can acquire, renew, and release a
-- named lease through SECURITY DEFINER functions, but cannot inspect or edit
-- the table directly.

CREATE TABLE appsea.maintenance_scheduler_leases (
  scheduler_name text PRIMARY KEY
    CHECK (scheduler_name ~ '^[a-z][a-z0-9_-]+$' AND length(scheduler_name) BETWEEN 3 AND 80),
  owner_id text NOT NULL
    CHECK (owner_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$' AND length(owner_id) BETWEEN 3 AND 160),
  lease_token text NOT NULL
    CHECK (lease_token ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$' AND length(lease_token) BETWEEN 16 AND 128),
  acquired_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT maintenance_scheduler_lease_window_check CHECK (lease_until > acquired_at)
);

DO $$
DECLARE
  maintenance_role pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO maintenance_role FROM pg_roles WHERE rolname = 'appsea_maintenance';
  IF maintenance_role.rolname IS NULL THEN
    RAISE EXCEPTION
      'appsea_maintenance role must be provisioned before migration 0046'
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

REVOKE ALL ON appsea.maintenance_scheduler_leases FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE appsea_maintenance FROM appsea_service;
GRANT USAGE ON SCHEMA appsea TO appsea_maintenance;

CREATE OR REPLACE FUNCTION appsea.acquire_maintenance_scheduler_lease(
  p_scheduler_name text,
  p_owner_id text,
  p_lease_token text,
  p_lease_seconds integer
)
RETURNS TABLE (acquired boolean, lease_until timestamptz, lease_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  existing appsea.maintenance_scheduler_leases%ROWTYPE;
  now_at timestamptz;
  next_until timestamptz;
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_scheduler_name IS NULL
     OR p_scheduler_name !~ '^[a-z][a-z0-9_-]+$'
     OR length(p_scheduler_name) NOT BETWEEN 3 AND 80
     OR p_scheduler_name NOT IN (
       'appsea-source-maintenance-v1',
       'appsea-auth-maintenance-v1',
       'appsea-auth-recovery-v1',
       'appsea-workspace-invitations-v1'
     )
     OR p_owner_id IS NULL
     OR p_owner_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_owner_id) NOT BETWEEN 3 AND 160
     OR p_lease_token IS NULL
     OR p_lease_token !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_lease_token) NOT BETWEEN 16 AND 128
     OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'invalid maintenance scheduler lease input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('maintenance-scheduler-lease:' || p_scheduler_name, 0)
  );
  SELECT * INTO existing
    FROM appsea.maintenance_scheduler_leases
   WHERE scheduler_name = p_scheduler_name
   FOR UPDATE;
  now_at := clock_timestamp();
  next_until := now_at + make_interval(secs => p_lease_seconds);

  IF existing.scheduler_name IS NOT NULL
     AND existing.lease_until > now_at THEN
    RETURN QUERY SELECT false, existing.lease_until, NULL::text;
    RETURN;
  END IF;

  INSERT INTO appsea.maintenance_scheduler_leases
    (scheduler_name, owner_id, lease_token, acquired_at, lease_until, updated_at)
  VALUES (p_scheduler_name, p_owner_id, p_lease_token, now_at, next_until, now_at)
  ON CONFLICT (scheduler_name) DO UPDATE
    SET owner_id = EXCLUDED.owner_id,
        lease_token = EXCLUDED.lease_token,
        acquired_at = EXCLUDED.acquired_at,
        lease_until = EXCLUDED.lease_until,
        updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT true, next_until, p_lease_token;
END
$$;

CREATE OR REPLACE FUNCTION appsea.renew_maintenance_scheduler_lease(
  p_scheduler_name text,
  p_owner_id text,
  p_lease_token text,
  p_lease_seconds integer
)
RETURNS TABLE (renewed boolean, lease_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  existing appsea.maintenance_scheduler_leases%ROWTYPE;
  now_at timestamptz;
  next_until timestamptz;
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_scheduler_name IS NULL
     OR p_scheduler_name !~ '^[a-z][a-z0-9_-]+$'
     OR length(p_scheduler_name) NOT BETWEEN 3 AND 80
     OR p_scheduler_name NOT IN (
       'appsea-source-maintenance-v1',
       'appsea-auth-maintenance-v1',
       'appsea-auth-recovery-v1',
       'appsea-workspace-invitations-v1'
     )
     OR p_owner_id IS NULL
     OR p_owner_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_owner_id) NOT BETWEEN 3 AND 160
     OR p_lease_token IS NULL
     OR p_lease_token !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_lease_token) NOT BETWEEN 16 AND 128
     OR p_lease_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'invalid maintenance scheduler lease input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('maintenance-scheduler-lease:' || p_scheduler_name, 0)
  );
  SELECT * INTO existing
    FROM appsea.maintenance_scheduler_leases
   WHERE scheduler_name = p_scheduler_name
   FOR UPDATE;
  now_at := clock_timestamp();
  next_until := now_at + make_interval(secs => p_lease_seconds);
  IF existing.scheduler_name IS NOT NULL
     AND existing.owner_id = p_owner_id
     AND existing.lease_token = p_lease_token
     AND existing.lease_until > now_at THEN
    UPDATE appsea.maintenance_scheduler_leases
       SET lease_until = next_until, updated_at = now_at
     WHERE scheduler_name = p_scheduler_name;
    RETURN QUERY SELECT true, next_until;
  ELSE
    RETURN QUERY SELECT false, NULL::timestamptz;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION appsea.release_maintenance_scheduler_lease(
  p_scheduler_name text,
  p_owner_id text,
  p_lease_token text
)
RETURNS TABLE (released boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_scheduler_name IS NULL
     OR p_scheduler_name !~ '^[a-z][a-z0-9_-]+$'
     OR length(p_scheduler_name) NOT BETWEEN 3 AND 80
     OR p_scheduler_name NOT IN (
       'appsea-source-maintenance-v1',
       'appsea-auth-maintenance-v1',
       'appsea-auth-recovery-v1',
       'appsea-workspace-invitations-v1'
     )
     OR p_owner_id IS NULL
     OR p_owner_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_owner_id) NOT BETWEEN 3 AND 160 THEN
    RAISE EXCEPTION 'invalid maintenance scheduler lease input'
      USING ERRCODE = '22023';
  END IF;

  IF p_lease_token IS NULL
     OR p_lease_token !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_lease_token) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'invalid maintenance scheduler lease input'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM appsea.maintenance_scheduler_leases
   WHERE scheduler_name = p_scheduler_name
     AND owner_id = p_owner_id
     AND lease_token = p_lease_token
     AND lease_until > clock_timestamp();
  RETURN QUERY SELECT FOUND;
END
$$;

REVOKE ALL ON FUNCTION appsea.acquire_maintenance_scheduler_lease(text, text, text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.renew_maintenance_scheduler_lease(text, text, text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.release_maintenance_scheduler_lease(text, text, text)
  FROM PUBLIC, appsea_service, appsea_maintenance;

GRANT EXECUTE ON FUNCTION appsea.acquire_maintenance_scheduler_lease(text, text, text, integer)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.renew_maintenance_scheduler_lease(text, text, text, integer)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.release_maintenance_scheduler_lease(text, text, text)
  TO appsea_maintenance;
