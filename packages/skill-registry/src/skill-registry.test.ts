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
    expect(() => activateSkill(proposed, '2026-07-10T00:00:00.000Z', signingSecret)).toThrow(
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
    const active = registry.activate(approved, '2026-07-10T00:02:00.000Z')
    expect(active.status).toBe('active')
    expect(active.activatedAt).toBe('2026-07-10T00:02:00.000Z')
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
