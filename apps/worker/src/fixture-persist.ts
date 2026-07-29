import { fixturePersistenceInputSchema } from '@appsea/contracts'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresFixtureResearchRepository
} from '@appsea/db'
import { generatePlanPackage } from '@appsea/reports'
import { buildFixtureResearchArtifact } from '@appsea/research'

const fixtureAt = '2026-07-10T00:00:00.000Z'
const artifact = await buildFixtureResearchArtifact(fixtureAt)
const planPackage = generatePlanPackage(artifact, fixtureAt)
const input = fixturePersistenceInputSchema.parse({
  workspaceId: 'workspace-fixture-local',
  campaignId: 'campaign-fixture-local',
  runId: 'run-fixture-local',
  idempotencyKey: 'fixture-persistence-local-v1',
  requestedAt: fixtureAt,
  artifact,
  planPackage
})

const pool = createDatabasePool(databaseConfigFromEnv())
try {
  const repository = new PostgresFixtureResearchRepository(pool)
  const result = await repository.persist(input)
  const readback = await repository.read(input.workspaceId, result.runId)
  if (!readback) throw new Error(`Persisted fixture run ${result.runId} could not be read back`)

  console.log(
    `persisted fixture run ${result.runId}: ${result.evidenceCount} evidence records, ` +
      `${result.clusterCount} clusters, score ${readback.artifact.opportunity.scoreSnapshot.score}, ` +
      `replayed=${result.replayed}`
  )
} finally {
  await pool.end()
}
