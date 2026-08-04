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

function equalSignature(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'base64url')
  const rightBytes = Buffer.from(right, 'base64url')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
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

function freezeRecord(record: RuntimeSkillRecord): RuntimeSkillRecord {
  const candidate = {
    ...record,
    requestedPermissions: Object.freeze([...record.requestedPermissions]),
    evaluationIds: Object.freeze([...record.evaluationIds]),
    evaluatorIds: Object.freeze([...record.evaluatorIds]),
    evaluations: Object.freeze(
      record.evaluations.map((evaluation) => Object.freeze({ ...evaluation }))
    ),
    approval: record.approval ? Object.freeze({ ...record.approval }) : null
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

function validateHydratedRecord(record: RuntimeSkillRecord, secret: Uint8Array): void {
  requireIdentifier(record.id, 'Skill id')
  requireIdentifier(record.name, 'Skill name')
  requireVersion(record.version)
  requireActor(record.proposedBy, 'Skill proposer')
  normalizePermissions(record.requestedPermissions)
  if (record.evaluationIds.length !== record.evaluatorIds.length) {
    throw new SkillGovernanceError('Skill evaluation evidence is inconsistent')
  }
  if (!verifyEvaluationChain(record, secret)) {
    throw new SkillGovernanceError('Skill evaluation evidence is invalid')
  }
  if (record.status === 'proposed' && record.evaluationIds.length !== 0) {
    throw new SkillGovernanceError('Proposed skills cannot contain evaluation evidence')
  }
  if (record.status === 'evaluated' && record.evaluationIds.length === 0) {
    throw new SkillGovernanceError('Evaluated skills require evaluation evidence')
  }
  if (record.status === 'proposed' || record.status === 'evaluated') {
    if (record.approvedBy !== null || record.approval !== null || record.activatedAt !== null) {
      throw new SkillGovernanceError('Unapproved skills cannot contain approval evidence')
    }
    return
  }
  if (!record.approval || !record.approvedBy || !verifyApproval(record, secret)) {
    throw new SkillGovernanceError('Skill approval evidence is invalid')
  }
  if ((record.status === 'active' || record.status === 'retired') && !record.activatedAt) {
    throw new SkillGovernanceError('Active skills require an activation timestamp')
  }
  if (record.status === 'approved' && record.activatedAt !== null) {
    throw new SkillGovernanceError('Approved skills cannot have an activation timestamp')
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
  activatedAt: string,
  signingSecret?: SkillRegistrySecret
): RuntimeSkillRecord {
  if (signingSecret === undefined || !canActivateSkill(record, signingSecret)) {
    throw new SkillGovernanceError('Skill is not approved with valid review evidence')
  }
  requireTimestamp(activatedAt, 'Activation timestamp')
  assertRecord(record)
  return freezeRecord({ ...record, status: 'active', activatedAt })
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
      activatedAt: null
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

  activate(record: RuntimeSkillRecord, activatedAt: string): RuntimeSkillRecord {
    const current = this.hydrate(record)
    return activateSkill(current, activatedAt, this.signingSecret)
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
      approval: record.approval ? { ...record.approval } : null
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
