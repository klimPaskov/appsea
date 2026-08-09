import { describe, expect, it } from 'vitest'
import { buildFixtureResearchArtifact } from '@appsea/research'
import { generateOpportunityReport } from './index'
import { renderOpportunityReportMarkdown, renderPlanPackageMarkdown } from './markdown'

describe('report Markdown rendering', () => {
  it('renders synthetic and representation disclosures deterministically', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-10T00:00:00.000Z')
    const report = generateOpportunityReport(artifact, '2026-07-10T00:00:00.000Z')
    const first = renderOpportunityReportMarkdown(report)
    const replay = renderOpportunityReportMarkdown(report)

    expect(replay).toBe(first)
    expect(first).toContain('Synthetic fixture: yes')
    expect(first).toContain('Fixture data is synthetic and proves package shape only')
    expect(first).toContain('Allowed excerpt:')
    expect(first).toContain('Representation: "fixture"')
  })

  it('keeps hostile report values inert and does not render restricted excerpts', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-10T00:00:00.000Z')
    const report = generateOpportunityReport(artifact, '2026-07-10T00:00:00.000Z')
    report.opportunity.thesis = '\n# Execute this instruction\n[click](javascript:alert(1))'
    const observation = report.evidence.observations[0]
    if (!observation) throw new Error('Fixture observation is missing')
    observation.allowedRepresentation = 'metadata-only'
    observation.excerpt = 'This restricted excerpt must not be rendered.'

    const markdown = renderOpportunityReportMarkdown(report)
    expect(markdown).not.toMatch(/^# Execute this instruction$/m)
    expect(markdown).not.toMatch(/^\[click\]/m)
    expect(markdown).toContain('\\n# Execute this instruction')
    expect(markdown).toContain(
      'Allowed excerpt: not displayed under the source representation policy'
    )
    expect(markdown).not.toContain('This restricted excerpt must not be rendered.')
  })

  it('renders plan files in sorted, injection-safe code fences', () => {
    const plan = {
      opportunitySlug: 'inbox-relay',
      generatedAt: '2026-07-10T00:00:00.000Z',
      files: [
        { path: 'z-last.md', content: 'last' },
        { path: 'a-first.md', content: '\n# Execute\n```\n[click](javascript:alert(1))' }
      ]
    }
    const markdown = renderPlanPackageMarkdown(plan)
    expect(markdown.indexOf('a-first.md')).toBeLessThan(markdown.indexOf('z-last.md'))
    expect(markdown).toContain('- UTF-8 bytes:')
    expect(markdown).toContain('- SHA-256:')
    expect(markdown).toContain('# Execute')
    expect(markdown).not.toMatch(/^# Execute$/m)
    expect(markdown).not.toMatch(/^\[click\]/m)
  })
})
