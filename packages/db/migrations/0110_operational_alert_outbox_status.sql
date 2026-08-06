BEGIN;

-- Extend the released maintenance scheduler boundary without editing
-- migration 0082 or 0109. The status reader is a separate lease and does not
-- enqueue, claim, complete, fail, purge, or deliver an alert.
ALTER TABLE appsea.maintenance_scheduler_runs
  DROP CONSTRAINT maintenance_scheduler_runs_scheduler_name_check;
ALTER TABLE appsea.maintenance_scheduler_runs
  ADD CONSTRAINT maintenance_scheduler_runs_scheduler_name_check CHECK (
    scheduler_name IN (
      'appsea-source-maintenance-v1',
      'appsea-auth-maintenance-v1',
      'appsea-auth-recovery-v1',
      'appsea-workspace-invitations-v1',
      'appsea-source-quota-alerts-v1',
      'appsea-source-health-alerts-v1',
      'appsea-production-analysis-recompute-alerts-v1',
      'appsea-workspace-cost-alerts-v1',
      'appsea-operational-alert-delivery-v1',
      'appsea-operational-alert-status-v1'
    )
  );

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
    'appsea-source-health-alerts-v1',
    'appsea-production-analysis-recompute-alerts-v1',
    'appsea-workspace-cost-alerts-v1',
    'appsea-operational-alert-delivery-v1',
    'appsea-operational-alert-status-v1'
  )
$$;

-- Return only bounded scalar state. Payloads, locators, failure context, and
-- provider configuration never cross this read boundary. Rows are ordered so
-- exhausted and stale/aged work is observed before a truncation is reported.
CREATE OR REPLACE FUNCTION appsea.read_operational_alert_outbox_status(
  p_limit integer,
  p_alert_after_seconds integer
)
RETURNS TABLE (
  observed_at timestamptz,
  pending_count integer,
  sending_count integer,
  exhausted_count integer,
  oldest_open_age_seconds integer,
  truncated boolean,
  state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, appsea
AS $$
DECLARE
  observed_at_value timestamptz := clock_timestamp();
BEGIN
  IF session_user <> 'appsea_maintenance' THEN
    RAISE EXCEPTION 'operational alert outbox status requires the maintenance role'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000
     OR p_alert_after_seconds IS NULL OR p_alert_after_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'invalid operational alert outbox status input'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT outbox.state,
           outbox.created_at,
           outbox.claim_expires_at,
           CASE
             WHEN outbox.state = 'exhausted' THEN 0
             WHEN outbox.state = 'sending'
               AND outbox.claim_expires_at <= observed_at_value THEN 1
             WHEN outbox.created_at <= observed_at_value
               - (p_alert_after_seconds * interval '1 second') THEN 2
             ELSE 3
           END AS priority,
           outbox.delivery_id
      FROM appsea.operational_alert_outbox outbox
     WHERE outbox.state IN ('pending', 'sending', 'exhausted')
     ORDER BY priority, outbox.created_at, outbox.delivery_id
     LIMIT p_limit + 1
  ), sample AS (
    SELECT candidates.*
      FROM candidates
     ORDER BY candidates.priority, candidates.created_at, candidates.delivery_id
     LIMIT p_limit
  ), summary AS (
    SELECT COUNT(*) FILTER (WHERE sample.state = 'pending')::integer AS pending_count,
           COUNT(*) FILTER (WHERE sample.state = 'sending')::integer AS sending_count,
           COUNT(*) FILTER (WHERE sample.state = 'exhausted')::integer AS exhausted_count,
           CASE
             WHEN MIN(sample.created_at) IS NULL THEN NULL
             ELSE LEAST(
               2147483647::bigint,
               GREATEST(
                 0::bigint,
                 FLOOR(EXTRACT(EPOCH FROM (observed_at_value - MIN(sample.created_at))))::bigint
               )
             )::integer
           END AS oldest_open_age_seconds,
           COALESCE((SELECT COUNT(*) > p_limit FROM candidates), false) AS truncated,
           COALESCE(BOOL_OR(sample.state = 'exhausted'), false) AS saw_exhausted,
           COALESCE(
             BOOL_OR(
               (sample.state = 'sending' AND sample.claim_expires_at <= observed_at_value)
               OR (
                 sample.state IN ('pending', 'sending')
                 AND sample.created_at <= observed_at_value
                   - (p_alert_after_seconds * interval '1 second')
               )
             ),
             false
           ) AS saw_breach
      FROM sample
  )
  SELECT observed_at_value,
         summary.pending_count,
         summary.sending_count,
         summary.exhausted_count,
         summary.oldest_open_age_seconds,
         summary.truncated,
         CASE
           WHEN summary.saw_exhausted OR summary.saw_breach THEN 'alert'
           WHEN summary.truncated THEN 'incomplete'
           ELSE 'clear'
         END
    FROM summary;
END
$$;

REVOKE ALL ON FUNCTION appsea.read_operational_alert_outbox_status(integer, integer)
  FROM PUBLIC, appsea_service, appsea_maintenance;
GRANT EXECUTE ON FUNCTION appsea.read_operational_alert_outbox_status(integer, integer)
  TO appsea_maintenance;

COMMENT ON FUNCTION appsea.read_operational_alert_outbox_status(integer, integer) IS
  'Returns bounded scalar pending, sending, exhausted, age, and truncation state for maintenance inspection; never returns outbox payloads.';

-- Keep the durable scalar allowlist forward-compatible with status events even
-- though the status command intentionally emits locally and never enqueues its
-- own observation (which would create a self-referential backlog).
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
     OR (SELECT count(*) FROM jsonb_object_keys(p_payload)) > 80
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
      'sourceQuotaReconciliationTruncated', 'sourceHealthSourcesObserved',
      'sourceHealthCollectibleSources', 'sourceHealthBlockedSources',
      'sourceHealthUnknownSources', 'sourceHealthDegradedSources',
      'sourceHealthStaleSources', 'sourceHealthExhaustedSources',
      'sourceHealthOldestDegradedAgeSeconds', 'sourceHealthTruncated',
      'productionAnalysisRecomputeJobs', 'productionAnalysisRecomputeFailed',
      'productionAnalysisRecomputeBlocked', 'productionAnalysisRecomputeStale',
      'productionAnalysisRecomputeOldestAgeSeconds', 'productionAnalysisRecomputeTruncated',
      'workspaceCostAlertRows', 'workspaceCostAlertEntries',
      'workspaceCostAlertTargetRows', 'workspaceCostAlertUnsupportedRows',
      'workspaceCostAlertWorkspacesOverActual', 'workspaceCostAlertWorkspacesOverEstimated',
      'workspaceCostAlertTruncated', 'productionWorkflowAdmissionsPurged',
      'productionAnalysisAdmissionsPurged', 'sourceCollectionLeasesPurged',
      'productionAnalysisObjectsPurged', 'sourceSnapshotReconciliationsProcessed',
      'sourceSnapshotReconciliationsCompleted', 'sourceSnapshotReconciliationsIncomplete',
      'sourceSnapshotReconciliationsFailed', 'sourceSnapshotReconciliationsRetried',
      'sourceSnapshotCoverageGaps', 'campaignRefreshClaims',
      'campaignRefreshDispatched', 'campaignRefreshFailed',
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
      'operationalAlertDeliveryPurged', 'operationalAlertOutboxPending',
      'operationalAlertOutboxSending', 'operationalAlertOutboxExhausted',
      'operationalAlertOutboxOldestAgeSeconds', 'operationalAlertOutboxTruncated',
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

COMMIT;
