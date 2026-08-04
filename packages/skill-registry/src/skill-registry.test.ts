import { describe, expect, it } from 'vitest'
import {
  activateSkill,
  canActivateSkill,
  requiresPrivilegedReview,
  SkillGovernanceError,
  SkillRegistry,
  type RuntimeSkillRecord
} from './index'

const signingSecret = Buffer.alloc(32, 7)

const activationInput = {
  transitionId: 'transition:activate:one',
  activatedBy: 'operator:activator',
  activatedAt: '2026-07-10T00:02:00.000Z'
} as const

const retirementInput = {
  transitionId: 'transition:retire:one',
  retiredBy: 'operator:retirer',
  retiredAt: '2026-07-10T00:03:00.000Z'
} as const

function proposedRecord(registry = new SkillRegistry(signingSecret)): RuntimeSkillRecord {
  return registry.propose({
    id: 'source-refresh',
    name: 'source-refresh',
    version: '1.0.0',
    requestedPermissions: ['activate-sources'],
    proposedBy: 'agent:proposal'
  })
}

describe('runtime skill governance', () => {
  it('blocks unapproved activation and rejects forged plain records', () => {
    const registry = new SkillRegistry(signingSecret)
    const proposed = proposedRecord(registry)
    expect(canActivateSkill(proposed, signingSecret)).toBe(false)
    expect(() => activateSkill(proposed, activationInput, signingSecret)).toThrow(
      SkillGovernanceError
    )

    const forged = {
      ...proposed,
      status: 'approved' as const,
      approvedBy: 'operator:forged',
      approval: {
        reviewId: 'review:forged',
        approvedBy: 'operator:forged',
        approvedAt: '2026-07-10T00:00:00.000Z',
        signature: 'forged'
      }
    }
    expect(canActivateSkill(forged, signingSecret)).toBe(false)
    expect(registry.canActivate(forged)).toBe(false)
  })

  it('requires independent evaluation and approval before privileged activation', () => {
    const registry = new SkillRegistry(signingSecret)
    const proposed = proposedRecord(registry)
    expect(requiresPrivilegedReview(proposed)).toBe(true)
    expect(() =>
      registry.evaluate(proposed, {
        evaluationId: 'evaluation:self',
        evaluatorId: 'agent:proposal',
        evaluatedAt: '2026-07-10T00:00:00.000Z'
      })
    ).toThrow('proposer')

    const evaluated = registry.evaluate(proposed, {
      evaluationId: 'evaluation:one',
      evaluatorId: 'agent:evaluator',
      evaluatedAt: '2026-07-10T00:00:00.000Z'
    })
    expect(evaluated.status).toBe('evaluated')
    expect(() =>
      registry.approve(evaluated, {
        reviewId: 'review:evaluator',
        approverId: 'agent:evaluator',
        approvedAt: '2026-07-10T00:01:00.000Z'
      })
    ).toThrow('independent')

    const approved = registry.approve(evaluated, {
      reviewId: 'review:owner',
      approverId: 'operator:owner',
      approvedAt: '2026-07-10T00:01:00.000Z'
    })
    expect(registry.canActivate(approved)).toBe(true)
    const active = registry.activate(approved, activationInput)
    expect(active.status).toBe('active')
    expect(active.activatedAt).toBe('2026-07-10T00:02:00.000Z')
    expect(active.activatedBy).toBe('operator:activator')
    expect(active.activation?.transitionId).toBe('transition:activate:one')

    const retired = registry.retire(active, retirementInput)
    expect(retired.status).toBe('retired')
    expect(retired.retiredAt).toBe('2026-07-10T00:03:00.000Z')
    expect(retired.retiredBy).toBe('operator:retirer')
  })

  it('detects tampering after approval and verifies persisted evidence on hydrate', () => {
    const registry = new SkillRegistry(signingSecret)
    const evaluated = registry.evaluate(proposedRecord(registry), {
      evaluationId: 'evaluation:one',
      evaluatorId: 'agent:evaluator',
      evaluatedAt: '2026-07-10T00:00:00.000Z'
    })
    const approved = registry.approve(evaluated, {
      reviewId: 'review:owner',
      approverId: 'operator:owner',
      approvedAt: '2026-07-10T00:01:00.000Z'
    })
    const persisted = JSON.parse(JSON.stringify(approved)) as RuntimeSkillRecord
    expect(registry.hydrate(persisted)).toMatchObject({
      status: 'approved',
      approvedBy: 'operator:owner'
    })
    const legacyPersisted = { ...persisted } as Record<string, unknown>
    delete legacyPersisted.activatedAt
    delete legacyPersisted.activatedBy
    delete legacyPersisted.activation
    delete legacyPersisted.retiredAt
    delete legacyPersisted.retiredBy
    delete legacyPersisted.retirement
    expect(registry.hydrate(legacyPersisted as unknown as RuntimeSkillRecord).status).toBe(
      'approved'
    )

    const changedPermissions = {
      ...persisted,
      requestedPermissions: ['activate-sources', 'run-migrations']
    }
    expect(() => registry.hydrate(changedPermissions)).toThrow(SkillGovernanceError)

    const changedEvaluator = {
      ...persisted,
      evaluatorIds: ['agent:other'],
      evaluations: persisted.evaluations.map((evaluation) => ({
        ...evaluation,
        evaluatorId: 'agent:other'
      }))
    }
    expect(() => registry.hydrate(changedEvaluator)).toThrow(SkillGovernanceError)
  })

  it('requires signed activation and retirement state transitions on hydration', () => {
    const registry = new SkillRegistry(signingSecret)
    const evaluated = registry.evaluate(proposedRecord(registry), {
      evaluationId: 'evaluation:one',
      evaluatorId: 'agent:evaluator',
      evaluatedAt: '2026-07-10T00:00:00.000Z'
    })
    const approved = registry.approve(evaluated, {
      reviewId: 'review:owner',
      approverId: 'operator:owner',
      approvedAt: '2026-07-10T00:01:00.000Z'
    })
    const active = registry.activate(approved, activationInput)
    const persistedActive = JSON.parse(JSON.stringify(active)) as RuntimeSkillRecord
    expect(registry.hydrate(persistedActive).status).toBe('active')

    expect(() =>
      registry.hydrate({ ...persistedActive, status: 'retired' } as RuntimeSkillRecord)
    ).toThrow(SkillGovernanceError)
    expect(() =>
      registry.hydrate({
        ...persistedActive,
        activatedAt: '2026-07-10T00:04:00.000Z'
      } as RuntimeSkillRecord)
    ).toThrow(SkillGovernanceError)
    expect(() =>
      registry.hydrate({
        ...persistedActive,
        activatedBy: 'operator:forged'
      } as RuntimeSkillRecord)
    ).toThrow(SkillGovernanceError)
    expect(() =>
      registry.hydrate({ ...persistedActive, status: 'unknown' } as unknown as RuntimeSkillRecord)
    ).toThrow(SkillGovernanceError)
    expect(() =>
      registry.hydrate({
        ...persistedActive,
        activation: { ...persistedActive.activation, signature: { forged: true } }
      } as unknown as RuntimeSkillRecord)
    ).toThrow(SkillGovernanceError)

    const retired = registry.retire(active, retirementInput)
    const persistedRetired = JSON.parse(JSON.stringify(retired)) as RuntimeSkillRecord
    expect(registry.hydrate(persistedRetired).status).toBe('retired')
    expect(() =>
      registry.hydrate({
        ...persistedRetired,
        retiredAt: '2026-07-10T00:05:00.000Z'
      } as RuntimeSkillRecord)
    ).toThrow(SkillGovernanceError)
    expect(() =>
      registry.hydrate({
        ...persistedRetired,
        retiredBy: 'operator:forged'
      } as RuntimeSkillRecord)
    ).toThrow(SkillGovernanceError)
    expect(() =>
      registry.hydrate({
        ...persistedRetired,
        retirement: { ...persistedRetired.retirement, retiredAt: '2026-07-10T00:05:00.000Z' }
      } as RuntimeSkillRecord)
    ).toThrow(SkillGovernanceError)
  })

  it('rejects non-canonical transition timestamps and actors before signing', () => {
    const registry = new SkillRegistry(signingSecret)
    const evaluated = registry.evaluate(proposedRecord(registry), {
      evaluationId: 'evaluation:one',
      evaluatorId: 'agent:evaluator',
      evaluatedAt: '2026-07-10T00:00:00.000Z'
    })
    const approved = registry.approve(evaluated, {
      reviewId: 'review:owner',
      approverId: 'operator:owner',
      approvedAt: '2026-07-10T00:01:00.000Z'
    })
    expect(() =>
      registry.activate(approved, {
        ...activationInput,
        activatedAt: '2026-07-10T00:02:00Z'
      })
    ).toThrow(SkillGovernanceError)
    expect(() =>
      registry.activate(approved, {
        ...activationInput,
        activatedBy: 'Operator/forged'
      })
    ).toThrow(SkillGovernanceError)
  })

  it('does not accept approval evidence signed by another registry', () => {
    const first = new SkillRegistry(signingSecret)
    const second = new SkillRegistry(Buffer.alloc(32, 8))
    const evaluated = first.evaluate(proposedRecord(first), {
      evaluationId: 'evaluation:one',
      evaluatorId: 'agent:evaluator',
      evaluatedAt: '2026-07-10T00:00:00.000Z'
    })
    const approved = first.approve(evaluated, {
      reviewId: 'review:owner',
      approverId: 'operator:owner',
      approvedAt: '2026-07-10T00:01:00.000Z'
    })
    expect(() => second.hydrate(approved)).toThrow(SkillGovernanceError)
  })
})
