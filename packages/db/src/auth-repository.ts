import { promisify } from 'node:util'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions
} from 'node:crypto'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  appseaIdentifierSchema,
  complaintAnalysisSchema,
  composeCompetitiveResearchReadModel,
  evidenceRedactionMarker,
  evidenceRedactionFieldSchema,
  objectReferenceSchema,
  authPasswordResetInputSchema,
  authPasswordResetRequestInputSchema,
  authPasswordResetTokenSchema,
  authExternalIdentityClaimsSchema,
  authExternalIdentityReadModelSchema,
  authReauthenticationInputSchema,
  authAccountDeletionInputSchema,
  authAccountDeletionResultSchema,
  workspaceArchiveInputSchema,
  workspaceArchiveResultSchema,
  workspacePurgeManifestInputSchema,
  workspacePurgeManifestObjectSchema,
  workspacePurgeManifestSchema,
  workspacePurgeRequestCancelInputSchema,
  workspacePurgeRequestInputSchema,
  workspacePurgeRequestSchema,
  workspacePurgeReadinessSchema,
  authSessionSummaryReadModelSchema,
  authSessionReadModelSchema,
  authSignInInputSchema,
  authSignInResultSchema,
  authSignInSuccessResultSchema,
  authSignUpInputSchema,
  authMfaCodeSchema,
  authMfaDisableInputSchema,
  authMfaStepUpInputSchema,
  authMfaEnrollmentConfirmInputSchema,
  authMfaEnrollmentReadModelSchema,
  authMfaKeyRotationRewrapInputSchema,
  authMfaKeyRotationRewrapResultSchema,
  authMfaKeyRotationStatusSchema,
  authMfaSignInInputSchema,
  authMfaStatusReadModelSchema,
  authSessionTokenSchema,
  fixtureResearchArtifactSchema,
  opportunityReportSchema,
  opportunitySchema,
  planPackageSchema,
  reportSourceCoverageSchema,
  workspaceMemberRoleUpdateInputSchema,
  workspaceInvitationAcceptInputSchema,
  workspaceInvitationCreateInputSchema,
  workspaceInvitationReadModelSchema,
  workspaceMemberReadModelSchema,
  workspaceEvidenceReadModelSchema,
  workspaceMembershipReadModelSchema,
  workspaceOpportunityDetailReadModelSchema,
  workspaceOpportunityReadModelSchema,
  workspacePlanApprovalInputSchema,
  workspacePlanExportReadModelSchema,
  workspacePlanReadModelSchema,
  workspaceReportApprovalInputSchema,
  workspaceReportExportReadModelSchema,
  workspaceReportReadModelSchema,
  redactOpportunityReport,
  redactComplaintAnalysis,
  redactOpportunity,
  redactOpportunityReadModel,
  redactPlanPackage,
  type MaintenanceSchedulerFence,
  type AuthSessionReadModel,
  type AuthSessionSummaryReadModel,
  type AuthPasswordResetInput,
  type AuthPasswordResetRequestInput,
  type AuthExternalIdentityClaims,
  type AuthExternalIdentityReadModel,
  type AuthSignInResult,
  type AuthReauthenticationInput,
  type AuthAccountDeletionInput,
  type AuthAccountDeletionResult,
  type WorkspaceArchiveInput,
  type WorkspaceArchiveResult,
  type WorkspacePurgeManifest,
  type WorkspacePurgeManifestInput,
  type WorkspacePurgeRequest,
  type WorkspacePurgeRequestCancelInput,
  type WorkspacePurgeRequestInput,
  type WorkspacePurgeReadiness,
  type AuthSignInInput,
  type AuthSignInSuccessResult,
  type AuthSignUpInput,
  type AuthMfaDisableInput,
  type AuthMfaStepUpInput,
  type AuthMfaEnrollmentConfirmInput,
  type AuthMfaEnrollmentReadModel,
  type AuthMfaKeyRotationRewrapInput,
  type AuthMfaKeyRotationRewrapResult,
  type AuthMfaKeyRotationStatus,
  type AuthMfaSignInInput,
  type AuthMfaStatusReadModel,
  type WorkspaceEvidenceReadModel,
  type EvidenceRedactionMask,
  type WorkspaceMemberReadModel,
  type WorkspaceMemberRoleUpdateInput,
  type WorkspaceInvitationCreateInput,
  type WorkspaceInvitationReadModel,
  type WorkspaceInvitationAcceptedReadModel,
  type WorkspaceMembershipReadModel,
  type WorkspaceOpportunityDetailReadModel,
  type WorkspaceOpportunityReadModel,
  type WorkspacePlanApprovalInput,
  type WorkspacePlanExportReadModel,
  type WorkspacePlanReadModel,
  type WorkspaceReportApprovalInput,
  type WorkspaceReportExportReadModel,
  type WorkspaceReportReadModel
} from '@appsea/contracts'
import { decodeOpportunityReport, decodePlanPackage } from '@appsea/reports'
import type { ObjectStore } from '@appsea/object-store'
import { contentHash, sha256 } from './hash'
import {
  buildMfaOtpAuthUri,
  generateMfaRecoveryCodes,
  generateMfaSecret,
  hashMfaRecoveryCode,
  isMfaRecoveryCode,
  verifyMfaTotpCode,
  normalizeMfaCode
} from './auth-mfa'
import {
  decryptMfaSecret as decryptMfaSecretWithConfig,
  encryptMfaSecret as encryptMfaSecretWithConfig,
  mfaEncryptionConfigFromEnv,
  type MfaEncryptionConfig
} from './auth-mfa-key'
import {
  MaintenanceSchedulerFenceError,
  WorkspaceAuthorizationError,
  withAuthenticatedWorkspaceTransaction,
  withDatabaseTransaction
} from './transaction'

const scrypt = promisify(scryptCallback) as unknown as (
  password: string | NodeJS.TypedArray | DataView,
  salt: string | NodeJS.TypedArray | DataView,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1_000
const scryptCost = 16_384
const scryptBlockSize = 8
const scryptParallelization = 1
const scryptKeyBytes = 32
const authRateLimitWindowMs = 15 * 60 * 1_000
const recentReauthenticationWindowMs = 15 * 60 * 1_000
const mfaChallengeLifetimeMs = 10 * 60 * 1_000
const mfaChallengeMaxAttempts = 5
const mfaChallengeLockMs = 10 * 60 * 1_000

export class AuthenticationError extends Error {
  constructor() {
    super('Invalid email or password')
    this.name = 'AuthenticationError'
  }
}

export class AuthenticationConflictError extends Error {
  constructor() {
    super('Unable to create the account')
    this.name = 'AuthenticationConflictError'
  }
}

export class AuthExternalIdentityNotFoundError extends Error {
  constructor() {
    super('The external identity is not linked to an AppSea account')
    this.name = 'AuthExternalIdentityNotFoundError'
  }
}

export class AuthExternalIdentityConflictError extends Error {
  constructor() {
    super('The external identity is already linked')
    this.name = 'AuthExternalIdentityConflictError'
  }
}

export class AuthExternalIdentityPermissionError extends Error {
  constructor() {
    super('A recent password and MFA step-up is required to manage external identities')
    this.name = 'AuthExternalIdentityPermissionError'
  }
}

export class AuthSessionNotFoundError extends Error {
  constructor() {
    super('Authentication session was not found')
    this.name = 'AuthSessionNotFoundError'
  }
}

export class AuthSessionConflictError extends Error {
  constructor() {
    super('The current authentication session cannot be revoked')
    this.name = 'AuthSessionConflictError'
  }
}

export class AuthPasswordResetError extends Error {
  constructor() {
    super('The password reset token is invalid or expired')
    this.name = 'AuthPasswordResetError'
  }
}

export class AuthPasswordResetConfigurationError extends Error {
  constructor() {
    super('Password recovery encryption is not configured')
    this.name = 'AuthPasswordResetConfigurationError'
  }
}

export class AuthMfaConfigurationError extends Error {
  constructor() {
    super('MFA encryption is not configured')
    this.name = 'AuthMfaConfigurationError'
  }
}

export class AuthMfaKeyRotationError extends Error {
  constructor() {
    super('MFA key rotation could not be completed')
    this.name = 'AuthMfaKeyRotationError'
  }
}

export class AuthMfaKeyRotationUnknownVersionError extends AuthMfaKeyRotationError {
  constructor() {
    super()
    this.name = 'AuthMfaKeyRotationUnknownVersionError'
  }
}

export class AuthMfaAlreadyEnabledError extends Error {
  constructor() {
    super('MFA is already enabled for this account')
    this.name = 'AuthMfaAlreadyEnabledError'
  }
}

export class AuthMfaNotEnabledError extends Error {
  constructor() {
    super('MFA is not enabled for this account')
    this.name = 'AuthMfaNotEnabledError'
  }
}

export class AuthMfaVerificationError extends Error {
  constructor() {
    super('The MFA code is invalid or expired')
    this.name = 'AuthMfaVerificationError'
  }
}

export class AuthAccountDeletionBlockedError extends Error {
  readonly workspaceIds: string[]

  constructor(workspaceIds: string[]) {
    super('Transfer workspace ownership before closing this account')
    this.name = 'AuthAccountDeletionBlockedError'
    this.workspaceIds = [...workspaceIds]
  }
}

export class WorkspaceArchivePermissionError extends Error {
  constructor() {
    super('Only the workspace owner can archive this active workspace')
    this.name = 'WorkspaceArchivePermissionError'
  }
}

export class WorkspacePurgeRequestPermissionError extends Error {
  constructor() {
    super('Only the workspace owner can request or cancel workspace purge')
    this.name = 'WorkspacePurgeRequestPermissionError'
  }
}

export class WorkspacePurgeRequestNotReadyError extends Error {
  readonly readiness: WorkspacePurgeReadiness

  constructor(readiness: WorkspacePurgeReadiness) {
    super('Workspace purge request is blocked by the current database readiness inventory')
    this.name = 'WorkspacePurgeRequestNotReadyError'
    this.readiness = readiness
  }
}

export class WorkspacePurgeManifestPermissionError extends Error {
  constructor() {
    super('Only the workspace owner can prepare or read a workspace purge manifest')
    this.name = 'WorkspacePurgeManifestPermissionError'
  }
}

export class WorkspacePurgeManifestNotReadyError extends Error {
  constructor() {
    super('Workspace purge manifests require an archived workspace')
    this.name = 'WorkspacePurgeManifestNotReadyError'
  }
}

export class WorkspaceInvitationError extends Error {
  constructor() {
    super('The workspace invitation is invalid, expired, or for another account')
    this.name = 'WorkspaceInvitationError'
  }
}

export class WorkspaceInvitationConflictError extends Error {
  constructor() {
    super('That email is already a workspace member')
    this.name = 'WorkspaceInvitationConflictError'
  }
}

export class WorkspaceMembershipManagementError extends Error {
  constructor() {
    super('Only workspace owners can manage members')
    this.name = 'WorkspaceMembershipManagementError'
  }
}

export class WorkspaceMembershipNotFoundError extends Error {
  constructor() {
    super('Workspace member was not found')
    this.name = 'WorkspaceMembershipNotFoundError'
  }
}

export class WorkspaceMembershipConflictError extends Error {
  constructor() {
    super('The workspace must retain at least one owner')
    this.name = 'WorkspaceMembershipConflictError'
  }
}

export class WorkspaceReportPermissionError extends Error {
  constructor() {
    super('The workspace role cannot perform this report approval action')
    this.name = 'WorkspaceReportPermissionError'
  }
}

export class WorkspaceReportNotFoundError extends Error {
  constructor() {
    super('The report was not found')
    this.name = 'WorkspaceReportNotFoundError'
  }
}

export class WorkspaceReportApprovalConflictError extends Error {
  constructor() {
    super('The report approval transition is not permitted')
    this.name = 'WorkspaceReportApprovalConflictError'
  }
}

export class WorkspaceReportNotApprovedError extends Error {
  constructor() {
    super('Only approved reports can be exported')
    this.name = 'WorkspaceReportNotApprovedError'
  }
}

export class WorkspacePlanPermissionError extends Error {
  constructor() {
    super('The workspace role cannot perform this plan approval action')
    this.name = 'WorkspacePlanPermissionError'
  }
}

export class WorkspacePlanNotFoundError extends Error {
  constructor() {
    super('The plan package was not found')
    this.name = 'WorkspacePlanNotFoundError'
  }
}

export class WorkspacePlanApprovalConflictError extends Error {
  constructor() {
    super('The plan approval transition is not permitted')
    this.name = 'WorkspacePlanApprovalConflictError'
  }
}

export class WorkspacePlanNotApprovedError extends Error {
  constructor() {
    super('Only approved plans can be exported')
    this.name = 'WorkspacePlanNotApprovedError'
  }
}

interface UserRow extends QueryResultRow {
  user_id: string
  email: string
  display_name: string
  created_at: Date | string
}

interface SessionRow extends QueryResultRow {
  session_id: string
  user_id: string
  email: string
  display_name: string
  user_created_at: Date | string
  expires_at: Date | string
}

interface AuthExternalIdentityRow extends QueryResultRow {
  identity_id: string
  user_id: string
  provider: 'oidc'
  issuer: string
  subject: string
  email: string
  linked_at: Date | string
  last_authenticated_at: Date | string | null
}

interface ReauthenticationSessionRow extends QueryResultRow {
  session_id: string
  password_hash: string
}

interface MfaSessionUserRow extends QueryResultRow {
  user_id: string
  email: string
}

interface MfaTotpRow extends QueryResultRow {
  user_id: string
  email: string
  secret_ciphertext: string
  secret_nonce: string
  secret_tag: string
  secret_key_version: number | string | null
  status: 'pending' | 'enabled'
  verified_at: Date | string | null
  last_used_step: number | string | null
}

interface MfaStatusRow extends QueryResultRow {
  status: 'pending' | 'enabled' | null
  verified_at: Date | string | null
  recovery_codes_remaining: number | string
}

interface MfaKeyRotationRow extends QueryResultRow {
  secret_key_version: number | string
  status: 'pending' | 'enabled'
  account_count: number | string
}

interface MfaKeyRotationSecretRow extends QueryResultRow {
  user_id: string
  secret_ciphertext: string
  secret_nonce: string
  secret_tag: string
  secret_key_version: number | string | null
}

interface MfaChallengeRow extends QueryResultRow {
  challenge_id: string
  user_id: string
  email: string
  oidc_identity_id: string | null
  oidc_issuer: string | null
  expires_at: Date | string
  attempt_count: number | string
  locked_until: Date | string | null
  consumed_at: Date | string | null
}

export interface PasswordResetDeliveryRecord {
  deliveryId: string
  email: string
  tokenCiphertext: string
  tokenNonce: string
  tokenTag: string
  expiresAt: string
}

export interface PasswordResetIssueResult {
  issued: boolean
  expiresAt: string
}

export interface WorkspaceInvitationIssueResult {
  invitation: WorkspaceInvitationReadModel
}

export interface WorkspaceInvitationDeliveryRecord {
  deliveryId: string
  invitationId: string
  workspaceId: string
  email: string
  tokenCiphertext: string
  tokenNonce: string
  tokenTag: string
  role: 'editor' | 'viewer'
  expiresAt: string
}

interface AuthSessionSummaryRow extends QueryResultRow {
  session_id: string
  created_at: Date | string
  last_seen_at: Date | string
  expires_at: Date | string
  is_current: boolean
}

interface MembershipRow extends QueryResultRow {
  workspace_id: string
  role: 'owner' | 'editor' | 'viewer'
}

interface WorkspaceArchiveRow extends QueryResultRow {
  workspace_id: string
  state: 'archived' | 'blocked'
  archived_at: Date | string | null
  active_work_count: number | string
  replayed: boolean
}

interface WorkspacePurgeReadinessRow extends QueryResultRow {
  workspace_id: string
  status: 'active' | 'suspended' | 'archived'
  archived_at: Date | string | null
  active_work_count: number | string
  raw_source_object_reference_count: number | string
  analysis_object_reference_count: number | string
  report_object_reference_count: number | string
  plan_object_reference_count: number | string
  checked_at: Date | string
}

interface WorkspacePurgeRequestRow extends QueryResultRow {
  workspace_id: string
  request_id: string | null
  state: 'awaiting_external_controls' | 'canceled' | 'blocked'
  requested_at: Date | string | null
  canceled_at: Date | string | null
  readiness_snapshot: unknown
  replayed: boolean
}

interface WorkspacePurgeManifestRow extends QueryResultRow {
  workspace_id: string
  manifest_id: string
  generated_by: string
  generated_at: Date | string
  expires_at: Date | string
  manifest_hash: string
  object_count: number | string
  object_entries: unknown
  external_requirements: string[]
  replayed: boolean
}

interface WorkspaceMemberRow extends QueryResultRow {
  user_id: string
  email: string
  display_name: string
  role: 'owner' | 'editor' | 'viewer'
  created_at: Date | string
}

interface WorkspaceMemberRoleRow extends QueryResultRow {
  user_id: string
  role: 'owner' | 'editor' | 'viewer'
}

interface WorkspaceInvitationRow extends QueryResultRow {
  invitation_id: string
  email: string
  role: 'editor' | 'viewer'
  state: 'pending' | 'accepted' | 'revoked' | 'expired'
  created_at: Date | string
  expires_at: Date | string
}

interface WorkspaceRow extends QueryResultRow {
  workspace_id: string
  slug: string
  display_name: string
  visibility: 'private' | 'public'
  fixture_only: boolean
  role: 'owner' | 'editor' | 'viewer'
}

interface OpportunityRow extends QueryResultRow {
  opportunity_id: string
  slug: string
  name: string
  one_line: string
  thesis: string
  audience: string
  first_wedge: string
  complaint_count: number | string
  synthetic: boolean
  tags: string[]
  contrary_evidence: string[]
  state: WorkspaceOpportunityReadModel['state']
  source_run_id: string
  current_score_snapshot_id: string | null
  current_plan_package_id: string | null
  score: number | string | null
  scoring_version: string | null
  score_calculated_at: Date | string | null
  current_report_id: string | null
  factors: unknown
  weights: unknown
}

interface EvidenceRow extends QueryResultRow {
  evidence_id: string
  source_item_id: string
  canonical_locator: string | null
  normalized_text: string
  language: string
  product_candidate: string
  company_candidate: string
  feature_candidate: string
  category_candidate: string
  analysis_snapshot: unknown
  review_state: 'unreviewed' | 'confirmed' | 'corrected' | 'rejected'
  synthetic: boolean
  redacted: boolean
  redacted_fields: string[]
  source_redacted_fields: string[]
  allowed_representation: WorkspaceEvidenceReadModel['allowedRepresentation']
  captured_at: Date | string
  published_at: Date | string | null
}

interface WorkspaceReportRow extends QueryResultRow {
  report_id: string
  version: string
  structured_report: unknown
  structured_object_ref: unknown
  generated_at: Date | string
  approval_state: WorkspaceReportReadModel['approvalState']
  manifest_hash: string
  deletion_state: string
  synthetic: boolean
  analysis_report_object_ref: unknown
  analysis_run_id: string | null
  collection_run_id: string | null
}

interface WorkspacePlanRow extends QueryResultRow {
  plan_package_id: string
  report_id: string | null
  version: string
  fixture_files: unknown
  package_object_ref: unknown
  generated_at: Date | string
  readiness_state: WorkspacePlanReadModel['readinessState']
  approval_state: WorkspacePlanReadModel['approvalState']
  synthetic: boolean
  deletion_state: string
  manifest_hash: string
  opportunity_slug: string
  analysis_run_id: string | null
  collection_run_id: string
  analysis_plan_object_ref: unknown
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapWorkspacePurgeRequest(row: WorkspacePurgeRequestRow): WorkspacePurgeRequest {
  if (row.request_id === null || row.requested_at === null || row.state === 'blocked') {
    throw new Error('Workspace purge request row is incomplete')
  }
  return workspacePurgeRequestSchema.parse({
    workspaceId: row.workspace_id,
    requestId: row.request_id,
    state: row.state,
    requestedAt: iso(row.requested_at),
    canceledAt: row.canceled_at === null ? null : iso(row.canceled_at),
    readiness: workspacePurgeReadinessSchema.parse(row.readiness_snapshot)
  })
}

function mapWorkspacePurgeManifest(row: WorkspacePurgeManifestRow): WorkspacePurgeManifest {
  const objects = workspacePurgeManifestObjectSchema.array().parse(row.object_entries)
  return workspacePurgeManifestSchema.parse({
    workspaceId: row.workspace_id,
    manifestId: row.manifest_id,
    generatedAt: iso(row.generated_at),
    expiresAt: iso(row.expires_at),
    manifestHash: row.manifest_hash,
    objectCount: Number(row.object_count),
    objects,
    externalRequirements: row.external_requirements
  })
}

function identifier(prefix: string): string {
  return `${prefix}:${randomBytes(18).toString('hex')}`
}

function sessionToken(): string {
  return randomBytes(48).toString('base64url')
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || `workspace-${randomBytes(5).toString('hex')}`
}

function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16)
  return scrypt(password, salt, scryptKeyBytes, {
    N: scryptCost,
    r: scryptBlockSize,
    p: scryptParallelization,
    maxmem: 32 * 1024 * 1024
  }).then((derived) => {
    const digest = Buffer.from(derived as Uint8Array).toString('hex')
    return `scrypt$${scryptCost}$${scryptBlockSize}$${scryptParallelization}$${salt.toString('hex')}$${digest}`
  })
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltHex, digestHex] = stored.split('$')
  if (
    algorithm !== 'scrypt' ||
    cost !== String(scryptCost) ||
    blockSize !== String(scryptBlockSize) ||
    parallelization !== String(scryptParallelization) ||
    !saltHex ||
    !digestHex ||
    !/^[a-f0-9]{32}$/.test(saltHex) ||
    !/^[a-f0-9]{64}$/.test(digestHex)
  ) {
    return false
  }
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), scryptKeyBytes, {
    N: scryptCost,
    r: scryptBlockSize,
    p: scryptParallelization,
    maxmem: 32 * 1024 * 1024
  })
  const expected = Buffer.from(digestHex, 'hex')
  const actual = Buffer.from(derived as Uint8Array)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function passwordResetEncryptionKey(): Buffer {
  const configured = process.env.APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY
  if (!configured) {
    if (process.env.NODE_ENV === 'test') return Buffer.alloc(32, 7)
    throw new AuthPasswordResetConfigurationError()
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(configured)) {
    throw new AuthPasswordResetConfigurationError()
  }
  const key = Buffer.from(configured, 'base64url')
  if (key.length !== 32) throw new AuthPasswordResetConfigurationError()
  return key
}

function mfaEncryptionConfig(): MfaEncryptionConfig {
  try {
    return mfaEncryptionConfigFromEnv()
  } catch {
    throw new AuthMfaConfigurationError()
  }
}

function encryptMfaSecret(secret: string) {
  try {
    return encryptMfaSecretWithConfig(secret, mfaEncryptionConfig())
  } catch {
    throw new AuthMfaConfigurationError()
  }
}

function decryptMfaSecret(row: {
  secret_ciphertext: string
  secret_nonce: string
  secret_tag: string
  secret_key_version?: number | string | null
}) {
  try {
    return decryptMfaSecretWithConfig(row, mfaEncryptionConfig())
  } catch {
    throw new AuthMfaConfigurationError()
  }
}

function encryptPasswordResetToken(token: string): {
  ciphertext: string
  nonce: string
  tag: string
} {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', passwordResetEncryptionKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64url'),
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  }
}

export function decryptPasswordResetDelivery(record: PasswordResetDeliveryRecord): string {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      passwordResetEncryptionKey(),
      Buffer.from(record.tokenNonce, 'base64url')
    )
    decipher.setAuthTag(Buffer.from(record.tokenTag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(record.tokenCiphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new AuthPasswordResetConfigurationError()
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function isWorkspaceArchivePermissionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '42501'
  )
}

function isMembershipOwnerConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23514' &&
    'message' in error &&
    String((error as { message?: unknown }).message).includes('workspace must retain an owner')
  )
}

function isReportApprovalConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23514' &&
    'message' in error &&
    String((error as { message?: unknown }).message).includes('report')
  )
}

function isPlanApprovalConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23514' &&
    'message' in error &&
    String((error as { message?: unknown }).message).includes('plan')
  )
}

function mapWorkspace(row: WorkspaceRow): WorkspaceMembershipReadModel {
  return workspaceMembershipReadModelSchema.parse({
    workspaceId: row.workspace_id,
    slug: row.slug,
    displayName: row.display_name,
    visibility: row.visibility,
    fixtureOnly: row.fixture_only,
    role: row.role
  })
}

function mapWorkspaceMember(row: WorkspaceMemberRow): WorkspaceMemberReadModel {
  return workspaceMemberReadModelSchema.parse({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: iso(row.created_at)
  })
}

function mapWorkspaceInvitation(row: WorkspaceInvitationRow): WorkspaceInvitationReadModel {
  const expiresAt = iso(row.expires_at)
  const state =
    row.state === 'pending' && new Date(expiresAt).getTime() <= Date.now() ? 'expired' : row.state
  return workspaceInvitationReadModelSchema.parse({
    invitationId: row.invitation_id,
    email: row.email,
    role: row.role,
    state,
    createdAt: iso(row.created_at),
    expiresAt
  })
}

function mapExternalIdentity(row: AuthExternalIdentityRow): AuthExternalIdentityReadModel {
  let issuerHost: string
  try {
    issuerHost = new URL(row.issuer).hostname
  } catch {
    throw new Error('Stored external identity issuer is invalid')
  }
  return authExternalIdentityReadModelSchema.parse({
    identityId: row.identity_id,
    provider: row.provider,
    issuerHost,
    email: row.email,
    linkedAt: iso(row.linked_at),
    lastAuthenticatedAt: row.last_authenticated_at === null ? null : iso(row.last_authenticated_at)
  })
}

function mapOpportunity(row: OpportunityRow): WorkspaceOpportunityReadModel {
  return workspaceOpportunityReadModelSchema.parse({
    id: row.opportunity_id,
    slug: row.slug,
    name: row.name,
    oneLine: row.one_line,
    complaintCount: Number(row.complaint_count),
    synthetic: row.synthetic,
    score: Number(row.score ?? 0),
    scoreVersion: row.scoring_version ?? 'unknown',
    scoreCalculatedAt: iso(row.score_calculated_at ?? new Date(0)),
    state: row.state,
    currentReportId: row.current_report_id,
    currentPlanPackageId: row.current_plan_package_id
  })
}

async function mapWorkspaceReport(
  row: WorkspaceReportRow,
  workspaceId: string,
  objectStore?: ObjectStore,
  masks: readonly EvidenceRedactionMask[] = []
): Promise<WorkspaceReportReadModel> {
  let structuredReport = row.structured_report
  const objectReferenceValue =
    row.analysis_report_object_ref ??
    (typeof row.structured_object_ref === 'object' ? row.structured_object_ref : null)
  if (objectReferenceValue !== null && objectReferenceValue !== undefined) {
    if (!objectStore) throw new WorkspaceReportNotFoundError()
    const reference = objectReferenceSchema.safeParse(objectReferenceValue)
    if (!reference.success || reference.data.kind !== 'report-json') {
      throw new WorkspaceReportNotFoundError()
    }
    try {
      const stored = await objectStore.get(workspaceId, reference.data)
      if (!stored || stored.reference.deletionState !== 'active') {
        throw new WorkspaceReportNotFoundError()
      }
      const decodedReport = decodeOpportunityReport(stored.body)
      structuredReport = decodedReport
      if (row.synthetic !== false || decodedReport.synthetic || decodedReport.testOnly) {
        throw new WorkspaceReportNotFoundError()
      }
    } catch (error) {
      if (error instanceof WorkspaceReportNotFoundError) throw error
      throw new WorkspaceReportNotFoundError()
    }
  }
  const parsedReport = opportunityReportSchema.parse(structuredReport)
  return workspaceReportReadModelSchema.parse({
    id: row.report_id,
    version: row.version,
    structuredReport: redactOpportunityReport(parsedReport, masks),
    generatedAt: iso(row.generated_at),
    approvalState: row.approval_state
  })
}

async function mapWorkspacePlan(
  row: WorkspacePlanRow,
  workspaceId: string,
  objectStore?: ObjectStore,
  masks: readonly EvidenceRedactionMask[] = []
): Promise<WorkspacePlanReadModel> {
  let files: unknown = row.fixture_files
  const objectReferenceValue =
    row.analysis_plan_object_ref ??
    (typeof row.package_object_ref === 'object' ? row.package_object_ref : null)
  if (!row.synthetic || objectReferenceValue !== null) {
    if (!objectStore) throw new WorkspacePlanNotFoundError()
    const reference = objectReferenceSchema.safeParse(objectReferenceValue)
    if (!reference.success || reference.data.kind !== 'plan-package') {
      throw new WorkspacePlanNotFoundError()
    }
    try {
      const stored = await objectStore.get(workspaceId, reference.data)
      if (!stored || stored.reference.deletionState !== 'active') {
        throw new WorkspacePlanNotFoundError()
      }
      const decodedPlan = decodePlanPackage(stored.body)
      if (decodedPlan.opportunitySlug !== row.opportunity_slug || row.synthetic) {
        throw new WorkspacePlanNotFoundError()
      }
      files = decodedPlan.files
    } catch (error) {
      if (error instanceof WorkspacePlanNotFoundError) throw error
      throw new WorkspacePlanNotFoundError()
    }
  }
  const parsedFiles = planPackageSchema.shape.files.safeParse(files)
  if (!parsedFiles.success) throw new WorkspacePlanNotFoundError()
  const parsedPlan = planPackageSchema.parse({
    opportunitySlug: row.opportunity_slug,
    generatedAt: iso(row.generated_at),
    files: parsedFiles.data
  })
  return workspacePlanReadModelSchema.parse({
    id: row.plan_package_id,
    version: row.version,
    files: redactPlanPackage(parsedPlan, masks).files,
    generatedAt: iso(row.generated_at),
    readinessState: row.readiness_state,
    approvalState: row.approval_state,
    synthetic: row.synthetic
  })
}

const workspaceReportSelect = `
  SELECT report.report_id, report.version, report.structured_report,
         report.structured_object_ref, report.generated_at,
         report.approval_state, report.manifest_hash, report.deletion_state,
         report.synthetic, report_opportunity.source_run_id AS collection_run_id,
         analysis.analysis_run_id,
         analysis.report_object_ref AS analysis_report_object_ref
    FROM appsea.report_versions report
    JOIN appsea.opportunities report_opportunity
      ON report_opportunity.workspace_id = report.workspace_id
     AND report_opportunity.opportunity_id = report.opportunity_id
    LEFT JOIN appsea.research_analysis_run_outputs analysis_output
      ON analysis_output.workspace_id = report.workspace_id
     AND analysis_output.report_id = report.report_id
    LEFT JOIN appsea.production_analysis_runs analysis
      ON analysis.workspace_id = analysis_output.workspace_id
     AND analysis.analysis_run_id = analysis_output.analysis_run_id`

const workspacePlanSelect = `
  SELECT plan.plan_package_id, plan.report_id, plan.version, plan.fixture_files,
         plan.package_object_ref, plan.generated_at, plan.readiness_state,
         plan.approval_state, plan.synthetic, plan.deletion_state,
         plan.manifest_hash, opportunity.slug AS opportunity_slug,
         plan.run_id AS collection_run_id,
         analysis.analysis_run_id,
         analysis.plan_object_ref AS analysis_plan_object_ref
    FROM appsea.plan_package_versions plan
    JOIN appsea.opportunities opportunity
      ON opportunity.workspace_id = plan.workspace_id
     AND opportunity.opportunity_id = plan.opportunity_id
    LEFT JOIN appsea.research_analysis_run_outputs analysis_output
      ON analysis_output.workspace_id = plan.workspace_id
     AND analysis_output.plan_package_id = plan.plan_package_id
    LEFT JOIN appsea.production_analysis_runs analysis
      ON analysis.workspace_id = analysis_output.workspace_id
     AND analysis.analysis_run_id = analysis_output.analysis_run_id`

const emptyScoreFactors = {
  complaintVolume: 0,
  painSeverity: 0,
  recurrence: 0,
  willingnessToPay: 0,
  competitiveGap: 0,
  buildFeasibility: 0,
  evidenceQuality: 0,
  contraryEvidencePenalty: 0
}

async function readMembershipRows(client: PoolClient, userId: string): Promise<MembershipRow[]> {
  const result = await client.query<MembershipRow>(
    `SELECT workspace_id, role
       FROM appsea.workspace_memberships
      WHERE user_id = $1
      ORDER BY workspace_id`,
    [userId]
  )
  return result.rows
}

async function readEvidenceRedactionMasks(
  client: PoolClient,
  workspaceId: string,
  analysisRunId: string | null
): Promise<EvidenceRedactionMask[]> {
  if (!analysisRunId) return []
  const result = await client.query<{ evidence_id: string; fields: string[] }>(
    `SELECT event.evidence_id,
            array_agg(DISTINCT field ORDER BY field)::text[] AS fields
       FROM appsea.evidence_redaction_events event
       JOIN appsea.research_analysis_run_evidence analysis_evidence
         ON analysis_evidence.workspace_id = event.workspace_id
        AND analysis_evidence.evidence_id = event.evidence_id
      CROSS JOIN LATERAL unnest(event.fields) AS event_field(field)
      WHERE event.workspace_id = $1
        AND analysis_evidence.analysis_run_id = $2
      GROUP BY event.evidence_id`,
    [workspaceId, analysisRunId]
  )
  return result.rows.map((row) => ({
    evidenceId: row.evidence_id,
    fields: evidenceRedactionFieldSchema.array().parse(row.fields)
  }))
}

async function readCollectionRunRedactionMasks(
  client: PoolClient,
  workspaceId: string,
  collectionRunId: string | null
): Promise<EvidenceRedactionMask[]> {
  if (!collectionRunId) return []
  const result = await client.query<{ evidence_id: string; fields: string[] }>(
    `SELECT evidence.evidence_id,
            array_agg(DISTINCT field ORDER BY field)::text[] AS fields
       FROM appsea.research_run_source_items run_item
       JOIN appsea.evidence_records evidence
         ON evidence.workspace_id = run_item.workspace_id
        AND evidence.source_item_id = run_item.source_item_id
       JOIN appsea.source_items source_item
         ON source_item.workspace_id = run_item.workspace_id
        AND source_item.source_item_id = run_item.source_item_id
       CROSS JOIN LATERAL unnest(
         evidence.redacted_fields || source_item.redacted_fields
       ) AS redaction_field(field)
      WHERE run_item.workspace_id = $1
        AND run_item.run_id = $2
      GROUP BY evidence.evidence_id
      ORDER BY evidence.evidence_id`,
    [workspaceId, collectionRunId]
  )
  return result.rows.map((row) => ({
    evidenceId: row.evidence_id,
    fields: evidenceRedactionFieldSchema.array().parse(row.fields)
  }))
}

async function readOutputRedactionMasks(
  client: PoolClient,
  workspaceId: string,
  analysisRunId: string | null,
  collectionRunId: string | null
): Promise<EvidenceRedactionMask[]> {
  return analysisRunId
    ? readEvidenceRedactionMasks(client, workspaceId, analysisRunId)
    : readCollectionRunRedactionMasks(client, workspaceId, collectionRunId)
}

export class PostgresAuthRepository {
  constructor(
    private readonly pool: Pool,
    private readonly objectStore?: ObjectStore
  ) {}

  async signUp(input: AuthSignUpInput): Promise<AuthSignInSuccessResult> {
    const parsed = authSignUpInputSchema.parse(input)
    const now = new Date()
    const userId = identifier('user')
    const workspaceId = identifier('workspace')
    const workspaceName = parsed.workspaceName ?? `${parsed.displayName}'s workspace`
    const workspaceSlug =
      parsed.workspaceSlug ?? `${slugify(parsed.displayName)}-${randomBytes(3).toString('hex')}`
    const password = await passwordHash(parsed.password)
    const token = sessionToken()

    try {
      await withDatabaseTransaction(this.pool, async (client) => {
        await client.query(
          `INSERT INTO appsea.users
             (user_id, email, display_name, password_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [userId, parsed.email, parsed.displayName, password, now]
        )
        await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [workspaceId])
        await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [userId])
        await client.query(
          `INSERT INTO appsea.workspaces
             (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'private', false, 'active', $4, $4)`,
          [workspaceId, workspaceSlug, workspaceName, now]
        )
        await client.query(
          `INSERT INTO appsea.workspace_memberships
             (workspace_id, user_id, role, created_at, updated_at)
           VALUES ($1, $2, 'owner', $3, $3)`,
          [workspaceId, userId, now]
        )
        await this.insertSession(client, userId, token, now)
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new AuthenticationConflictError()
      throw error
    }

    const session = await this.readSession(token)
    if (!session) throw new Error('New authentication session could not be read')
    return authSignInSuccessResultSchema.parse({ mfaRequired: false, token, session })
  }

  async signIn(input: AuthSignInInput): Promise<AuthSignInResult> {
    const parsed = authSignInInputSchema.parse(input)
    const token = sessionToken()
    const now = new Date()
    const mfaChallenge = await withDatabaseTransaction(this.pool, async (client) => {
      const user = await client.query<UserRow & { password_hash: string }>(
        `SELECT user_id, email, display_name, password_hash, created_at
           FROM appsea.users
          WHERE email = $1
            AND account_state = 'active'`,
        [parsed.email]
      )
      const row = user.rows[0]
      if (!row || !(await verifyPassword(parsed.password, row.password_hash))) {
        throw new AuthenticationError()
      }
      const mfa = await client.query<{ enabled: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM appsea.auth_mfa_totp
            WHERE user_id = $1
              AND status = 'enabled'
         ) AS enabled`,
        [row.user_id]
      )
      if (mfa.rows[0]?.enabled === true) {
        const challengeToken = sessionToken()
        const expiresAt = new Date(now.getTime() + mfaChallengeLifetimeMs)
        await client.query(
          `INSERT INTO appsea.auth_mfa_challenges
             (challenge_id, user_id, challenge_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [identifier('mfa-challenge'), row.user_id, sha256(challengeToken), now, expiresAt]
        )
        await this.recordMfaEvent(client, 'challenge_created', row.user_id, null, now)
        return { challengeToken, expiresAt }
      }
      await this.insertSession(client, row.user_id, token, now)
      return null
    })
    if (mfaChallenge) {
      return authSignInResultSchema.parse({
        mfaRequired: true,
        challengeToken: mfaChallenge.challengeToken,
        expiresAt: mfaChallenge.expiresAt.toISOString()
      })
    }
    const session = await this.readSession(token)
    if (!session) throw new Error('Authentication session could not be read')
    return authSignInResultSchema.parse({ mfaRequired: false, token, session })
  }

  async completeMfaSignIn(input: AuthMfaSignInInput): Promise<AuthSignInResult> {
    const parsed = authMfaSignInInputSchema.parse(input)
    const token = sessionToken()
    let userId: string | null = null
    let verificationFailed = false
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const challenge = await client.query<MfaChallengeRow>(
          `SELECT challenge.challenge_id, challenge.user_id,
                  app_user.email, challenge.oidc_identity_id,
                  challenge.oidc_issuer, challenge.expires_at,
                  challenge.attempt_count, challenge.locked_until,
                  challenge.consumed_at
             FROM appsea.auth_mfa_challenges challenge
             JOIN appsea.users app_user ON app_user.user_id = challenge.user_id
            WHERE challenge.challenge_hash = $1
              AND app_user.account_state = 'active'
              AND challenge.expires_at > clock_timestamp()
              AND challenge.consumed_at IS NULL
            FOR UPDATE OF challenge`,
          [sha256(parsed.challengeToken)]
        )
        const challengeRow = challenge.rows[0]
        if (
          !challengeRow ||
          Number(challengeRow.attempt_count) >= mfaChallengeMaxAttempts ||
          (challengeRow.locked_until !== null &&
            new Date(challengeRow.locked_until).getTime() > Date.now())
        ) {
          throw new AuthMfaVerificationError()
        }

        const totp = await client.query<MfaTotpRow>(
          `SELECT mfa.user_id, app_user.email, mfa.secret_ciphertext,
                  mfa.secret_nonce, mfa.secret_tag, mfa.secret_key_version, mfa.status,
                  mfa.verified_at, mfa.last_used_step
             FROM appsea.auth_mfa_totp mfa
             JOIN appsea.users app_user ON app_user.user_id = mfa.user_id
            WHERE mfa.user_id = $1
              AND mfa.status = 'enabled'
            FOR UPDATE OF mfa`,
          [challengeRow.user_id]
        )
        const mfaRow = totp.rows[0]
        if (!mfaRow) throw new AuthMfaVerificationError()

        const verified = await this.verifyMfaCode(client, mfaRow, parsed.code, Date.now())
        if (!verified) {
          const nextAttempts = Number(challengeRow.attempt_count) + 1
          await client.query(
            `UPDATE appsea.auth_mfa_challenges
                SET attempt_count = $2::integer,
                    locked_until = CASE WHEN $2::integer >= $3::integer
                      THEN clock_timestamp() + ($4::bigint * interval '1 millisecond')
                      ELSE locked_until END
              WHERE challenge_id = $1`,
            [challengeRow.challenge_id, nextAttempts, mfaChallengeMaxAttempts, mfaChallengeLockMs]
          )
          await this.recordMfaEvent(
            client,
            'challenge_failed',
            challengeRow.user_id,
            challengeRow.challenge_id,
            new Date()
          )
          verificationFailed = true
          return
        }

        const now = new Date()
        await client.query(
          `UPDATE appsea.auth_mfa_challenges
              SET consumed_at = $2
            WHERE challenge_id = $1`,
          [challengeRow.challenge_id, now]
        )
        await this.insertSession(client, challengeRow.user_id, token, now, now)
        if (challengeRow.oidc_identity_id && challengeRow.oidc_issuer) {
          await client.query(`SELECT appsea.touch_oidc_identity_sign_in($1, $2, $3, $4)`, [
            identifier('oidc-event'),
            challengeRow.user_id,
            challengeRow.oidc_identity_id,
            challengeRow.oidc_issuer
          ])
        }
        await this.recordMfaEvent(
          client,
          'challenge_succeeded',
          challengeRow.user_id,
          challengeRow.challenge_id,
          now
        )
        userId = challengeRow.user_id
      },
      { maxSerializationRetries: 0 }
    )
    if (verificationFailed) throw new AuthMfaVerificationError()
    if (!userId) throw new AuthMfaVerificationError()
    const session = await this.readSession(token)
    if (!session) throw new Error('MFA authentication session could not be read')
    return authSignInResultSchema.parse({ mfaRequired: false, token, session })
  }

  async readMfaStatus(token: string): Promise<AuthMfaStatusReadModel> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    if (!parsedToken.success) throw new AuthenticationError()
    const result = await withDatabaseTransaction(
      this.pool,
      (client) =>
        client.query<MfaStatusRow>(
          `SELECT mfa.status, mfa.verified_at,
                  COUNT(recovery.recovery_code_id) FILTER (WHERE recovery.consumed_at IS NULL)
                    AS recovery_codes_remaining
             FROM appsea.auth_sessions session
             JOIN appsea.users app_user
               ON app_user.user_id = session.user_id
              AND app_user.account_state = 'active'
             LEFT JOIN appsea.auth_mfa_totp mfa
               ON mfa.user_id = session.user_id
             LEFT JOIN appsea.auth_mfa_recovery_codes recovery
               ON recovery.user_id = session.user_id
            WHERE session.token_hash = $1
              AND session.revoked_at IS NULL
              AND session.expires_at > clock_timestamp()
            GROUP BY mfa.status, mfa.verified_at`,
          [sha256(parsedToken.data)]
        ),
      { readOnly: true, maxSerializationRetries: 0 }
    )
    const row = result.rows[0]
    if (!row) throw new AuthenticationError()
    return authMfaStatusReadModelSchema.parse({
      enabled: row?.status === 'enabled',
      enrolledAt: row?.status === 'enabled' && row.verified_at ? iso(row.verified_at) : null,
      recoveryCodesRemaining: Number(row?.recovery_codes_remaining ?? 0)
    })
  }

  /**
   * Return operator-only MFA key-version counts. This intentionally exposes
   * no key material or encrypted fields and is safe to run during a reviewed
   * deployment rotation.
   */
  async readMfaKeyRotationStatus(): Promise<AuthMfaKeyRotationStatus> {
    const config = mfaEncryptionConfig()
    const result = await withDatabaseTransaction(
      this.pool,
      (client) =>
        client.query<MfaKeyRotationRow>(
          `SELECT secret_key_version, status, COUNT(*)::bigint AS account_count
             FROM appsea.auth_mfa_totp
            GROUP BY secret_key_version, status
            ORDER BY secret_key_version, status`,
          []
        ),
      { readOnly: true, maxSerializationRetries: 0 }
    )
    let totalAccounts = 0
    let currentKeyAccounts = 0
    let previousKeyAccounts = 0
    let unknownKeyAccounts = 0
    let enabledAccounts = 0
    let pendingAccounts = 0
    for (const row of result.rows) {
      const count = Number(row.account_count)
      const version = Number(row.secret_key_version)
      totalAccounts += count
      if (version === config.current.version) currentKeyAccounts += count
      else if (config.previous?.version === version) previousKeyAccounts += count
      else unknownKeyAccounts += count
      if (row.status === 'enabled') enabledAccounts += count
      else pendingAccounts += count
    }
    return authMfaKeyRotationStatusSchema.parse({
      currentKeyVersion: config.current.version,
      previousKeyVersion: config.previous?.version ?? null,
      totalAccounts,
      currentKeyAccounts,
      previousKeyAccounts,
      unknownKeyAccounts,
      enabledAccounts,
      pendingAccounts
    })
  }

  /**
   * Rewrap a bounded batch of dormant MFA ciphertexts with the configured
   * current key. The previous key is required, unknown key versions fail
   * closed before any row is changed, and the maintenance fence is asserted
   * inside the same transaction as each batch. Replaying the batch is safe:
   * rows are selected by the previous version and therefore cannot be
   * rewrapped twice after a committed update.
   */
  async rewrapMfaKeyBatch(
    input: AuthMfaKeyRotationRewrapInput,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<AuthMfaKeyRotationRewrapResult> {
    const parsedInput = authMfaKeyRotationRewrapInputSchema.parse(input)
    const config = mfaEncryptionConfig()
    const previous = config.previous
    if (!previous) throw new AuthMfaKeyRotationError()

    try {
      const result = await withDatabaseTransaction(
        this.pool,
        async (client) => {
          const unknown = await client.query<{ account_count: number | string }>(
            `SELECT COUNT(*)::bigint AS account_count
               FROM appsea.auth_mfa_totp
              WHERE secret_key_version NOT IN ($1, $2)`,
            [config.current.version, previous.version]
          )
          if (Number(unknown.rows[0]?.account_count ?? 0) > 0) {
            throw new AuthMfaKeyRotationUnknownVersionError()
          }

          const rows = await client.query<MfaKeyRotationSecretRow>(
            `SELECT user_id, secret_ciphertext, secret_nonce, secret_tag,
                    secret_key_version
               FROM appsea.auth_mfa_totp
              WHERE secret_key_version = $1
              ORDER BY user_id
              LIMIT $2
              FOR UPDATE SKIP LOCKED`,
            [previous.version, parsedInput.batchSize]
          )
          let rewrappedAccounts = 0
          for (const row of rows.rows) {
            let encrypted: ReturnType<typeof encryptMfaSecretWithConfig>
            try {
              const decrypted = decryptMfaSecretWithConfig(row, config)
              if (decrypted.keyVersion !== previous.version) {
                throw new AuthMfaKeyRotationError()
              }
              encrypted = encryptMfaSecretWithConfig(decrypted.secret, config)
            } catch (error) {
              if (error instanceof AuthMfaKeyRotationError) throw error
              throw new AuthMfaKeyRotationError()
            }

            const updated = await client.query(
              `UPDATE appsea.auth_mfa_totp
                  SET secret_ciphertext = $2,
                      secret_nonce = $3,
                      secret_tag = $4,
                      secret_key_version = $5
                WHERE user_id = $1
                  AND secret_key_version = $6`,
              [
                row.user_id,
                encrypted.ciphertext,
                encrypted.nonce,
                encrypted.tag,
                encrypted.keyVersion,
                previous.version
              ]
            )
            if (updated.rowCount !== 1) throw new AuthMfaKeyRotationError()
            await this.recordMfaEvent(
              client,
              'key_rotation_rewrapped',
              row.user_id,
              null,
              new Date()
            )
            rewrappedAccounts += 1
          }

          const remaining = await client.query<{ account_count: number | string }>(
            `SELECT COUNT(*)::bigint AS account_count
               FROM appsea.auth_mfa_totp
              WHERE secret_key_version = $1`,
            [previous.version]
          )
          const remainingPreviousKeyAccounts = Number(remaining.rows[0]?.account_count ?? 0)
          return {
            currentKeyVersion: config.current.version,
            previousKeyVersion: previous.version,
            batchSize: parsedInput.batchSize,
            rewrappedAccounts,
            remainingPreviousKeyAccounts,
            completed: remainingPreviousKeyAccounts === 0
          }
        },
        { maxSerializationRetries: 0, maintenanceFence }
      )
      return authMfaKeyRotationRewrapResultSchema.parse(result)
    } catch (error) {
      if (
        error instanceof AuthMfaKeyRotationError ||
        error instanceof MaintenanceSchedulerFenceError
      ) {
        throw error
      }
      throw new AuthMfaKeyRotationError()
    }
  }

  async beginMfaEnrollment(token: string): Promise<AuthMfaEnrollmentReadModel> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    if (!parsedToken.success) throw new AuthenticationError()
    const secret = generateMfaSecret()
    const recoveryCodes = generateMfaRecoveryCodes()
    const encrypted = encryptMfaSecret(secret)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + mfaChallengeLifetimeMs)
    let email: string | null = null
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const current = await this.currentMfaSessionUser(client, parsedToken.data)
        if (!current) throw new AuthenticationError()
        email = current.email
        const existing = await client.query<{ status: 'pending' | 'enabled' }>(
          `SELECT status
             FROM appsea.auth_mfa_totp
            WHERE user_id = $1
            FOR UPDATE`,
          [current.user_id]
        )
        if (existing.rows[0]?.status === 'enabled') throw new AuthMfaAlreadyEnabledError()
        await client.query(`DELETE FROM appsea.auth_mfa_recovery_codes WHERE user_id = $1`, [
          current.user_id
        ])
        await client.query(
          `INSERT INTO appsea.auth_mfa_totp
             (user_id, secret_ciphertext, secret_nonce, secret_tag, secret_key_version, status,
              created_at, verified_at, last_used_step)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, NULL, NULL)
           ON CONFLICT (user_id) DO UPDATE
             SET secret_ciphertext = EXCLUDED.secret_ciphertext,
                 secret_nonce = EXCLUDED.secret_nonce,
                 secret_tag = EXCLUDED.secret_tag,
                 secret_key_version = EXCLUDED.secret_key_version,
                 status = 'pending',
                 created_at = EXCLUDED.created_at,
                 verified_at = NULL,
                 last_used_step = NULL`,
          [
            current.user_id,
            encrypted.ciphertext,
            encrypted.nonce,
            encrypted.tag,
            encrypted.keyVersion,
            now
          ]
        )
        for (const code of recoveryCodes) {
          await client.query(
            `INSERT INTO appsea.auth_mfa_recovery_codes
               (recovery_code_id, user_id, code_hash, created_at)
             VALUES ($1, $2, $3, $4)`,
            [identifier('mfa-recovery'), current.user_id, hashMfaRecoveryCode(code), now]
          )
        }
        await this.recordMfaEvent(client, 'enrollment_started', current.user_id, null, now)
      },
      { maxSerializationRetries: 0 }
    )
    if (!email) throw new AuthenticationError()
    return authMfaEnrollmentReadModelSchema.parse({
      secret,
      otpauthUri: buildMfaOtpAuthUri(email, secret),
      recoveryCodes,
      expiresAt: expiresAt.toISOString()
    })
  }

  async confirmMfaEnrollment(
    token: string,
    input: AuthMfaEnrollmentConfirmInput
  ): Promise<AuthMfaStatusReadModel> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    const parsedInput = authMfaEnrollmentConfirmInputSchema.safeParse(input)
    if (!parsedToken.success || !parsedInput.success) throw new AuthMfaVerificationError()
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const current = await this.currentMfaSessionUser(client, parsedToken.data)
        if (!current) throw new AuthenticationError()
        const result = await client.query<MfaTotpRow>(
          `SELECT mfa.user_id, app_user.email, mfa.secret_ciphertext,
                  mfa.secret_nonce, mfa.secret_tag, mfa.secret_key_version, mfa.status,
                  mfa.verified_at, mfa.last_used_step
            FROM appsea.auth_mfa_totp mfa
             JOIN appsea.users app_user ON app_user.user_id = mfa.user_id
            WHERE mfa.user_id = $1
              AND mfa.status = 'pending'
              AND mfa.created_at > $2
             FOR UPDATE OF mfa`,
          [current.user_id, new Date(Date.now() - mfaChallengeLifetimeMs)]
        )
        const row = result.rows[0]
        if (!row) throw new AuthMfaVerificationError()
        const decrypted = decryptMfaSecret(row)
        const step = verifyMfaTotpCode(decrypted.secret, parsedInput.data.code, Date.now(), null)
        if (step === null) throw new AuthMfaVerificationError()
        const encrypted = encryptMfaSecret(decrypted.secret)
        const now = new Date()
        await client.query(
          `UPDATE appsea.auth_mfa_totp
              SET secret_ciphertext = $2,
                  secret_nonce = $3,
                  secret_tag = $4,
                  secret_key_version = $5,
                  status = 'enabled',
                  verified_at = $6,
                  last_used_step = $7
            WHERE user_id = $1`,
          [
            current.user_id,
            encrypted.ciphertext,
            encrypted.nonce,
            encrypted.tag,
            encrypted.keyVersion,
            now,
            step
          ]
        )
        await this.recordMfaEvent(client, 'enrollment_completed', current.user_id, null, now)
      },
      { maxSerializationRetries: 0 }
    )
    return this.readMfaStatus(parsedToken.data)
  }

  async disableMfa(token: string, input: AuthMfaDisableInput): Promise<AuthMfaStatusReadModel> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    const parsedInput = authMfaDisableInputSchema.safeParse(input)
    if (!parsedToken.success || !parsedInput.success) throw new AuthMfaVerificationError()
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const current = await this.currentMfaSessionUser(client, parsedToken.data)
        if (!current) throw new AuthenticationError()
        const result = await client.query<MfaTotpRow>(
          `SELECT mfa.user_id, app_user.email, mfa.secret_ciphertext,
                  mfa.secret_nonce, mfa.secret_tag, mfa.secret_key_version, mfa.status,
                  mfa.verified_at, mfa.last_used_step
             FROM appsea.auth_mfa_totp mfa
             JOIN appsea.users app_user ON app_user.user_id = mfa.user_id
            WHERE mfa.user_id = $1
              AND mfa.status = 'enabled'
             FOR UPDATE OF mfa`,
          [current.user_id]
        )
        const row = result.rows[0]
        if (!row) throw new AuthMfaNotEnabledError()
        if (!(await this.verifyMfaCode(client, row, parsedInput.data.code, Date.now()))) {
          throw new AuthMfaVerificationError()
        }
        await client.query(`DELETE FROM appsea.auth_mfa_recovery_codes WHERE user_id = $1`, [
          current.user_id
        ])
        await client.query(`DELETE FROM appsea.auth_mfa_totp WHERE user_id = $1`, [current.user_id])
        await this.recordMfaEvent(client, 'disabled', current.user_id, null, new Date())
      },
      { maxSerializationRetries: 0 }
    )
    return this.readMfaStatus(parsedToken.data)
  }

  /** Queue a single-use reset token without exposing it to the web response. */
  async requestPasswordReset(
    input: AuthPasswordResetRequestInput
  ): Promise<PasswordResetIssueResult> {
    const parsed = authPasswordResetRequestInputSchema.parse(input)
    const token = sessionToken()
    const encrypted = encryptPasswordResetToken(token)
    const result = await withDatabaseTransaction(this.pool, async (client) =>
      client.query<{ issued: boolean; reset_token_expires_at: Date | string }>(
        `SELECT *
           FROM appsea.issue_password_reset(
             $1, $2, $3, $4, $5, $6, $7, $8
           )`,
        [
          parsed.email,
          identifier('reset'),
          sha256(token),
          identifier('delivery'),
          sha256(parsed.email),
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.tag
        ]
      )
    )
    const row = result.rows[0]
    if (!row) throw new Error('Password reset request was not recorded')
    return { issued: row.issued, expiresAt: iso(row.reset_token_expires_at) }
  }

  /** Invalidate a reset token through the narrow database function boundary. */
  async invalidatePasswordResetToken(token: string): Promise<void> {
    const parsedToken = authPasswordResetTokenSchema.safeParse(token)
    if (!parsedToken.success) return
    await withDatabaseTransaction(this.pool, async (client) => {
      await client.query(`SELECT appsea.invalidate_password_reset($1)`, [sha256(parsedToken.data)])
    })
  }

  /** Consume a reset token, rotate the password, and revoke every old session. */
  async resetPassword(input: AuthPasswordResetInput): Promise<void> {
    const parsed = authPasswordResetInputSchema.safeParse(input)
    if (!parsed.success) throw new AuthPasswordResetError()
    const tokenHash = sha256(parsed.data.token)
    const active = await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<{ active: boolean }>(
          `SELECT appsea.password_reset_token_is_active($1) AS active`,
          [tokenHash]
        )
        return result.rows[0]?.active === true
      },
      { readOnly: true, maxSerializationRetries: 0 }
    )
    if (!active) throw new AuthPasswordResetError()

    // Do the expensive derivation only after the token has passed the cheap
    // active check. The consume function locks and rechecks it atomically.
    const nextPasswordHash = await passwordHash(parsed.data.password)
    const consumed = await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<{ consumed: boolean }>(
          `SELECT appsea.consume_password_reset($1, $2) AS consumed`,
          [tokenHash, nextPasswordHash]
        )
        return result.rows[0]?.consumed === true
      },
      { maxSerializationRetries: 0 }
    )
    if (!consumed) throw new AuthPasswordResetError()
  }

  async claimPasswordResetDeliveries(
    batchSize = 100,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<PasswordResetDeliveryRecord[]> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new Error('Password reset delivery batch size is invalid')
    }
    const result = await withDatabaseTransaction(
      this.pool,
      (client) =>
        client.query<{
          delivery_id: string
          email: string
          token_ciphertext: string
          token_nonce: string
          token_tag: string
          expires_at: Date | string
        }>(`SELECT * FROM appsea.claim_password_reset_deliveries($1)`, [batchSize]),
      { maxSerializationRetries: 0, maintenanceFence }
    )
    return result.rows.map((row) => ({
      deliveryId: row.delivery_id,
      email: row.email,
      tokenCiphertext: row.token_ciphertext,
      tokenNonce: row.token_nonce,
      tokenTag: row.token_tag,
      expiresAt: iso(row.expires_at)
    }))
  }

  async completePasswordResetDelivery(
    deliveryId: string,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<void> {
    const parsedDeliveryId = appseaIdentifierSchema.safeParse(deliveryId)
    if (!parsedDeliveryId.success) throw new Error('Password reset delivery id is invalid')
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        await client.query(`SELECT appsea.complete_password_reset_delivery($1)`, [
          parsedDeliveryId.data
        ])
      },
      { maintenanceFence }
    )
  }

  async failPasswordResetDelivery(
    deliveryId: string,
    failureCode: string,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<void> {
    const parsedDeliveryId = appseaIdentifierSchema.safeParse(deliveryId)
    if (!parsedDeliveryId.success || !/^[A-Z0-9_:-]{1,80}$/.test(failureCode)) {
      throw new Error('Password reset delivery failure is invalid')
    }
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        await client.query(`SELECT appsea.fail_password_reset_delivery($1, $2)`, [
          parsedDeliveryId.data,
          failureCode
        ])
      },
      { maintenanceFence }
    )
  }

  /**
   * Sign in only through an identity that an existing AppSea account linked
   * explicitly. Provider email claims never perform account discovery or
   * account linking; the issuer/subject pair is the durable identity key.
   */
  async signInWithExternalIdentity(input: AuthExternalIdentityClaims): Promise<AuthSignInResult> {
    const parsed = authExternalIdentityClaimsSchema.parse(input)
    const issuer = parsed.issuer.endsWith('/') ? parsed.issuer.slice(0, -1) : parsed.issuer
    const token = sessionToken()
    const now = new Date()
    const mfaChallenge = await withDatabaseTransaction(this.pool, async (client) => {
      const result = await client.query<
        AuthExternalIdentityRow & { account_state: 'active' | 'closed' }
      >(
        `SELECT identity.identity_id, identity.provider, identity.issuer,
                identity.subject, identity.email, identity.linked_at,
                identity.last_authenticated_at, identity.user_id,
                app_user.account_state
           FROM appsea.auth_identities identity
           JOIN appsea.users app_user ON app_user.user_id = identity.user_id
          WHERE identity.provider = 'oidc'
            AND identity.issuer = $1
            AND identity.subject = $2
            AND app_user.account_state = 'active'
            AND identity.email = $3
          FOR UPDATE OF identity`,
        [issuer, parsed.subject, parsed.email]
      )
      const identity = result.rows[0]
      if (!identity) throw new AuthExternalIdentityNotFoundError()
      const mfa = await client.query<{ enabled: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM appsea.auth_mfa_totp
            WHERE user_id = $1
              AND status = 'enabled'
         ) AS enabled`,
        [identity.user_id]
      )
      if (mfa.rows[0]?.enabled === true) {
        const challengeToken = sessionToken()
        const expiresAt = new Date(now.getTime() + mfaChallengeLifetimeMs)
        await client.query(
          `INSERT INTO appsea.auth_mfa_challenges
             (challenge_id, user_id, challenge_hash, created_at, expires_at,
              oidc_identity_id, oidc_issuer)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            identifier('mfa-challenge'),
            identity.user_id,
            sha256(challengeToken),
            now,
            expiresAt,
            identity.identity_id,
            issuer
          ]
        )
        return { challengeToken, expiresAt }
      }
      await this.insertSession(client, identity.user_id, token, now)
      await client.query(`SELECT appsea.touch_oidc_identity_sign_in($1, $2, $3, $4)`, [
        identifier('oidc-event'),
        identity.user_id,
        identity.identity_id,
        issuer
      ])
      return null
    })
    if (mfaChallenge) {
      return authSignInResultSchema.parse({
        mfaRequired: true,
        challengeToken: mfaChallenge.challengeToken,
        expiresAt: mfaChallenge.expiresAt.toISOString()
      })
    }
    const session = await this.readSession(token)
    if (!session) throw new Error('External identity session could not be read')
    return authSignInResultSchema.parse({ mfaRequired: false, token, session })
  }

  async listExternalIdentities(token: string): Promise<AuthExternalIdentityReadModel[]> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    if (!parsedToken.success) throw new AuthenticationError()
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const current = await this.currentMfaSessionUser(client, parsedToken.data)
        if (!current) throw new AuthenticationError()
        const result = await client.query<AuthExternalIdentityRow>(
          `SELECT identity_id, user_id, provider, issuer, subject, email, linked_at,
                  last_authenticated_at
             FROM appsea.auth_identities
            WHERE user_id = $1
            ORDER BY linked_at, identity_id`,
          [current.user_id]
        )
        return result.rows.map(mapExternalIdentity)
      },
      { readOnly: true, maxSerializationRetries: 0 }
    )
  }

  /** Link or replay an OIDC identity after both current step-up markers pass. */
  async linkExternalIdentity(
    token: string,
    input: AuthExternalIdentityClaims
  ): Promise<AuthExternalIdentityReadModel> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    const parsed = authExternalIdentityClaimsSchema.parse(input)
    if (!parsedToken.success) throw new AuthExternalIdentityPermissionError()
    const issuer = parsed.issuer.endsWith('/') ? parsed.issuer.slice(0, -1) : parsed.issuer
    try {
      return await withDatabaseTransaction(
        this.pool,
        async (client) => {
          const current = await client.query<{
            session_id: string
            user_id: string
            email: string
            mfa_allowed: boolean
          }>(
            `SELECT session.session_id, session.user_id, app_user.email,
                    (
                      NOT EXISTS (
                        SELECT 1 FROM appsea.auth_mfa_totp mfa
                         WHERE mfa.user_id = session.user_id
                           AND mfa.status = 'enabled'
                      )
                      OR (
                        session.last_mfa_reauthenticated_at IS NOT NULL
                        AND session.last_mfa_reauthenticated_at >
                            clock_timestamp() - ($2::bigint * interval '1 millisecond')
                      )
                    ) AS mfa_allowed
               FROM appsea.auth_sessions session
               JOIN appsea.users app_user
                 ON app_user.user_id = session.user_id
                AND app_user.account_state = 'active'
              WHERE session.token_hash = $1
                AND session.revoked_at IS NULL
                AND session.expires_at > clock_timestamp()
                AND session.last_reauthenticated_at >
                    clock_timestamp() - ($2::bigint * interval '1 millisecond')
              FOR UPDATE OF session`,
            [sha256(parsedToken.data), recentReauthenticationWindowMs]
          )
          const currentRow = current.rows[0]
          if (!currentRow || !currentRow.mfa_allowed || currentRow.email !== parsed.email) {
            throw new AuthExternalIdentityPermissionError()
          }

          const existing = await client.query<AuthExternalIdentityRow>(
            `SELECT identity_id, user_id, provider, issuer, subject, email, linked_at,
                    last_authenticated_at
               FROM appsea.auth_identities
              WHERE provider = 'oidc'
                AND issuer = $1
                AND subject = $2
              FOR UPDATE`,
            [issuer, parsed.subject]
          )
          const existingRow = existing.rows[0]
          if (existingRow) {
            if (existingRow.user_id !== currentRow.user_id || existingRow.email !== parsed.email) {
              throw new AuthExternalIdentityConflictError()
            }
            return mapExternalIdentity(existingRow)
          }

          const identityId = identifier('oidc-identity')
          const inserted = await client.query<AuthExternalIdentityRow>(
            `SELECT * FROM appsea.link_oidc_identity($1, $2, $3, $4, $5, $6)`,
            [
              identifier('oidc-event'),
              sha256(parsedToken.data),
              identityId,
              issuer,
              parsed.subject,
              parsed.email
            ]
          )
          const row = inserted.rows[0]
          if (!row) throw new Error('External identity was not recorded')
          return mapExternalIdentity(row)
        },
        { maxSerializationRetries: 0 }
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new AuthExternalIdentityConflictError()
      throw error
    }
  }

  async unlinkExternalIdentity(token: string, identityId: string): Promise<boolean> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    const parsedIdentityId = appseaIdentifierSchema.safeParse(identityId)
    if (!parsedToken.success || !parsedIdentityId.success) {
      throw new AuthExternalIdentityPermissionError()
    }
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const current = await client.query<{
          session_id: string
          user_id: string
          mfa_allowed: boolean
        }>(
          `SELECT session.session_id, session.user_id,
                  (
                    NOT EXISTS (
                      SELECT 1 FROM appsea.auth_mfa_totp mfa
                       WHERE mfa.user_id = session.user_id
                         AND mfa.status = 'enabled'
                    )
                    OR (
                      session.last_mfa_reauthenticated_at IS NOT NULL
                      AND session.last_mfa_reauthenticated_at >
                          clock_timestamp() - ($2::bigint * interval '1 millisecond')
                    )
                  ) AS mfa_allowed
             FROM appsea.auth_sessions session
             JOIN appsea.users app_user
               ON app_user.user_id = session.user_id
              AND app_user.account_state = 'active'
            WHERE session.token_hash = $1
              AND session.revoked_at IS NULL
              AND session.expires_at > clock_timestamp()
              AND session.last_reauthenticated_at >
                  clock_timestamp() - ($2::bigint * interval '1 millisecond')
            FOR UPDATE OF session`,
          [sha256(parsedToken.data), recentReauthenticationWindowMs]
        )
        const currentRow = current.rows[0]
        if (!currentRow || !currentRow.mfa_allowed) {
          throw new AuthExternalIdentityPermissionError()
        }
        const identity = await client.query<{ identity_id: string; issuer: string }>(
          `SELECT identity_id, issuer
             FROM appsea.auth_identities
            WHERE identity_id = $1
              AND user_id = $2
            FOR UPDATE`,
          [parsedIdentityId.data, currentRow.user_id]
        )
        const identityRow = identity.rows[0]
        if (!identityRow) return false
        const result = await client.query<{ unlink_oidc_identity: boolean }>(
          `SELECT appsea.unlink_oidc_identity($1, $2, $3)`,
          [identifier('oidc-event'), sha256(parsedToken.data), parsedIdentityId.data]
        )
        return result.rows[0]?.unlink_oidc_identity === true
      },
      { maxSerializationRetries: 0 }
    )
  }

  private async currentMfaSessionUser(
    client: PoolClient,
    token: string
  ): Promise<MfaSessionUserRow | null> {
    const result = await client.query<MfaSessionUserRow>(
      `SELECT session.user_id, app_user.email
         FROM appsea.auth_sessions session
         JOIN appsea.users app_user
           ON app_user.user_id = session.user_id
          AND app_user.account_state = 'active'
        WHERE session.token_hash = $1
          AND session.revoked_at IS NULL
          AND session.expires_at > clock_timestamp()
        FOR KEY SHARE OF session`,
      [sha256(token)]
    )
    return result.rows[0] ?? null
  }

  private async recordMfaEvent(
    client: PoolClient,
    eventType:
      | 'enrollment_started'
      | 'enrollment_completed'
      | 'disabled'
      | 'challenge_created'
      | 'challenge_succeeded'
      | 'challenge_failed'
      | 'recovery_code_used'
      | 'key_rotation_rewrapped',
    userId: string,
    challengeId: string | null,
    occurredAt: Date
  ): Promise<void> {
    await client.query(
      `INSERT INTO appsea.auth_mfa_events
         (event_id, event_type, user_id, challenge_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [identifier('mfa-event'), eventType, userId, challengeId, occurredAt]
    )
  }

  private async verifyMfaCode(
    client: PoolClient,
    row: MfaTotpRow,
    inputCode: string,
    timestampMs: number
  ): Promise<boolean> {
    const parsedCode = authMfaCodeSchema.safeParse(inputCode)
    if (!parsedCode.success) return false
    const normalized = normalizeMfaCode(parsedCode.data)
    if (isMfaRecoveryCode(normalized)) {
      const recovery = await client.query<{ recovery_code_id: string }>(
        `SELECT recovery_code_id
           FROM appsea.auth_mfa_recovery_codes
          WHERE user_id = $1
            AND code_hash = $2
            AND consumed_at IS NULL
          FOR UPDATE`,
        [row.user_id, hashMfaRecoveryCode(normalized)]
      )
      const recoveryRow = recovery.rows[0]
      if (!recoveryRow) return false
      await client.query(
        `UPDATE appsea.auth_mfa_recovery_codes
            SET consumed_at = clock_timestamp()
          WHERE recovery_code_id = $1`,
        [recoveryRow.recovery_code_id]
      )
      await this.recordMfaEvent(client, 'recovery_code_used', row.user_id, null, new Date())
      return true
    }
    const lastUsedStep = row.last_used_step === null ? null : Number(row.last_used_step)
    const decrypted = decryptMfaSecret(row)
    const step = verifyMfaTotpCode(decrypted.secret, normalized, timestampMs, lastUsedStep)
    if (step === null) return false
    const currentKeyVersion = mfaEncryptionConfig().current.version
    if (decrypted.keyVersion !== currentKeyVersion) {
      const encrypted = encryptMfaSecret(decrypted.secret)
      await client.query(
        `UPDATE appsea.auth_mfa_totp
            SET secret_ciphertext = $2,
                secret_nonce = $3,
                secret_tag = $4,
                secret_key_version = $5,
                last_used_step = $6
          WHERE user_id = $1
            AND status = 'enabled'`,
        [
          row.user_id,
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.tag,
          encrypted.keyVersion,
          step
        ]
      )
    } else {
      await client.query(
        `UPDATE appsea.auth_mfa_totp
            SET last_used_step = $2
          WHERE user_id = $1
            AND status = 'enabled'`,
        [row.user_id, step]
      )
    }
    return true
  }

  private async insertSession(
    client: PoolClient,
    userId: string,
    token: string,
    now: Date,
    mfaAuthenticatedAt: Date | null = null
  ): Promise<void> {
    const expiresAt = new Date(now.getTime() + sessionLifetimeMs)
    await client.query(
      `INSERT INTO appsea.auth_sessions
         (session_id, user_id, token_hash, created_at, expires_at, last_seen_at,
          last_reauthenticated_at, last_mfa_reauthenticated_at)
       VALUES ($1, $2, $3, $4, $5, $4, $4, $6)`,
      [identifier('session'), userId, sha256(token), now, expiresAt, mfaAuthenticatedAt]
    )
  }

  /**
   * Verifies the account password without persisting it and marks the active
   * session as recently reauthenticated for high-risk owner actions.
   */
  async reauthenticateSession(token: string, input: AuthReauthenticationInput): Promise<void> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    const parsedInput = authReauthenticationInputSchema.safeParse(input)
    if (!parsedToken.success || !parsedInput.success) throw new AuthenticationError()
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<ReauthenticationSessionRow>(
          `SELECT session.session_id, app_user.password_hash
             FROM appsea.auth_sessions session
             JOIN appsea.users app_user ON app_user.user_id = session.user_id
            WHERE session.token_hash = $1
              AND app_user.account_state = 'active'
              AND session.revoked_at IS NULL
              AND session.expires_at > clock_timestamp()`,
          [sha256(parsedToken.data)]
        )
        const row = result.rows[0]
        if (!row || !(await verifyPassword(parsedInput.data.password, row.password_hash))) {
          throw new AuthenticationError()
        }
        await client.query(
          `UPDATE appsea.auth_sessions
              SET last_reauthenticated_at = clock_timestamp(),
                  last_seen_at = clock_timestamp()
            WHERE session_id = $1`,
          [row.session_id]
        )
      },
      { maxSerializationRetries: 0 }
    )
  }

  async hasRecentReauthentication(token: string): Promise<boolean> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    if (!parsedToken.success) return false
    const result = await withDatabaseTransaction(
      this.pool,
      (client) =>
        client.query(
          `SELECT 1
             FROM appsea.auth_sessions
           WHERE token_hash = $1
              AND EXISTS (
                SELECT 1 FROM appsea.users app_user
                 WHERE app_user.user_id = appsea.auth_sessions.user_id
                   AND app_user.account_state = 'active'
              )
              AND revoked_at IS NULL
              AND expires_at > clock_timestamp()
              AND last_reauthenticated_at >
                  clock_timestamp() - ($2::bigint * interval '1 millisecond')
            LIMIT 1`,
          [sha256(parsedToken.data), recentReauthenticationWindowMs]
        ),
      { readOnly: true, maxSerializationRetries: 0 }
    )
    return result.rowCount === 1
  }

  /**
   * High-risk bearer-token actions require a fresh MFA proof whenever the
   * account has MFA enabled. Accounts without MFA continue to use the
   * password step-up boundary alone; enabling MFA therefore strengthens the
   * existing control without silently locking out accounts that have not
   * enrolled it yet.
   */
  async hasRecentMfaReauthentication(token: string): Promise<boolean> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    if (!parsedToken.success) return false
    const result = await withDatabaseTransaction(
      this.pool,
      (client) =>
        client.query<{ allowed: boolean }>(
          `SELECT (
             NOT EXISTS (
               SELECT 1
                 FROM appsea.auth_mfa_totp mfa
                WHERE mfa.user_id = session.user_id
                  AND mfa.status = 'enabled'
             )
             OR (
               session.last_mfa_reauthenticated_at IS NOT NULL
               AND session.last_mfa_reauthenticated_at >
                   clock_timestamp() - ($2::bigint * interval '1 millisecond')
             )
           ) AS allowed
             FROM appsea.auth_sessions session
             JOIN appsea.users app_user
               ON app_user.user_id = session.user_id
              AND app_user.account_state = 'active'
            WHERE session.token_hash = $1
              AND session.revoked_at IS NULL
              AND session.expires_at > clock_timestamp()
            LIMIT 1`,
          [sha256(parsedToken.data), recentReauthenticationWindowMs]
        ),
      { readOnly: true, maxSerializationRetries: 0 }
    )
    return result.rows[0]?.allowed === true
  }

  /**
   * Consume a TOTP or one-time recovery code and mark this session as
   * recently MFA-authenticated. The session and MFA row are locked together
   * so a code cannot authorize two concurrent high-risk actions.
   */
  async reauthenticateMfaSession(token: string, input: AuthMfaStepUpInput): Promise<void> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    const parsedInput = authMfaStepUpInputSchema.safeParse(input)
    if (!parsedToken.success || !parsedInput.success) throw new AuthMfaVerificationError()
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const current = await client.query<{ session_id: string; user_id: string }>(
          `SELECT session.session_id, session.user_id
             FROM appsea.auth_sessions session
             JOIN appsea.users app_user
               ON app_user.user_id = session.user_id
              AND app_user.account_state = 'active'
            WHERE session.token_hash = $1
              AND session.revoked_at IS NULL
              AND session.expires_at > clock_timestamp()
            FOR UPDATE OF session`,
          [sha256(parsedToken.data)]
        )
        const currentRow = current.rows[0]
        if (!currentRow) throw new AuthenticationError()

        const result = await client.query<MfaTotpRow>(
          `SELECT mfa.user_id, app_user.email, mfa.secret_ciphertext,
                  mfa.secret_nonce, mfa.secret_tag, mfa.secret_key_version, mfa.status,
                  mfa.verified_at, mfa.last_used_step
             FROM appsea.auth_mfa_totp mfa
             JOIN appsea.users app_user ON app_user.user_id = mfa.user_id
            WHERE mfa.user_id = $1
              AND mfa.status = 'enabled'
            FOR UPDATE OF mfa`,
          [currentRow.user_id]
        )
        const row = result.rows[0]
        if (!row) throw new AuthMfaNotEnabledError()
        if (!(await this.verifyMfaCode(client, row, parsedInput.data.code, Date.now()))) {
          throw new AuthMfaVerificationError()
        }
        await client.query(
          `UPDATE appsea.auth_sessions
              SET last_mfa_reauthenticated_at = clock_timestamp(),
                  last_seen_at = clock_timestamp()
            WHERE session_id = $1`,
          [currentRow.session_id]
        )
      },
      { maxSerializationRetries: 0 }
    )
  }

  /**
   * Close the authenticated account after a recent password step-up. Research
   * rows and memberships remain available to the workspace; authentication
   * material and the profile are revoked/anonymized at the database boundary.
   */
  async closeAccount(
    userId: string,
    input: AuthAccountDeletionInput
  ): Promise<AuthAccountDeletionResult> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    authAccountDeletionInputSchema.parse(input)
    const result = await withDatabaseTransaction(
      this.pool,
      async (client) => {
        await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
        return client.query<{ closed: boolean; blocking_workspace_ids: string[] }>(
          `SELECT closed, blocking_workspace_ids
           FROM appsea.close_user_account($1)`,
          [parsedUserId]
        )
      },
      { maxSerializationRetries: 0 }
    )
    const row = result.rows[0]
    if (!row) throw new Error('Account closure result was not recorded')
    const parsed = authAccountDeletionResultSchema.parse({
      closed: row.closed,
      blockingWorkspaceIds: row.blocking_workspace_ids ?? []
    })
    if (!parsed.closed) throw new AuthAccountDeletionBlockedError(parsed.blockingWorkspaceIds)
    return parsed
  }

  /**
   * Archive a workspace through the owner-only security-definer boundary.
   * Archival blocks new work and retains research lineage; destructive purge
   * of evidence, exports, object storage, or backups is intentionally separate.
   */
  async archiveWorkspace(
    userId: string,
    workspaceId: string,
    input: WorkspaceArchiveInput
  ): Promise<WorkspaceArchiveResult> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    workspaceArchiveInputSchema.parse(input)

    try {
      const result = await withDatabaseTransaction(
        this.pool,
        async (client) => {
          await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
          await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
            parsedWorkspaceId
          ])
          return client.query<WorkspaceArchiveRow>(
            `SELECT workspace_id, state, archived_at, active_work_count, replayed
               FROM appsea.archive_workspace($1, $2)`,
            [parsedWorkspaceId, parsedUserId]
          )
        },
        { maxSerializationRetries: 0 }
      )
      const row = result.rows[0]
      if (!row) throw new Error('Workspace archival result was not recorded')
      return workspaceArchiveResultSchema.parse({
        workspaceId: row.workspace_id,
        state: row.state,
        archivedAt: row.archived_at === null ? null : iso(row.archived_at),
        activeWorkCount: Number(row.active_work_count),
        replayed: row.replayed
      })
    } catch (error) {
      if (isWorkspaceArchivePermissionError(error)) {
        throw new WorkspaceArchivePermissionError()
      }
      throw error
    }
  }

  /**
   * Read the owner-only database side of workspace purge readiness.
   *
   * This boundary is intentionally non-destructive: it inventories active
   * work and persisted object references, then leaves cloud object-store,
   * export-retention, and backup verification to an operated provider layer.
   * Archived workspaces remain readable here so an owner can see what still
   * prevents a reviewed retention operation.
   */
  async readWorkspacePurgeReadiness(
    userId: string,
    workspaceId: string
  ): Promise<WorkspacePurgeReadiness> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const result = await withDatabaseTransaction(
      this.pool,
      async (client) => {
        await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
        const membership = await client.query<{ role: string }>(
          `SELECT role
             FROM appsea.workspace_memberships
            WHERE workspace_id = $1 AND user_id = $2`,
          [parsedWorkspaceId, parsedUserId]
        )
        if (membership.rows[0]?.role !== 'owner') throw new WorkspaceAuthorizationError()
        await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
          parsedWorkspaceId
        ])
        return client.query<WorkspacePurgeReadinessRow>(
          `SELECT workspace.workspace_id, workspace.status, workspace.archived_at,
                  clock_timestamp() AS checked_at,
                  LEAST(
                    2147483647::bigint,
                    (SELECT count(*) FROM appsea.workflow_job_executions workflow_execution
                      WHERE workflow_execution.workspace_id = workspace.workspace_id
                        AND workflow_execution.state IN ('queued', 'running'))
                    + (SELECT count(*) FROM appsea.research_runs run
                      WHERE run.workspace_id = workspace.workspace_id
                        AND run.state IN ('queued', 'running', 'paused'))
                    + (SELECT count(*) FROM appsea.production_collection_workflow_jobs workflow
                      WHERE workflow.workspace_id = workspace.workspace_id
                        AND workflow.state IN ('queued', 'running'))
                    + (SELECT count(*) FROM appsea.production_analysis_runs analysis
                      WHERE analysis.workspace_id = workspace.workspace_id
                        AND analysis.state IN ('queued', 'running'))
                    + (SELECT count(*) FROM appsea.production_analysis_handoffs handoff
                      WHERE handoff.workspace_id = workspace.workspace_id
                        AND handoff.state IN ('queued', 'dispatching', 'started'))
                    + (SELECT count(*) FROM appsea.production_analysis_recompute_jobs recompute
                      WHERE recompute.workspace_id = workspace.workspace_id
                        AND recompute.state IN ('queued', 'dispatching', 'started'))
                    + (SELECT count(*) FROM appsea.source_snapshot_reconciliation_jobs snapshot
                      WHERE snapshot.workspace_id = workspace.workspace_id
                        AND snapshot.state IN ('queued', 'running'))
                    + (SELECT count(*) FROM appsea.source_collection_leases lease
                      WHERE lease.workspace_id = workspace.workspace_id
                        AND lease.state = 'active')
                  ) AS active_work_count,
                  (SELECT count(*) FROM appsea.source_items source_item
                    WHERE source_item.workspace_id = workspace.workspace_id
                      AND source_item.raw_object_ref IS NOT NULL)
                    AS raw_source_object_reference_count,
                  (SELECT count(*) FROM appsea.production_analysis_runs analysis
                    WHERE analysis.workspace_id = workspace.workspace_id
                      AND (analysis.artifact_object_ref IS NOT NULL
                           OR analysis.report_object_ref IS NOT NULL
                           OR analysis.plan_object_ref IS NOT NULL))
                    AS analysis_object_reference_count,
                  (SELECT count(*) FROM appsea.report_versions report
                    WHERE report.workspace_id = workspace.workspace_id
                      AND (report.structured_object_ref IS NOT NULL
                           OR report.markdown_object_ref IS NOT NULL))
                    AS report_object_reference_count,
                  (SELECT count(*) FROM appsea.plan_package_versions plan
                    WHERE plan.workspace_id = workspace.workspace_id
                      AND plan.package_object_ref IS NOT NULL)
                    AS plan_object_reference_count
             FROM appsea.workspaces workspace
            WHERE workspace.workspace_id = $1`,
          [parsedWorkspaceId]
        )
      },
      { readOnly: true, maxSerializationRetries: 0 }
    )
    const row = result.rows[0]
    if (!row) throw new WorkspaceAuthorizationError()
    const activeWorkCount = Number(row.active_work_count)
    const rawSourceObjectReferenceCount = Number(row.raw_source_object_reference_count)
    const analysisObjectReferenceCount = Number(row.analysis_object_reference_count)
    const reportObjectReferenceCount = Number(row.report_object_reference_count)
    const planObjectReferenceCount = Number(row.plan_object_reference_count)
    const blockers = [
      ...(row.archived_at === null ? (['workspace_not_archived'] as const) : []),
      ...(activeWorkCount > 0 ? (['active_work'] as const) : []),
      ...(rawSourceObjectReferenceCount > 0 ? (['raw_source_objects'] as const) : []),
      ...(analysisObjectReferenceCount > 0 ? (['analysis_objects'] as const) : []),
      ...(reportObjectReferenceCount > 0 ? (['report_objects'] as const) : []),
      ...(planObjectReferenceCount > 0 ? (['plan_objects'] as const) : [])
    ]
    return workspacePurgeReadinessSchema.parse({
      workspaceId: row.workspace_id,
      state: blockers.length === 0 ? 'database_ready' : 'blocked',
      archivedAt: row.archived_at === null ? null : iso(row.archived_at),
      activeWorkCount,
      rawSourceObjectReferenceCount,
      analysisObjectReferenceCount,
      reportObjectReferenceCount,
      planObjectReferenceCount,
      blockers,
      externalRequirements: [
        'cloud_object_store_purge',
        'export_retention_purge',
        'backup_deletion_verification'
      ],
      checkedAt: iso(row.checked_at)
    })
  }

  /**
   * Prepare a deterministic, metadata-only object inventory for external
   * retention controls. The manifest is owner-scoped and archived-workspace
   * only; it never returns object bodies or provider credentials and never
   * authorizes deletion.
   */
  async prepareWorkspacePurgeManifest(
    userId: string,
    workspaceId: string,
    input: WorkspacePurgeManifestInput
  ): Promise<WorkspacePurgeManifest> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    workspacePurgeManifestInputSchema.parse(input)
    try {
      const result = await withDatabaseTransaction(
        this.pool,
        async (client) => {
          await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
          const membership = await client.query<{ role: string }>(
            `SELECT role
               FROM appsea.workspace_memberships
              WHERE workspace_id = $1 AND user_id = $2`,
            [parsedWorkspaceId, parsedUserId]
          )
          if (membership.rows[0]?.role !== 'owner') {
            throw new WorkspacePurgeManifestPermissionError()
          }
          await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
            parsedWorkspaceId
          ])
          const workspace = await client.query<{ archived_at: Date | string | null }>(
            `SELECT archived_at
               FROM appsea.workspaces
              WHERE workspace_id = $1`,
            [parsedWorkspaceId]
          )
          if (!workspace.rows[0] || workspace.rows[0].archived_at === null) {
            throw new WorkspacePurgeManifestNotReadyError()
          }

          const objectsResult = await client.query<{ object_entries: unknown }>(
            `SELECT COALESCE(
                      jsonb_agg(
                        jsonb_build_object('uri', object_references.object_uri, 'kind', object_references.object_kind)
                        ORDER BY object_references.object_uri
                      ),
                      '[]'::jsonb
                    ) AS object_entries
               FROM (
                 SELECT source_item.raw_object_ref AS object_uri,
                        split_part(source_item.raw_object_ref, '/', 4) AS object_kind
                   FROM appsea.source_items source_item
                  WHERE source_item.workspace_id = $1
                    AND source_item.raw_object_ref LIKE 'appsea-object://%'
                 UNION
                 SELECT report.markdown_object_ref AS object_uri,
                        split_part(report.markdown_object_ref, '/', 4) AS object_kind
                   FROM appsea.report_versions report
                  WHERE report.workspace_id = $1
                    AND report.markdown_object_ref LIKE 'appsea-object://%'
                 UNION
                 SELECT report.structured_object_ref AS object_uri,
                        split_part(report.structured_object_ref, '/', 4) AS object_kind
                   FROM appsea.report_versions report
                  WHERE report.workspace_id = $1
                    AND report.structured_object_ref LIKE 'appsea-object://%'
                 UNION
                 SELECT plan.package_object_ref AS object_uri,
                        split_part(plan.package_object_ref, '/', 4) AS object_kind
                   FROM appsea.plan_package_versions plan
                  WHERE plan.workspace_id = $1
                    AND plan.package_object_ref LIKE 'appsea-object://%'
                 UNION
                 SELECT output.object_ref->>'uri' AS object_uri,
                        output.object_ref->>'kind' AS object_kind
                   FROM appsea.production_analysis_runs analysis
                   CROSS JOIN LATERAL jsonb_array_elements(
                     jsonb_build_array(
                       analysis.artifact_object_ref,
                       analysis.report_object_ref,
                       analysis.plan_object_ref
                     )
                   ) AS output(object_ref)
                  WHERE analysis.workspace_id = $1
                    AND output.object_ref ? 'uri'
                    AND output.object_ref->>'uri' LIKE 'appsea-object://%'
               ) object_references`,
            [parsedWorkspaceId]
          )
          const objects = workspacePurgeManifestObjectSchema
            .array()
            .parse(objectsResult.rows[0]?.object_entries ?? [])
          const generatedAtResult = await client.query<{ generated_at: Date | string }>(
            `SELECT clock_timestamp() AS generated_at`
          )
          const generatedAt = iso(generatedAtResult.rows[0]!.generated_at)
          const expiresAt = new Date(Date.parse(generatedAt) + 24 * 60 * 60 * 1_000).toISOString()
          const manifestHash = contentHash({ workspaceId: parsedWorkspaceId, objects })
          const manifestId =
            'workspace-purge-manifest:' +
            createHash('md5')
              .update(parsedWorkspaceId + ':' + manifestHash, 'utf8')
              .digest('hex')
          const created = await client.query<WorkspacePurgeManifestRow>(
            `SELECT workspace_id, manifest_id, generated_by, generated_at, expires_at,
                    manifest_hash, object_count, object_entries, external_requirements, replayed
               FROM appsea.create_workspace_purge_manifest(
                 $1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz
               )`,
            [
              parsedWorkspaceId,
              parsedUserId,
              manifestId,
              manifestHash,
              JSON.stringify(objects),
              generatedAt,
              expiresAt
            ]
          )
          const row = created.rows[0]
          if (!row) throw new Error('Workspace purge manifest was not recorded')
          return mapWorkspacePurgeManifest(row)
        },
        { maxSerializationRetries: 0 }
      )
      return result
    } catch (error) {
      if (error instanceof WorkspacePurgeManifestPermissionError) throw error
      if (error instanceof WorkspacePurgeManifestNotReadyError) throw error
      throw error
    }
  }

  /** Read the latest owner-visible metadata-only purge manifest. */
  async readWorkspacePurgeManifest(
    userId: string,
    workspaceId: string
  ): Promise<WorkspacePurgeManifest | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    try {
      const result = await withDatabaseTransaction(
        this.pool,
        async (client) => {
          await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
          await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
            parsedWorkspaceId
          ])
          const read = await client.query<WorkspacePurgeManifestRow>(
            `SELECT workspace_id, manifest_id, generated_by, generated_at, expires_at,
                    manifest_hash, object_count, object_entries, external_requirements, replayed
               FROM appsea.read_workspace_purge_manifest($1, $2)`,
            [parsedWorkspaceId, parsedUserId]
          )
          return read.rows[0] ? mapWorkspacePurgeManifest(read.rows[0]) : null
        },
        { readOnly: true, maxSerializationRetries: 0 }
      )
      return result
    } catch (error) {
      if (isWorkspaceArchivePermissionError(error)) {
        throw new WorkspacePurgeManifestPermissionError()
      }
      throw error
    }
  }

  /**
   * Record an owner-confirmed purge intent only after PostgreSQL reports a
   * database-ready snapshot. The returned request remains awaiting external
   * object-store, export-retention, and backup controls; this method never
   * performs destructive deletion.
   */
  async requestWorkspacePurge(
    userId: string,
    workspaceId: string,
    input: WorkspacePurgeRequestInput
  ): Promise<WorkspacePurgeRequest> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    workspacePurgeRequestInputSchema.parse(input)
    try {
      const result = await withDatabaseTransaction(
        this.pool,
        async (client) => {
          await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
          await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
            parsedWorkspaceId
          ])
          return client.query<WorkspacePurgeRequestRow>(
            `SELECT workspace_id, request_id, state, requested_at, canceled_at,
                    readiness_snapshot, replayed
               FROM appsea.request_workspace_purge($1, $2)`,
            [parsedWorkspaceId, parsedUserId]
          )
        },
        { maxSerializationRetries: 0 }
      )
      const row = result.rows[0]
      if (!row) throw new Error('Workspace purge request result was not recorded')
      if (row.state === 'blocked') {
        throw new WorkspacePurgeRequestNotReadyError(
          workspacePurgeReadinessSchema.parse(row.readiness_snapshot)
        )
      }
      return mapWorkspacePurgeRequest(row)
    } catch (error) {
      if (isWorkspaceArchivePermissionError(error)) {
        throw new WorkspacePurgeRequestPermissionError()
      }
      throw error
    }
  }

  /** Read the latest owner-visible purge intent without exposing bodies. */
  async readWorkspacePurgeRequest(
    userId: string,
    workspaceId: string
  ): Promise<WorkspacePurgeRequest | null> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const result = await withDatabaseTransaction(
      this.pool,
      async (client) => {
        await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
        const membership = await client.query<{ role: string }>(
          `SELECT role
             FROM appsea.workspace_memberships
            WHERE workspace_id = $1 AND user_id = $2`,
          [parsedWorkspaceId, parsedUserId]
        )
        if (membership.rows[0]?.role !== 'owner') throw new WorkspaceAuthorizationError()
        await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
          parsedWorkspaceId
        ])
        return client.query<WorkspacePurgeRequestRow>(
          `SELECT workspace_id, request_id, state, requested_at, canceled_at,
                  readiness_snapshot, false AS replayed
             FROM appsea.workspace_purge_requests
            WHERE workspace_id = $1
            ORDER BY requested_at DESC, request_id DESC
            LIMIT 1`,
          [parsedWorkspaceId]
        )
      },
      { readOnly: true, maxSerializationRetries: 0 }
    )
    const row = result.rows[0]
    return row ? mapWorkspacePurgeRequest(row) : null
  }

  /** Cancel a pending purge intent; cancellation does not restore deleted data. */
  async cancelWorkspacePurge(
    userId: string,
    workspaceId: string,
    input: WorkspacePurgeRequestCancelInput
  ): Promise<WorkspacePurgeRequest> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedInput = workspacePurgeRequestCancelInputSchema.parse(input)
    try {
      const result = await withDatabaseTransaction(
        this.pool,
        async (client) => {
          await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
          await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [
            parsedWorkspaceId
          ])
          return client.query<WorkspacePurgeRequestRow>(
            `SELECT workspace_id, request_id, state, requested_at, canceled_at,
                    readiness_snapshot, replayed
               FROM appsea.cancel_workspace_purge($1, $2, $3)`,
            [parsedWorkspaceId, parsedUserId, parsedInput.requestId]
          )
        },
        { maxSerializationRetries: 0 }
      )
      const row = result.rows[0]
      if (!row) throw new Error('Workspace purge cancellation result was not recorded')
      return mapWorkspacePurgeRequest(row)
    } catch (error) {
      if (isWorkspaceArchivePermissionError(error)) {
        throw new WorkspacePurgeRequestPermissionError()
      }
      throw error
    }
  }

  async readAuthenticatedSession(token: string): Promise<AuthSessionReadModel | null> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    if (!parsedToken.success) return null
    const row = await withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<SessionRow>(
          `SELECT session.session_id, session.user_id, session.expires_at,
                  app_user.email, app_user.display_name, app_user.created_at AS user_created_at
             FROM appsea.auth_sessions session
             JOIN appsea.users app_user ON app_user.user_id = session.user_id
            WHERE session.token_hash = $1
              AND app_user.account_state = 'active'
              AND session.revoked_at IS NULL
              AND session.expires_at > clock_timestamp()`,
          [sha256(parsedToken.data)]
        )
        const session = result.rows[0]
        if (!session) return undefined
        await client.query(
          `UPDATE appsea.auth_sessions SET last_seen_at = clock_timestamp()
            WHERE session_id = $1`,
          [session.session_id]
        )
        return session
      },
      { maxSerializationRetries: 0 }
    )
    if (!row) return null

    const workspaces = await this.listUserWorkspaces(row.user_id)
    return authSessionReadModelSchema.parse({
      sessionId: row.session_id,
      user: {
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        createdAt: iso(row.user_created_at)
      },
      workspaces,
      expiresAt: iso(row.expires_at)
    })
  }

  async readSession(token: string): Promise<AuthSessionReadModel | null> {
    return this.readAuthenticatedSession(token)
  }

  async revokeSession(token: string): Promise<void> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    if (!parsedToken.success) return
    await withDatabaseTransaction(this.pool, async (client) => {
      await client.query(
        `UPDATE appsea.auth_sessions
            SET revoked_at = COALESCE(revoked_at, clock_timestamp())
          WHERE token_hash = $1`,
        [sha256(parsedToken.data)]
      )
    })
  }

  async listActiveSessions(token: string): Promise<AuthSessionSummaryReadModel[]> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    if (!parsedToken.success) return []
    const result = await withDatabaseTransaction(
      this.pool,
      (client) =>
        client.query<AuthSessionSummaryRow>(
          `WITH current_session AS (
             SELECT session_id, user_id
               FROM appsea.auth_sessions
              WHERE token_hash = $1
                AND revoked_at IS NULL
                AND expires_at > clock_timestamp()
              LIMIT 1
           )
           SELECT session.session_id, session.created_at, session.last_seen_at,
                  session.expires_at,
                  (session.session_id = current_session.session_id) AS is_current
             FROM appsea.auth_sessions session
             JOIN current_session ON current_session.user_id = session.user_id
             JOIN appsea.users app_user
               ON app_user.user_id = current_session.user_id
              AND app_user.account_state = 'active'
            WHERE session.revoked_at IS NULL
              AND session.expires_at > clock_timestamp()
            ORDER BY is_current DESC, session.last_seen_at DESC, session.session_id
            LIMIT 1000`,
          [sha256(parsedToken.data)]
        ),
      { readOnly: true }
    )
    return result.rows.map((row) =>
      authSessionSummaryReadModelSchema.parse({
        id: row.session_id,
        createdAt: iso(row.created_at),
        lastSeenAt: iso(row.last_seen_at),
        expiresAt: iso(row.expires_at),
        current: row.is_current
      })
    )
  }

  async revokeSessionById(token: string, targetSessionId: string): Promise<void> {
    const parsedToken = authSessionTokenSchema.safeParse(token)
    const parsedTarget = appseaIdentifierSchema.safeParse(targetSessionId)
    if (!parsedToken.success || !parsedTarget.success) throw new AuthSessionNotFoundError()

    await withDatabaseTransaction(this.pool, async (client) => {
      const current = await client.query<{ session_id: string; user_id: string }>(
        `SELECT session_id, user_id
           FROM appsea.auth_sessions
          WHERE token_hash = $1
            AND revoked_at IS NULL
            AND expires_at > clock_timestamp()
          FOR SHARE`,
        [sha256(parsedToken.data)]
      )
      const currentRow = current.rows[0]
      if (!currentRow) throw new AuthSessionNotFoundError()
      if (currentRow.session_id === parsedTarget.data) throw new AuthSessionConflictError()

      const updated = await client.query<{ session_id: string }>(
        `UPDATE appsea.auth_sessions
            SET revoked_at = COALESCE(revoked_at, clock_timestamp())
          WHERE session_id = $1
            AND user_id = $2
            AND revoked_at IS NULL
            AND expires_at > clock_timestamp()
          RETURNING session_id`,
        [parsedTarget.data, currentRow.user_id]
      )
      if (!updated.rows[0]) throw new AuthSessionNotFoundError()
    })
  }

  /**
   * Atomically increments a durable authentication-attempt bucket. The key is
   * hashed before persistence so emails, IP addresses, and other request
   * identifiers never appear in the rate-limit table.
   */
  async consumeAuthRateLimit(
    key: string,
    maxAttempts: number,
    windowMs = authRateLimitWindowMs
  ): Promise<boolean> {
    if (!key.trim() || key.length > 240) throw new Error('Authentication rate-limit key is invalid')
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1_000) {
      throw new Error('Authentication rate-limit maximum is invalid')
    }
    if (!Number.isSafeInteger(windowMs) || windowMs < 1_000 || windowMs > 86_400_000) {
      throw new Error('Authentication rate-limit window is invalid')
    }
    const result = await withDatabaseTransaction(this.pool, async (client) => {
      return client.query<{ attempt_count: number | string }>(
        `INSERT INTO appsea.auth_rate_limits
           (rate_limit_key, window_started_at, attempt_count, updated_at)
         VALUES ($1, clock_timestamp(), 1, clock_timestamp())
         ON CONFLICT (rate_limit_key) DO UPDATE
           SET attempt_count = CASE
                 WHEN appsea.auth_rate_limits.window_started_at <=
                      clock_timestamp() - ($2::bigint * interval '1 millisecond')
                   THEN 1
                 ELSE appsea.auth_rate_limits.attempt_count + 1
               END,
               window_started_at = CASE
                 WHEN appsea.auth_rate_limits.window_started_at <=
                      clock_timestamp() - ($2::bigint * interval '1 millisecond')
                   THEN clock_timestamp()
                 ELSE appsea.auth_rate_limits.window_started_at
               END,
               updated_at = clock_timestamp()
         RETURNING attempt_count`,
        [sha256(`auth-rate:${key}`), windowMs]
      )
    })
    return Number(result.rows[0]?.attempt_count ?? maxAttempts + 1) <= maxAttempts
  }

  /** Delete expired authentication material in bounded batches. */
  async purgeExpiredSessions(
    retentionDays = 7,
    batchSize = 1_000,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<{
    sessionsDeleted: number
    rateLimitsDeleted: number
    passwordResetTokensDeleted: number
    workspaceInvitationsDeleted: number
    mfaChallengesDeleted: number
    mfaEventsDeleted: number
    mfaPendingEnrollmentsDeleted: number
  }> {
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      throw new Error('Authentication retention days is invalid')
    }
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
      throw new Error('Authentication retention batch size is invalid')
    }
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const sessions = await client.query(
          `WITH expired AS (
           SELECT session_id
             FROM appsea.auth_sessions
            WHERE expires_at <= clock_timestamp() - ($1::bigint * interval '1 day')
               OR (revoked_at IS NOT NULL
                   AND revoked_at <= clock_timestamp() - ($1::bigint * interval '1 day'))
            ORDER BY expires_at, session_id
            LIMIT $2
         )
         DELETE FROM appsea.auth_sessions session
          USING expired
          WHERE session.session_id = expired.session_id
         RETURNING session.session_id`,
          [retentionDays, batchSize]
        )
        const rateLimits = await client.query(
          `WITH stale AS (
           SELECT rate_limit_key
             FROM appsea.auth_rate_limits
            WHERE updated_at <= clock_timestamp() - interval '1 day'
            ORDER BY updated_at, rate_limit_key
            LIMIT $1
         )
         DELETE FROM appsea.auth_rate_limits rate_limit
          USING stale
          WHERE rate_limit.rate_limit_key = stale.rate_limit_key
         RETURNING rate_limit.rate_limit_key`,
          [batchSize]
        )
        const passwordResetTokens = await client.query<{
          password_reset_tokens_deleted: number | string
        }>(
          `SELECT appsea.purge_password_reset_tokens($1, $2)
                  AS password_reset_tokens_deleted`,
          [retentionDays, batchSize]
        )
        const workspaceInvitations = await client.query<{
          workspace_invitations_deleted: number | string
        }>(
          `SELECT appsea.purge_workspace_invitations($1, $2)
                  AS workspace_invitations_deleted`,
          [retentionDays, batchSize]
        )
        const mfa = await client.query<{
          challenges_deleted: number | string
          events_deleted: number | string
          pending_enrollments_deleted: number | string
        }>(
          `SELECT *
             FROM appsea.purge_auth_mfa_material(
               clock_timestamp() - ($1::bigint * interval '1 day'), $2
             )`,
          [retentionDays, batchSize]
        )
        return {
          sessionsDeleted: sessions.rowCount ?? 0,
          rateLimitsDeleted: rateLimits.rowCount ?? 0,
          passwordResetTokensDeleted: Number(
            passwordResetTokens.rows[0]?.password_reset_tokens_deleted ?? 0
          ),
          workspaceInvitationsDeleted: Number(
            workspaceInvitations.rows[0]?.workspace_invitations_deleted ?? 0
          ),
          mfaChallengesDeleted: Number(mfa.rows[0]?.challenges_deleted ?? 0),
          mfaEventsDeleted: Number(mfa.rows[0]?.events_deleted ?? 0),
          mfaPendingEnrollmentsDeleted: Number(mfa.rows[0]?.pending_enrollments_deleted ?? 0)
        }
      },
      { maintenanceFence }
    )
  }

  async listUserWorkspaces(userId: string): Promise<WorkspaceMembershipReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const memberships = await withDatabaseTransaction(
      this.pool,
      async (client) => {
        await client.query("SELECT set_config('appsea.auth_user_id', $1, true)", [parsedUserId])
        return readMembershipRows(client, parsedUserId)
      },
      { readOnly: true }
    )
    const workspaces: WorkspaceMembershipReadModel[] = []
    for (const membership of memberships) {
      const workspace = await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        membership.workspace_id,
        async (client) => {
          const result = await client.query<WorkspaceRow>(
            `SELECT workspace_id, slug, display_name, visibility, fixture_only, $2::text AS role
               FROM appsea.workspaces
              WHERE workspace_id = $1 AND status = 'active'`,
            [membership.workspace_id, membership.role]
          )
          return result.rows[0]
        },
        { readOnly: true }
      )
      if (workspace) workspaces.push(mapWorkspace(workspace))
    }
    return workspaces
  }

  async listWorkspaces(userId: string): Promise<WorkspaceMembershipReadModel[]> {
    return this.listUserWorkspaces(userId)
  }

  async listWorkspaceMembers(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceMemberReadModel[]> {
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      async (client) => {
        const actor = await client.query<WorkspaceMemberRoleRow>(
          `SELECT user_id, role
             FROM appsea.workspace_memberships
            WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, userId]
        )
        if (actor.rows[0]?.role !== 'owner') throw new WorkspaceMembershipManagementError()
        const result = await client.query<WorkspaceMemberRow>(
          `SELECT membership.user_id, app_user.email, app_user.display_name,
                  membership.role, membership.created_at
             FROM appsea.workspace_memberships membership
             JOIN appsea.users app_user ON app_user.user_id = membership.user_id
            WHERE membership.workspace_id = $1
            ORDER BY lower(app_user.email), membership.user_id`,
          [workspaceId]
        )
        return result.rows.map(mapWorkspaceMember)
      },
      { readOnly: true }
    )
  }

  async createWorkspaceInvitation(
    actorUserId: string,
    workspaceId: string,
    input: WorkspaceInvitationCreateInput
  ): Promise<WorkspaceInvitationIssueResult> {
    const parsedActorId = appseaIdentifierSchema.parse(actorUserId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedInput = workspaceInvitationCreateInputSchema.parse(input)
    const token = sessionToken()
    const encrypted = encryptPasswordResetToken(token)
    const invitationId = identifier('invite')
    const deliveryId = identifier('delivery')
    try {
      const invitation = await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedActorId,
        parsedWorkspaceId,
        async (client) => {
          const actor = await client.query<{ role: string }>(
            `SELECT role
               FROM appsea.workspace_memberships
              WHERE workspace_id = $1 AND user_id = $2
              FOR SHARE`,
            [parsedWorkspaceId, parsedActorId]
          )
          if (actor.rows[0]?.role !== 'owner') throw new WorkspaceMembershipManagementError()
          await client.query(
            `SELECT *
               FROM appsea.issue_workspace_invitation(
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
               )`,
            [
              parsedWorkspaceId,
              parsedActorId,
              invitationId,
              deliveryId,
              parsedInput.email,
              sha256(parsedInput.email),
              sha256(token),
              encrypted.ciphertext,
              encrypted.nonce,
              encrypted.tag,
              parsedInput.role
            ]
          )
          const result = await client.query<WorkspaceInvitationRow>(
            `SELECT invitation_id, email, role, state, created_at, expires_at
               FROM appsea.workspace_invitations
              WHERE workspace_id = $1 AND invitation_id = $2`,
            [parsedWorkspaceId, invitationId]
          )
          const row = result.rows[0]
          if (!row) throw new Error('Workspace invitation was not recorded')
          return mapWorkspaceInvitation(row)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
      return { invitation }
    } catch (error) {
      if (isUniqueViolation(error)) throw new WorkspaceInvitationConflictError()
      throw error
    }
  }

  async listWorkspaceInvitations(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceInvitationReadModel[]> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const owner = await client.query<{ role: string }>(
          `SELECT role
             FROM appsea.workspace_memberships
            WHERE workspace_id = $1 AND user_id = $2`,
          [parsedWorkspaceId, parsedUserId]
        )
        if (owner.rows[0]?.role !== 'owner') throw new WorkspaceMembershipManagementError()
        const result = await client.query<WorkspaceInvitationRow>(
          `SELECT invitation_id, email, role, state, created_at, expires_at
             FROM appsea.workspace_invitations
            WHERE workspace_id = $1
            ORDER BY created_at DESC, invitation_id DESC`,
          [parsedWorkspaceId]
        )
        return result.rows.map(mapWorkspaceInvitation)
      },
      { readOnly: true }
    )
  }

  async revokeWorkspaceInvitation(
    actorUserId: string,
    workspaceId: string,
    invitationId: string
  ): Promise<void> {
    const parsedActorId = appseaIdentifierSchema.parse(actorUserId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedInvitationId = appseaIdentifierSchema.parse(invitationId)
    const result = await withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedActorId,
      parsedWorkspaceId,
      async (client) => {
        const owner = await client.query<{ role: string }>(
          `SELECT role
             FROM appsea.workspace_memberships
            WHERE workspace_id = $1 AND user_id = $2`,
          [parsedWorkspaceId, parsedActorId]
        )
        if (owner.rows[0]?.role !== 'owner') throw new WorkspaceMembershipManagementError()
        return client.query<{ revoked: boolean }>(
          `SELECT appsea.revoke_workspace_invitation($1, $2, $3) AS revoked`,
          [parsedWorkspaceId, parsedActorId, parsedInvitationId]
        )
      },
      { isolationLevel: 'SERIALIZABLE' }
    )
    if (result.rows[0]?.revoked !== true) throw new WorkspaceInvitationError()
  }

  async acceptWorkspaceInvitation(
    userId: string,
    input: { token: string }
  ): Promise<WorkspaceInvitationAcceptedReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsed = workspaceInvitationAcceptInputSchema.parse(input)
    const result = await withDatabaseTransaction(this.pool, async (client) =>
      client.query<{ accepted: boolean; workspace_id: string | null; role: 'editor' | 'viewer' }>(
        `SELECT accepted, workspace_id, role
           FROM appsea.accept_workspace_invitation($1, $2)`,
        [sha256(parsed.token), parsedUserId]
      )
    )
    const row = result.rows[0]
    if (!row?.accepted || !row.workspace_id) throw new WorkspaceInvitationError()
    return {
      accepted: true,
      workspaceId: row.workspace_id,
      role: row.role
    }
  }

  async claimWorkspaceInvitationDeliveries(
    batchSize = 100,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<WorkspaceInvitationDeliveryRecord[]> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new Error('Workspace invitation delivery batch size is invalid')
    }
    const result = await withDatabaseTransaction(
      this.pool,
      (client) =>
        client.query<{
          delivery_id: string
          invitation_id: string
          workspace_id: string
          email: string
          token_ciphertext: string
          token_nonce: string
          token_tag: string
          role: 'editor' | 'viewer'
          expires_at: Date | string
        }>(`SELECT * FROM appsea.claim_workspace_invitation_deliveries($1)`, [batchSize]),
      { maxSerializationRetries: 0, maintenanceFence }
    )
    return result.rows.map((row) => ({
      deliveryId: row.delivery_id,
      invitationId: row.invitation_id,
      workspaceId: row.workspace_id,
      email: row.email,
      tokenCiphertext: row.token_ciphertext,
      tokenNonce: row.token_nonce,
      tokenTag: row.token_tag,
      role: row.role,
      expiresAt: iso(row.expires_at)
    }))
  }

  async completeWorkspaceInvitationDelivery(
    deliveryId: string,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<void> {
    const parsedDeliveryId = appseaIdentifierSchema.safeParse(deliveryId)
    if (!parsedDeliveryId.success) throw new Error('Workspace invitation delivery id is invalid')
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        await client.query(`SELECT appsea.complete_workspace_invitation_delivery($1)`, [
          parsedDeliveryId.data
        ])
      },
      { maintenanceFence }
    )
  }

  async failWorkspaceInvitationDelivery(
    deliveryId: string,
    failureCode: string,
    maintenanceFence?: MaintenanceSchedulerFence
  ): Promise<void> {
    const parsedDeliveryId = appseaIdentifierSchema.safeParse(deliveryId)
    if (
      !parsedDeliveryId.success ||
      failureCode !== 'APPSEA_WORKSPACE_INVITATION_DELIVERY_FAILED'
    ) {
      throw new Error('Workspace invitation delivery failure is invalid')
    }
    await withDatabaseTransaction(
      this.pool,
      async (client) => {
        await client.query(`SELECT appsea.fail_workspace_invitation_delivery($1, $2)`, [
          parsedDeliveryId.data,
          failureCode
        ])
      },
      { maintenanceFence }
    )
  }

  async updateWorkspaceMemberRole(
    actorUserId: string,
    workspaceId: string,
    targetUserId: string,
    input: WorkspaceMemberRoleUpdateInput
  ): Promise<WorkspaceMemberReadModel> {
    const parsedActorId = appseaIdentifierSchema.parse(actorUserId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedTargetId = appseaIdentifierSchema.parse(targetUserId)
    const parsedInput = workspaceMemberRoleUpdateInputSchema.parse(input)
    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedActorId,
        parsedWorkspaceId,
        async (client) => {
          const memberships = await this.lockMembershipAdminRows(
            client,
            parsedWorkspaceId,
            parsedActorId,
            parsedTargetId
          )
          const actor = memberships.find((row) => row.user_id === parsedActorId)
          if (actor?.role !== 'owner') throw new WorkspaceMembershipManagementError()
          const target = memberships.find((row) => row.user_id === parsedTargetId)
          if (!target) throw new WorkspaceMembershipNotFoundError()
          if (target.role === parsedInput.role) {
            return this.readWorkspaceMember(client, parsedWorkspaceId, parsedTargetId)
          }
          if (target.role === 'owner' && parsedInput.role !== 'owner') {
            const ownerCount = memberships.filter((row) => row.role === 'owner').length
            if (ownerCount <= 1) throw new WorkspaceMembershipConflictError()
          }
          await client.query(
            `UPDATE appsea.workspace_memberships
                SET role = $3, updated_at = clock_timestamp()
              WHERE workspace_id = $1 AND user_id = $2`,
            [parsedWorkspaceId, parsedTargetId, parsedInput.role]
          )
          return this.readWorkspaceMember(client, parsedWorkspaceId, parsedTargetId)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isMembershipOwnerConflict(error)) throw new WorkspaceMembershipConflictError()
      throw error
    }
  }

  async removeWorkspaceMember(
    actorUserId: string,
    workspaceId: string,
    targetUserId: string
  ): Promise<void> {
    const parsedActorId = appseaIdentifierSchema.parse(actorUserId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedTargetId = appseaIdentifierSchema.parse(targetUserId)
    try {
      await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedActorId,
        parsedWorkspaceId,
        async (client) => {
          const memberships = await this.lockMembershipAdminRows(
            client,
            parsedWorkspaceId,
            parsedActorId,
            parsedTargetId
          )
          const actor = memberships.find((row) => row.user_id === parsedActorId)
          if (actor?.role !== 'owner') throw new WorkspaceMembershipManagementError()
          const target = memberships.find((row) => row.user_id === parsedTargetId)
          if (!target) throw new WorkspaceMembershipNotFoundError()
          if (
            target.role === 'owner' &&
            memberships.filter((row) => row.role === 'owner').length <= 1
          ) {
            throw new WorkspaceMembershipConflictError()
          }
          await client.query(
            `DELETE FROM appsea.workspace_memberships
              WHERE workspace_id = $1 AND user_id = $2`,
            [parsedWorkspaceId, parsedTargetId]
          )
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isMembershipOwnerConflict(error)) throw new WorkspaceMembershipConflictError()
      throw error
    }
  }

  private async lockMembershipAdminRows(
    client: PoolClient,
    workspaceId: string,
    actorUserId: string,
    targetUserId: string
  ): Promise<WorkspaceMemberRoleRow[]> {
    const result = await client.query<WorkspaceMemberRoleRow>(
      `SELECT user_id, role
         FROM appsea.workspace_memberships
        WHERE workspace_id = $1
          AND (user_id = ANY($2::text[]) OR role = 'owner')
        ORDER BY user_id
        FOR UPDATE`,
      [workspaceId, Array.from(new Set([actorUserId, targetUserId]))]
    )
    return result.rows
  }

  private async readWorkspaceMember(
    client: PoolClient,
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMemberReadModel> {
    const result = await client.query<WorkspaceMemberRow>(
      `SELECT membership.user_id, app_user.email, app_user.display_name,
              membership.role, membership.created_at
         FROM appsea.workspace_memberships membership
         JOIN appsea.users app_user ON app_user.user_id = membership.user_id
        WHERE membership.workspace_id = $1 AND membership.user_id = $2`,
      [workspaceId, userId]
    )
    const row = result.rows[0]
    if (!row) throw new WorkspaceMembershipNotFoundError()
    return mapWorkspaceMember(row)
  }

  async updateWorkspaceReportApproval(
    userId: string,
    workspaceId: string,
    reportId: string,
    input: WorkspaceReportApprovalInput
  ): Promise<WorkspaceReportReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedReportId = appseaIdentifierSchema.parse(reportId)
    const parsedInput = workspaceReportApprovalInputSchema.parse(input)

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const actor = await client.query<WorkspaceMemberRoleRow>(
            `SELECT user_id, role
               FROM appsea.workspace_memberships
              WHERE workspace_id = $1 AND user_id = $2
              FOR SHARE`,
            [parsedWorkspaceId, parsedUserId]
          )
          const role = actor.rows[0]?.role
          if (
            (parsedInput.action === 'reviewed' && role !== 'owner' && role !== 'editor') ||
            (parsedInput.action !== 'reviewed' && role !== 'owner')
          ) {
            throw new WorkspaceReportPermissionError()
          }

          const result = await client.query<WorkspaceReportRow>(
            `${workspaceReportSelect}
     WHERE report.workspace_id = $1 AND report.report_id = $2
       AND (analysis.analysis_run_id IS NULL OR analysis.availability_state = 'active')
     FOR UPDATE OF report`,
            [parsedWorkspaceId, parsedReportId]
          )
          const row = result.rows[0]
          if (!row || row.deletion_state !== 'active') {
            throw new WorkspaceReportNotFoundError()
          }
          if (row.approval_state === parsedInput.action) {
            const masks = await readOutputRedactionMasks(
              client,
              parsedWorkspaceId,
              row.analysis_run_id,
              row.collection_run_id
            )
            return mapWorkspaceReport(row, parsedWorkspaceId, this.objectStore, masks)
          }

          const allowed =
            (row.approval_state === 'draft' && parsedInput.action === 'reviewed') ||
            (row.approval_state === 'reviewed' && parsedInput.action === 'approved') ||
            (row.approval_state !== 'withdrawn' && parsedInput.action === 'withdrawn')
          if (!allowed) throw new WorkspaceReportApprovalConflictError()

          const updated = await client.query<WorkspaceReportRow>(
            `UPDATE appsea.report_versions
                SET approval_state = $3
              WHERE workspace_id = $1 AND report_id = $2
            RETURNING report_id, version, structured_report, structured_object_ref, generated_at,
                      approval_state, manifest_hash, deletion_state, synthetic`,
            [parsedWorkspaceId, parsedReportId, parsedInput.action]
          )
          const updatedRow = updated.rows[0]
          if (!updatedRow) throw new WorkspaceReportNotFoundError()
          const refreshed = await client.query<WorkspaceReportRow>(
            `${workspaceReportSelect}
       WHERE report.workspace_id = $1 AND report.report_id = $2
         AND (analysis.analysis_run_id IS NULL OR analysis.availability_state = 'active')`,
            [parsedWorkspaceId, parsedReportId]
          )
          const refreshedRow = refreshed.rows[0]
          if (!refreshedRow) throw new WorkspaceReportNotFoundError()
          const masks = await readOutputRedactionMasks(
            client,
            parsedWorkspaceId,
            refreshedRow.analysis_run_id,
            refreshedRow.collection_run_id
          )
          return mapWorkspaceReport(refreshedRow, parsedWorkspaceId, this.objectStore, masks)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isReportApprovalConflict(error)) throw new WorkspaceReportApprovalConflictError()
      throw error
    }
  }

  async exportWorkspaceReport(
    userId: string,
    workspaceId: string,
    reportId: string
  ): Promise<WorkspaceReportExportReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedReportId = appseaIdentifierSchema.parse(reportId)

    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<WorkspaceReportRow>(
          `${workspaceReportSelect}
          WHERE report.workspace_id = $1
            AND report.report_id = $2
            AND report.deletion_state = 'active'
            AND (analysis.analysis_run_id IS NULL OR analysis.availability_state = 'active')`,
          [parsedWorkspaceId, parsedReportId]
        )
        const row = result.rows[0]
        if (!row) throw new WorkspaceReportNotFoundError()
        if (row.approval_state !== 'approved') throw new WorkspaceReportNotApprovedError()
        const masks = await readOutputRedactionMasks(
          client,
          parsedWorkspaceId,
          row.analysis_run_id,
          row.collection_run_id
        )
        return workspaceReportExportReadModelSchema.parse({
          report: await mapWorkspaceReport(row, parsedWorkspaceId, this.objectStore, masks),
          manifestHash: row.manifest_hash
        })
      },
      { readOnly: true }
    )
  }

  async updateWorkspacePlanApproval(
    userId: string,
    workspaceId: string,
    planPackageId: string,
    input: WorkspacePlanApprovalInput
  ): Promise<WorkspacePlanReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedPlanPackageId = appseaIdentifierSchema.parse(planPackageId)
    const parsedInput = workspacePlanApprovalInputSchema.parse(input)

    try {
      return await withAuthenticatedWorkspaceTransaction(
        this.pool,
        parsedUserId,
        parsedWorkspaceId,
        async (client) => {
          const actor = await client.query<WorkspaceMemberRoleRow>(
            `SELECT user_id, role
               FROM appsea.workspace_memberships
              WHERE workspace_id = $1 AND user_id = $2
              FOR SHARE`,
            [parsedWorkspaceId, parsedUserId]
          )
          const role = actor.rows[0]?.role
          if (
            (parsedInput.action === 'reviewed' && role !== 'owner' && role !== 'editor') ||
            (parsedInput.action !== 'reviewed' && role !== 'owner')
          ) {
            throw new WorkspacePlanPermissionError()
          }

          const result = await client.query<WorkspacePlanRow>(
            `${workspacePlanSelect}
     WHERE plan.workspace_id = $1 AND plan.plan_package_id = $2
       AND (analysis.analysis_run_id IS NULL OR analysis.availability_state = 'active')
     FOR UPDATE OF plan`,
            [parsedWorkspaceId, parsedPlanPackageId]
          )
          const row = result.rows[0]
          if (!row || row.deletion_state !== 'active') {
            throw new WorkspacePlanNotFoundError()
          }
          if (row.approval_state === parsedInput.action) {
            const masks = await readOutputRedactionMasks(
              client,
              parsedWorkspaceId,
              row.analysis_run_id,
              row.collection_run_id
            )
            return mapWorkspacePlan(row, parsedWorkspaceId, this.objectStore, masks)
          }

          const allowed =
            (row.approval_state === 'unreviewed' && parsedInput.action === 'reviewed') ||
            (row.approval_state === 'reviewed' && parsedInput.action === 'approved') ||
            (row.approval_state !== 'withdrawn' && parsedInput.action === 'withdrawn')
          if (!allowed) throw new WorkspacePlanApprovalConflictError()

          if (parsedInput.action === 'approved') {
            if (row.readiness_state !== 'ready') {
              throw new WorkspacePlanApprovalConflictError()
            }
            if (row.report_id !== null) {
              const linkedReport = await client.query<QueryResultRow & { approval_state: string }>(
                `SELECT approval_state
                   FROM appsea.report_versions
                  WHERE workspace_id = $1 AND report_id = $2`,
                [parsedWorkspaceId, row.report_id]
              )
              if (linkedReport.rows[0]?.approval_state !== 'approved') {
                throw new WorkspacePlanApprovalConflictError()
              }
            }
          }

          await client.query(
            `UPDATE appsea.plan_package_versions
                SET approval_state = $3
              WHERE workspace_id = $1 AND plan_package_id = $2`,
            [parsedWorkspaceId, parsedPlanPackageId, parsedInput.action]
          )
          const refreshed = await client.query<WorkspacePlanRow>(
            `${workspacePlanSelect}
       WHERE plan.workspace_id = $1 AND plan.plan_package_id = $2
         AND (analysis.analysis_run_id IS NULL OR analysis.availability_state = 'active')`,
            [parsedWorkspaceId, parsedPlanPackageId]
          )
          const refreshedRow = refreshed.rows[0]
          if (!refreshedRow) throw new WorkspacePlanNotFoundError()
          const masks = await readOutputRedactionMasks(
            client,
            parsedWorkspaceId,
            refreshedRow.analysis_run_id,
            refreshedRow.collection_run_id
          )
          return mapWorkspacePlan(refreshedRow, parsedWorkspaceId, this.objectStore, masks)
        },
        { isolationLevel: 'SERIALIZABLE' }
      )
    } catch (error) {
      if (isPlanApprovalConflict(error)) throw new WorkspacePlanApprovalConflictError()
      throw error
    }
  }

  async exportWorkspacePlan(
    userId: string,
    workspaceId: string,
    planPackageId: string
  ): Promise<WorkspacePlanExportReadModel> {
    const parsedUserId = appseaIdentifierSchema.parse(userId)
    const parsedWorkspaceId = appseaIdentifierSchema.parse(workspaceId)
    const parsedPlanPackageId = appseaIdentifierSchema.parse(planPackageId)

    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      parsedUserId,
      parsedWorkspaceId,
      async (client) => {
        const result = await client.query<WorkspacePlanRow>(
          `${workspacePlanSelect}
          WHERE plan.workspace_id = $1
            AND plan.plan_package_id = $2
            AND plan.deletion_state = 'active'
            AND (analysis.analysis_run_id IS NULL OR analysis.availability_state = 'active')`,
          [parsedWorkspaceId, parsedPlanPackageId]
        )
        const row = result.rows[0]
        if (!row) throw new WorkspacePlanNotFoundError()
        if (row.approval_state !== 'approved') throw new WorkspacePlanNotApprovedError()
        const masks = await readOutputRedactionMasks(
          client,
          parsedWorkspaceId,
          row.analysis_run_id,
          row.collection_run_id
        )
        return workspacePlanExportReadModelSchema.parse({
          plan: await mapWorkspacePlan(row, parsedWorkspaceId, this.objectStore, masks),
          manifestHash: row.manifest_hash
        })
      },
      { readOnly: true }
    )
  }

  async listWorkspaceOpportunities(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceOpportunityReadModel[]> {
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      async (client) => {
        const rows = await client.query<OpportunityRow>(
          `SELECT opportunity.opportunity_id, opportunity.slug, opportunity.name,
                  opportunity.one_line, opportunity.thesis, opportunity.audience,
                  opportunity.first_wedge, opportunity.complaint_count, opportunity.synthetic,
                  opportunity.tags, opportunity.contrary_evidence, opportunity.state,
                  opportunity.source_run_id, opportunity.current_score_snapshot_id,
                  opportunity.current_plan_package_id, score.score, score.scoring_version,
                  score.calculated_at AS score_calculated_at, score.factors, score.weights,
                  report.report_id AS current_report_id
             FROM appsea.opportunities opportunity
             LEFT JOIN appsea.opportunity_score_snapshots score
               ON score.workspace_id = opportunity.workspace_id
              AND score.opportunity_id = opportunity.opportunity_id
              AND score.score_snapshot_id = opportunity.current_score_snapshot_id
             LEFT JOIN LATERAL (
                SELECT report_id FROM appsea.report_versions report
                 WHERE report.workspace_id = opportunity.workspace_id
                   AND report.opportunity_id = opportunity.opportunity_id
                   AND report.approval_state <> 'withdrawn'
                   AND report.deletion_state = 'active'
                 ORDER BY report.generated_at DESC LIMIT 1
              ) report ON true
             WHERE opportunity.workspace_id = $1
               AND opportunity.availability_state = 'active'
             ORDER BY score.score DESC NULLS LAST,
                     opportunity.complaint_count DESC,
                     opportunity.slug`,
          [workspaceId]
        )
        const masksByRun = new Map<string, EvidenceRedactionMask[]>()
        return Promise.all(
          rows.rows.map(async (row) => {
            const runId = row.source_run_id
            let masks = masksByRun.get(runId)
            if (!masks) {
              masks = await readCollectionRunRedactionMasks(client, workspaceId, runId)
              masksByRun.set(runId, masks)
            }
            return redactOpportunityReadModel(mapOpportunity(row), masks)
          })
        )
      },
      { readOnly: true }
    )
  }

  async readWorkspaceOpportunity(
    userId: string,
    workspaceId: string,
    slug: string
  ): Promise<WorkspaceOpportunityDetailReadModel | undefined> {
    return withAuthenticatedWorkspaceTransaction(
      this.pool,
      userId,
      workspaceId,
      async (client) => {
        const result = await client.query<OpportunityRow>(
          `SELECT opportunity.opportunity_id, opportunity.slug, opportunity.name,
                  opportunity.one_line, opportunity.thesis, opportunity.audience,
                  opportunity.first_wedge, opportunity.complaint_count, opportunity.synthetic,
                  opportunity.tags, opportunity.contrary_evidence, opportunity.state,
                  opportunity.source_run_id, opportunity.current_score_snapshot_id,
                  opportunity.current_plan_package_id, score.score, score.scoring_version,
                  score.calculated_at AS score_calculated_at, score.factors, score.weights,
                  report.report_id AS current_report_id
             FROM appsea.opportunities opportunity
             LEFT JOIN appsea.opportunity_score_snapshots score
               ON score.workspace_id = opportunity.workspace_id
              AND score.opportunity_id = opportunity.opportunity_id
              AND score.score_snapshot_id = opportunity.current_score_snapshot_id
             LEFT JOIN LATERAL (
                SELECT report_id FROM appsea.report_versions report
                 WHERE report.workspace_id = opportunity.workspace_id
                   AND report.opportunity_id = opportunity.opportunity_id
                   AND report.approval_state <> 'withdrawn'
                   AND report.deletion_state = 'active'
                 ORDER BY report.generated_at DESC LIMIT 1
               ) report ON true
             WHERE opportunity.workspace_id = $1
               AND opportunity.slug = $2
               AND opportunity.availability_state = 'active'`,
          [workspaceId, slug]
        )
        const row = result.rows[0]
        if (!row) return undefined
        const summary = mapOpportunity(row)
        const run = await client.query<
          QueryResultRow & {
            artifact_snapshot: unknown
            coverage_gaps: string[]
          }
        >(
          `SELECT artifact_snapshot, coverage_gaps FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2`,
          [workspaceId, row.source_run_id]
        )
        const artifact = run.rows[0]
          ? fixtureResearchArtifactSchema.safeParse(run.rows[0].artifact_snapshot)
          : undefined
        const fallbackOpportunity = opportunitySchema.parse({
          id: row.opportunity_id,
          slug: row.slug,
          name: row.name,
          oneLine: row.one_line,
          thesis: row.thesis,
          audience: row.audience,
          firstWedge: row.first_wedge,
          complaintCount: Number(row.complaint_count),
          synthetic: row.synthetic,
          tags: row.tags,
          complaintIds: [],
          competitors: [],
          scoreSnapshot: {
            score: Number(row.score ?? 0),
            version: row.scoring_version ?? 'unknown',
            calculatedAt: iso(row.score_calculated_at ?? new Date(0)),
            factors: row.factors ?? emptyScoreFactors,
            weights: row.weights ?? emptyScoreFactors
          },
          contraryEvidence: row.contrary_evidence,
          planFiles: []
        })
        const opportunity = artifact?.success ? artifact.data.opportunity : fallbackOpportunity
        const competitiveResearch = artifact?.success
          ? composeCompetitiveResearchReadModel({
              synthetic: artifact.data.mode === 'fixture',
              coverageGaps: artifact.data.coverageGaps
            })
          : composeCompetitiveResearchReadModel({
              synthetic: row.synthetic,
              coverageGaps: []
            })
        const evidence = await this.readEvidence(client, workspaceId, row.source_run_id)
        const masks: EvidenceRedactionMask[] = evidence.flatMap((entry) =>
          entry.redactedFields && entry.redactedFields.length > 0
            ? [{ evidenceId: entry.id, fields: entry.redactedFields }]
            : []
        )
        const report = await this.readReport(client, workspaceId, row.opportunity_id, masks)
        const plan = await this.readPlan(client, workspaceId, row.opportunity_id, masks)
        return workspaceOpportunityDetailReadModelSchema.parse({
          opportunity: redactOpportunity(opportunity, masks),
          summary: redactOpportunityReadModel(summary, masks),
          evidence,
          competitiveResearch,
          coverageGaps: run.rows[0]?.coverage_gaps ?? [],
          sourceCoverage: artifact?.success
            ? artifact.data.sourcePolicies.map((policy) =>
                reportSourceCoverageSchema.parse({
                  sourceId: policy.sourceId,
                  displayName: policy.displayName,
                  sourceType: policy.sourceType,
                  policyState: policy.policyState,
                  enabled: policy.enabled,
                  displayMode: policy.displayMode,
                  coverageNotes: policy.coverageNotes,
                  reviewedAt: policy.reviewedAt,
                  expiresAt: policy.expiresAt,
                  observationCount: artifact.data.complaints.filter(
                    (complaint) => complaint.sourceId === policy.sourceId
                  ).length,
                  synthetic: artifact.data.mode === 'fixture'
                })
              )
            : [],
          report,
          plan
        })
      },
      { readOnly: true }
    )
  }

  private async readEvidence(
    client: PoolClient,
    workspaceId: string,
    runId: string
  ): Promise<WorkspaceEvidenceReadModel[]> {
    const rows = await client.query<EvidenceRow>(
      `SELECT evidence.evidence_id, evidence.source_item_id, source_item.canonical_locator,
              evidence.normalized_text,
              evidence.language, evidence.product_candidate, evidence.company_candidate,
              evidence.feature_candidate, evidence.category_candidate, evidence.synthetic,
              evidence.redacted, evidence.redacted_fields,
              source_item.redacted_fields AS source_redacted_fields,
              evidence.allowed_representation, source_item.captured_at,
              source_item.published_at, complaint.review_state,
              complaint.analysis_snapshot
         FROM appsea.research_run_source_items run_item
         JOIN appsea.evidence_records evidence
           ON evidence.workspace_id = run_item.workspace_id
          AND evidence.source_item_id = run_item.source_item_id
         JOIN appsea.source_items source_item
           ON source_item.workspace_id = run_item.workspace_id
          AND source_item.source_item_id = run_item.source_item_id
         JOIN appsea.complaint_observations complaint
           ON complaint.workspace_id = evidence.workspace_id
          AND complaint.evidence_id = evidence.evidence_id
        WHERE run_item.workspace_id = $1 AND run_item.run_id = $2
           AND evidence.deletion_state = 'active'
           AND source_item.deletion_state = 'active'
           AND (evidence.synthetic OR evidence.redacted)
           AND evidence.allowed_representation IN ('excerpt', 'fixture')
        ORDER BY source_item.captured_at DESC, evidence.evidence_id`,
      [workspaceId, runId]
    )
    return rows.rows.map((row) => {
      const redactedFields = evidenceRedactionFieldSchema
        .array()
        .parse(
          [
            ...new Set([...(row.redacted_fields ?? []), ...(row.source_redacted_fields ?? [])])
          ].sort()
        )
      const analysis = complaintAnalysisSchema.parse({
        ...complaintAnalysisSchema.parse(row.analysis_snapshot),
        reviewState: row.review_state
      })
      return workspaceEvidenceReadModelSchema.parse({
        id: row.evidence_id,
        sourceItemId: row.source_item_id,
        canonicalLocator: redactedFields.includes('canonicalLocator')
          ? null
          : row.canonical_locator,
        text: redactedFields.includes('text') ? evidenceRedactionMarker : row.normalized_text,
        language: row.language,
        product: redactedFields.includes('product')
          ? evidenceRedactionMarker
          : row.product_candidate,
        company: redactedFields.includes('company')
          ? evidenceRedactionMarker
          : row.company_candidate,
        feature: redactedFields.includes('feature')
          ? evidenceRedactionMarker
          : row.feature_candidate,
        category: redactedFields.includes('category')
          ? evidenceRedactionMarker
          : row.category_candidate,
        analysis:
          redactedFields.length > 0
            ? redactComplaintAnalysis(analysis, new Set(redactedFields))
            : analysis,
        synthetic: row.synthetic,
        redacted: row.redacted,
        redactedFields,
        allowedRepresentation: row.allowed_representation,
        capturedAt: iso(row.captured_at),
        publishedAt: row.published_at === null ? null : iso(row.published_at)
      })
    })
  }

  private async readReport(
    client: PoolClient,
    workspaceId: string,
    opportunityId: string,
    masks: readonly EvidenceRedactionMask[] = []
  ): Promise<WorkspaceReportReadModel | null> {
    const result = await client.query<WorkspaceReportRow>(
      `${workspaceReportSelect}
       WHERE report.workspace_id = $1 AND report.opportunity_id = $2
         AND report.approval_state <> 'withdrawn'
         AND report.deletion_state = 'active'
         AND (analysis.analysis_run_id IS NULL OR analysis.availability_state = 'active')
       ORDER BY report.generated_at DESC LIMIT 1`,
      [workspaceId, opportunityId]
    )
    const row = result.rows[0]
    return row ? mapWorkspaceReport(row, workspaceId, this.objectStore, masks) : null
  }

  private async readPlan(
    client: PoolClient,
    workspaceId: string,
    opportunityId: string,
    masks: readonly EvidenceRedactionMask[] = []
  ): Promise<WorkspacePlanReadModel | null> {
    const result = await client.query<WorkspacePlanRow>(
      `${workspacePlanSelect}
       WHERE plan.workspace_id = $1 AND plan.opportunity_id = $2
         AND plan.deletion_state = 'active'
         AND (analysis.analysis_run_id IS NULL OR analysis.availability_state = 'active')
       ORDER BY plan.generated_at DESC LIMIT 1`,
      [workspaceId, opportunityId]
    )
    const row = result.rows[0]
    if (!row) return null
    return mapWorkspacePlan(row, workspaceId, this.objectStore, masks)
  }
}

export { WorkspaceAuthorizationError }
