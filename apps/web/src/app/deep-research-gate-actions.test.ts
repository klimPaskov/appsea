import { describe, expect, it } from 'vitest'
import {
  deepResearchGateCheckDefinitions,
  initialDeepResearchGateChecks,
  parseEvidenceIds
} from './workspace/deep-research-gate-actions'

describe('deep research gate review form helpers', () => {
  it('creates a complete not-reviewed checklist for a new gate', () => {
    const checks = initialDeepResearchGateChecks(null)

    expect(Object.keys(checks)).toHaveLength(12)
    expect(deepResearchGateCheckDefinitions.map(({ key }) => key)).toEqual(
      expect.arrayContaining(Object.keys(checks))
    )
    expect(Object.values(checks).every((check) => check.state === 'not-reviewed')).toBe(true)
    expect(Object.values(checks).every((check) => check.note === null)).toBe(true)
  })

  it('clones persisted checks so editing the form cannot mutate the server projection', () => {
    const gate = {
      checks: initialDeepResearchGateChecks(null)
    }
    gate.checks.coherentCluster = {
      state: 'pass',
      note: 'Reviewed against the retained cluster.',
      evidenceIds: ['evidence:one']
    }

    const copy = initialDeepResearchGateChecks(gate)
    copy.coherentCluster.evidenceIds.push('evidence:two')

    expect(gate.checks.coherentCluster.evidenceIds).toEqual(['evidence:one'])
    expect(copy.coherentCluster).toEqual({
      state: 'pass',
      note: 'Reviewed against the retained cluster.',
      evidenceIds: ['evidence:one', 'evidence:two']
    })
  })

  it('normalizes comma-separated evidence IDs without changing their order', () => {
    expect(parseEvidenceIds(' evidence:one, evidence:two, evidence:one ,, ')).toEqual([
      'evidence:one',
      'evidence:two'
    ])
  })
})
