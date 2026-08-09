import { createHash } from 'node:crypto'
import { planPackageSchema, type PlanPackage } from '@appsea/contracts'

export type PlanPackageFileState = 'added' | 'removed' | 'changed' | 'unchanged'

export interface PlanPackageFileSnapshot {
  path: string
  hash: string
  bytes: number
}

export interface PlanPackageFileComparison {
  path: string
  state: PlanPackageFileState
  before: PlanPackageFileSnapshot | null
  after: PlanPackageFileSnapshot | null
}

export interface PlanPackageManifest {
  opportunitySlug: string
  generatedAt: string
  files: PlanPackageFileSnapshot[]
  bytes: number
  hash: string
}

export interface PlanPackageComparison {
  before: PlanPackageManifest
  after: PlanPackageManifest
  /** All paths, sorted by portable path, including unchanged files. */
  files: PlanPackageFileComparison[]
  /** Path-level subsets of `files`, each sorted by portable path. */
  added: PlanPackageFileComparison[]
  removed: PlanPackageFileComparison[]
  changed: PlanPackageFileComparison[]
  unchanged: PlanPackageFileComparison[]
  addedPaths: string[]
  removedPaths: string[]
  changedPaths: string[]
  unchangedPaths: string[]
  /** True when slug and every file body match; generatedAt is metadata. */
  identical: boolean
  metadataChanged: boolean
}

function utf8Bytes(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

export function hashPlanPackageFileContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function comparePath(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function snapshotsFor(planPackage: PlanPackage): PlanPackageFileSnapshot[] {
  return [...planPackage.files]
    .sort((left, right) => comparePath(left.path, right.path))
    .map((file) => ({
      path: file.path,
      hash: hashPlanPackageFileContent(file.content),
      bytes: utf8Bytes(file.content)
    }))
}

function manifestFor(planPackage: PlanPackage): PlanPackageManifest {
  const files = snapshotsFor(planPackage)
  const bytes = files.reduce((total, file) => total + file.bytes, 0)
  // Delimit fields so a path or hash cannot make two manifest rows ambiguous.
  const material = [
    planPackage.opportunitySlug,
    ...files.map((file) => `${file.path}\0${file.hash}\0${file.bytes}`)
  ].join('\n')
  return {
    opportunitySlug: planPackage.opportunitySlug,
    generatedAt: planPackage.generatedAt,
    files,
    bytes,
    hash: createHash('sha256').update(material, 'utf8').digest('hex')
  }
}

/**
 * Compare two validated plan packages using only sorted path, SHA-256, and
 * UTF-8 byte metadata. File content is deliberately not returned, preventing
 * a comparison artifact from accidentally re-publishing source-derived text.
 */
export function comparePlanPackages(
  beforeInput: PlanPackage,
  afterInput: PlanPackage
): PlanPackageComparison {
  const beforePackage = planPackageSchema.parse(beforeInput)
  const afterPackage = planPackageSchema.parse(afterInput)
  const before = manifestFor(beforePackage)
  const after = manifestFor(afterPackage)

  const beforeByPath = new Map(before.files.map((file) => [file.path, file]))
  const afterByPath = new Map(after.files.map((file) => [file.path, file]))
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort(comparePath)
  const files = paths.map((path): PlanPackageFileComparison => {
    const previous = beforeByPath.get(path) ?? null
    const current = afterByPath.get(path) ?? null
    const state: PlanPackageFileState =
      previous === null
        ? 'added'
        : current === null
          ? 'removed'
          : previous.hash === current.hash && previous.bytes === current.bytes
            ? 'unchanged'
            : 'changed'
    return { path, state, before: previous, after: current }
  })
  const byState = (state: PlanPackageFileState) => files.filter((file) => file.state === state)
  const added = byState('added')
  const removed = byState('removed')
  const changed = byState('changed')
  const unchanged = byState('unchanged')

  return {
    before,
    after,
    files,
    added,
    removed,
    changed,
    unchanged,
    addedPaths: added.map((file) => file.path),
    removedPaths: removed.map((file) => file.path),
    changedPaths: changed.map((file) => file.path),
    unchangedPaths: unchanged.map((file) => file.path),
    identical:
      before.opportunitySlug === after.opportunitySlug &&
      changed.length === 0 &&
      added.length === 0 &&
      removed.length === 0,
    metadataChanged:
      before.opportunitySlug !== after.opportunitySlug || before.generatedAt !== after.generatedAt
  }
}
