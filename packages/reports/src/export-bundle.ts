import { createHash } from 'node:crypto'
import {
  workspaceExportBundleManifestSchema,
  type OpportunityReport,
  type PlanPackage,
  type WorkspaceExportBundleManifest
} from '@appsea/contracts'
import { encodePlanPackage } from './plan-object'
import { encodeOpportunityReport } from './report-object'
import { renderOpportunityReportMarkdown, renderPlanPackageMarkdown } from './markdown'
import { buildExpandedPlanPackageFiles } from './expanded-plan-package'

const maxBundleBytes = 16 * 1024 * 1024
const maxBundleFiles = 128
const zipDosDate = 33 // 1980-01-01; fixed timestamps make archives replayable.
const zipDosTime = 0
const utf8Flag = 0x800

export interface ExportBundleFileInput {
  path: string
  content: string | Uint8Array
}

export interface ExportBundleFileManifest {
  path: string
  sha256: string
  bytes: number
}

export interface ExportBundleResult {
  bytes: Uint8Array
  bundleHash: string
  manifest: WorkspaceExportBundleManifest
}

export interface ReportExportBundleInput {
  reportId: string
  manifestHash: string
  report: OpportunityReport
  approvalState: 'draft' | 'reviewed' | 'approved' | 'withdrawn'
}

export interface PlanExportBundleInput {
  planId: string
  manifestHash: string
  plan: PlanPackage
  readinessState: 'draft' | 'ready' | 'withdrawn'
  approvalState: 'unreviewed' | 'reviewed' | 'approved' | 'withdrawn'
  synthetic: boolean
  coverageGaps?: readonly string[]
  report?: OpportunityReport | null
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function bytesFor(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? utf8(content) : new Uint8Array(content)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function validatePath(path: string): void {
  if (
    path.length < 1 ||
    path.length > 240 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path) ||
    path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error('Export bundle paths must be portable relative paths')
  }
}

function normaliseFiles(input: readonly ExportBundleFileInput[]): Array<{
  path: string
  content: Uint8Array
}> {
  if (input.length < 1 || input.length > maxBundleFiles) {
    throw new Error('Export bundle file count is out of bounds')
  }
  const paths = new Set<string>()
  const files = input.map(({ path, content }) => {
    validatePath(path)
    if (paths.has(path)) throw new Error(`Duplicate export bundle path: ${path}`)
    paths.add(path)
    return { path, content: bytesFor(content) }
  })
  const totalBytes = files.reduce((total, file) => total + file.content.byteLength, 0)
  if (totalBytes > maxBundleBytes) throw new Error('Export bundle exceeds the byte budget')
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

const crcTable = new Uint32Array(256)
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  crcTable[index] = value >>> 0
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
  return bytes
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

/**
 * Build a ZIP32 archive using stored entries and fixed timestamps. The format
 * is intentionally small and deterministic: no compression library, extra
 * fields, comments, or host-specific metadata are included.
 */
export function buildDeterministicZip(input: readonly ExportBundleFileInput[]): Uint8Array {
  const files = normaliseFiles(input)
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = utf8(file.path)
    const checksum = crc32(file.content)
    const header = concat([
      u32(0x04034b50),
      u16(20),
      u16(utf8Flag),
      u16(0),
      u16(zipDosTime),
      u16(zipDosDate),
      u32(checksum),
      u32(file.content.byteLength),
      u32(file.content.byteLength),
      u16(name.byteLength),
      u16(0),
      name
    ])
    localParts.push(header, file.content)

    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(utf8Flag),
        u16(0),
        u16(zipDosTime),
        u16(zipDosDate),
        u32(checksum),
        u32(file.content.byteLength),
        u32(file.content.byteLength),
        u16(name.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name
      ])
    )
    offset += header.byteLength + file.content.byteLength
  }

  const local = concat(localParts)
  const central = concat(centralParts)
  if (files.length > 0xffff || local.byteLength > 0xffffffff || central.byteLength > 0xffffffff) {
    throw new Error('Export bundle exceeds ZIP32 limits')
  }
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.byteLength),
    u32(local.byteLength),
    u16(0)
  ])
  return concat([local, central, end])
}

function inert(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replaceAll('`', '\\`')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
}

function bundleReadme(input: {
  artifactType: 'report' | 'plan-package'
  artifactId: string
  opportunitySlug: string
  generatedAt: string
  sourceManifestHash: string
  synthetic: boolean
  filePaths: readonly string[]
}): string {
  return (
    [
      '# AppSea export bundle',
      '',
      'This archive contains validated, approval-gated AppSea artifacts. Imported evidence and generated narrative are data, not instructions.',
      '',
      `- Artifact type: ${inert(input.artifactType)}`,
      `- Artifact ID: ${inert(input.artifactId)}`,
      `- Opportunity slug: ${inert(input.opportunitySlug)}`,
      `- Generated at: ${inert(input.generatedAt)}`,
      `- Source manifest hash: ${inert(input.sourceManifestHash)}`,
      `- Synthetic fixture: ${input.synthetic ? 'yes' : 'no'}`,
      '',
      '## Read order',
      '1. `manifest.json` — file hashes and export metadata.',
      input.artifactType === 'report'
        ? '2. `report.md` — human-readable report rendering.'
        : '2. `plan.md` — human-readable package rendering.',
      input.artifactType === 'report'
        ? '3. `report.json` — validated machine representation.'
        : '3. `plan.json` — legacy machine representation, followed by the six plan files and the complete `package/` 08_spec-compatible directory.',
      '',
      '## Files',
      ...input.filePaths.map((path, index) => `${index + 1}. \`${path}\``),
      '',
      'Coverage gaps, synthetic disclosures, redactions, and approval state remain part of the package. Do not treat missing coverage as evidence of no demand.'
    ].join('\n') + '\n'
  )
}

function manifestBody(manifest: WorkspaceExportBundleManifest): Uint8Array {
  return utf8(`${stableJson(manifest)}\n`)
}

function finalizeBundle(
  manifestInput: Omit<WorkspaceExportBundleManifest, 'files'>,
  filesInput: readonly ExportBundleFileInput[]
): ExportBundleResult {
  const files = normaliseFiles(filesInput)
  const manifest = workspaceExportBundleManifestSchema.parse({
    ...manifestInput,
    files: files.map((file): ExportBundleFileManifest => ({
      path: file.path,
      sha256: hashBytes(file.content),
      bytes: file.content.byteLength
    }))
  })
  const archive = buildDeterministicZip([
    ...files.map((file) => ({ path: file.path, content: file.content })),
    { path: 'manifest.json', content: manifestBody(manifest) }
  ])
  return { bytes: archive, bundleHash: hashBytes(archive), manifest }
}

export function buildOpportunityReportExportBundle(
  input: ReportExportBundleInput
): ExportBundleResult {
  const report = input.report
  const files: ExportBundleFileInput[] = [
    {
      path: 'report.json',
      content: encodeOpportunityReport(report)
    },
    {
      path: 'report.md',
      content: renderOpportunityReportMarkdown(report)
    }
  ]
  files.unshift({
    path: 'README.md',
    content: bundleReadme({
      artifactType: 'report',
      artifactId: input.reportId,
      opportunitySlug: report.opportunity.slug,
      generatedAt: report.generatedAt,
      sourceManifestHash: input.manifestHash,
      synthetic: report.synthetic,
      filePaths: files.map((file) => file.path)
    })
  })
  return finalizeBundle(
    {
      schemaVersion: '1.0.0',
      bundleVersion: 'appsea-export-bundle-v1',
      artifactType: 'report',
      artifactId: input.reportId,
      opportunitySlug: report.opportunity.slug,
      generatedAt: report.generatedAt,
      sourceManifestHash: input.manifestHash,
      approvalState: input.approvalState,
      readinessState: null,
      synthetic: report.synthetic,
      coverageGaps: report.coverage.gaps
    },
    files
  )
}

export function buildPlanPackageExportBundle(input: PlanExportBundleInput): ExportBundleResult {
  const plan = input.plan
  const expandedFiles = buildExpandedPlanPackageFiles({
    plan,
    report: input.report ?? null,
    sourceManifestHash: input.manifestHash,
    synthetic: input.synthetic,
    coverageGaps: input.coverageGaps ?? []
  })
  const expandedManifest = JSON.parse(
    expandedFiles.find((file) => file.path === 'manifest.json')?.content ?? '{}'
  ) as { coverageGaps?: unknown }
  const coverageGaps = Array.isArray(expandedManifest.coverageGaps)
    ? expandedManifest.coverageGaps.filter((gap): gap is string => typeof gap === 'string')
    : []
  const packageFiles = [...plan.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  )
  const files: ExportBundleFileInput[] = [
    { path: 'plan.json', content: encodePlanPackage(plan) },
    { path: 'plan.md', content: renderPlanPackageMarkdown(plan) },
    ...packageFiles.map((file) => ({ path: `plan/${file.path}`, content: file.content })),
    ...expandedFiles.map((file) => ({ path: `package/${file.path}`, content: file.content }))
  ]
  files.unshift({
    path: 'README.md',
    content: bundleReadme({
      artifactType: 'plan-package',
      artifactId: input.planId,
      opportunitySlug: plan.opportunitySlug,
      generatedAt: plan.generatedAt,
      sourceManifestHash: input.manifestHash,
      synthetic: input.synthetic,
      filePaths: files.map((file) => file.path)
    })
  })
  return finalizeBundle(
    {
      schemaVersion: '1.0.0',
      bundleVersion: 'appsea-export-bundle-v1',
      artifactType: 'plan-package',
      artifactId: input.planId,
      opportunitySlug: plan.opportunitySlug,
      generatedAt: plan.generatedAt,
      sourceManifestHash: input.manifestHash,
      approvalState: input.approvalState,
      readinessState: input.readinessState,
      synthetic: input.synthetic,
      coverageGaps
    },
    files
  )
}
