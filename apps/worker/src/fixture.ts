import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildFixtureResearchArtifact } from '@appsea/research'

const root = resolve(import.meta.dirname, '../../..')
const outputDirectory = resolve(root, 'artifacts/research')
const outputPath = resolve(outputDirectory, 'seed-research-artifact.json')

const artifact = await buildFixtureResearchArtifact()
await mkdir(outputDirectory, { recursive: true })
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')

console.log(`wrote ${outputPath}`)
console.log(
  `fixture artifact: ${artifact.complaints.length} complaints, ${artifact.clusters.length} clusters, score ${artifact.opportunity.scoreSnapshot.score}`
)
