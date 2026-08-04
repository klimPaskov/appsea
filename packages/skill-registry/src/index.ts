import { createHmac, timingSafeEqual } from 'node:crypto'

export type SkillStatus = 'proposed' | 'evaluated' | 'approved' | 'active' | 'retired'

export type SkillRegistrySecret = Uint8Array | string

export interface SkillEvaluationEvidence {
  readonly evaluationId: string
  readonly evaluatorId: string
  readonly evaluatedAt: string
  readonly signature: string
}

export interface SkillApprovalEvidence {
  readonly reviewId: string
  readonly approvedBy: string
  readonly approvedAt: string
  readonly signature: string
}

export interface SkillActivationInput {
  readonly transitionId: string
  readonly activatedBy: string
  readonly activatedAt: string
}

export interface SkillActivationEvidence extends SkillActivationInput {
  readonly signature: string
}

export interface SkillRetirementInput {
  readonly transitionId: string
  readonly retiredBy: string
  readonly retiredAt: string
}

export interface SkillRetirementEvidence extends SkillRetirementInput {
  readonly signature: string
}

export interface RuntimeSkillRecord {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly status: SkillStatus
  readonly requestedPermissions: readonly string[]
  readonly proposedBy: string
  readonly evaluationIds: readonly string[]
  readonly evaluatorIds: readonly string[]
  readonly evaluations: readonly SkillEvaluationEvidence[]
  readonly approvedBy: string | null
  readonly approval: SkillApprovalEvidence | null
  readonly activatedAt: string | null
  readonly activatedBy: string | null
  readonly activation: SkillActivationEvidence | null
  readonly retiredAt: string | null
  readonly retiredBy: string | null
  readonly retirement: SkillRetirementEvidence | null
}

export interface SkillProposalInput {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly requestedPermissions: readonly string[]
  readonly proposedBy: string
}

export interface SkillEvaluationInput {
  readonly evaluationId: string
  readonly evaluatorId: string
  readonly evaluatedAt: string
}

export interface SkillApprovalInput {
  readonly reviewId: string
  readonly approverId: string
  readonly approvedAt: string
}

export class SkillGovernanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillGovernanceError'
  }
}

const privilegedPermissions = new Set([
  'deploy-production',
  'manage-credentials',
  'change-retention',
  'run-migrations',
  'grant-permissions',
  'activate-sources'
])

const recordBrand = Symbol('appsea.runtime-skill-record')
type BrandedRuntimeSkillRecord = RuntimeSkillRecord & {
  readonly [recordBrand]: true
}

const actorPattern = /^[a-z0-9][a-z0-9._:/-]{0,127}$/
const identifierPattern = /^[a-z0-9][a-z0-9._:/-]{0,191}$/
const signaturePattern = /^[A-Za-z0-9_-]{43}$/
const skillStatuses = new Set<SkillStatus>([
  'proposed',
  'evaluated',
  'approved',
  'active',
  'retired'
])

function requireStatus(value: unknown): SkillStatus {
  if (typeof value !== 'string' || !skillStatuses.has(value as SkillStatus)) {
    throw new SkillGovernanceError('Skill status is invalid')
  }
  return value as SkillStatus
}

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new SkillGovernanceError(`${label} is invalid`)
  }
  return value
}

function requireActor(value: string, label: string): string {
  if (typeof value !== 'string' || !actorPattern.test(value)) {
    throw new SkillGovernanceError(`${label} is invalid`)
  }
  return value
}

function requireVersion(value: string): string {
  if (typeof value !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(value)) {
    throw new SkillGovernanceError('Skill version is invalid')
  }
  return value
}

function requireTimestamp(value: string, label: string): string {
  if (typeof value !== 'string') throw new SkillGovernanceError(`${label} is invalid`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new SkillGovernanceError(`${label} must be a canonical ISO timestamp`)
  }
  return value
}

function normalizePermissions(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values)) throw new SkillGovernanceError('Skill permissions are invalid')
  const normalized = [...values]
    .map((permission) => {
      if (typeof permission !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(permission)) {
        throw new SkillGovernanceError('Skill permission is invalid')
      }
      return permission
    })
    .sort()
  if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
    throw new SkillGovernanceError('Skill permissions must be non-empty and unique')
  }
  if (normalized.length > 32) throw new SkillGovernanceError('Skill has too many permissions')
  return normalized
}

function secretBytes(value: SkillRegistrySecret): Uint8Array {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
  if (bytes.byteLength < 32) {
    throw new SkillGovernanceError('Skill registry signing secret must be at least 32 bytes')
  }
  return bytes
}

function sign(secret: Uint8Array, material: unknown): string {
  return createHmac('sha256', secret).update(JSON.stringify(material)).digest('base64url')
}

function equalSignature(left: unknown, right: unknown): boolean {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    !signaturePattern.test(left) ||
    !signaturePattern.test(right)
  ) {
    return false
  }
  const leftBytes = Buffer.from(left, 'base64url')
  const rightBytes = Buffer.from(right, 'base64url')
  if (
    leftBytes.length !== 32 ||
    rightBytes.length !== 32 ||
    leftBytes.toString('base64url') !== left ||
    rightBytes.toString('base64url') !== right
  ) {
    return false
  }
  return timingSafeEqual(leftBytes, rightBytes)
}

function staticMaterial(record: RuntimeSkillRecord): Record<string, unknown> {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    requestedPermissions: record.requestedPermissions,
    proposedBy: record.proposedBy
  }
}

function evaluationMaterial(
  record: RuntimeSkillRecord,
  input: SkillEvaluationInput,
  previousEvaluationIds: readonly string[],
  previousEvaluatorIds: readonly string[]
): Record<string, unknown> {
  return {
    kind: 'appsea.skill.evaluation.v1',
    ...staticMaterial(record),
    previousEvaluationIds,
    previousEvaluatorIds,
    evaluationId: input.evaluationId,
    evaluatorId: input.evaluatorId,
    evaluatedAt: input.evaluatedAt
  }
}

function approvalMaterial(record: RuntimeSkillRecord, approval: SkillApprovalEvidence) {
  return {
    kind: 'appsea.skill.approval.v1',
    ...staticMaterial(record),
    evaluationIds: record.evaluationIds,
    evaluatorIds: record.evaluatorIds,
    evaluationSignatures: record.evaluations.map((evaluation) => evaluation.signature),
    reviewId: approval.reviewId,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt
  }
}

function activationMaterial(
  record: RuntimeSkillRecord,
  activation: SkillActivationEvidence
): Record<string, unknown> {
  return {
    kind: 'appsea.skill.activation.v1',
    state: 'active',
    ...staticMaterial(record),
    evaluationIds: record.evaluationIds,
    evaluatorIds: record.evaluatorIds,
    evaluationSignatures: record.evaluations.map((evaluation) => evaluation.signature),
    reviewId: record.approval?.reviewId,
    approvedBy: record.approval?.approvedBy,
    approvedAt: record.approval?.approvedAt,
    approvalSignature: record.approval?.signature,
    transitionId: activation.transitionId,
    activatedBy: activation.activatedBy,
    activatedAt: activation.activatedAt
  }
}

function retirementMaterial(
  record: RuntimeSkillRecord,
  retirement: SkillRetirementEvidence
): Record<string, unknown> {
  return {
    kind: 'appsea.skill.retirement.v1',
    state: 'retired',
    ...staticMaterial(record),
    evaluationIds: record.evaluationIds,
    evaluatorIds: record.evaluatorIds,
    evaluationSignatures: record.evaluations.map((evaluation) => evaluation.signature),
    reviewId: record.approval?.reviewId,
    approvedBy: record.approval?.approvedBy,
    approvedAt: record.approval?.approvedAt,
    approvalSignature: record.approval?.signature,
    activationTransitionId: record.activation?.transitionId,
    activationActor: record.activation?.activatedBy,
    activationTimestamp: record.activation?.activatedAt,
    activationSignature: record.activation?.signature,
    transitionId: retirement.transitionId,
    retiredBy: retirement.retiredBy,
    retiredAt: retirement.retiredAt
  }
}

function freezeRecord(record: RuntimeSkillRecord): RuntimeSkillRecord {
  const candidate = {
    ...record,
    requestedPermissions: Object.freeze([...record.requestedPermissions]),
    evaluationIds: Object.freeze([...record.evaluationIds]),
    evaluatorIds: Object.freeze([...record.evaluatorIds]),
    evaluations: Object.freeze(
      record.evaluations.map((evaluation) => Object.freeze({ ...evaluation }))
    ),
    approval: record.approval ? Object.freeze({ ...record.approval }) : null,
    activation: record.activation ? Object.freeze({ ...record.activation }) : null,
    retirement: record.retirement ? Object.freeze({ ...record.retirement }) : null
  } as RuntimeSkillRecord & { [recordBrand]?: true }
  Object.defineProperty(candidate, recordBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  })
  return Object.freeze(candidate) as BrandedRuntimeSkillRecord
}

function isBrandedRecord(record: RuntimeSkillRecord): record is BrandedRuntimeSkillRecord {
  return (
    !!record &&
    typeof record === 'object' &&
    Object.isFrozen(record) &&
    (record as RuntimeSkillRecord & { [recordBrand]?: true })[recordBrand] === true
  )
}

function assertRecord(record: RuntimeSkillRecord): asserts record is BrandedRuntimeSkillRecord {
  if (!isBrandedRecord(record)) {
    throw new SkillGovernanceError('Skill record was not created or hydrated by the registry')
  }
}

function verifyEvaluationChain(record: RuntimeSkillRecord, secret: Uint8Array): boolean {
  if (
    record.evaluationIds.length !== record.evaluatorIds.length ||
    record.evaluationIds.length !== record.evaluations.length ||
    new Set(record.evaluationIds).size !== record.evaluationIds.length ||
    new Set(record.evaluatorIds).size !== record.evaluatorIds.length
  ) {
    return false
  }
  const previousEvaluationIds: string[] = []
  const previousEvaluatorIds: string[] = []
  for (const [index, evidence] of record.evaluations.entries()) {
    try {
      requireIdentifier(evidence.evaluationId, 'Evaluation id')
      requireActor(evidence.evaluatorId, 'Evaluator')
      requireTimestamp(evidence.evaluatedAt, 'Evaluation timestamp')
    } catch {
      return false
    }
    if (evidence.evaluatorId === record.proposedBy) return false
    const input: SkillEvaluationInput = {
      evaluationId: evidence.evaluationId,
      evaluatorId: evidence.evaluatorId,
      evaluatedAt: evidence.evaluatedAt
    }
    if (
      record.evaluationIds[index] !== evidence.evaluationId ||
      record.evaluatorIds[index] !== evidence.evaluatorId ||
      !equalSignature(
        evidence.signature,
        sign(secret, evaluationMaterial(record, input, previousEvaluationIds, previousEvaluatorIds))
      )
    ) {
      return false
    }
    previousEvaluationIds.push(evidence.evaluationId)
    previousEvaluatorIds.push(evidence.evaluatorId)
  }
  return true
}

function verifyApproval(record: RuntimeSkillRecord, secret: Uint8Array): boolean {
  const approval = record.approval
  if (!approval || record.approvedBy !== approval.approvedBy) return false
  if (
    approval.approvedBy === record.proposedBy ||
    record.evaluatorIds.includes(approval.approvedBy)
  ) {
    return false
  }
  try {
    requireIdentifier(approval.reviewId, 'Review id')
    requireActor(approval.approvedBy, 'Approver')
    requireTimestamp(approval.approvedAt, 'Approval timestamp')
  } catch {
    return false
  }
  if (!verifyEvaluationChain(record, secret)) return false
  return equalSignature(approval.signature, sign(secret, approvalMaterial(record, approval)))
}

function verifyActivation(record: RuntimeSkillRecord, secret: Uint8Array): boolean {
  const activation = record.activation
  if (
    !activation ||
    record.activatedAt !== activation.activatedAt ||
    record.activatedBy !== activation.activatedBy
  ) {
    return false
  }
  try {
    requireIdentifier(activation.transitionId, 'Activation transition id')
    requireActor(activation.activatedBy, 'Activation actor')
    requireTimestamp(activation.activatedAt, 'Activation timestamp')
  } catch {
    return false
  }
  if (!record.approval || !verifyApproval(record, secret)) return false
  return equalSignature(activation.signature, sign(secret, activationMaterial(record, activation)))
}

function verifyRetirement(record: RuntimeSkillRecord, secret: Uint8Array): boolean {
  const retirement = record.retirement
  if (
    !retirement ||
    record.retiredAt !== retirement.retiredAt ||
    record.retiredBy !== retirement.retiredBy
  ) {
    return false
  }
  try {
    requireIdentifier(retirement.transitionId, 'Retirement transition id')
    requireActor(retirement.retiredBy, 'Retirement actor')
    requireTimestamp(retirement.retiredAt, 'Retirement timestamp')
  } catch {
    return false
  }
  if (!verifyActivation(record, secret)) return false
  return equalSignature(retirement.signature, sign(secret, retirementMaterial(record, retirement)))
}

function validateHydratedRecord(record: RuntimeSkillRecord, secret: Uint8Array): void {
  requireIdentifier(record.id, 'Skill id')
  requireIdentifier(record.name, 'Skill name')
  requireVersion(record.version)
  requireActor(record.proposedBy, 'Skill proposer')
  const status = requireStatus(record.status)
  normalizePermissions(record.requestedPermissions)
  if (record.evaluationIds.length !== record.evaluatorIds.length) {
    throw new SkillGovernanceError('Skill evaluation evidence is inconsistent')
  }
  if (!verifyEvaluationChain(record, secret)) {
    throw new SkillGovernanceError('Skill evaluation evidence is invalid')
  }
  if (status === 'proposed' && record.evaluationIds.length !== 0) {
    throw new SkillGovernanceError('Proposed skills cannot contain evaluation evidence')
  }
  if (status === 'evaluated' && record.evaluationIds.length === 0) {
    throw new SkillGovernanceError('Evaluated skills require evaluation evidence')
  }
  if (status === 'proposed' || status === 'evaluated') {
    if (
      record.approvedBy !== null ||
      record.approval !== null ||
      record.activatedAt !== null ||
      record.activatedBy !== null ||
      record.activation !== null ||
      record.retiredAt !== null ||
      record.retiredBy !== null ||
      record.retirement !== null
    ) {
      throw new SkillGovernanceError('Unapproved skills cannot contain approval evidence')
    }
    return
  }
  if (status === 'approved') {
    if (!record.approval || !record.approvedBy || !verifyApproval(record, secret)) {
      throw new SkillGovernanceError('Skill approval evidence is invalid')
    }
    if (
      record.activatedAt !== null ||
      record.activatedBy !== null ||
      record.activation !== null ||
      record.retiredAt !== null ||
      record.retiredBy !== null ||
      record.retirement !== null
    ) {
      throw new SkillGovernanceError('Approved skills cannot have activation evidence')
    }
    return
  }
  if (!record.approval || !record.approvedBy || !verifyApproval(record, secret)) {
    throw new SkillGovernanceError('Skill approval evidence is invalid')
  }
  if (!record.activatedAt || !record.activatedBy || !verifyActivation(record, secret)) {
    throw new SkillGovernanceError('Active skills require valid activation evidence')
  }
  if (status === 'active') {
    if (record.retiredAt !== null || record.retiredBy !== null || record.retirement !== null) {
      throw new SkillGovernanceError('Active skills cannot have retirement evidence')
    }
    return
  }
  if (!record.retiredAt || !record.retiredBy || !verifyRetirement(record, secret)) {
    throw new SkillGovernanceError('Retired skills require valid retirement evidence')
  }
}

export function requiresPrivilegedReview(record: RuntimeSkillRecord): boolean {
  return record.requestedPermissions.some((permission) => privilegedPermissions.has(permission))
}

/**
 * A plain object is never activatable. Callers must use SkillRegistry or
 * hydrate a persisted record so approval HMAC evidence is checked first.
 */
export function canActivateSkill(
  record: RuntimeSkillRecord,
  signingSecret?: SkillRegistrySecret
): boolean {
  if (!isBrandedRecord(record) || record.status !== 'approved' || !record.approval) return false
  if (signingSecret === undefined) return false
  try {
    return verifyApproval(record, secretBytes(signingSecret))
  } catch {
    return false
  }
}

export function activateSkill(
  record: RuntimeSkillRecord,
  input: SkillActivationInput,
  signingSecret?: SkillRegistrySecret
): RuntimeSkillRecord {
  if (signingSecret === undefined || !canActivateSkill(record, signingSecret)) {
    throw new SkillGovernanceError('Skill is not approved with valid review evidence')
  }
  if (!input || typeof input !== 'object') {
    throw new SkillGovernanceError('Activation input is invalid')
  }
  const secret = secretBytes(signingSecret)
  const transitionId = requireIdentifier(input.transitionId, 'Activation transition id')
  const activatedBy = requireActor(input.activatedBy, 'Activation actor')
  const activatedAt = requireTimestamp(input.activatedAt, 'Activation timestamp')
  assertRecord(record)
  const activation: SkillActivationEvidence = {
    transitionId,
    activatedBy,
    activatedAt,
    signature: sign(
      secret,
      activationMaterial(
        { ...record, status: 'active', activatedAt, activatedBy },
        { transitionId, activatedBy, activatedAt, signature: '' }
      )
    )
  }
  return freezeRecord({
    ...record,
    status: 'active',
    activatedAt,
    activatedBy,
    activation,
    retiredAt: null,
    retiredBy: null,
    retirement: null
  })
}

export function retireSkill(
  record: RuntimeSkillRecord,
  input: SkillRetirementInput,
  signingSecret?: SkillRegistrySecret
): RuntimeSkillRecord {
  if (signingSecret === undefined) {
    throw new SkillGovernanceError('Skill registry signing secret is required')
  }
  if (!input || typeof input !== 'object') {
    throw new SkillGovernanceError('Retirement input is invalid')
  }
  assertRecord(record)
  if (record.status !== 'active') {
    throw new SkillGovernanceError('Only active skills can be retired')
  }
  const secret = secretBytes(signingSecret)
  if (!verifyActivation(record, secret)) {
    throw new SkillGovernanceError('Skill is not active with valid activation evidence')
  }
  const transitionId = requireIdentifier(input.transitionId, 'Retirement transition id')
  const retiredBy = requireActor(input.retiredBy, 'Retirement actor')
  const retiredAt = requireTimestamp(input.retiredAt, 'Retirement timestamp')
  const retirement: SkillRetirementEvidence = {
    transitionId,
    retiredBy,
    retiredAt,
    signature: sign(
      secret,
      retirementMaterial(
        { ...record, status: 'retired', retiredAt, retiredBy },
        { transitionId, retiredBy, retiredAt, signature: '' }
      )
    )
  }
  return freezeRecord({ ...record, status: 'retired', retiredAt, retiredBy, retirement })
}

/**
 * Registry transitions are the only way to create approval evidence. The
 * signing secret belongs to the separately operated approval boundary and is
 * never part of a skill record or runtime event.
 */
export class SkillRegistry {
  private readonly signingSecret: Uint8Array

  constructor(secret: SkillRegistrySecret) {
    this.signingSecret = secretBytes(secret)
  }

  propose(input: SkillProposalInput): RuntimeSkillRecord {
    const id = requireIdentifier(input.id, 'Skill id')
    const name = requireIdentifier(input.name, 'Skill name')
    const version = requireVersion(input.version)
    const proposedBy = requireActor(input.proposedBy, 'Skill proposer')
    const requestedPermissions = normalizePermissions(input.requestedPermissions)
    return freezeRecord({
      id,
      name,
      version,
      status: 'proposed',
      requestedPermissions,
      proposedBy,
      evaluationIds: [],
      evaluatorIds: [],
      evaluations: [],
      approvedBy: null,
      approval: null,
      activatedAt: null,
      activatedBy: null,
      activation: null,
      retiredAt: null,
      retiredBy: null,
      retirement: null
    })
  }

  evaluate(record: RuntimeSkillRecord, input: SkillEvaluationInput): RuntimeSkillRecord {
    const current = this.hydrate(record)
    if (current.status !== 'proposed' && current.status !== 'evaluated') {
      throw new SkillGovernanceError('Only proposed skills can receive evaluations')
    }
    const evaluationId = requireIdentifier(input.evaluationId, 'Evaluation id')
    const evaluatorId = requireActor(input.evaluatorId, 'Evaluator')
    requireTimestamp(input.evaluatedAt, 'Evaluation timestamp')
    if (evaluatorId === current.proposedBy) {
      throw new SkillGovernanceError('A proposer cannot evaluate its own skill')
    }
    if (current.evaluationIds.includes(evaluationId)) {
      throw new SkillGovernanceError('Evaluation id has already been recorded')
    }
    if (current.evaluatorIds.includes(evaluatorId)) {
      throw new SkillGovernanceError('Evaluator has already reviewed this skill')
    }
    const evaluationInput = { ...input, evaluationId, evaluatorId }
    const evidence: SkillEvaluationEvidence = {
      ...evaluationInput,
      signature: sign(
        this.signingSecret,
        evaluationMaterial(current, evaluationInput, current.evaluationIds, current.evaluatorIds)
      )
    }
    return freezeRecord({
      ...current,
      status: 'evaluated',
      evaluationIds: [...current.evaluationIds, evaluationId],
      evaluatorIds: [...current.evaluatorIds, evaluatorId],
      evaluations: [...current.evaluations, evidence]
    })
  }

  approve(record: RuntimeSkillRecord, input: SkillApprovalInput): RuntimeSkillRecord {
    const current = this.hydrate(record)
    if (current.status !== 'evaluated' || current.evaluationIds.length === 0) {
      throw new SkillGovernanceError('Only evaluated skills can be approved')
    }
    const reviewId = requireIdentifier(input.reviewId, 'Review id')
    const approverId = requireActor(input.approverId, 'Approver')
    requireTimestamp(input.approvedAt, 'Approval timestamp')
    if (approverId === current.proposedBy || current.evaluatorIds.includes(approverId)) {
      throw new SkillGovernanceError('Approval requires an independent actor')
    }
    const approval: SkillApprovalEvidence = {
      reviewId,
      approvedBy: approverId,
      approvedAt: input.approvedAt,
      signature: sign(
        this.signingSecret,
        approvalMaterial(
          { ...current, approvedBy: approverId },
          {
            reviewId,
            approvedBy: approverId,
            approvedAt: input.approvedAt,
            signature: ''
          }
        )
      )
    }
    return freezeRecord({
      ...current,
      status: 'approved',
      approvedBy: approverId,
      approval
    })
  }

  activate(record: RuntimeSkillRecord, input: SkillActivationInput): RuntimeSkillRecord {
    const current = this.hydrate(record)
    return activateSkill(current, input, this.signingSecret)
  }

  retire(record: RuntimeSkillRecord, input: SkillRetirementInput): RuntimeSkillRecord {
    const current = this.hydrate(record)
    return retireSkill(current, input, this.signingSecret)
  }

  hydrate(record: RuntimeSkillRecord): RuntimeSkillRecord {
    if (
      !record ||
      typeof record !== 'object' ||
      !Array.isArray(record.requestedPermissions) ||
      !Array.isArray(record.evaluationIds) ||
      !Array.isArray(record.evaluatorIds) ||
      !Array.isArray(record.evaluations)
    ) {
      throw new SkillGovernanceError('Skill record shape is invalid')
    }
    const candidate = {
      ...record,
      requestedPermissions: [...record.requestedPermissions],
      evaluationIds: [...record.evaluationIds],
      evaluatorIds: [...record.evaluatorIds],
      evaluations: record.evaluations.map((evaluation) => ({ ...evaluation })),
      approval: record.approval ? { ...record.approval } : null,
      activatedAt: record.activatedAt ?? null,
      activatedBy: record.activatedBy ?? null,
      activation: record.activation ? { ...record.activation } : null,
      retiredAt: record.retiredAt ?? null,
      retiredBy: record.retiredBy ?? null,
      retirement: record.retirement ? { ...record.retirement } : null
    }
    validateHydratedRecord(candidate, this.signingSecret)
    return freezeRecord(candidate)
  }

  canActivate(record: RuntimeSkillRecord): boolean {
    try {
      return canActivateSkill(this.hydrate(record), this.signingSecret)
    } catch {
      return false
    }
  }
}
