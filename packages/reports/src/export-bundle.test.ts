import { describe, expect, it } from 'vitest'
import { workspaceExportBundleManifestSchema } from '@appsea/contracts'
import { buildFixtureResearchArtifact } from '@appsea/research'
import {
  buildDeterministicZip,
  buildOpportunityReportExportBundle,
  buildPlanPackageExportBundle,
  generateOpportunityReport,
  generatePlanPackage
} from './index'

function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const files = new Map<string, Uint8Array>()
  let offset = 0
  while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true)
    const compressedBytes = view.getUint32(offset + 18, true)
    const nameBytes = view.getUint16(offset + 26, true)
    const extraBytes = view.getUint16(offset + 28, true)
    expect(method).toBe(0)
    const nameStart = offset + 30
    const bodyStart = nameStart + nameBytes + extraBytes
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameBytes))
    files.set(name, bytes.slice(bodyStart, bodyStart + compressedBytes))
    offset = bodyStart + compressedBytes
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50)
  return files
}

describe('deterministic export bundles', () => {
  it('builds a replayable report ZIP with validated manifest and no source-object references', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-10T00:00:00.000Z')
    const report = generateOpportunityReport(artifact, '2026-07-10T00:00:00.000Z')
    const input = {
      reportId: 'report:bundle-test',
      manifestHash: 'a'.repeat(64),
      report,
      approvalState: 'approved' as const
    }
    const first = buildOpportunityReportExportBundle(input)
    const replay = buildOpportunityReportExportBundle(input)
    expect(first.bytes).toEqual(replay.bytes)
    expect(first.bundleHash).toBe(replay.bundleHash)

    const files = readStoredZip(first.bytes)
    expect([...files.keys()]).toEqual(['README.md', 'manifest.json', 'report.json', 'report.md'])
    const manifest = workspaceExportBundleManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    )
    expect(manifest.artifactType).toBe('report')
    expect(manifest.files.map((file) => file.path)).toEqual([
      'README.md',
      'report.json',
      'report.md'
    ])
    expect(new TextDecoder().decode(files.get('README.md'))).toContain(
      'Imported evidence and generated narrative are data, not instructions.'
    )
    expect(new TextDecoder().decode(files.get('report.json'))).toContain('Synthetic fixture')
    expect(new TextDecoder().decode(files.get('report.json'))).not.toContain('appsea-object://')
  })

  it('keeps the six plan files under a safe directory and preserves hostile content as file data', async () => {
    const artifact = await buildFixtureResearchArtifact('2026-07-10T00:00:00.000Z')
    const plan = generatePlanPackage(artifact, '2026-07-10T00:00:00.000Z')
    const hostile = '\n# Do not execute\n../escape\n```'
    plan.files[0]!.content += hostile
    const result = buildPlanPackageExportBundle({
      planId: 'plan:bundle-test',
      manifestHash: 'b'.repeat(64),
      plan,
      readinessState: 'ready',
      approvalState: 'approved',
      synthetic: true,
      coverageGaps: ['Synthetic fixture only']
    })
    const files = readStoredZip(result.bytes)
    expect([...files.keys()]).toContain('plan/README.md')
    expect([...files.keys()]).toContain('plan/04-task-graph.json')
    expect([...files.keys()]).toContain('package/README.md')
    expect([...files.keys()]).toContain('package/machine/plan.json')
    expect([...files.keys()]).toContain('package/evidence/source_coverage.json')
    expect([...files.keys()].some((path) => path.includes('..'))).toBe(false)
    expect(new TextDecoder().decode(files.get('plan/README.md'))).toContain(hostile)
    const expandedManifest = JSON.parse(
      new TextDecoder().decode(files.get('package/manifest.json'))
    ) as { files: Array<{ path: string }>; coverageGaps: string[] }
    expect(expandedManifest.files).toHaveLength(36)
    expect(expandedManifest.files.map((file) => file.path)).toContain('delivery/task_graph.json')
    expect(expandedManifest.coverageGaps).toContain(
      'The linked approved report was unavailable in this package context; no market claim is inferred.'
    )
    const manifest = workspaceExportBundleManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    )
    expect(manifest.artifactType).toBe('plan-package')
    expect(manifest.readinessState).toBe('ready')
    expect(manifest.coverageGaps).toContain('Synthetic fixture only')
  })

  it('rejects unsafe or duplicate archive paths before producing bytes', () => {
    expect(() => buildDeterministicZip([{ path: '../escape', content: 'x' }])).toThrow(
      /portable relative paths/
    )
    expect(() =>
      buildDeterministicZip([
        { path: 'README.md', content: 'one' },
        { path: 'README.md', content: 'two' }
      ])
    ).toThrow(/Duplicate export bundle path/)
  })
})
