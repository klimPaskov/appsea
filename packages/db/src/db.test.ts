import { describe, expect, it } from 'vitest'
import { databaseConfigFromEnv } from './config'
import { canonicalJson, contentHash } from './hash'
import { loadMigrations } from './migrations'

describe('database foundation', () => {
  it('canonicalizes JSON before hashing', () => {
    expect(canonicalJson({ beta: [2, { y: true, x: false }], alpha: 1 })).toBe(
      '{"alpha":1,"beta":[2,{"x":false,"y":true}]}'
    )
    expect(contentHash({ left: 1, right: 2 })).toBe(contentHash({ right: 2, left: 1 }))
  })

  it('loads ordered checksummed migrations', async () => {
    const migrations = await loadMigrations()
    expect(migrations.map((migration) => migration.version)).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
      '0021',
      '0022',
      '0023',
      '0024',
      '0025',
      '0026',
      '0027',
      '0028',
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
      '0035',
      '0036',
      '0037',
      '0038',
      '0039',
      '0040',
      '0041',
      '0042',
      '0043',
      '0044',
      '0045',
      '0046',
      '0047',
      '0048',
      '0049',
      '0050',
      '0051',
      '0052',
      '0053'
    ])
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(migrations[0]?.sql).toContain('CREATE TABLE appsea.evidence_records')
    expect(migrations[0]?.sql).toContain('ENABLE ROW LEVEL SECURITY')
    const authMigration = migrations.find((migration) => migration.version === '0008')
    const privacyMigration = migrations.find((migration) => migration.version === '0009')
    const retentionMigration = migrations.find((migration) => migration.version === '0010')
    const quotaMigration = migrations.find((migration) => migration.version === '0011')
    const deletionMigration = migrations.find((migration) => migration.version === '0012')
    const hardeningMigration = migrations.find((migration) => migration.version === '0013')
    const maintenanceMigration = migrations.find((migration) => migration.version === '0014')
    const deletionIntegrityMigration = migrations.find((migration) => migration.version === '0015')
    const deletionClaimMigration = migrations.find((migration) => migration.version === '0016')
    const workflowActorMigration = migrations.find((migration) => migration.version === '0017')
    const workflowActorUpdateMigration = migrations.find(
      (migration) => migration.version === '0018'
    )
    const workflowWorkspaceGateMigration = migrations.find(
      (migration) => migration.version === '0019'
    )
    const workspaceMembershipAdminMigration = migrations.find(
      (migration) => migration.version === '0020'
    )
    const authStepUpMigration = migrations.find((migration) => migration.version === '0021')
    const reportApprovalMigration = migrations.find((migration) => migration.version === '0022')
    const passwordResetMigration = migrations.find((migration) => migration.version === '0023')
    const authRecoveryBoundaryMigration = migrations.find(
      (migration) => migration.version === '0024'
    )
    const workspaceInvitationMigration = migrations.find(
      (migration) => migration.version === '0025'
    )
    const accountClosureMigration = migrations.find((migration) => migration.version === '0026')
    const sourcePolicyApprovalMigration = migrations.find(
      (migration) => migration.version === '0027'
    )
    const productionWorkflowMigration = migrations.find((migration) => migration.version === '0028')
    const sourceRetentionMigration = migrations.find((migration) => migration.version === '0029')
    const productionAnalysisMigration = migrations.find((migration) => migration.version === '0030')
    const planApprovalMigration = migrations.find((migration) => migration.version === '0031')
    const complaintReviewMigration = migrations.find((migration) => migration.version === '0032')
    const seedReviewMigration = migrations.find((migration) => migration.version === '0033')
    const analysisHandoffMigration = migrations.find((migration) => migration.version === '0034')
    const opportunityAvailabilityMigration = migrations.find(
      (migration) => migration.version === '0035'
    )
    const sameRunRecoveryMigration = migrations.find((migration) => migration.version === '0036')
    const recomputationMigration = migrations.find((migration) => migration.version === '0037')
    const productionAdmissionMigration = migrations.find(
      (migration) => migration.version === '0038'
    )
    const sourceCollectionLeaseMigration = migrations.find(
      (migration) => migration.version === '0039'
    )
    const sourceSnapshotReconciliationMigration = migrations.find(
      (migration) => migration.version === '0040'
    )
    const sourceSnapshotPageCheckpointMigration = migrations.find(
      (migration) => migration.version === '0041'
    )
    const productionAnalysisAdmissionMigration = migrations.find(
      (migration) => migration.version === '0042'
    )
    const productionAnalysisObjectPurgeMigration = migrations.find(
      (migration) => migration.version === '0043'
    )
    const retryableDeletionMigration = migrations.find((migration) => migration.version === '0044')
    const sourceSnapshotAdmissionMigration = migrations.find(
      (migration) => migration.version === '0045'
    )
    const maintenanceSchedulerLeaseMigration = migrations.find(
      (migration) => migration.version === '0046'
    )
    const maintenanceSchedulerRunMigration = migrations.find(
      (migration) => migration.version === '0047'
    )
    const costSummaryIndexMigration = migrations.find((migration) => migration.version === '0048')
    const quotaReconciliationMigration = migrations.find(
      (migration) => migration.version === '0049'
    )
    const explicitRecollectionMigration = migrations.find(
      (migration) => migration.version === '0050'
    )
    expect(authMigration?.sql).toContain('CREATE TABLE appsea.users')
    expect(authMigration?.sql).toContain('CREATE TABLE appsea.auth_sessions')
    expect(authMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(privacyMigration?.sql).toContain('evidence_non_fixture_must_be_redacted')
    expect(retentionMigration?.sql).toContain('CREATE TABLE appsea.auth_rate_limits')
    expect(quotaMigration?.sql).toContain('CREATE TABLE appsea.source_quota_reservations')
    expect(quotaMigration?.sql).toContain('CREATE OR REPLACE FUNCTION appsea.reserve_source_quota')
    expect(quotaMigration?.sql).toContain('pg_advisory_xact_lock')
    expect(quotaMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(deletionMigration?.sql).toContain('deletion_tombstone_id')
    expect(deletionMigration?.sql).toContain('GRANT UPDATE (normalized_text, redacted')
    expect(hardeningMigration?.sql).toContain('cannot target the future')
    expect(hardeningMigration?.sql).toContain('source_items_deletion_guard')
    expect(maintenanceMigration?.sql).toContain('list_active_workspaces_for_maintenance')
    expect(maintenanceMigration?.sql).toContain('TO appsea_owner')
    expect(deletionIntegrityMigration?.sql).toContain('source_items_active_payload_guard')
    expect(deletionIntegrityMigration?.sql).toContain('evidence_records_active_payload_guard')
    expect(deletionIntegrityMigration?.sql).toContain('deletion_tombstones_transition_guard')
    expect(deletionIntegrityMigration?.sql).toContain(
      'plan_package_non_synthetic_fixture_files_check'
    )
    expect(deletionClaimMigration?.sql).toContain('deletion_processing_requires_started_at')
    expect(deletionClaimMigration?.sql).toContain('deletion_tombstone_migration_repair')
    expect(deletionIntegrityMigration?.sql).toContain('CHECK (synthetic OR fixture_files IS NULL)')
    expect(workflowActorMigration?.sql).toContain('workflow_job_actor_guard')
    expect(workflowActorMigration?.sql).toContain('workflow user actor is not an editor or owner')
    expect(workflowActorUpdateMigration?.sql).toContain("IF TG_OP = 'UPDATE'")
    expect(workflowActorUpdateMigration?.sql).toContain('workflow requesting actor is immutable')
    expect(workflowWorkspaceGateMigration?.sql).toContain(
      'workflow workspace must be active and fixture-enabled'
    )
    expect(workspaceMembershipAdminMigration?.sql).toContain('workspace_membership_admin_guard')
    expect(workspaceMembershipAdminMigration?.sql).toContain('workspace must retain an owner')
    expect(workspaceMembershipAdminMigration?.sql).toContain('pg_advisory_xact_lock')
    expect(workspaceMembershipAdminMigration?.sql).toContain('INSERT INTO appsea.audit_events')
    expect(workspaceMembershipAdminMigration?.sql).toContain('INSERT INTO appsea.outbox_events')
    expect(workspaceMembershipAdminMigration?.sql).toContain("NEW.role = 'owner'")
    expect(workspaceMembershipAdminMigration?.sql).toContain('previous_role')
    expect(workspaceMembershipAdminMigration?.sql).toContain(
      'workspace_membership_owner_presence_guard'
    )
    expect(authStepUpMigration?.sql).toContain('last_reauthenticated_at')
    expect(reportApprovalMigration?.sql).toContain('report_approval_transition_guard')
    expect(reportApprovalMigration?.sql).toContain('report approval transition is not permitted')
    expect(reportApprovalMigration?.sql).toContain('INSERT INTO appsea.audit_events')
    expect(reportApprovalMigration?.sql).toContain('INSERT INTO appsea.outbox_events')
    expect(reportApprovalMigration?.sql).toContain('GRANT UPDATE (approval_state)')
    expect(passwordResetMigration?.sql).toContain('CREATE TABLE appsea.auth_password_reset_tokens')
    expect(passwordResetMigration?.sql).toContain('REVOKE ALL ON appsea.auth_password_reset_tokens')
    expect(authRecoveryBoundaryMigration?.sql).toContain(
      'CREATE TABLE appsea.auth_password_reset_deliveries'
    )
    expect(authRecoveryBoundaryMigration?.sql).toContain('SECURITY DEFINER')
    expect(authRecoveryBoundaryMigration?.sql).toContain(
      'REVOKE UPDATE (password_hash, updated_at)'
    )
    expect(authRecoveryBoundaryMigration?.sql).toContain('claim_password_reset_deliveries')
    expect(authRecoveryBoundaryMigration?.sql).toContain('expires_at > clock_timestamp()')
    expect(authRecoveryBoundaryMigration?.sql).toContain('ON DELETE CASCADE')
    expect(authRecoveryBoundaryMigration?.sql).toContain(
      'REVOKE ALL ON appsea.auth_password_reset_deliveries FROM PUBLIC, appsea_service'
    )
    expect(workspaceInvitationMigration?.sql).toContain('CREATE TABLE appsea.workspace_invitations')
    expect(workspaceInvitationMigration?.sql).toContain(
      'CREATE TABLE appsea.workspace_invitation_deliveries'
    )
    expect(workspaceInvitationMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.accept_workspace_invitation'
    )
    expect(workspaceInvitationMigration?.sql).toContain(
      'ALTER TABLE appsea.workspace_invitations FORCE ROW LEVEL SECURITY'
    )
    expect(workspaceInvitationMigration?.sql).toContain(
      'GRANT EXECUTE ON FUNCTION appsea.claim_workspace_invitation_deliveries(integer)'
    )
    expect(workspaceInvitationMigration?.sql).toContain(
      'APPSEA_WORKSPACE_INVITATION_DELIVERY_FAILED'
    )
    expect(workspaceInvitationMigration?.sql).toContain(
      'IF NOT FOUND THEN\n    RETURN QUERY SELECT false'
    )
    expect(accountClosureMigration?.sql).toContain('ALTER TABLE appsea.users')
    expect(accountClosureMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.close_user_account'
    )
    expect(accountClosureMigration?.sql).toContain('workspaceData')
    expect(accountClosureMigration?.sql).toContain('APPSEA_ACCOUNT_CLOSED')
    expect(sourcePolicyApprovalMigration?.sql).toContain(
      'CREATE TABLE appsea.source_policy_reviews'
    )
    expect(sourcePolicyApprovalMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.register_source_policy_draft'
    )
    expect(sourcePolicyApprovalMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.approve_source_policy'
    )
    expect(sourcePolicyApprovalMigration?.sql).toContain(
      'source policy approval requires the migration operator role'
    )
    expect(sourcePolicyApprovalMigration?.sql).toContain("retentionAction}' = 'purge'")
    expect(productionWorkflowMigration?.sql).toContain(
      'CREATE TABLE appsea.production_collection_workflow_jobs'
    )
    expect(productionWorkflowMigration?.sql).toContain(
      'CREATE TABLE appsea.production_collection_workflow_checkpoints'
    )
    expect(productionWorkflowMigration?.sql).toContain(
      'production_collection_workflow_transition_guard'
    )
    expect(productionWorkflowMigration?.sql).toContain(
      'production_collection_workflow_source_policy_gate'
    )
    expect(productionWorkflowMigration?.sql).toContain('production_collection_workflow_actor_guard')
    expect(sourceRetentionMigration?.sql).toContain('enqueue_expired_source_tombstones')
    expect(sourceRetentionMigration?.sql).toContain('retention window elapsed')
    expect(sourceRetentionMigration?.sql).toContain("current_setting('appsea.workspace_id'")
    expect(sourceRetentionMigration?.sql).toContain('effective_received_at := clock_timestamp()')
    expect(productionAnalysisMigration?.sql).toContain(
      'CREATE TABLE appsea.production_analysis_runs'
    )
    expect(productionAnalysisMigration?.sql).toContain(
      'CREATE TABLE appsea.research_analysis_run_evidence'
    )
    expect(productionAnalysisMigration?.sql).toContain('production_analysis_collection_gate')
    expect(productionAnalysisMigration?.sql).toContain('production_analysis_transition_guard')
    expect(productionAnalysisMigration?.sql).toContain(
      'ALTER TABLE appsea.production_analysis_runs FORCE ROW LEVEL SECURITY'
    )
    expect(productionAnalysisMigration?.sql).toContain('structured_object_ref')
    expect(planApprovalMigration?.sql).toContain('plan_approval_transition_guard')
    expect(planApprovalMigration?.sql).toContain('only ready plans can be approved')
    expect(planApprovalMigration?.sql).toContain(
      'the linked report must be approved before the plan'
    )
    expect(planApprovalMigration?.sql).toContain("package_object_ref ~ '^deleted:")
    expect(planApprovalMigration?.sql).toContain('GRANT UPDATE (approval_state)')
    expect(complaintReviewMigration?.sql).toContain('complaint_review_transition_guard')
    expect(complaintReviewMigration?.sql).toContain(
      'complaint review requires an editor or owner actor'
    )
    expect(complaintReviewMigration?.sql).toContain(
      'GRANT UPDATE (review_state) ON appsea.complaint_observations'
    )
    expect(seedReviewMigration?.sql).toContain('CREATE TABLE appsea.opportunity_seed_reviews')
    expect(seedReviewMigration?.sql).toContain('opportunity_seed_review_mutation_guard')
    expect(analysisHandoffMigration?.sql).toContain(
      'CREATE TABLE appsea.production_analysis_handoffs'
    )
    expect(analysisHandoffMigration?.sql).toContain(
      'production_collection_workflow_seed_review_gate'
    )
    expect(seedReviewMigration?.sql).toContain('opportunity seed review content is immutable')
    expect(seedReviewMigration?.sql).toContain(
      'opportunity seed review decision metadata is immutable'
    )
    expect(seedReviewMigration?.sql).toContain('GRANT UPDATE (')
    expect(opportunityAvailabilityMigration?.sql).toContain(
      "ADD COLUMN availability_state text NOT NULL DEFAULT 'active'"
    )
    expect(opportunityAvailabilityMigration?.sql).toContain('guard_opportunity_availability')
    expect(opportunityAvailabilityMigration?.sql).toContain(
      'invalidated opportunity requires a new source run before reactivation'
    )
    expect(sameRunRecoveryMigration?.sql).toContain('linked active re-analysis')
    expect(sameRunRecoveryMigration?.sql).toContain("analysis.state IN ('running', 'completed')")
    expect(recomputationMigration?.sql).toContain(
      'CREATE TABLE appsea.production_analysis_recompute_jobs'
    )
    expect(recomputationMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(recomputationMigration?.sql).toContain(
      'production analysis recomputation seed does not match its opportunity'
    )
    expect(productionAdmissionMigration?.sql).toContain(
      'CREATE TABLE appsea.production_collection_workflow_admissions'
    )
    expect(productionAdmissionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.admit_production_collection_workflow'
    )
    expect(productionAdmissionMigration?.sql).toContain('pg_advisory_xact_lock')
    expect(productionAdmissionMigration?.sql).toContain('p_idempotency_digest IS NULL')
    expect(productionAdmissionMigration?.sql).toContain('p_input_hash IS NULL')
    expect(productionAdmissionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.consume_production_collection_workflow_admission'
    )
    expect(productionAdmissionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.purge_production_collection_workflow_admissions'
    )
    expect(productionAdmissionMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(sourceCollectionLeaseMigration?.sql).toContain(
      'CREATE TABLE appsea.source_collection_leases'
    )
    expect(sourceCollectionLeaseMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.acquire_source_collection_lease'
    )
    expect(sourceCollectionLeaseMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.assert_source_collection_lease'
    )
    expect(sourceCollectionLeaseMigration?.sql).toContain('source_policy_reviews')
    expect(sourceCollectionLeaseMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(sourceSnapshotReconciliationMigration?.sql).toContain(
      'CREATE TABLE appsea.source_snapshot_reconciliation_jobs'
    )
    expect(sourceSnapshotReconciliationMigration?.sql).toContain(
      'CREATE TABLE appsea.source_snapshot_reconciliation_items'
    )
    expect(sourceSnapshotReconciliationMigration?.sql).toContain(
      'enforce_source_snapshot_reconciliation_policy'
    )
    expect(sourceSnapshotReconciliationMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(sourceSnapshotPageCheckpointMigration?.sql).toContain(
      'CREATE TABLE appsea.source_snapshot_reconciliation_pages'
    )
    expect(sourceSnapshotPageCheckpointMigration?.sql).toContain('warnings text[]')
    expect(sourceSnapshotPageCheckpointMigration?.sql).toContain('ADD COLUMN next_attempt_at')
    expect(sourceSnapshotPageCheckpointMigration?.sql).toContain(
      'source_snapshot_reconciliation_due_idx'
    )
    expect(sourceSnapshotPageCheckpointMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(productionAnalysisAdmissionMigration?.sql).toContain(
      'CREATE TABLE appsea.production_analysis_workflow_admissions'
    )
    expect(productionAnalysisAdmissionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.admit_production_analysis_workflow'
    )
    expect(productionAnalysisAdmissionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.consume_production_analysis_workflow_admission'
    )
    expect(productionAnalysisAdmissionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.release_production_analysis_workflow_admission'
    )
    expect(productionAnalysisAdmissionMigration?.sql).toContain(
      "existing.state IN ('consumed', 'released')"
    )
    expect(productionAnalysisAdmissionMigration?.sql).toContain('production_analysis_actor_guard')
    expect(productionAnalysisAdmissionMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(productionAnalysisObjectPurgeMigration?.sql).toContain(
      'CREATE TABLE appsea.production_analysis_object_purge_jobs'
    )
    expect(productionAnalysisObjectPurgeMigration?.sql).toContain(
      'enqueue_invalidated_production_analysis_objects'
    )
    expect(productionAnalysisObjectPurgeMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(retryableDeletionMigration?.sql).toContain('deletion_tombstone_attempt_count_check')
    expect(retryableDeletionMigration?.sql).toContain(
      'exhausted deletion tombstones cannot be retried'
    )
    expect(retryableDeletionMigration?.sql).toContain('deletion_tombstones_due_idx')
    expect(retryableDeletionMigration?.sql).toContain('deletion_tombstone_failure_code_fixed_check')
    expect(retryableDeletionMigration?.sql).toContain('deletion_tombstone_retry_migration_repair')
    expect(sourceSnapshotAdmissionMigration?.sql).toContain(
      'CREATE TABLE appsea.source_snapshot_reconciliation_start_buckets'
    )
    expect(sourceSnapshotAdmissionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.admit_source_snapshot_reconciliation'
    )
    expect(sourceSnapshotAdmissionMigration?.sql).toContain(
      'source_snapshot_reconciliation_actor_guard'
    )
    expect(sourceSnapshotAdmissionMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain(
      'CREATE TABLE appsea.maintenance_scheduler_leases'
    )
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.acquire_maintenance_scheduler_lease'
    )
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.renew_maintenance_scheduler_lease'
    )
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.release_maintenance_scheduler_lease'
    )
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain('clock_timestamp()')
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain('lease_token')
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain('appsea_maintenance')
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain('session_user <>')
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain('pg_advisory_xact_lock')
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain(
      'REVOKE ALL ON appsea.maintenance_scheduler_leases'
    )
    expect(maintenanceSchedulerRunMigration?.sql).toContain(
      'CREATE TABLE appsea.maintenance_scheduler_runs'
    )
    expect(maintenanceSchedulerRunMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.record_maintenance_scheduler_run'
    )
    expect(maintenanceSchedulerRunMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.purge_maintenance_scheduler_runs'
    )
    expect(maintenanceSchedulerRunMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.list_maintenance_scheduler_runs'
    )
    expect(maintenanceSchedulerRunMigration?.sql).toContain(
      'REVOKE ALL ON appsea.maintenance_scheduler_runs'
    )
    expect(costSummaryIndexMigration?.sql).toContain('cost_ledger_entries_workspace_recorded_idx')
    expect(quotaReconciliationMigration?.sql).toContain(
      'CREATE TABLE appsea.source_quota_reconciliation_cases'
    )
    expect(quotaReconciliationMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.resolve_source_quota_reconciliation_case'
    )
    expect(quotaReconciliationMigration?.sql).toContain("session_user <> 'appsea_maintenance'")
    expect(quotaReconciliationMigration?.sql).toContain(
      'source_snapshot_reconciliation_jobs snapshot'
    )
    expect(explicitRecollectionMigration?.sql).toContain('source_items_active_native_idx')
    expect(explicitRecollectionMigration?.sql).toContain('guard_source_recollection_lineage')
    expect(explicitRecollectionMigration?.sql).toContain(
      'DROP CONSTRAINT source_items_workspace_id_source_id_source_record_id_key'
    )
    const serviceAdmissionMigration = migrations.find((migration) => migration.version === '0051')
    expect(serviceAdmissionMigration?.sql).toContain("service_principal = 'appsea-worker'")
    expect(serviceAdmissionMigration?.sql).toContain("session_user <> 'appsea_service'")
    const maintenanceFencingMigration = migrations.find((migration) => migration.version === '0052')
    expect(maintenanceFencingMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.assert_maintenance_scheduler_lease'
    )
    expect(maintenanceFencingMigration?.sql).toContain('FOR UPDATE')
    expect(maintenanceFencingMigration?.sql).toContain('pg_advisory_xact_lock')
    expect(maintenanceFencingMigration?.sql).toContain('clock_timestamp()')
    expect(maintenanceFencingMigration?.sql).toContain("session_user <> 'appsea_service'")
    expect(maintenanceFencingMigration?.sql).toContain(
      'REVOKE ALL ON FUNCTION appsea.assert_maintenance_scheduler_lease'
    )
    expect(maintenanceFencingMigration?.sql).toContain(
      'GRANT EXECUTE ON FUNCTION appsea.assert_maintenance_scheduler_lease'
    )
    const complaintAnalysisMigration = migrations.find((migration) => migration.version === '0053')
    expect(complaintAnalysisMigration?.sql).toContain(
      'ADD COLUMN IF NOT EXISTS analysis_snapshot jsonb'
    )
    expect(complaintAnalysisMigration?.sql).toContain('complaint_analysis_snapshot_object')
    expect(complaintAnalysisMigration?.sql).toContain("'unresolvedTypes'")
    expect(complaintAnalysisMigration?.sql).toContain("'{analyses}'")
    expect(complaintAnalysisMigration?.sql).toContain('production_analysis_runs')
  })

  it('requires verified TLS for production database connections', () => {
    expect(() =>
      databaseConfigFromEnv({
        DATABASE_URL: 'postgres://appsea:local@localhost:5433/appsea',
        NODE_ENV: 'production',
        APPSEA_DATABASE_SSL_MODE: 'disable'
      })
    ).toThrow(/verify TLS/)
  })

  it('rejects connection-string SSL parameters that could override policy', () => {
    expect(() =>
      databaseConfigFromEnv({
        DATABASE_URL: 'postgres://appsea:local@localhost:5433/appsea?sslmode=disable',
        NODE_ENV: 'production'
      })
    ).toThrow(/must not contain SSL parameters/)
  })

  it('rejects connection-string routing parameters', () => {
    expect(() =>
      databaseConfigFromEnv({
        DATABASE_URL:
          'postgres://appsea:local@localhost:5433/appsea_test?host=database.example.com&port=5432',
        NODE_ENV: 'test'
      })
    ).toThrow(/must not contain query parameters/)
  })
})
