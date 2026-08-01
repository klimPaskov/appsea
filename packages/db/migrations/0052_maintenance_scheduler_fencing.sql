-- A scheduler lease prevents duplicate starts, but a local lease check alone
-- cannot stop a service transaction that begins just before a lease expires.
-- This security-definer assertion is called inside the same appsea_service
-- transaction as the mutation.  The advisory and row locks remain held until
-- that transaction commits, so an expired lease cannot be taken over while a
-- fenced mutation is still in flight.

CREATE OR REPLACE FUNCTION appsea.assert_maintenance_scheduler_lease(
  p_scheduler_name text,
  p_owner_id text,
  p_lease_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  existing appsea.maintenance_scheduler_leases%ROWTYPE;
  now_at timestamptz;
BEGIN
  IF session_user <> 'appsea_service'
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
     OR length(p_lease_token) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'invalid maintenance scheduler fence input'
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

  RETURN existing.scheduler_name IS NOT NULL
     AND existing.owner_id = p_owner_id
     AND existing.lease_token = p_lease_token
     AND existing.lease_until > now_at;
END
$$;

REVOKE ALL ON FUNCTION appsea.assert_maintenance_scheduler_lease(text, text, text)
  FROM PUBLIC, appsea_maintenance, appsea_service;
GRANT EXECUTE ON FUNCTION appsea.assert_maintenance_scheduler_lease(text, text, text)
  TO appsea_service;
