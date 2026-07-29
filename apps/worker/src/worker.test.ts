import { describe, expect, it } from 'vitest'
import { generatePlanPackage } from '@appsea/reports'
import { buildFixtureResearchArtifact } from '@appsea/research'

describe('worker vertical slice', () => {
  it('can build the fixture artifact and coding-agent package', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-10T00:00:00.000Z')
    const plan = generatePlanPackage(artifact, '2026-07-10T00:00:00.000Z')
    expect(artifact.complaints).toHaveLength(4)
    expect(plan.files).toHaveLength(6)
  })
})
