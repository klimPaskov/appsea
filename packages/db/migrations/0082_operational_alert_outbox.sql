-- Durable, secret-free operational alert delivery. The maintenance role owns
-- only the narrow functions below; runtime and web roles cannot inspect or
-- mutate the outbox directly. A provider outage therefore leaves an
-- idempotent, inspectable retry record instead of relying on process memory.

CREATE TABLE appsea.operational_alert_outbox (
  delivery_id text PRIMARY KEY
    CHECK (delivery_id ~ '^alert:[a-f0-9]{32}$' AND length(delivery_id) = 38),
  payload jsonb NOT NULL
    CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL
    CHECK (payload_hash ~ '^[a-f0-9]{64}$' AND length(payload_hash) = 64),
  state text NOT NULL
    CHECK (state IN ('pending', 'sending', 'sent', 'exhausted')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL,
  claim_id uuid,
  claimed_by text
    CHECK (claimed_by IS NULL OR (claimed_by ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
      AND length(claimed_by) BETWEEN 3 AND 160)),
  claim_expires_at timestamptz,
  sent_at timestamptz,
  last_failure_code text
    CHECK (last_failure_code IS NULL OR (last_failure_code ~ '^[A-Z][A-Z0-9_:-]+$'
      AND length(last_failure_code) <= 80)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT operational_alert_claim_fields_check CHECK (
    (state = 'sending'
      AND claim_id IS NOT NULL
      AND claimed_by IS NOT NULL
      AND claim_expires_at IS NOT NULL)
    OR (state <> 'sending'
      AND claim_id IS NULL
      AND claimed_by IS NULL
      AND claim_expires_at IS NULL)
  ),
  CONSTRAINT operational_alert_sent_fields_check CHECK (
    (state = 'sent' AND sent_at IS NOT NULL)
    OR (state <> 'sent' AND sent_at IS NULL)
  ),
  CONSTRAINT operational_alert_attempt_state_check CHECK (
    (state = 'pending' AND attempt_count < 5)
    OR (state = 'sending' AND attempt_count BETWEEN 1 AND 5)
    OR state IN ('sent', 'exhausted')
  )
);

CREATE INDEX operational_alert_outbox_claim_idx
  ON appsea.operational_alert_outbox (state, available_at, created_at, delivery_id);

DO $$
DECLARE
  maintenance_role pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO maintenance_role FROM pg_roles WHERE rolname = 'appsea_maintenance';
  IF maintenance_role.rolname IS NULL THEN
    RAISE EXCEPTION
      'appsea_maintenance role must be provisioned before migration 0082'
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

REVOKE ALL ON appsea.operational_alert_outbox FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT USAGE ON SCHEMA appsea TO appsea_maintenance;

CREATE OR REPLACE FUNCTION appsea.assert_operational_alert_payload(
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  payload_entry record;
BEGIN
  IF p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_object_length(p_payload) > 80
     OR p_payload->>'schemaVersion' <> '1'
     OR p_payload->>'service' <> 'appsea-worker'
     OR p_payload->>'observedAt' IS NULL
     OR p_payload->>'event' !~ '^[a-z][a-z0-9_:-]+$'
     OR length(p_payload->>'event') NOT BETWEEN 3 AND 120
     OR p_payload->>'taskQueue' !~ '^[a-z][a-z0-9_-]+$'
     OR length(p_payload->>'taskQueue') NOT BETWEEN 3 AND 160
     OR (p_payload ? 'schedulerName' AND p_payload->>'schedulerName' !~ '^[a-z][a-z0-9_-]{2,79}$')
     OR (p_payload ? 'jobId' AND p_payload->>'jobId' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$')
     OR (p_payload ? 'workflowId' AND p_payload->>'workflowId' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$')
     OR (p_payload ? 'state' AND p_payload->>'state' !~ '^[a-z][a-z0-9_:-]*$')
     OR (p_payload ? 'failureCode' AND p_payload->>'failureCode' !~ '^[A-Z][A-Z0-9_:-]+$')
     OR (p_payload ? 'attempt'
         AND (jsonb_typeof(p_payload->'attempt') <> 'number'
              OR (p_payload->>'attempt') !~ '^[0-9]+$'
              OR (p_payload->>'attempt')::numeric > 1000000)) THEN
    RAISE EXCEPTION 'invalid operational alert payload'
      USING ERRCODE = '22023';
  END IF;

  FOR payload_entry IN SELECT key, value FROM jsonb_each(p_payload) LOOP
    IF payload_entry.key NOT IN (
      'schemaVersion', 'service', 'observedAt', 'event', 'taskQueue',
      'schedulerName', 'jobId', 'workflowId', 'state', 'attempt',
      'workspacesScanned', 'sourceItems', 'snapshotPagesScanned',
      'snapshotSourceRecords', 'snapshotDeletionsQueued', 'snapshotCoverageGaps',
      'costMicros', 'sessionsDeleted', 'rateLimitsDeleted',
      'passwordResetTokensDeleted', 'workspaceInvitationsDeleted',
      'mfaChallengesDeleted', 'mfaEventsDeleted', 'mfaPendingEnrollmentsDeleted',
      'passwordResetDeliveriesClaimed', 'passwordResetDeliveriesSent',
      'passwordResetDeliveriesFailed', 'workspaceInvitationDeliveriesClaimed',
      'workspaceInvitationDeliveriesSent', 'workspaceInvitationDeliveriesFailed',
      'quotaReservationsExpired', 'quotaReservationsPurged',
      'sourceQuotaReconciliationOpenCases', 'sourceQuotaReconciliationOldestAgeSeconds',
      'sourceQuotaReconciliationTruncated', 'productionAnalysisRecomputeJobs',
      'productionAnalysisRecomputeFailed', 'productionAnalysisRecomputeBlocked',
      'productionAnalysisRecomputeStale', 'productionAnalysisRecomputeOldestAgeSeconds',
      'productionAnalysisRecomputeTruncated', 'workspaceCostAlertRows',
      'workspaceCostAlertEntries', 'workspaceCostAlertTargetRows',
      'workspaceCostAlertUnsupportedRows', 'workspaceCostAlertWorkspacesOverActual',
      'workspaceCostAlertWorkspacesOverEstimated', 'workspaceCostAlertTruncated',
      'productionWorkflowAdmissionsPurged', 'productionAnalysisAdmissionsPurged',
      'sourceCollectionLeasesPurged', 'productionAnalysisObjectsPurged',
      'sourceSnapshotReconciliationsProcessed', 'sourceSnapshotReconciliationsCompleted',
      'sourceSnapshotReconciliationsIncomplete', 'sourceSnapshotReconciliationsFailed',
      'sourceSnapshotReconciliationsRetried', 'sourceSnapshotCoverageGaps',
      'campaignRefreshClaims', 'campaignRefreshDispatched', 'campaignRefreshFailed',
      'campaignRefreshPolicyDenied', 'campaignOrchestrationClaims',
      'campaignOrchestrationDispatched', 'campaignOrchestrationFailed',
      'campaignOrchestrationPolicyDenied', 'campaignOrchestrationReconciled',
      'productionWorkflowCancellationTargets', 'productionWorkflowCancellationAttempted',
      'productionWorkflowCancellationDispatched', 'productionWorkflowCancellationFailed',
      'retentionTombstonesQueued', 'deletionTombstonesProcessed',
      'deletionObjectsAffected', 'deletionOpportunitiesInvalidated',
      'recomputationJobsQueued', 'maintenancePasses', 'maintenanceFailures',
      'operationalAlertDeliveryClaimed', 'operationalAlertDeliverySent',
      'operationalAlertDeliveryFailed', 'operationalAlertDeliveryExhausted',
      'operationalAlertDeliveryPurged',
      'failureCode'
    )
       OR jsonb_typeof(payload_entry.value) NOT IN ('string', 'number', 'boolean')
       OR (jsonb_typeof(payload_entry.value) = 'string' AND length(payload_entry.value #>> '{}') > 240)
       OR (jsonb_typeof(payload_entry.value) = 'number'
           AND (payload_entry.value::text !~ '^[0-9]+$'
                OR payload_entry.value::text::numeric > 9007199254740991)) THEN
      RAISE EXCEPTION 'invalid operational alert payload field'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION appsea.enqueue_operational_alert(
  p_delivery_id text,
  p_payload jsonb,
  p_payload_hash text,
  p_available_at timestamptz
)
RETURNS TABLE (enqueued boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  existing_hash text;
  existing_payload jsonb;
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_delivery_id IS NULL
     OR p_delivery_id !~ '^alert:[a-f0-9]{32}$'
     OR length(p_delivery_id) <> 38
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[a-f0-9]{64}$'
     OR length(p_payload_hash) <> 64
     OR p_available_at IS NULL
     OR p_available_at < clock_timestamp() - interval '1 day'
     OR p_available_at > clock_timestamp() + interval '1 hour' THEN
    RAISE EXCEPTION 'invalid operational alert enqueue input'
      USING ERRCODE = '22023';
  END IF;
  PERFORM appsea.assert_operational_alert_payload(p_payload);

  SELECT payload_hash, payload
    INTO existing_hash, existing_payload
    FROM appsea.operational_alert_outbox
   WHERE delivery_id = p_delivery_id
   FOR UPDATE;
  IF FOUND THEN
    IF existing_hash <> p_payload_hash OR existing_payload <> p_payload THEN
      RAISE EXCEPTION 'operational alert delivery id conflicts with existing payload'
        USING ERRCODE = '40001';
    END IF;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO appsea.operational_alert_outbox
    (delivery_id, payload, payload_hash, state, attempt_count, available_at)
  VALUES
    (p_delivery_id, p_payload, p_payload_hash, 'pending', 0, p_available_at);
  RETURN QUERY SELECT true;
END
$$;

CREATE OR REPLACE FUNCTION appsea.claim_operational_alerts(
  p_owner_id text,
  p_claim_id uuid,
  p_limit integer,
  p_claim_ttl_seconds integer
)
RETURNS TABLE (
  delivery_id text,
  payload jsonb,
  attempt_count integer,
  claim_id uuid,
  claimed_by text,
  claim_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_owner_id IS NULL
     OR p_owner_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_owner_id) NOT BETWEEN 3 AND 160
     OR p_claim_id IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR p_claim_ttl_seconds NOT BETWEEN 30 AND 3600 THEN
    RAISE EXCEPTION 'invalid operational alert claim input'
      USING ERRCODE = '22023';
  END IF;

  WITH stale AS (
    SELECT outbox.delivery_id
      FROM appsea.operational_alert_outbox outbox
      WHERE outbox.state = 'sending'
        AND outbox.claim_expires_at <= clock_timestamp()
      ORDER BY outbox.claim_expires_at, outbox.delivery_id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
  )
  UPDATE appsea.operational_alert_outbox outbox
     SET state = CASE WHEN outbox.attempt_count >= 5 THEN 'exhausted' ELSE 'pending' END,
         claim_id = NULL,
         claimed_by = NULL,
         claim_expires_at = NULL,
         last_failure_code = CASE
           WHEN outbox.attempt_count >= 5 THEN 'APPSEA_ALERT_DELIVERY_ATTEMPTS_EXHAUSTED'
           ELSE outbox.last_failure_code
         END,
         updated_at = clock_timestamp()
   WHERE outbox.delivery_id IN (SELECT stale.delivery_id FROM stale);

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.delivery_id
      FROM appsea.operational_alert_outbox outbox
      WHERE outbox.state = 'pending'
        AND outbox.attempt_count < 5
        AND outbox.available_at <= clock_timestamp()
      ORDER BY outbox.available_at, outbox.created_at, outbox.delivery_id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE appsea.operational_alert_outbox outbox
       SET state = 'sending',
           attempt_count = outbox.attempt_count + 1,
           claim_id = p_claim_id,
           claimed_by = p_owner_id,
           claim_expires_at = clock_timestamp() + make_interval(secs => p_claim_ttl_seconds),
           updated_at = clock_timestamp()
     WHERE outbox.delivery_id IN (SELECT candidates.delivery_id FROM candidates)
     RETURNING outbox.delivery_id, outbox.payload, outbox.attempt_count,
               outbox.claim_id, outbox.claimed_by, outbox.claim_expires_at
  )
  SELECT claimed.delivery_id, claimed.payload, claimed.attempt_count,
         claimed.claim_id, claimed.claimed_by, claimed.claim_expires_at
    FROM claimed
   ORDER BY claimed.delivery_id;
END
$$;

CREATE OR REPLACE FUNCTION appsea.complete_operational_alert(
  p_delivery_id text,
  p_owner_id text,
  p_claim_id uuid,
  p_sent_at timestamptz
)
RETURNS TABLE (completed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_delivery_id IS NULL
     OR p_delivery_id !~ '^alert:[a-f0-9]{32}$'
     OR p_owner_id IS NULL
     OR p_owner_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_owner_id) NOT BETWEEN 3 AND 160
     OR p_claim_id IS NULL
     OR p_sent_at IS NULL
     OR p_sent_at > clock_timestamp() + interval '1 hour' THEN
    RAISE EXCEPTION 'invalid operational alert completion input'
      USING ERRCODE = '22023';
  END IF;

  UPDATE appsea.operational_alert_outbox
     SET state = 'sent',
         claim_id = NULL,
         claimed_by = NULL,
         claim_expires_at = NULL,
         sent_at = p_sent_at,
         last_failure_code = NULL,
         updated_at = clock_timestamp()
   WHERE delivery_id = p_delivery_id
     AND state = 'sending'
     AND claimed_by = p_owner_id
     AND claim_id = p_claim_id;
  RETURN QUERY SELECT FOUND;
END
$$;

CREATE OR REPLACE FUNCTION appsea.fail_operational_alert(
  p_delivery_id text,
  p_owner_id text,
  p_claim_id uuid,
  p_failure_code text,
  p_retry_at timestamptz
)
RETURNS TABLE (applied boolean, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  next_state text;
BEGIN
  IF session_user <> 'appsea_maintenance'
     OR p_delivery_id IS NULL
     OR p_delivery_id !~ '^alert:[a-f0-9]{32}$'
     OR p_owner_id IS NULL
     OR p_owner_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_owner_id) NOT BETWEEN 3 AND 160
     OR p_claim_id IS NULL
     OR p_failure_code IS NULL
     OR p_failure_code !~ '^[A-Z][A-Z0-9_:-]+$'
     OR length(p_failure_code) > 80
     OR p_retry_at IS NULL
     OR p_retry_at < clock_timestamp()
     OR p_retry_at > clock_timestamp() + interval '1 day' THEN
    RAISE EXCEPTION 'invalid operational alert failure input'
      USING ERRCODE = '22023';
  END IF;

  UPDATE appsea.operational_alert_outbox
     SET state = CASE WHEN attempt_count >= 5 THEN 'exhausted' ELSE 'pending' END,
         available_at = CASE WHEN attempt_count >= 5 THEN available_at ELSE p_retry_at END,
         claim_id = NULL,
         claimed_by = NULL,
         claim_expires_at = NULL,
         last_failure_code = p_failure_code,
         updated_at = clock_timestamp()
   WHERE delivery_id = p_delivery_id
     AND state = 'sending'
     AND claimed_by = p_owner_id
     AND claim_id = p_claim_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;
  SELECT outbox.state INTO next_state
    FROM appsea.operational_alert_outbox outbox
   WHERE outbox.delivery_id = p_delivery_id;
  RETURN QUERY SELECT true, next_state;
END
$$;

CREATE OR REPLACE FUNCTION appsea.purge_operational_alerts(
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
    RAISE EXCEPTION 'invalid operational alert purge input'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM appsea.operational_alert_outbox
   WHERE delivery_id IN (
     SELECT outbox.delivery_id
       FROM appsea.operational_alert_outbox outbox
      WHERE outbox.state IN ('sent', 'exhausted')
        AND outbox.updated_at < p_before
      ORDER BY outbox.updated_at, outbox.delivery_id
      LIMIT p_limit
   );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN QUERY SELECT deleted_count;
END
$$;

REVOKE ALL ON FUNCTION appsea.assert_operational_alert_payload(jsonb)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.enqueue_operational_alert(text, jsonb, text, timestamptz)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.claim_operational_alerts(text, uuid, integer, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.complete_operational_alert(text, text, uuid, timestamptz)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.fail_operational_alert(text, text, uuid, text, timestamptz)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.purge_operational_alerts(timestamptz, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;

GRANT EXECUTE ON FUNCTION appsea.enqueue_operational_alert(text, jsonb, text, timestamptz)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.claim_operational_alerts(text, uuid, integer, integer)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.complete_operational_alert(text, text, uuid, timestamptz)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.fail_operational_alert(text, text, uuid, text, timestamptz)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.purge_operational_alerts(timestamptz, integer)
  TO appsea_maintenance;

-- Migration 0046 originally allowlisted only the first four maintenance
-- commands. These forward-compatible v2 functions add the three existing
-- alert scans and the durable outbox drain without editing released history.
-- The old functions remain available for legacy callers.

CREATE OR REPLACE FUNCTION appsea.is_allowed_maintenance_scheduler_name(
  p_scheduler_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, appsea
AS $$
  SELECT p_scheduler_name IN (
    'appsea-source-maintenance-v1',
    'appsea-auth-maintenance-v1',
    'appsea-auth-recovery-v1',
    'appsea-workspace-invitations-v1',
    'appsea-source-quota-alerts-v1',
    'appsea-production-analysis-recompute-alerts-v1',
    'appsea-workspace-cost-alerts-v1',
    'appsea-operational-alert-delivery-v1'
  )
$$;

CREATE OR REPLACE FUNCTION appsea.acquire_maintenance_scheduler_lease_v2(
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
     OR NOT appsea.is_allowed_maintenance_scheduler_name(p_scheduler_name)
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
  VALUES
    (p_scheduler_name, p_owner_id, p_lease_token, now_at, next_until, now_at)
  ON CONFLICT (scheduler_name) DO UPDATE
    SET owner_id = EXCLUDED.owner_id,
        lease_token = EXCLUDED.lease_token,
        acquired_at = EXCLUDED.acquired_at,
        lease_until = EXCLUDED.lease_until,
        updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT true, next_until, p_lease_token;
END
$$;

CREATE OR REPLACE FUNCTION appsea.renew_maintenance_scheduler_lease_v2(
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
     OR NOT appsea.is_allowed_maintenance_scheduler_name(p_scheduler_name)
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

CREATE OR REPLACE FUNCTION appsea.release_maintenance_scheduler_lease_v2(
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
     OR NOT appsea.is_allowed_maintenance_scheduler_name(p_scheduler_name)
     OR p_owner_id IS NULL
     OR p_owner_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$'
     OR length(p_owner_id) NOT BETWEEN 3 AND 160
     OR p_lease_token IS NULL
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

CREATE OR REPLACE FUNCTION appsea.record_maintenance_scheduler_run_v2(
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
     OR NOT appsea.is_allowed_maintenance_scheduler_name(p_scheduler_name)
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

CREATE OR REPLACE FUNCTION appsea.list_maintenance_scheduler_runs_v2(
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
     OR (p_scheduler_name IS NOT NULL
         AND NOT appsea.is_allowed_maintenance_scheduler_name(p_scheduler_name))
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

REVOKE ALL ON FUNCTION appsea.is_allowed_maintenance_scheduler_name(text)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.acquire_maintenance_scheduler_lease_v2(text, text, text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.renew_maintenance_scheduler_lease_v2(text, text, text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.release_maintenance_scheduler_lease_v2(text, text, text)
  FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.record_maintenance_scheduler_run_v2(
  text, text, text, text, timestamptz, timestamptz, integer, text, jsonb
) FROM PUBLIC, appsea_service, appsea_maintenance;
REVOKE ALL ON FUNCTION appsea.list_maintenance_scheduler_runs_v2(text, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;

GRANT EXECUTE ON FUNCTION appsea.acquire_maintenance_scheduler_lease_v2(text, text, text, integer)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.renew_maintenance_scheduler_lease_v2(text, text, text, integer)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.release_maintenance_scheduler_lease_v2(text, text, text)
  TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.record_maintenance_scheduler_run_v2(
  text, text, text, text, timestamptz, timestamptz, integer, text, jsonb
) TO appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.list_maintenance_scheduler_runs_v2(text, integer)
  TO appsea_maintenance;
