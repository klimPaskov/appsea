BEGIN;

-- Migration 0082 allowlisted four alert schedulers and the outbox drain.
-- Extend that released boundary forward for the scalar source-health scan;
-- editing 0082 would invalidate already-applied checksums.
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
      'appsea-operational-alert-delivery-v1'
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
    'appsea-operational-alert-delivery-v1'
  )
$$;

-- Keep the durable outbox scalar allowlist in lockstep with the worker event
-- projection. Raw source payloads and arbitrary objects remain rejected.
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
      'operationalAlertDeliveryPurged', 'failureCode'
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
