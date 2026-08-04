import type { Pool, QueryResultRow } from 'pg'
import {
  SkillGovernanceError,
  type SkillRegistry,
  type RuntimeSkillRecord,
  type SkillActivationInput,
  type SkillApprovalInput,
  type SkillEvaluationInput,
  type SkillProposalInput,
  type SkillRetirementInput
} from '@appsea/skill-registry'
import { contentHash } from './hash'
import { withDatabaseTransaction } from './transaction'

export type RuntimeSkillPersistenceEventType =
  'proposal' | 'evaluation' | 'approval' | 'activation' | 'retirement'

export interface RuntimeSkillPersistenceEvent {
  readonly eventId: string
  readonly eventType: RuntimeSkillPersistenceEventType
  readonly actorId: string
  readonly occurredAt: string
}

export interface RuntimeSkillRecordSnapshot {
  readonly record: RuntimeSkillRecord
  readonly recordHash: string
  readonly lastEventId: string
  readonly updatedAt: string
}

export interface RuntimeSkillEventReadModel {
  readonly eventId: string
  readonly skillId: string
  readonly eventType: RuntimeSkillPersistenceEventType
  readonly actorId: string
  readonly beforeRecordHash: string | null
  readonly afterRecordHash: string
  readonly occurredAt: string
}

export interface RuntimeSkillPersistenceResult {
  readonly record: RuntimeSkillRecord
  readonly recordHash: string
  readonly replayed: boolean
}

export class RuntimeSkillPersistenceConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeSkillPersistenceConflictError'
  }
}

interface RuntimeSkillRecordRow extends QueryResultRow {
  skill_id: string
  name: string
  version: string
  status: string
  requested_permissions: unknown
  proposed_by: string
  record_json: unknown
  record_hash: string
  last_event_id: string
  created_at: Date | string
  updated_at: Date | string
}

interface RuntimeSkillEventRow extends QueryResultRow {
  event_id: string
  skill_id: string
  event_type: RuntimeSkillPersistenceEventType
  actor_id: string
  before_record_hash: string | null
  after_record_hash: string
  occurred_at: Date | string
}

interface PersistedSkillRow extends QueryResultRow {
  replayed: boolean
  record_hash: string
}

const identifierPattern = /^[a-z0-9][a-z0-9._:/-]{0,191}$/
const actorPattern = /^[a-z0-9][a-z0-9._:/-]{0,127}$/
const hashPattern = /^[a-f0-9]{64}$/
const eventTypes = new Set<RuntimeSkillPersistenceEventType>([
  'proposal',
  'evaluation',
  'approval',
  'activation',
  'retirement'
])

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

function requiredIso(value: Date | string, label: string): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

function requireEvent(input: RuntimeSkillPersistenceEvent): RuntimeSkillPersistenceEvent {
  if (
    !input ||
    typeof input !== 'object' ||
    !identifierPattern.test(input.eventId) ||
    !eventTypes.has(input.eventType) ||
    !actorPattern.test(input.actorId) ||
    typeof input.occurredAt !== 'string'
  ) {
    throw new RuntimeSkillPersistenceConflictError('Runtime skill persistence event is invalid')
  }
  const occurredAt = new Date(input.occurredAt)
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.toISOString() !== input.occurredAt) {
    throw new RuntimeSkillPersistenceConflictError(
      'Runtime skill persistence event timestamp must be canonical'
    )
  }
  return { ...input }
}

function requireLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new RangeError('Runtime skill query limit must be between 1 and 100')
  }
  return value
}

function mapRecord(
  row: RuntimeSkillRecordRow,
  registry: SkillRegistry
): RuntimeSkillRecordSnapshot {
  if (!hashPattern.test(row.record_hash)) {
    throw new SkillGovernanceError('Stored runtime skill hash is invalid')
  }
  const record = registry.hydrate(row.record_json as RuntimeSkillRecord)
  const computedHash = contentHash(record)
  if (computedHash !== row.record_hash) {
    throw new SkillGovernanceError(`Stored runtime skill ${row.skill_id} failed its hash check`)
  }
  if (
    record.id !== row.skill_id ||
    record.name !== row.name ||
    record.version !== row.version ||
    record.status !== row.status ||
    record.proposedBy !== row.proposed_by ||
    JSON.stringify(record.requestedPermissions) !== JSON.stringify(row.requested_permissions)
  ) {
    throw new SkillGovernanceError(`Stored runtime skill ${row.skill_id} failed its identity check`)
  }
  return {
    record,
    recordHash: row.record_hash,
    lastEventId: row.last_event_id,
    updatedAt: requiredIso(row.updated_at, 'Stored runtime skill update time')
  }
}

function mapEvent(row: RuntimeSkillEventRow): RuntimeSkillEventReadModel {
  if (!hashPattern.test(row.after_record_hash)) {
    throw new SkillGovernanceError('Stored runtime skill event hash is invalid')
  }
  if (row.before_record_hash !== null && !hashPattern.test(row.before_record_hash)) {
    throw new SkillGovernanceError('Stored runtime skill event predecessor hash is invalid')
  }
  return {
    eventId: row.event_id,
    skillId: row.skill_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    beforeRecordHash: row.before_record_hash,
    afterRecordHash: row.after_record_hash,
    occurredAt: requiredIso(row.occurred_at, 'Stored runtime skill event time')
  }
}

function transitionActor(
  record: RuntimeSkillRecord,
  eventType: RuntimeSkillPersistenceEventType
): string {
  const actor =
    eventType === 'proposal'
      ? record.proposedBy
      : eventType === 'evaluation'
        ? record.evaluations.at(-1)?.evaluatorId
        : eventType === 'approval'
          ? record.approval?.approvedBy
          : eventType === 'activation'
            ? record.activation?.activatedBy
            : record.retirement?.retiredBy
  if (!actor) throw new RuntimeSkillPersistenceConflictError('Runtime skill evidence is incomplete')
  return actor
}

function assertEventMatchesRecord(
  record: RuntimeSkillRecord,
  event: RuntimeSkillPersistenceEvent
): void {
  if (transitionActor(record, event.eventType) !== event.actorId) {
    throw new RuntimeSkillPersistenceConflictError(
      'Runtime skill persistence actor does not match signed evidence'
    )
  }
  const expectedStatus = {
    proposal: 'proposed',
    evaluation: 'evaluated',
    approval: 'approved',
    activation: 'active',
    retirement: 'retired'
  }[event.eventType]
  if (record.status !== expectedStatus) {
    throw new RuntimeSkillPersistenceConflictError(
      'Runtime skill persistence event does not match the record status'
    )
  }
  if (
    record.status === 'active' &&
    record.requestedPermissions.some((permission) =>
      [
        'deploy-production',
        'manage-credentials',
        'change-retention',
        'run-migrations',
        'grant-permissions',
        'activate-sources'
      ].includes(permission)
    ) &&
    !event.actorId.startsWith('operator:')
  ) {
    throw new RuntimeSkillPersistenceConflictError(
      'Privileged runtime skill activation requires an operator actor'
    )
  }
}

export class PostgresRuntimeSkillRepository {
  constructor(
    private readonly pool: Pool,
    private readonly registry: SkillRegistry
  ) {}

  async propose(
    input: SkillProposalInput,
    eventInput: RuntimeSkillPersistenceEvent
  ): Promise<RuntimeSkillPersistenceResult> {
    const event = requireEvent(eventInput)
    const replay = await this.replayIfPresent(event, input.id)
    if (replay) return replay
    const record = this.registry.propose(input)
    assertEventMatchesRecord(record, event)
    return this.persist(record, event, null)
  }

  async evaluate(
    skillId: string,
    input: SkillEvaluationInput,
    eventInput: RuntimeSkillPersistenceEvent
  ): Promise<RuntimeSkillPersistenceResult> {
    const event = requireEvent(eventInput)
    const replay = await this.replayIfPresent(event, skillId)
    if (replay) return replay
    const current = await this.requireRecord(skillId)
    const record = this.registry.evaluate(current.record, input)
    assertEventMatchesRecord(record, event)
    return this.persist(record, event, current.recordHash)
  }

  async approve(
    skillId: string,
    input: SkillApprovalInput,
    eventInput: RuntimeSkillPersistenceEvent
  ): Promise<RuntimeSkillPersistenceResult> {
    const event = requireEvent(eventInput)
    const replay = await this.replayIfPresent(event, skillId)
    if (replay) return replay
    const current = await this.requireRecord(skillId)
    const record = this.registry.approve(current.record, input)
    assertEventMatchesRecord(record, event)
    return this.persist(record, event, current.recordHash)
  }

  async activate(
    skillId: string,
    input: SkillActivationInput,
    eventInput: RuntimeSkillPersistenceEvent
  ): Promise<RuntimeSkillPersistenceResult> {
    const event = requireEvent(eventInput)
    const replay = await this.replayIfPresent(event, skillId)
    if (replay) return replay
    const current = await this.requireRecord(skillId)
    const record = this.registry.activate(current.record, input)
    assertEventMatchesRecord(record, event)
    return this.persist(record, event, current.recordHash)
  }

  async retire(
    skillId: string,
    input: SkillRetirementInput,
    eventInput: RuntimeSkillPersistenceEvent
  ): Promise<RuntimeSkillPersistenceResult> {
    const event = requireEvent(eventInput)
    const replay = await this.replayIfPresent(event, skillId)
    if (replay) return replay
    const current = await this.requireRecord(skillId)
    const record = this.registry.retire(current.record, input)
    assertEventMatchesRecord(record, event)
    return this.persist(record, event, current.recordHash)
  }

  async read(skillId: string): Promise<RuntimeSkillRecordSnapshot | null> {
    if (!identifierPattern.test(skillId)) throw new Error('Runtime skill id is invalid')
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<RuntimeSkillRecordRow>(
          'SELECT * FROM appsea.read_runtime_skill_record($1)',
          [skillId]
        )
        const row = result.rows[0]
        return row ? mapRecord(row, this.registry) : null
      },
      { readOnly: true }
    )
  }

  async list(limit = 50): Promise<RuntimeSkillRecordSnapshot[]> {
    const validatedLimit = requireLimit(limit)
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<RuntimeSkillRecordRow>(
          'SELECT * FROM appsea.list_runtime_skill_records($1)',
          [validatedLimit]
        )
        return result.rows.map((row) => mapRecord(row, this.registry))
      },
      { readOnly: true }
    )
  }

  async readEvent(eventId: string): Promise<RuntimeSkillEventReadModel | null> {
    if (!identifierPattern.test(eventId)) throw new Error('Runtime skill event id is invalid')
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<RuntimeSkillEventRow>(
          'SELECT * FROM appsea.read_runtime_skill_event($1)',
          [eventId]
        )
        const row = result.rows[0]
        return row ? mapEvent(row) : null
      },
      { readOnly: true }
    )
  }

  async listEvents(skillId: string, limit = 100): Promise<RuntimeSkillEventReadModel[]> {
    if (!identifierPattern.test(skillId)) throw new Error('Runtime skill id is invalid')
    const validatedLimit = requireLimit(limit)
    return withDatabaseTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<RuntimeSkillEventRow>(
          'SELECT * FROM appsea.list_runtime_skill_events($1, $2)',
          [skillId, validatedLimit]
        )
        return result.rows.map(mapEvent)
      },
      { readOnly: true }
    )
  }

  private async requireRecord(skillId: string): Promise<RuntimeSkillRecordSnapshot> {
    const current = await this.read(skillId)
    if (!current) throw new RuntimeSkillPersistenceConflictError('Runtime skill was not found')
    return current
  }

  private async replayIfPresent(
    event: RuntimeSkillPersistenceEvent,
    expectedSkillId: string
  ): Promise<RuntimeSkillPersistenceResult | null> {
    const existing = await this.readEvent(event.eventId)
    if (!existing) return null
    if (
      existing.skillId !== expectedSkillId ||
      existing.eventType !== event.eventType ||
      existing.actorId !== event.actorId
    ) {
      throw new RuntimeSkillPersistenceConflictError(
        'Runtime skill event id is already bound to different transition metadata'
      )
    }
    const current = await this.requireRecord(expectedSkillId)
    return { record: current.record, recordHash: current.recordHash, replayed: true }
  }

  private async persist(
    record: RuntimeSkillRecord,
    event: RuntimeSkillPersistenceEvent,
    expectedRecordHash: string | null
  ): Promise<RuntimeSkillPersistenceResult> {
    const hydrated = this.registry.hydrate(record)
    const recordHash = contentHash(hydrated)
    if (!hashPattern.test(recordHash)) throw new Error('Runtime skill hash generation failed')
    try {
      const persisted = await withDatabaseTransaction(this.pool, async (client) => {
        const result = await client.query<PersistedSkillRow>(
          `SELECT * FROM appsea.persist_runtime_skill_record(
             $1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11,
             $12::timestamptz, $13
           )`,
          [
            event.eventId,
            hydrated.id,
            hydrated.name,
            hydrated.version,
            hydrated.status,
            JSON.stringify(hydrated.requestedPermissions),
            hydrated.proposedBy,
            JSON.stringify(hydrated),
            recordHash,
            event.eventType,
            event.actorId,
            event.occurredAt,
            expectedRecordHash
          ]
        )
        const row = result.rows[0]
        if (!row || row.record_hash !== recordHash) {
          throw new RuntimeSkillPersistenceConflictError(
            'Runtime skill persistence returned an unexpected hash'
          )
        }
        return { replayed: row.replayed, recordHash: row.record_hash }
      })
      return { record: hydrated, recordHash: persisted.recordHash, replayed: persisted.replayed }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const replay = await this.replayIfPresent(event, hydrated.id)
      if (replay) return replay
      throw error
    }
  }
}
