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
      '0053',
      '0054',
      '0055',
      '0056',
      '0057',
      '0058',
      '0059',
      '0060',
      '0061',
      '0062',
      '0063',
      '0064',
      '0065',
      '0066',
      '0067',
      '0068',
      '0069',
      '0070',
      '0071',
      '0072',
      '0073',
      '0074',
      '0075',
      '0076',
      '0077',
      '0078',
      '0079',
      '0080',
      '0081',
      '0082',
      '0083',
      '0084',
      '0085',
      '0086',
      '0087',
      '0088',
      '0089',
      '0090',
      '0091',
      '0092',
      '0093',
      '0094',
      '0095'
    ])
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(migrations[0]?.sql).toContain('CREATE TABLE appsea.evidence_records')
    expect(migrations[0]?.sql).toContain('ENABLE ROW LEVEL SECURITY')
    const cancellationMigration = migrations.find((migration) => migration.version === '0070')
    expect(cancellationMigration?.sql).toContain('cancellation_requested_at')
    expect(cancellationMigration?.sql).toContain(
      'enforce_research_campaign_orchestration_cancellation'
    )
    expect(cancellationMigration?.sql).toContain(
      "IF TG_OP = 'UPDATE' AND OLD.cancellation_requested_at IS NOT NULL"
    )
    expect(cancellationMigration?.sql).toContain("current_setting('appsea.service_principal'")
    expect(cancellationMigration?.sql).toContain('workspace.fixture_only = false')
    const oneSourceCancellationMigration = migrations.find(
      (migration) => migration.version === '0071'
    )
    expect(oneSourceCancellationMigration?.sql).toContain(
      'enforce_production_collection_workflow_cancellation'
    )
    expect(oneSourceCancellationMigration?.sql).toContain('cancellation_requested_by')
    const historyIndexMigration = migrations.find((migration) => migration.version === '0072')
    expect(historyIndexMigration?.sql).toContain(
      'production_collection_workflow_jobs_campaign_history_idx'
    )
    expect(historyIndexMigration?.sql).toContain(
      'research_campaign_orchestrations_campaign_history_idx'
    )
    const workspacePurgeMigration = migrations.find((migration) => migration.version === '0073')
    expect(workspacePurgeMigration?.sql).toContain('CREATE TABLE appsea.workspace_purge_requests')
    expect(workspacePurgeMigration?.sql).toContain('request_workspace_purge')
    expect(workspacePurgeMigration?.sql).toContain('cancel_workspace_purge')
    const migrationOwnerCompatibilityMigration = migrations.find(
      (migration) => migration.version === '0074'
    )
    expect(migrationOwnerCompatibilityMigration?.sql).toContain('migration_owner_scope')
    expect(migrationOwnerCompatibilityMigration?.sql).toContain('default_research_run_finished_at')
    const invitationRlsMigration = migrations.find((migration) => migration.version === '0075')
    expect(invitationRlsMigration?.sql).toContain('ALTER POLICY workspace_invitation_owner_scope')
    expect(invitationRlsMigration?.sql).toContain(
      'ALTER TABLE appsea.workspace_invitation_deliveries FORCE ROW LEVEL SECURITY'
    )
    const admissionReadGrantMigration = migrations.find((migration) => migration.version === '0076')
    expect(admissionReadGrantMigration?.sql).toContain(
      'production_analysis_workflow_admissions TO appsea_service'
    )
    const sourceQuotaQualificationMigration = migrations.find(
      (migration) => migration.version === '0077'
    )
    expect(sourceQuotaQualificationMigration?.sql).toContain(
      'ON CONFLICT ON CONSTRAINT source_quota_reconciliation_cases_pkey'
    )
    const sourceQuotaResolutionQualificationMigration = migrations.find(
      (migration) => migration.version === '0078'
    )
    expect(sourceQuotaResolutionQualificationMigration?.sql).toContain(
      'stored_case.workspace_id = p_workspace_id'
    )
    const competitorObservationDependencyGrantMigration = migrations.find(
      (migration) => migration.version === '0079'
    )
    expect(competitorObservationDependencyGrantMigration?.sql).toContain(
      'GRANT SELECT ON appsea.opportunity_competitors TO appsea_service'
    )
    const authMfaMigration = migrations.find((migration) => migration.version === '0080')
    expect(authMfaMigration?.sql).toContain('CREATE TABLE appsea.auth_mfa_totp')
    expect(authMfaMigration?.sql).toContain('CREATE TABLE appsea.auth_mfa_challenges')
    expect(authMfaMigration?.sql).toContain('purge_auth_mfa_material')
    expect(authMfaMigration?.sql).toContain('pending_enrollments_deleted')
    const authMfaStepUpMigration = migrations.find((migration) => migration.version === '0081')
    expect(authMfaStepUpMigration?.sql).toContain('last_mfa_reauthenticated_at')
    expect(authMfaStepUpMigration?.sql).toContain(
      'GRANT UPDATE (last_mfa_reauthenticated_at) ON appsea.auth_sessions TO appsea_service'
    )
    const operationalAlertMigration = migrations.find((migration) => migration.version === '0082')
    expect(operationalAlertMigration?.sql).toContain('CREATE TABLE appsea.operational_alert_outbox')
    expect(operationalAlertMigration?.sql).toContain('claim_operational_alerts')
    expect(operationalAlertMigration?.sql).toContain('acquire_maintenance_scheduler_lease_v2')
    const workspacePurgeManifestMigration = migrations.find(
      (migration) => migration.version === '0083'
    )
    expect(workspacePurgeManifestMigration?.sql).toContain(
      'CREATE TABLE appsea.workspace_purge_manifests'
    )
    expect(workspacePurgeManifestMigration?.sql).toContain('create_workspace_purge_manifest')
    expect(workspacePurgeManifestMigration?.sql).toContain('read_workspace_purge_manifest')
    const workspaceArchivalQualificationMigration = migrations.find(
      (migration) => migration.version === '0084'
    )
    expect(workspaceArchivalQualificationMigration?.sql).toContain(
      'UPDATE appsea.workspaces AS workspace'
    )
    expect(workspaceArchivalQualificationMigration?.sql).toContain(
      'WHERE workspace.workspace_id = p_workspace_id'
    )
    const workspacePurgeManifestReadMigration = migrations.find(
      (migration) => migration.version === '0085'
    )
    expect(workspacePurgeManifestReadMigration?.sql).toContain(
      'workspace purge manifest read requires an owner'
    )
    expect(workspacePurgeManifestReadMigration?.sql).not.toContain('FOR SHARE')
    const authMfaKeyVersionMigration = migrations.find((migration) => migration.version === '0086')
    expect(authMfaKeyVersionMigration?.sql).toContain('secret_key_version')
    expect(authMfaKeyVersionMigration?.sql).toContain('auth_mfa_totp_key_version_idx')
    const authMfaRotationEventMigration = migrations.find(
      (migration) => migration.version === '0087'
    )
    expect(authMfaRotationEventMigration?.sql).toContain('key_rotation_rewrapped')
    const authOidcMigration = migrations.find((migration) => migration.version === '0088')
    expect(authOidcMigration?.sql).toContain('CREATE TABLE appsea.auth_identities')
    expect(authOidcMigration?.sql).toContain('record_oidc_security_event')
    expect(authOidcMigration?.sql).toContain('OIDC security event identity binding is invalid')
    expect(authOidcMigration?.sql).toContain('CREATE OR REPLACE FUNCTION appsea.link_oidc_identity')
    expect(authOidcMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.unlink_oidc_identity'
    )
    expect(authOidcMigration?.sql).toContain(
      'REVOKE ALL ON FUNCTION appsea.link_oidc_identity(text, text, text, text, text, text)'
    )
    expect(authOidcMigration?.sql).toContain("position('@' IN issuer) = 0")
    expect(authOidcMigration?.sql).toContain('oidc_identity_id text')
    expect(authOidcMigration?.sql).toContain('auth_mfa_challenges_oidc_identity_binding_check')
    const manualImportMigration = migrations.find((migration) => migration.version === '0089')
    expect(manualImportMigration?.sql).toContain('CREATE TABLE appsea.manual_import_batches')
    expect(manualImportMigration?.sql).toContain('CREATE TABLE appsea.manual_import_records')
    expect(manualImportMigration?.sql).toContain('enforce_manual_import_batch_boundary')
    expect(manualImportMigration?.sql).toContain('manual-owner-import-v1')
    expect(manualImportMigration?.sql).toContain(
      'GRANT UPDATE (state, run_id, consumed_at, deleted_at)'
    )
    const manualImportPolicyGateMigration = migrations.find(
      (migration) => migration.version === '0090'
    )
    expect(manualImportPolicyGateMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.manual_import_source_policy_collectible'
    )
    expect(manualImportPolicyGateMigration?.sql).toContain(
      'GRANT EXECUTE ON FUNCTION appsea.manual_import_source_policy_collectible'
    )
    const manualImportDeleteStateMigration = migrations.find(
      (migration) => migration.version === '0091'
    )
    expect(manualImportDeleteStateMigration?.sql).toContain(
      'manual_import_batches_consumed_at_check'
    )
    const campaignSourcePrivilegeMigration = migrations.find(
      (migration) => migration.version === '0092'
    )
    expect(campaignSourcePrivilegeMigration?.sql).toContain('GRANT SELECT ON appsea.sources')
    expect(campaignSourcePrivilegeMigration?.sql).toContain('appsea.source_policy_versions')
    const sourceQuotaReservationQualificationMigration = migrations.find(
      (migration) => migration.version === '0093'
    )
    expect(sourceQuotaReservationQualificationMigration?.sql).toContain(
      'sum(reservation.requested_records)'
    )
    expect(sourceQuotaReservationQualificationMigration?.sql).toContain(
      "reservation.status IN ('reserved', 'committed')"
    )
    const productionRunSnapshotPrivilegeMigration = migrations.find(
      (migration) => migration.version === '0094'
    )
    expect(productionRunSnapshotPrivilegeMigration?.sql).toContain(
      'GRANT UPDATE (artifact_snapshot) ON appsea.research_runs'
    )
    const workspacePurgeReadinessLeaseGrantMigration = migrations.find(
      (migration) => migration.version === '0095'
    )
    expect(workspacePurgeReadinessLeaseGrantMigration?.sql).toContain(
      'GRANT SELECT (workspace_id, state)'
    )
    expect(workspacePurgeReadinessLeaseGrantMigration?.sql).toContain(
      'ON appsea.source_collection_leases TO appsea_service'
    )
    const authMigration = migrations.find((migration) => migration.version === '0008')
    const privacyMigration = migrations.find((migration) => migration.version === '0009')
    const retentionMigration = migrations.find((migration) => migration.version === '0010')
    const quotaMigration = migrations.find((migration) => migration.version === '0011')
    const deletionMigration = migrations.find((migration) => migration.version === '0012')
    const hardeningMigration = migrations.find((migration) => migration.version === '0013')
    expect(hardeningMigration?.sql).not.toContain(
      'REVOKE ALL ON FUNCTION appsea.expire_source_quota_reservations(timestamptz, integer)'
    )
    expect(hardeningMigration?.sql).toContain(
      'REVOKE ALL ON FUNCTION appsea.expire_source_quota_reservations(text, timestamptz, integer)'
    )
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
    const sourcePolicyIntegrityMigration = migrations.find(
      (migration) => migration.version === '0054'
    )
    const productionAnalysisAttemptMigration = migrations.find(
      (migration) => migration.version === '0055'
    )
    const productionAnalysisAttemptHistoryMigration = migrations.find(
      (migration) => migration.version === '0056'
    )
    const researchCampaignLifecycleMigration = migrations.find(
      (migration) => migration.version === '0057'
    )
    const researchCampaignRefreshMigration = migrations.find(
      (migration) => migration.version === '0058'
    )
    const competitorResearchObservationMigration = migrations.find(
      (migration) => migration.version === '0059'
    )
    const sourceCanonicalLocatorMigration = migrations.find(
      (migration) => migration.version === '0060'
    )
    const complaintAnalysisCorrectionMigration = migrations.find(
      (migration) => migration.version === '0061'
    )
    const correctionRecomputeMigration = migrations.find(
      (migration) => migration.version === '0062'
    )
    const competitorFeatureMatrixMigration = migrations.find(
      (migration) => migration.version === '0063'
    )
    const recomputeAlertMigration = migrations.find((migration) => migration.version === '0064')
    const costAlertMigration = migrations.find((migration) => migration.version === '0065')
    const workspaceArchivalMigration = migrations.find((migration) => migration.version === '0066')
    const evidenceRedactionMigration = migrations.find((migration) => migration.version === '0067')
    const campaignOrchestrationMigration = migrations.find(
      (migration) => migration.version === '0068'
    )
    const agentAccessTokenMigration = migrations.find((migration) => migration.version === '0069')
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
    expect(deletionClaimMigration?.sql).toContain('TO appsea_owner, appsea_migrator')
    expect(deletionClaimMigration?.sql).toContain(
      'ALTER TABLE appsea.deletion_tombstones NO FORCE ROW LEVEL SECURITY'
    )
    expect(deletionClaimMigration?.sql).toContain(
      'ALTER TABLE appsea.deletion_tombstones FORCE ROW LEVEL SECURITY'
    )
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
    expect(sourcePolicyIntegrityMigration?.sql).toContain('source_policy_review_integrity_guard')
    expect(sourcePolicyIntegrityMigration?.sql).toContain('reviewer_identity')
    expect(sourcePolicyIntegrityMigration?.sql).toContain('independence_attested')
    expect(sourcePolicyIntegrityMigration?.sql).toContain(
      'source policy owner cannot approve its own policy'
    )
    expect(productionAnalysisAttemptMigration?.sql).toContain(
      'ADD COLUMN activity_attempts integer NOT NULL DEFAULT 0'
    )
    expect(productionAnalysisAttemptMigration?.sql).toContain(
      'production analysis activity attempts cannot decrease'
    )
    expect(productionAnalysisAttemptMigration?.sql).toContain(
      "state IN ('completed', 'partial', 'failed', 'canceled')"
    )
    expect(productionAnalysisAttemptMigration?.sql).toContain(
      'GRANT UPDATE (activity_attempts) ON appsea.production_analysis_runs'
    )
    expect(productionAnalysisAttemptHistoryMigration?.sql).toContain(
      'CREATE TABLE appsea.production_analysis_activity_attempts'
    )
    expect(productionAnalysisAttemptHistoryMigration?.sql).toContain(
      'production analysis activity heartbeat count cannot decrease'
    )
    expect(productionAnalysisAttemptHistoryMigration?.sql).toContain(
      'ALTER TABLE appsea.production_analysis_activity_attempts FORCE ROW LEVEL SECURITY'
    )
    expect(productionAnalysisAttemptHistoryMigration?.sql).toContain(
      'GRANT UPDATE (\n  state, last_heartbeat_at, heartbeat_count'
    )
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
    expect(campaignOrchestrationMigration?.sql).toContain(
      'CREATE TABLE appsea.research_campaign_orchestrations'
    )
    expect(campaignOrchestrationMigration?.sql).toContain(
      'CREATE TABLE appsea.research_campaign_orchestration_sources'
    )
    expect(campaignOrchestrationMigration?.sql).toContain(
      'ALTER TABLE appsea.research_campaign_orchestrations FORCE ROW LEVEL SECURITY'
    )
    expect(campaignOrchestrationMigration?.sql).toContain(
      'research_campaign_orchestration_source_transition_guard'
    )
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
    expect(productionAnalysisObjectPurgeMigration?.sql).toContain('"authorization" text')
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
    expect(maintenanceSchedulerLeaseMigration?.sql).toContain('the migration role cannot revoke it')
    expect(maintenanceSchedulerLeaseMigration?.sql).not.toContain('REVOKE appsea_maintenance FROM')
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
    expect(researchCampaignLifecycleMigration?.sql).toContain(
      'ALTER TABLE appsea.research_campaigns'
    )
    expect(researchCampaignLifecycleMigration?.sql).toContain("'archived'")
    expect(researchCampaignRefreshMigration?.sql).toContain('refresh_claim_token')
    expect(researchCampaignRefreshMigration?.sql).toContain('refresh_pending_request')
    expect(researchCampaignRefreshMigration?.sql).toContain(
      'ADD COLUMN refresh_updated_at timestamptz DEFAULT clock_timestamp()'
    )
    expect(researchCampaignRefreshMigration?.sql).toContain(
      'ALTER TABLE appsea.research_campaigns NO FORCE ROW LEVEL SECURITY'
    )
    expect(researchCampaignRefreshMigration?.sql).toContain(
      'ALTER TABLE appsea.research_campaigns FORCE ROW LEVEL SECURITY'
    )
    expect(competitorResearchObservationMigration?.sql).toContain(
      'CREATE TABLE appsea.competitor_research_observations'
    )
    expect(competitorResearchObservationMigration?.sql).toContain('competitor-research')
    expect(competitorResearchObservationMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(competitorResearchObservationMigration?.sql).toContain(
      'competitor_research_observation_review_guard'
    )
    expect(sourceCanonicalLocatorMigration?.sql).toContain('source_items_canonical_locator_check')
    expect(sourceCanonicalLocatorMigration?.sql).toContain(
      "'^https?://[^[:space:]/]+(/[^[:space:]]*)?$'"
    )
    expect(complaintAnalysisCorrectionMigration?.sql).toContain(
      'CREATE TABLE appsea.complaint_analysis_corrections'
    )
    expect(complaintAnalysisCorrectionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.apply_complaint_analysis_correction'
    )
    expect(complaintAnalysisCorrectionMigration?.sql).toContain(
      'enforce_complaint_review_transition_v2'
    )
    expect(complaintAnalysisCorrectionMigration?.sql).toContain("NEW.review_state = 'corrected'")
    expect(complaintAnalysisCorrectionMigration?.sql).toContain(
      'GRANT EXECUTE ON FUNCTION appsea.apply_complaint_analysis_correction'
    )
    expect(complaintAnalysisCorrectionMigration?.sql).toContain(
      "p_next_snapshot->>'reviewState' IS DISTINCT FROM 'corrected'"
    )
    expect(complaintAnalysisCorrectionMigration?.sql).toContain(
      'REVOKE ALL ON appsea.complaint_analysis_corrections FROM PUBLIC, appsea_service'
    )
    expect(correctionRecomputeMigration?.sql).toContain(
      'ALTER COLUMN source_tombstone_id DROP NOT NULL'
    )
    expect(correctionRecomputeMigration?.sql).toContain('ADD COLUMN correction_id text')
    expect(correctionRecomputeMigration?.sql).toContain(
      'production_analysis_recompute_correction_key'
    )
    expect(correctionRecomputeMigration?.sql).toContain(
      'CREATE CONSTRAINT TRIGGER complaint_analysis_correction_recompute_enqueue'
    )
    expect(correctionRecomputeMigration?.sql).toContain('DEFERRABLE INITIALLY DEFERRED')
    expect(correctionRecomputeMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.enqueue_complaint_analysis_recompute'
    )
    expect(competitorFeatureMatrixMigration?.sql).toContain(
      "ADD COLUMN feature_matrix jsonb NOT NULL DEFAULT '[]'::jsonb"
    )
    expect(competitorFeatureMatrixMigration?.sql).toContain(
      'competitors_feature_matrix_shape_check'
    )
    expect(competitorFeatureMatrixMigration?.sql).toContain('jsonb_array_length(feature_matrix)')
    expect(recomputeAlertMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.list_production_analysis_recompute_alerts'
    )
    expect(recomputeAlertMigration?.sql).toContain("session_user <> 'appsea_maintenance'")
    expect(recomputeAlertMigration?.sql).toContain(
      'REVOKE ALL ON FUNCTION appsea.list_production_analysis_recompute_alerts'
    )
    expect(recomputeAlertMigration?.sql).toContain(
      'GRANT EXECUTE ON FUNCTION appsea.list_production_analysis_recompute_alerts'
    )
    expect(costAlertMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.list_workspace_cost_alerts'
    )
    expect(costAlertMigration?.sql).toContain("session_user <> 'appsea_maintenance'")
    expect(costAlertMigration?.sql).toContain(
      'REVOKE ALL ON FUNCTION appsea.list_workspace_cost_alerts'
    )
    expect(costAlertMigration?.sql).toContain(
      'GRANT EXECUTE ON FUNCTION appsea.list_workspace_cost_alerts'
    )
    expect(workspaceArchivalMigration?.sql).toContain('ADD COLUMN archived_at timestamptz')
    expect(workspaceArchivalMigration?.sql).toContain('workspace_archive_state_check')
    expect(workspaceArchivalMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.archive_workspace'
    )
    expect(workspaceArchivalMigration?.sql).toContain('active_work_count')
    expect(workspaceArchivalMigration?.sql).toContain(
      "workflow_execution.state IN ('queued', 'running')"
    )
    expect(workspaceArchivalMigration?.sql).toContain(
      "handoff.state IN ('queued', 'dispatching', 'started')"
    )
    expect(workspaceArchivalMigration?.sql).toContain('workspace_invitation_deliveries')
    expect(workspaceArchivalMigration?.sql).toContain("state IN ('pending', 'sending', 'failed')")
    expect(workspaceArchivalMigration?.sql).toContain('researchLineage')
    expect(workspaceArchivalMigration?.sql).toContain(
      'REVOKE ALL ON FUNCTION appsea.archive_workspace(text, text) FROM PUBLIC'
    )
    expect(workspaceArchivalMigration?.sql).toContain(
      'GRANT EXECUTE ON FUNCTION appsea.archive_workspace(text, text) TO appsea_service'
    )
    expect(evidenceRedactionMigration?.sql).toContain(
      'CREATE TABLE appsea.evidence_redaction_events'
    )
    expect(evidenceRedactionMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.apply_evidence_field_redaction'
    )
    expect(evidenceRedactionMigration?.sql).toContain(
      'REVOKE ALL ON FUNCTION appsea.apply_evidence_field_redaction'
    )
    expect(evidenceRedactionMigration?.sql).toContain(
      'GRANT SELECT ON appsea.evidence_redaction_events TO appsea_service'
    )
    expect(evidenceRedactionMigration?.sql).toContain(
      "current_setting('appsea.evidence_redaction_id', true)"
    )
    expect(campaignOrchestrationMigration?.sql).toContain(
      'CREATE TABLE appsea.research_campaign_orchestrations'
    )
    expect(campaignOrchestrationMigration?.sql).toContain('FORCE ROW LEVEL SECURITY')
    expect(agentAccessTokenMigration?.sql).toContain('CREATE TABLE appsea.agent_access_tokens')
    expect(agentAccessTokenMigration?.sql).toContain('CREATE POLICY workspace_scope')
    expect(agentAccessTokenMigration?.sql).toContain(
      'ALTER TABLE appsea.agent_access_tokens FORCE ROW LEVEL SECURITY'
    )
    expect(agentAccessTokenMigration?.sql).toContain(
      'CREATE OR REPLACE FUNCTION appsea.authenticate_agent_access_token'
    )
    expect(agentAccessTokenMigration?.sql).toContain(
      "set_config('appsea.workspace_id', token_row.workspace_id, true)"
    )
    expect(agentAccessTokenMigration?.sql).toContain('Raw bearer tokens never enter PostgreSQL')
    expect(agentAccessTokenMigration?.sql).toContain(
      'GRANT EXECUTE ON FUNCTION appsea.issue_agent_access_token'
    )
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
