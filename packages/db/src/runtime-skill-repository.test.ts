import { describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { SkillGovernanceError, SkillRegistry } from '@appsea/skill-registry'
import {
  PostgresRuntimeSkillRepository,
  RuntimeSkillPersistenceConflictError,
  type RuntimeSkillEventReadModel,
  type RuntimeSkillRecordSnapshot
} from './runtime-skill-repository'

const signingSecret = Buffer.alloc(32, 7)
const fixedAt = '2026-08-04T00:00:00.000Z'

interface FakeState {
  snapshot: RuntimeSkillRecordSnapshot | null
  events: RuntimeSkillEventReadModel[]
}

function fakePool(): { pool: Pool; state: FakeState; statements: string[] } {
  const state: FakeState = { snapshot: null, events: [] }
  const statements: string[] = []
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      statements.push(text)
      if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }
      if (text.includes('read_runtime_skill_event')) {
        const event = state.events.find((candidate) => candidate.eventId === values[0])
        return {
          rows: event
            ? [
                {
                  event_id: event.eventId,
                  skill_id: event.skillId,
                  event_type: event.eventType,
                  actor_id: event.actorId,
                  before_record_hash: event.beforeRecordHash,
                  after_record_hash: event.afterRecordHash,
                  occurred_at: event.occurredAt
                }
              ]
            : [],
          rowCount: event ? 1 : 0
        }
      }
      if (text.includes('read_runtime_skill_record')) {
        if (!state.snapshot) return { rows: [], rowCount: 0 }
        return {
          rows: [
            {
              skill_id: state.snapshot.record.id,
              name: state.snapshot.record.name,
              version: state.snapshot.record.version,
              status: state.snapshot.record.status,
              requested_permissions: state.snapshot.record.requestedPermissions,
              proposed_by: state.snapshot.record.proposedBy,
              record_json: state.snapshot.record,
              record_hash: state.snapshot.recordHash,
              last_event_id: state.snapshot.lastEventId,
              created_at: fixedAt,
              updated_at: state.snapshot.updatedAt
            }
          ],
          rowCount: 1
        }
      }
      if (text.includes('persist_runtime_skill_record')) {
        const [
          eventId,
          skillId,
          name,
          version,
          status,
          permissionsJson,
          proposedBy,
          recordJson,
          hash,
          eventType,
          actorId,
          occurredAt,
          expectedHash
        ] = values
        const existing = state.events.find((candidate) => candidate.eventId === eventId)
        if (existing)
          return { rows: [{ replayed: true, record_hash: existing.afterRecordHash }], rowCount: 1 }
        if (state.snapshot && expectedHash !== state.snapshot.recordHash) {
          const error = new Error('optimistic concurrency') as Error & { code: string }
          error.code = '40001'
          throw error
        }
        const record = JSON.parse(String(recordJson)) as RuntimeSkillRecordSnapshot['record']
        state.snapshot = {
          record,
          recordHash: String(hash),
          lastEventId: String(eventId),
          updatedAt: String(occurredAt)
        }
        state.events.unshift({
          eventId: String(eventId),
          skillId: String(skillId),
          eventType: eventType as RuntimeSkillEventReadModel['eventType'],
          actorId: String(actorId),
          beforeRecordHash: expectedHash ? String(expectedHash) : null,
          afterRecordHash: String(hash),
          occurredAt: String(occurredAt)
        })
        expect(String(name)).toBe(record.name)
        expect(String(version)).toBe(record.version)
        expect(String(status)).toBe(record.status)
        expect(JSON.parse(String(permissionsJson))).toEqual(record.requestedPermissions)
        expect(String(proposedBy)).toBe(record.proposedBy)
        return { rows: [{ replayed: false, record_hash: hash }], rowCount: 1 }
      }
      throw new Error(`Unexpected SQL in test double: ${text}`)
    },
    release: () => undefined
  } as unknown as PoolClient
  return {
    pool: { connect: async () => client } as unknown as Pool,
    state,
    statements
  }
}

describe('runtime skill persistence repository', () => {
  it('hydrates registry records, persists transitions, and replays event ids', async () => {
    const { pool, state } = fakePool()
    const repository = new PostgresRuntimeSkillRepository(pool, new SkillRegistry(signingSecret))
    const proposalEvent = {
      eventId: 'skill-event:proposal',
      eventType: 'proposal' as const,
      actorId: 'agent:proposal',
      occurredAt: fixedAt
    }

    await expect(
      repository.propose(
        {
          id: 'skill:test',
          name: 'test-skill',
          version: '1.0.0',
          requestedPermissions: ['read-evidence'],
          proposedBy: 'agent:proposal'
        },
        proposalEvent
      )
    ).resolves.toMatchObject({ record: { status: 'proposed' }, replayed: false })
    await expect(
      repository.propose(
        {
          id: 'skill:test',
          name: 'test-skill',
          version: '1.0.0',
          requestedPermissions: ['read-evidence'],
          proposedBy: 'agent:proposal'
        },
        proposalEvent
      )
    ).resolves.toMatchObject({ replayed: true })
    expect(state.events).toHaveLength(1)
  })

  it('requires operator activation for privileged permissions and rejects tampered reads', async () => {
    const { pool, state, statements } = fakePool()
    const repository = new PostgresRuntimeSkillRepository(pool, new SkillRegistry(signingSecret))
    const skillId = 'skill:privileged'
    await repository.propose(
      {
        id: skillId,
        name: 'privileged-skill',
        version: '1.0.0',
        requestedPermissions: ['activate-sources'],
        proposedBy: 'agent:proposal'
      },
      {
        eventId: 'skill-event:privileged-proposal',
        eventType: 'proposal',
        actorId: 'agent:proposal',
        occurredAt: fixedAt
      }
    )
    await repository.evaluate(
      skillId,
      {
        evaluationId: 'skill-evaluation:privileged',
        evaluatorId: 'agent:evaluator',
        evaluatedAt: fixedAt
      },
      {
        eventId: 'skill-event:privileged-evaluation',
        eventType: 'evaluation',
        actorId: 'agent:evaluator',
        occurredAt: fixedAt
      }
    )
    await repository.approve(
      skillId,
      {
        reviewId: 'skill-review:privileged',
        approverId: 'operator:approver',
        approvedAt: fixedAt
      },
      {
        eventId: 'skill-event:privileged-approval',
        eventType: 'approval',
        actorId: 'operator:approver',
        occurredAt: fixedAt
      }
    )
    await expect(
      repository.activate(
        skillId,
        {
          transitionId: 'skill-transition:bad',
          activatedBy: 'agent:activator',
          activatedAt: fixedAt
        },
        {
          eventId: 'skill-event:privileged-bad-activation',
          eventType: 'activation',
          actorId: 'agent:activator',
          occurredAt: fixedAt
        }
      )
    ).rejects.toBeInstanceOf(RuntimeSkillPersistenceConflictError)

    if (!state.snapshot) throw new Error('expected persisted skill')
    state.snapshot = { ...state.snapshot, recordHash: 'f'.repeat(64) }
    await expect(repository.read(skillId)).rejects.toBeInstanceOf(SkillGovernanceError)
    expect(statements.some((statement) => statement.includes('runtime_skill_events '))).toBe(false)
  })

  it('rejects invalid limits and event timestamps before opening a transaction', async () => {
    const { pool, statements } = fakePool()
    const repository = new PostgresRuntimeSkillRepository(pool, new SkillRegistry(signingSecret))
    await expect(repository.list(0)).rejects.toThrow('between 1 and 100')
    await expect(repository.listEvents('skill:test', 101)).rejects.toThrow('between 1 and 100')
    await expect(
      repository.propose(
        {
          id: 'skill:test',
          name: 'test-skill',
          version: '1.0.0',
          requestedPermissions: ['read-evidence'],
          proposedBy: 'agent:proposal'
        },
        {
          eventId: 'skill-event:bad-time',
          eventType: 'proposal',
          actorId: 'agent:proposal',
          occurredAt: 'not-a-timestamp'
        }
      )
    ).rejects.toThrow()
    expect(statements).toHaveLength(0)
  })
})
