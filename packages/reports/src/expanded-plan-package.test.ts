import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildFixtureResearchArtifact } from '@appsea/research'
import {
  buildExpandedPlanPackageFiles,
  expandedPlanPackagePaths,
  generateOpportunityReport,
  generatePlanPackage
} from './index'

describe('expanded coding-agent plan package', () => {
  it('replays the complete 08_spec-compatible path set with manifest hashes', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-10T00:00:00.000Z')
    const report = generateOpportunityReport(artifact, '2026-07-10T00:00:00.000Z')
    const plan = generatePlanPackage(artifact, '2026-07-10T00:00:00.000Z')
    const input = {
      plan,
      report,
      sourceManifestHash: 'a'.repeat(64),
      synthetic: true,
      coverageGaps: ['fixture-only evidence']
    }
    const first = buildExpandedPlanPackageFiles(input)
    const replay = buildExpandedPlanPackageFiles(input)
    expect(first).toEqual(replay)
    expect(first.map((file) => file.path)).toEqual([...expandedPlanPackagePaths])

    const manifest = JSON.parse(first.find((file) => file.path === 'manifest.json')!.content) as {
      schemaVersion: string
      sourceManifestHash: string
      files: Array<{ path: string; sha256: string; bytes: number }>
      coverageGaps: string[]
    }
    expect(manifest.schemaVersion).toBe('08_spec-package-v1')
    expect(manifest.sourceManifestHash).toBe('a'.repeat(64))
    expect(manifest.files).toHaveLength(expandedPlanPackagePaths.length - 1)
    expect(manifest.coverageGaps).toContain('fixture-only evidence')
    for (const entry of manifest.files) {
      const content = first.find((file) => file.path === entry.path)!.content
      expect(entry.bytes).toBe(new TextEncoder().encode(content).byteLength)
      expect(entry.sha256).toBe(
        createHash('sha256').update(new TextEncoder().encode(content)).digest('hex')
      )
    }
    expect(first.map((file) => file.content).join('\n')).not.toContain('appsea-object://')
  })

  it('keeps plan-only packages honest and imported content inert', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-10T00:00:00.000Z')
    const plan = generatePlanPackage(artifact, '2026-07-10T00:00:00.000Z')
    plan.files.find((file) => file.path === '01-product-brief.md')!.content =
      '# imported\n../escape\n```\njavascript:alert(1)'
    const files = buildExpandedPlanPackageFiles({
      plan,
      sourceManifestHash: 'b'.repeat(64),
      synthetic: true,
      coverageGaps: ['Synthetic fixture only']
    })
    const manifest = JSON.parse(files.find((file) => file.path === 'manifest.json')!.content) as {
      coverageGaps: string[]
    }
    expect(manifest.coverageGaps).toEqual([
      'Synthetic fixture only',
      'The linked approved report was unavailable in this package context; no market claim is inferred.'
    ])
    const productBrief = files.find((file) => file.path === 'product/product_brief.md')!.content
    expect(productBrief).toContain(
      '"content": "# imported\\n../escape\\n```\\njavascript:alert(1)"'
    )
    expect(productBrief).toContain('preserved below as inert file data')
    expect(files.find((file) => file.path === 'evidence/complaints.csv')!.content).toBe(
      '"evidence_id","source_id","source_record_id","product","feature","category","representation","excerpt"\r\n'
    )
  })
})
