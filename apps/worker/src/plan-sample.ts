import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { generatePlanPackage } from '@appsea/reports'
import { buildFixtureResearchArtifact } from '@appsea/research'

const root = resolve(import.meta.dirname, '../../..')
const artifact = await buildFixtureResearchArtifact()
const plan = generatePlanPackage(artifact)
const outputDirectory = resolve(root, 'artifacts/plans', plan.opportunitySlug)

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
for (const file of plan.files) {
  const targetPath = resolve(outputDirectory, file.path)
  const pathWithinPackage = relative(outputDirectory, targetPath)
  if (
    pathWithinPackage === '..' ||
    pathWithinPackage.startsWith(`..${sep}`) ||
    isAbsolute(pathWithinPackage)
  ) {
    throw new Error(`Plan file path escapes the package directory: ${file.path}`)
  }
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(
    targetPath,
    file.content.endsWith('\n') ? file.content : `${file.content}\n`,
    'utf8'
  )
}

console.log(`wrote ${plan.files.length} files to ${outputDirectory}`)
