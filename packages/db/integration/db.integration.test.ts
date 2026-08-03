import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  fixturePersistenceInputSchema,
  fixtureResearchWorkflowHashMaterialSchema,
  fixtureResearchWorkflowInputSchema,
  opportunityReportSchema,
  type FixturePersistenceInput,
  type WorkflowActor,
  type FixtureResearchWorkflowInput,
  type EvidenceRedactionInput,
  type WorkflowExecutionMetadata
} from '@appsea/contracts'
import { generatePlanPackage } from '@appsea/reports'
import { buildFixtureResearchArtifact } from '@appsea/research'
import { InvalidScoreSnapshotError } from '@appsea/scoring'
import {
  createDatabasePool,
  contentHash,
  databaseConfigFromEnv,
  IdempotencyConflictError,
  ImmutableRecordConflictError,
  migrateDatabase,
  MigrationHistoryError,
  AuthenticationError,
  AuthSessionConflictError,
  WorkspaceMembershipConflictError,
  WorkspaceMembershipManagementError,
  WorkspaceReportNotApprovedError,
  PostgresFixtureResearchRepository,
  PostgresAuthRepository,
  PostgresDeletionPropagationRepository,
  PostgresProductionAnalysisAdmissionRepository,
  PostgresProductionAnalysisRepository,
  PostgresProductionAnalysisRecomputeRepository,
  PostgresOpportunitySeedReviewRepository,
  PostgresProductionWorkflowAdmissionRepository,
  PostgresMaintenanceSchedulerLeaseRepository,
  PostgresMaintenanceSchedulerRunRepository,
  PostgresWorkspaceCostRepository,
  PostgresWorkspaceCostAlertRepository,
  PostgresCompetitiveResearchRepository,
  PostgresEvidenceRedactionRepository,
  PostgresSourceCollectionLeaseRepository,
  PostgresSourceQuotaRepository,
  PostgresSourceSnapshotReconciliationRepository,
  ProductionWorkflowConcurrencyLimitError,
  ProductionWorkflowRateLimitError,
  PostgresWorkflowJobRepository,
  WorkflowCheckpointConflictError,
  WorkflowJobConflictError,
  ProductionWorkflowAdmissionConflictError,
  withAuthenticatedWorkspaceTransaction,
  withWorkspaceTransaction
} from '../src/index'

const fixedAt = '2026-07-10T00:00:00.000Z'
const laterAt = '2026-07-11T00:00:00.000Z'
const latestAt = '2026-07-12T00:00:00.000Z'

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for the PostgreSQL integration suite`)
  return value
}

const serviceDatabaseUrl = requiredEnvironment('APPSEA_TEST_DATABASE_URL')
const maintenanceDatabaseUrl = requiredEnvironment('APPSEA_TEST_MAINTENANCE_DATABASE_URL')
const migrationDatabaseUrl = requiredEnvironment('APPSEA_TEST_MIGRATION_DATABASE_URL')
if (process.env.APPSEA_ALLOW_DESTRUCTIVE_DB_TESTS !== 'yes') {
  throw new Error('APPSEA_ALLOW_DESTRUCTIVE_DB_TESTS=yes is required')
}

function assertDisposableDatabaseUrl(value: string, expectedUsername: string): void {
  const parsed = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Database integration tests require a PostgreSQL URL')
  }
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Database integration tests require a local PostgreSQL host')
  }
  if (parsed.port !== '5433') {
    throw new Error('Database integration tests require the local PostgreSQL port 5433')
  }
  if (parsed.pathname !== '/appsea_test') {
    throw new Error('Database integration tests require the exact appsea_test database')
  }
  if (decodeURIComponent(parsed.username) !== expectedUsername) {
    throw new Error(`Database integration tests require the ${expectedUsername} role`)
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Database integration test URLs must not contain parameters or fragments')
  }
}

assertDisposableDatabaseUrl(serviceDatabaseUrl, 'appsea_service')
assertDisposableDatabaseUrl(maintenanceDatabaseUrl, 'appsea_maintenance')
assertDisposableDatabaseUrl(migrationDatabaseUrl, 'appsea_migrator')

const migrationPool = createDatabasePool(
  databaseConfigFromEnv({
    DATABASE_URL: migrationDatabaseUrl,
    NODE_ENV: 'test',
    APPSEA_DATABASE_SSL_MODE: 'disable',
    APPSEA_DATABASE_APPLICATION_NAME: 'appsea-db-migration-integration'
  })
)
const servicePool = createDatabasePool(
  databaseConfigFromEnv({
    DATABASE_URL: serviceDatabaseUrl,
    NODE_ENV: 'test',
    APPSEA_DATABASE_SSL_MODE: 'disable',
    APPSEA_DATABASE_APPLICATION_NAME: 'appsea-db-service-integration'
  })
)
const maintenancePool = createDatabasePool(
  databaseConfigFromEnv({
    DATABASE_URL: maintenanceDatabaseUrl,
    NODE_ENV: 'test',
    APPSEA_DATABASE_SSL_MODE: 'disable',
    APPSEA_DATABASE_APPLICATION_NAME: 'appsea-db-maintenance-integration'
  })
)
const migrationOptions = { role: 'appsea_owner' } as const
const repository = new PostgresFixtureResearchRepository(servicePool)
const workflowRepository = new PostgresWorkflowJobRepository(servicePool)
const authRepository = new PostgresAuthRepository(servicePool)
const deletionRepository = new PostgresDeletionPropagationRepository(servicePool)
const seedReviewRepository = new PostgresOpportunitySeedReviewRepository(servicePool)
const evidenceRedactionRepository = new PostgresEvidenceRedactionRepository(servicePool)

async function withOwnerClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await migrationPool.connect()
  try {
    await client.query('SET ROLE appsea_owner')
    return await operation(client)
  } finally {
    try {
      await client.query('RESET ROLE')
    } finally {
      client.release()
    }
  }
}

async function resetDisposableDatabase(): Promise<void> {
  const serviceIdentity = await servicePool.query<{
    database_name: string
    current_role: string
    session_role: string
    database_comment: string | null
  }>(
    `SELECT current_database() AS database_name,
            current_user AS current_role,
            session_user AS session_role,
            shobj_description(oid, 'pg_database') AS database_comment
       FROM pg_database
      WHERE datname = current_database()`
  )
  expect(serviceIdentity.rows[0]).toEqual({
    database_name: 'appsea_test',
    current_role: 'appsea_service',
    session_role: 'appsea_service',
    database_comment: 'appsea-disposable-test-database'
  })

  await withOwnerClient(async (client) => {
    const identity = await client.query<{
      database_name: string
      current_role: string
      session_role: string
      database_comment: string | null
    }>(
      `SELECT current_database() AS database_name,
              current_user AS current_role,
              session_user AS session_role,
             shobj_description(oid, 'pg_database') AS database_comment
         FROM pg_database
        WHERE datname = current_database()`
    )
    expect(identity.rows[0]).toEqual({
      database_name: 'appsea_test',
      current_role: 'appsea_owner',
      session_role: 'appsea_migrator',
      database_comment: 'appsea-disposable-test-database'
    })
    await client.query('DROP SCHEMA IF EXISTS appsea CASCADE')
    await client.query('DROP TABLE IF EXISTS public.appsea_schema_migrations')
  })
}

async function seedVersionOneLineage(): Promise<void> {
  await withOwnerClient(async (client) => {
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('appsea.workspace_id', 'workspace-upgrade', true)")
      await client.query(`
        INSERT INTO appsea.workspaces
          (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
        VALUES
          ('workspace-upgrade', 'workspace-upgrade', 'Upgrade fixture', 'private', true, 'active',
           '${fixedAt}', '${fixedAt}');

        INSERT INTO appsea.sources
          (source_id, display_name, source_type, lifecycle_state, created_at, updated_at)
        VALUES
          ('source-upgrade', 'Upgrade source', 'fixture', 'disabled_pending_review',
           '${fixedAt}', '${fixedAt}');

        INSERT INTO appsea.deletion_tombstones
          (workspace_id, tombstone_id, source_id, source_record_id, reason, state, received_at)
        VALUES
          ('workspace-upgrade', 'tombstone-upgrade', 'source-upgrade', 'record-upgrade',
           'upgrade migration repair', 'processing', '${fixedAt}');

        INSERT INTO appsea.research_campaigns
          (workspace_id, campaign_id, name, purpose, state, configuration, budget, synthetic,
           created_at, updated_at)
        VALUES
          ('workspace-upgrade', 'campaign-upgrade', 'Upgrade fixture', 'internal_quality',
           'completed', '{}'::jsonb, '{}'::jsonb, true, '${fixedAt}', '${fixedAt}');

        INSERT INTO appsea.research_runs
          (workspace_id, run_id, campaign_id, idempotency_key, mode, state, artifact_id,
           input_hash, artifact_snapshot, requested_at, started_at, completed_at)
        VALUES
          ('workspace-upgrade', 'run-upgrade', 'campaign-upgrade', 'upgrade-idempotency',
           'fixture', 'completed', 'artifact-upgrade', repeat('0', 64), '{}'::jsonb,
           '${fixedAt}', '${fixedAt}', '${fixedAt}'),
          ('workspace-upgrade', 'run-upgrade-previous', 'campaign-upgrade',
           'upgrade-idempotency-previous', 'fixture', 'completed', 'artifact-upgrade-previous',
           repeat('3', 64), '{}'::jsonb,
           '${fixedAt}', '${fixedAt}', '${fixedAt}');

        INSERT INTO appsea.opportunities
          (workspace_id, opportunity_id, slug, name, one_line, thesis, audience, first_wedge,
           complaint_count, synthetic, state, source_run_id, created_at, updated_at)
        VALUES
          ('workspace-upgrade', 'opportunity-upgrade', 'opportunity-upgrade', 'Upgrade',
           'Upgrade fixture', 'Upgrade fixture thesis', 'Test users', 'Test wedge', 1, true,
           'researched', 'run-upgrade', '${fixedAt}', '${fixedAt}');

        INSERT INTO appsea.opportunity_score_snapshots
          (workspace_id, score_snapshot_id, opportunity_id, scoring_version, score, factors,
           weights, input_hash, calculated_at)
        VALUES
          ('workspace-upgrade', 'score-upgrade', 'opportunity-upgrade', 'upgrade-v1', 50.0,
           '{}'::jsonb, '{}'::jsonb, repeat('1', 64), '${fixedAt}');

        INSERT INTO appsea.plan_package_versions
          (workspace_id, plan_package_id, opportunity_id, run_id, version, manifest_hash,
           fixture_files, readiness_state, approval_state, synthetic, generated_at)
        VALUES
          ('workspace-upgrade', 'plan-upgrade', 'opportunity-upgrade', 'run-upgrade',
           'upgrade-v1', repeat('2', 64), '[{"path":"README.md","content":"# Upgrade"}]'::jsonb,
           'ready', 'unreviewed', true, '${fixedAt}'),
          ('workspace-upgrade', 'plan-upgrade-previous', 'opportunity-upgrade',
           'run-upgrade-previous', 'upgrade-v0', repeat('4', 64),
           '[{"path":"README.md","content":"# Previous"}]'::jsonb,
           'ready', 'unreviewed', true, '${fixedAt}');

        UPDATE appsea.opportunities
           SET current_score_snapshot_id = 'score-upgrade',
               current_plan_package_id = 'plan-upgrade'
         WHERE workspace_id = 'workspace-upgrade'
           AND opportunity_id = 'opportunity-upgrade';
      `)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  })
}

async function fixtureInput(
  workspaceId = 'workspace-fixture-a',
  campaignId = 'campaign-fixture-a',
  runId = 'run-fixture-a',
  idempotencyKey = 'fixture-persistence-a',
  requestedAt = fixedAt
): Promise<FixturePersistenceInput> {
  const artifact = await buildFixtureResearchArtifact(fixedAt)
  const planPackage = generatePlanPackage(artifact, fixedAt)
  return fixturePersistenceInputSchema.parse({
    workspaceId,
    campaignId,
    runId,
    idempotencyKey,
    requestedAt,
    artifact,
    planPackage
  })
}

function durableWorkflowInput(
  workspaceId: string,
  campaignId: string,
  runId: string,
  rawIdempotencyKey: string,
  maxSourceItems = 10,
  requestedBy?: WorkflowActor
): FixtureResearchWorkflowInput {
  const hashMaterial = fixtureResearchWorkflowHashMaterialSchema.parse({
    workspaceId,
    campaignId,
    runId,
    idempotencyDigest: contentHash({
      endpoint: 'fixture-research',
      workflowType: 'fixtureResearchWorkflow',
      workflowVersion: 'fixture-research-v1',
      workspaceId,
      idempotencyKey: rawIdempotencyKey
    }),
    workflowVersion: 'fixture-research-v1',
    fixtureAt: fixedAt,
    budget: {
      currency: 'USD',
      maxSourceItems,
      maxCostMicros: 0,
      maxActivityAttempts: 3
    },
    ...(requestedBy ? { requestedBy } : {})
  })
  return fixtureResearchWorkflowInputSchema.parse({
    ...hashMaterial,
    inputHash: contentHash(hashMaterial)
  })
}

function durableWorkflowExecution(
  workflowId: string,
  temporalFirstExecutionRunId: string
): WorkflowExecutionMetadata {
  return {
    workflowId,
    temporalFirstExecutionRunId,
    workflowType: 'fixtureResearchWorkflow',
    workflowVersion: 'fixture-research-v1',
    taskQueue: 'appsea-research-v1'
  }
}

async function registerFixturePolicy(
  sourceId: string,
  policyVersion: string,
  reviewedAt: string,
  permittedPurposes: string[],
  contentHash: string
): Promise<void> {
  await servicePool.query(
    `SELECT appsea.register_fixture_source_policy(
       $1, $2, $3, $4, 'integration fixture', 0, false, false,
       ARRAY['Integration-only policy'], $5, $6::jsonb, $7, $5
     )`,
    [
      sourceId,
      `Fixture ${sourceId}`,
      policyVersion,
      permittedPurposes,
      reviewedAt,
      JSON.stringify({ sourceId, policyVersion, permittedPurposes }),
      contentHash
    ]
  )
}

let upgradeBackfillCounts: { opportunity_links: string; score_links: string; plan_links: string }
let upgradeProcessingStartedAt: string | null
let firstMigrationResult: Awaited<ReturnType<typeof migrateDatabase>>
let secondMigrationResult: Awaited<ReturnType<typeof migrateDatabase>>

describe.sequential('PostgreSQL fixture persistence lifecycle', () => {
  beforeAll(async () => {
    await resetDisposableDatabase()
    await migrateDatabase(migrationPool, { ...migrationOptions, throughVersion: '0001' })
    await seedVersionOneLineage()
    await migrateDatabase(migrationPool, migrationOptions)
    upgradeBackfillCounts = await withWorkspaceTransaction(
      servicePool,
      'workspace-upgrade',
      async (client) => {
        const result = await client.query<typeof upgradeBackfillCounts>(
          `SELECT
             (SELECT count(*)::text FROM appsea.research_run_opportunities
               WHERE workspace_id = 'workspace-upgrade') AS opportunity_links,
             (SELECT count(*)::text FROM appsea.research_run_score_snapshots
               WHERE workspace_id = 'workspace-upgrade') AS score_links,
             (SELECT count(*)::text FROM appsea.research_run_plan_packages
               WHERE workspace_id = 'workspace-upgrade') AS plan_links`
        )
        return result.rows[0]!
      },
      { readOnly: true }
    )
    upgradeProcessingStartedAt = await withWorkspaceTransaction(
      servicePool,
      'workspace-upgrade',
      async (client) => {
        const result = await client.query<{ processing_started_at: Date | string | null }>(
          `SELECT processing_started_at
             FROM appsea.deletion_tombstones
            WHERE workspace_id = 'workspace-upgrade'
              AND tombstone_id = 'tombstone-upgrade'`
        )
        const value = result.rows[0]?.processing_started_at
        return value instanceof Date ? value.toISOString() : (value ?? null)
      },
      { readOnly: true }
    )

    await resetDisposableDatabase()
    firstMigrationResult = await migrateDatabase(migrationPool, migrationOptions)
    secondMigrationResult = await migrateDatabase(migrationPool, migrationOptions)
  }, 30_000)

  afterAll(async () => {
    await Promise.all([servicePool.end(), maintenancePool.end(), migrationPool.end()])
  })

  it('applies an exact migration history and repairs a populated version-one upgrade', () => {
    expect(upgradeBackfillCounts).toEqual({
      opportunity_links: '2',
      score_links: '1',
      plan_links: '2'
    })
    expect(upgradeProcessingStartedAt).toBe(fixedAt)
    expect(firstMigrationResult.applied).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
      '0021',
      '0022',
      '0023',
      '0024',
      '0025',
      '0026',
      '0027',
      '0028',
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
      '0035',
      '0036',
      '0037',
      '0038',
      '0039',
      '0040',
      '0041',
      '0042',
      '0043',
      '0044',
      '0045',
      '0046',
      '0047',
      '0048',
      '0049',
      '0050',
      '0051',
      '0052',
      '0053',
      '0054',
      '0055',
      '0056',
      '0057',
      '0058',
      '0059',
      '0060',
      '0061',
      '0062',
      '0063',
      '0064',
      '0065',
      '0066',
      '0067',
      '0068',
      '0069',
      '0070',
      '0071',
      '0072',
      '0073',
      '0074',
      '0075'
    ])
    expect(secondMigrationResult.applied).toEqual([])
    expect(secondMigrationResult.alreadyApplied).toEqual([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
      '0011',
      '0012',
      '0013',
      '0014',
      '0015',
      '0016',
      '0017',
      '0018',
      '0019',
      '0020',
      '0021',
      '0022',
      '0023',
      '0024',
      '0025',
      '0026',
      '0027',
      '0028',
      '0029',
      '0030',
      '0031',
      '0032',
      '0033',
      '0034',
      '0035',
      '0036',
      '0037',
      '0038',
      '0039',
      '0040',
      '0041',
      '0042',
      '0043',
      '0044',
      '0045',
      '0046',
      '0047',
      '0048',
      '0049',
      '0050',
      '0051',
      '0052',
      '0053',
      '0054',
      '0055',
      '0056',
      '0057',
      '0058',
      '0059',
      '0060',
      '0061',
      '0062',
      '0063',
      '0064',
      '0065',
      '0066',
      '0067',
      '0068',
      '0069',
      '0070',
      '0071',
      '0072',
      '0073',
      '0074',
      '0075'
    ])
  })

  it('runs PostgreSQL 18 with a non-owner, non-bypass runtime role', async () => {
    const version = await servicePool.query<{ server_version_num: string }>(
      "SELECT current_setting('server_version_num') AS server_version_num"
    )
    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(180_000)

    const role = await servicePool.query<{
      current_role: string
      rolsuper: boolean
      rolbypassrls: boolean
      owns_tables: boolean
    }>(
      `SELECT current_user AS current_role,
              role.rolsuper,
              role.rolbypassrls,
              EXISTS (
                SELECT 1 FROM pg_class relation
                 WHERE relation.relnamespace = 'appsea'::regnamespace
                   AND relation.relowner = role.oid
              ) AS owns_tables
         FROM pg_roles role
        WHERE role.rolname = current_user`
    )
    expect(role.rows[0]).toEqual({
      current_role: 'appsea_service',
      rolsuper: false,
      rolbypassrls: false,
      owns_tables: false
    })
    await expect(servicePool.query('SET ROLE appsea_owner')).rejects.toMatchObject({
      code: '42501'
    })
    await expect(servicePool.query('SET ROLE appsea_maintenance')).rejects.toMatchObject({
      code: '42501'
    })
    const maintenanceRole = await maintenancePool.query<{
      current_role: string
      rolsuper: boolean
      rolbypassrls: boolean
      rolinherit: boolean
      rolreplication: boolean
      incoming_membership: boolean
      outgoing_membership: boolean
    }>(
      `SELECT current_user AS current_role,
              role.rolsuper,
              role.rolbypassrls,
              role.rolinherit,
              role.rolreplication,
              EXISTS (
                SELECT 1 FROM pg_auth_members membership
                 WHERE membership.roleid = role.oid
              ) AS incoming_membership,
              EXISTS (
                SELECT 1 FROM pg_auth_members membership
                 WHERE membership.member = role.oid
              ) AS outgoing_membership
         FROM pg_roles role
        WHERE role.rolname = current_user`
    )
    expect(maintenanceRole.rows[0]).toEqual({
      current_role: 'appsea_maintenance',
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolreplication: false,
      incoming_membership: false,
      outgoing_membership: false
    })
    await expect(
      servicePool.query('ALTER TABLE appsea.opportunities DISABLE ROW LEVEL SECURITY')
    ).rejects.toMatchObject({ code: '42501' })
    await expect(servicePool.query('TRUNCATE appsea.opportunities')).rejects.toMatchObject({
      code: '42501'
    })
    await expect(
      servicePool.query(
        `INSERT INTO appsea.sources
           (source_id, display_name, source_type, lifecycle_state, created_at, updated_at)
         VALUES ('fixture-forbidden', 'Forbidden', 'fixture', 'disabled_pending_review', $1, $1)`,
        [fixedAt]
      )
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      servicePool.query("UPDATE appsea.sources SET lifecycle_state = 'active' WHERE false")
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      servicePool.query('DELETE FROM appsea.audit_events WHERE false')
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      servicePool.query(
        'UPDATE appsea.evidence_records SET source_item_id = source_item_id WHERE false'
      )
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      servicePool.query('DELETE FROM appsea.source_collection_leases WHERE false')
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      servicePool.query(
        `INSERT INTO appsea.source_collection_leases
           (workspace_id, lease_id, source_id, policy_version, input_hash,
            observed_at, state, acquired_at, expires_at, updated_at)
         VALUES ('workspace-forbidden', 'lease:forbidden', 'source:forbidden', 'v1', $1,
                 $2, 'active', $2, $3, $2)`,
        ['a'.repeat(64), fixedAt, latestAt]
      )
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('serializes maintenance scheduler ownership and permits server-clock takeover', async () => {
    await expect(
      servicePool.query(
        `SELECT * FROM appsea.acquire_maintenance_scheduler_lease($1, $2, $3, $4)`,
        ['appsea-source-maintenance-v1', 'worker:service:blocked', 'token:service:blocked', 30]
      )
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      servicePool.query(`SELECT * FROM appsea.renew_maintenance_scheduler_lease($1, $2, $3, $4)`, [
        'appsea-source-maintenance-v1',
        'worker:service:blocked',
        'token:service:blocked',
        30
      ])
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      servicePool.query(`SELECT * FROM appsea.release_maintenance_scheduler_lease($1, $2, $3)`, [
        'appsea-source-maintenance-v1',
        'worker:service:blocked',
        'token:service:blocked'
      ])
    ).rejects.toMatchObject({ code: '42501' })
    const repository = new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool)
    const schedulerName = 'appsea-source-maintenance-v1'
    const firstOwner = 'worker:integration:one'
    const secondOwner = 'worker:integration:two'
    const firstToken = 'token:integration:one'
    const secondToken = 'token:integration:two'
    const [first, second] = await Promise.all([
      repository.acquire(schedulerName, firstOwner, firstToken, 30),
      repository.acquire(schedulerName, secondOwner, secondToken, 30)
    ])
    expect([first.acquired, second.acquired].filter(Boolean)).toHaveLength(1)
    const currentOwner = first.acquired ? firstOwner : secondOwner
    const otherOwner = first.acquired ? secondOwner : firstOwner
    const currentToken = first.acquired ? firstToken : secondToken
    const otherToken = first.acquired ? secondToken : firstToken

    const [sameOwnerFirst, sameOwnerSecond] = await Promise.all([
      repository.acquire(schedulerName, currentOwner, 'token:integration:same-owner-a', 30),
      repository.acquire(schedulerName, currentOwner, 'token:integration:same-owner-b', 30)
    ])
    expect(sameOwnerFirst.acquired).toBe(false)
    expect(sameOwnerSecond.acquired).toBe(false)

    await expect(repository.renew(schedulerName, otherOwner, otherToken, 30)).resolves.toEqual({
      renewed: false,
      leaseUntil: null
    })
    await expect(repository.release(schedulerName, otherOwner, otherToken)).resolves.toEqual({
      released: false
    })

    await withOwnerClient(async (client) => {
      await client.query(
        `UPDATE appsea.maintenance_scheduler_leases
            SET acquired_at = clock_timestamp() - interval '2 seconds',
                lease_until = clock_timestamp() - interval '1 second'
          WHERE scheduler_name = $1`,
        [schedulerName]
      )
    })
    await expect(
      repository.acquire(schedulerName, otherOwner, otherToken, 30)
    ).resolves.toMatchObject({
      acquired: true
    })
    await expect(repository.release(schedulerName, otherOwner, otherToken)).resolves.toEqual({
      released: true
    })
    await expect(
      servicePool.query('SELECT * FROM appsea.maintenance_scheduler_leases')
    ).rejects.toThrow()

    // The stale original owner cannot release the replacement lease.
    await expect(repository.release(schedulerName, currentOwner, currentToken)).resolves.toEqual({
      released: false
    })
    await expect(
      repository.acquire(schedulerName, currentOwner, 'token:integration:retry', 30)
    ).resolves.toMatchObject({ acquired: true })
    await expect(
      repository.release(schedulerName, currentOwner, 'token:integration:retry')
    ).resolves.toEqual({ released: true })
    await expect(
      maintenancePool.query('SELECT * FROM appsea.maintenance_scheduler_leases')
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('holds a service fence through commit and rejects the stale token after takeover', async () => {
    const leaseRepository = new PostgresMaintenanceSchedulerLeaseRepository(maintenancePool)
    const schedulerName = 'appsea-source-maintenance-v1'
    const firstOwner = 'worker:integration:fence-one'
    const firstToken = 'token:integration:fence-one'
    const secondOwner = 'worker:integration:fence-two'
    const secondToken = 'token:integration:fence-two'
    await expect(
      leaseRepository.acquire(schedulerName, firstOwner, firstToken, 30)
    ).resolves.toMatchObject({ acquired: true })

    const fencedClient = await servicePool.connect()
    let committed = false
    let replacementAcquired = false
    try {
      await fencedClient.query('BEGIN')
      await expect(
        fencedClient.query<{ asserted: boolean }>(
          `SELECT appsea.assert_maintenance_scheduler_lease($1, $2, $3) AS asserted`,
          [schedulerName, firstOwner, firstToken]
        )
      ).resolves.toMatchObject({ rows: [{ asserted: true }] })

      // A takeover-affecting owner update cannot pass the fenced row lock
      // until the service mutation transaction commits.
      const expireLease = withOwnerClient(async (client) => {
        await client.query(
          `UPDATE appsea.maintenance_scheduler_leases
              SET acquired_at = clock_timestamp() - interval '2 seconds',
                  lease_until = clock_timestamp() - interval '1 second'
            WHERE scheduler_name = $1`,
          [schedulerName]
        )
      })
      await expect(
        Promise.race([
          expireLease.then(() => 'updated'),
          new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 100))
        ])
      ).resolves.toBe('blocked')

      await fencedClient.query('COMMIT')
      committed = true
      await expireLease
      await expect(
        leaseRepository.acquire(schedulerName, secondOwner, secondToken, 30)
      ).resolves.toMatchObject({ acquired: true })
      replacementAcquired = true
      await expect(
        servicePool.query<{ asserted: boolean }>(
          `SELECT appsea.assert_maintenance_scheduler_lease($1, $2, $3) AS asserted`,
          [schedulerName, firstOwner, firstToken]
        )
      ).resolves.toMatchObject({ rows: [{ asserted: false }] })
    } finally {
      if (!committed) {
        await fencedClient.query('ROLLBACK').catch(() => undefined)
      }
      fencedClient.release()
      if (replacementAcquired) {
        await leaseRepository.release(schedulerName, secondOwner, secondToken)
      } else {
        await leaseRepository.release(schedulerName, firstOwner, firstToken)
      }
    }
  })

  it('persists bounded scheduler outcomes through the maintenance role only', async () => {
    await expect(
      servicePool.query(
        `SELECT * FROM appsea.record_maintenance_scheduler_run(
           $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
         )`,
        [
          'maintenance:run:service',
          'appsea-source-maintenance-v1',
          'worker:service:blocked',
          'succeeded',
          fixedAt,
          fixedAt,
          0,
          null,
          '{}'
        ]
      )
    ).rejects.toMatchObject({ code: '42501' })
    const repository = new PostgresMaintenanceSchedulerRunRepository(maintenancePool)
    const metric = {
      runId: 'maintenance:run:integration',
      schedulerName: 'appsea-source-maintenance-v1' as const,
      ownerId: 'worker:integration:metrics',
      state: 'succeeded' as const,
      startedAt: fixedAt,
      finishedAt: fixedAt,
      durationMs: 0,
      failureCode: null,
      counters: { sourceItems: 2, deletionTombstones: 1 }
    }
    await expect(repository.record(metric)).resolves.toEqual({ recorded: true })
    await expect(repository.record(metric)).resolves.toEqual({ recorded: false })
    await expect(repository.listRecent('appsea-source-maintenance-v1', 10)).resolves.toEqual([
      metric
    ])
    await expect(repository.purge({ before: '2026-07-11T00:00:00.000Z', limit: 10 })).resolves.toBe(
      1
    )
    await expect(repository.listRecent('appsea-source-maintenance-v1', 10)).resolves.toEqual([])
    await expect(
      servicePool.query('SELECT * FROM appsea.maintenance_scheduler_runs')
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      maintenancePool.query('SELECT * FROM appsea.maintenance_scheduler_runs')
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('aggregates the immutable cost ledger inside authenticated workspace RLS', async () => {
    const workspaceId = 'workspace-cost-summary'
    const userId = 'user-cost-summary'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, 'cost-summary@example.test', 'Cost Summary', repeat('x', 64), $2, $2)`,
        [userId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES ($1, 'cost-summary-workspace', 'Cost Summary', 'private', true, 'active', $2, $2)`,
        [workspaceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'viewer', $3, $3)`,
        [workspaceId, userId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.cost_ledger_entries
           (workspace_id, cost_entry_id, cost_type, quantity, unit, amount, currency, estimate, recorded_at)
         VALUES
           ($1, 'cost:integration:actual', 'source_request', 1, 'request', 0.500000, 'USD', false, $2),
           ($1, 'cost:integration:estimate', 'source_request', 1, 'request', 0.250000, 'USD', true, $2),
           ($1, 'cost:integration:eur', 'licensed_feed', 1, 'request', 0.125000, 'EUR', false, $2)`,
        [workspaceId, fixedAt]
      )
    })

    try {
      const costRepository = new PostgresWorkspaceCostRepository(servicePool)
      const costAlertRepository = new PostgresWorkspaceCostAlertRepository(maintenancePool)
      await expect(
        costRepository.readForUser(userId, workspaceId, {
          from: fixedAt,
          to: laterAt
        })
      ).resolves.toMatchObject({
        workspaceId,
        entryCount: 3,
        currencies: [
          expect.objectContaining({ currency: 'EUR', totalCostMicros: '125000' }),
          expect.objectContaining({ currency: 'USD', totalCostMicros: '750000' })
        ]
      })
      await expect(
        costAlertRepository.listAlertObservations(workspaceId, fixedAt, laterAt, 16)
      ).resolves.toEqual([
        {
          currency: 'EUR',
          entryCount: 1,
          totalCostMicros: '125000',
          estimatedCostMicros: '0',
          actualCostMicros: '125000'
        },
        {
          currency: 'USD',
          entryCount: 2,
          totalCostMicros: '750000',
          estimatedCostMicros: '250000',
          actualCostMicros: '500000'
        }
      ])
      await expect(
        maintenancePool.query('SELECT * FROM appsea.cost_ledger_entries WHERE workspace_id = $1', [
          workspaceId
        ])
      ).rejects.toMatchObject({ code: '42501' })
      const indexes = await servicePool.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = 'appsea' AND tablename = 'cost_ledger_entries'`
      )
      expect(indexes.rows.map((row) => row.indexname)).toContain(
        'cost_ledger_entries_workspace_recorded_idx'
      )
    } finally {
      await withOwnerClient(async (client) => {
        await client.query('DELETE FROM appsea.cost_ledger_entries WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query('DELETE FROM appsea.workspace_memberships WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
        await client.query('DELETE FROM appsea.users WHERE user_id = $1', [userId])
      })
    }
  })

  it('surfaces and maintenance-resolves a settled quota without a production result', async () => {
    const workspaceId = 'workspace-quota-reconcile'
    const userId = 'user-quota-reconcile'
    const sourceId = 'source-quota-reconcile'
    const policyVersion = 'quota-v1'
    const reservationId = 'quota:reconcile:one'
    const runId = 'run:quota:missing'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, 'quota-reconcile@example.test', 'Quota Reconcile', repeat('x', 64), $2, $2)`,
        [userId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES ($1, 'quota-reconcile-workspace', 'Quota Reconcile', 'private', false, 'active', $2, $2)`,
        [workspaceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'viewer', $3, $3)`,
        [workspaceId, userId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.sources
           (source_id, display_name, source_type, lifecycle_state, current_policy_version,
            created_at, updated_at)
         VALUES ($1, 'Quota Reconcile Source', 'api', 'active', NULL, $2, $2)`,
        [sourceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.source_policy_versions
           (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
            access_method, retention_days, deletion_required, attribution_required,
            display_mode, coverage_notes, reviewed_at, policy_payload, content_hash, created_at)
         VALUES ($1, $2, 'approved', ARRAY['opportunity-research'], 'allowed', 'test route',
                 30, false, false, 'metadata-only', ARRAY['test-only'], $3,
                 '{"quota":{"requestsPerMinute":10,"maxRecordsPerRun":10}}'::jsonb,
                 $4, $3)`,
        [sourceId, policyVersion, fixedAt, 'a'.repeat(64)]
      )
      await client.query(
        `UPDATE appsea.sources
            SET current_policy_version = $2, updated_at = $3
          WHERE source_id = $1`,
        [sourceId, policyVersion, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.source_quota_windows
           (source_id, policy_version, window_started_at, request_count, record_count, updated_at)
         VALUES ($1, $2, $3, 1, 2, $3)`,
        [sourceId, policyVersion, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.source_quota_reservations
           (workspace_id, reservation_id, source_id, policy_version, run_id, idempotency_key,
            window_started_at, requested_records, requested_cost_micros, actual_records,
            actual_cost_micros, status, reserved_at, expires_at, settled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 2, 15, 2, 15, 'committed', $7, $8, $8)`,
        [
          workspaceId,
          reservationId,
          sourceId,
          policyVersion,
          runId,
          'b'.repeat(64),
          fixedAt,
          laterAt
        ]
      )
    })

    try {
      const quotaRepository = new PostgresSourceQuotaRepository(servicePool)
      await expect(
        quotaRepository.listReconciliationCasesForUser(userId, workspaceId, { limit: 10 })
      ).resolves.toMatchObject([
        {
          reservationId,
          runId,
          state: 'open',
          actualCostMicros: 15
        }
      ])
      await expect(
        quotaRepository.resolveReconciliationCase({
          workspaceId,
          reservationId,
          resolutionCode: 'voided_no_result',
          linkedRunId: null,
          actorId: 'operator:integration'
        })
      ).rejects.toMatchObject({ code: '42501' })

      const maintenanceRepository = new PostgresSourceQuotaRepository(maintenancePool)
      await expect(
        maintenanceRepository.resolveReconciliationCase({
          workspaceId,
          reservationId,
          resolutionCode: 'voided_no_result',
          linkedRunId: null,
          actorId: 'operator:integration'
        })
      ).resolves.toMatchObject({ state: 'resolved', resolutionActorId: 'operator:integration' })
      await expect(
        quotaRepository.listReconciliationCasesForUser(userId, workspaceId, { limit: 10 })
      ).resolves.toEqual([])
      await expect(
        servicePool.query('SELECT * FROM appsea.source_quota_reconciliation_cases')
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        maintenancePool.query('SELECT * FROM appsea.source_quota_reconciliation_cases')
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await withOwnerClient(async (client) => {
        await client.query(
          'DELETE FROM appsea.source_quota_reconciliation_cases WHERE workspace_id = $1',
          [workspaceId]
        )
        await client.query('DELETE FROM appsea.source_quota_reservations WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query(
          'DELETE FROM appsea.source_quota_windows WHERE source_id = $1 AND policy_version = $2',
          [sourceId, policyVersion]
        )
        await client.query('DELETE FROM appsea.workspace_memberships WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query(
          `UPDATE appsea.sources
              SET lifecycle_state = 'retired', current_policy_version = NULL
            WHERE source_id = $1`,
          [sourceId]
        )
        await client.query('DELETE FROM appsea.source_policy_versions WHERE source_id = $1', [
          sourceId
        ])
        await client.query('DELETE FROM appsea.sources WHERE source_id = $1', [sourceId])
        await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
        await client.query('DELETE FROM appsea.users WHERE user_id = $1', [userId])
      })
    }
  })

  it('serializes production workflow admission and preserves replay semantics', async () => {
    const workspaceId = 'workspace-admission'
    const userId = 'user-admission'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, 'admission@example.test', 'Admission Owner', repeat('x', 64), $2, $2)`,
        [userId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES ($1, 'admission-workspace', 'Admission Workspace', 'private', false, 'active', $2, $2)`,
        [workspaceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'owner', $3, $3)`,
        [workspaceId, userId, fixedAt]
      )
    })
    const admissionRepository = new PostgresProductionWorkflowAdmissionRepository(servicePool)
    const input = (digest: string, hash: string) => ({
      workspaceId,
      userId,
      idempotencyDigest: digest,
      inputHash: hash
    })
    try {
      const first = await admissionRepository.admitForUser(input('a'.repeat(64), 'b'.repeat(64)))
      expect(first.replayed).toBe(false)
      await expect(
        admissionRepository.admitForUser(input('a'.repeat(64), 'b'.repeat(64)))
      ).resolves.toMatchObject({ replayed: true })
      const second = await admissionRepository.admitForUser(input('c'.repeat(64), 'd'.repeat(64)))
      expect(second.replayed).toBe(false)
      await expect(
        admissionRepository.admitForUser(input('e'.repeat(64), 'f'.repeat(64)))
      ).rejects.toBeInstanceOf(ProductionWorkflowConcurrencyLimitError)

      await admissionRepository.consume(workspaceId, 'a'.repeat(64), 'b'.repeat(64))
      await admissionRepository.consume(workspaceId, 'c'.repeat(64), 'd'.repeat(64))
      for (const [digest, hash] of [
        ['e', 'f'],
        ['0', '1'],
        ['2', '3']
      ] as const) {
        const admitted = await admissionRepository.admitForUser(
          input(digest.repeat(64), hash.repeat(64))
        )
        expect(admitted.replayed).toBe(false)
        await admissionRepository.consume(workspaceId, digest.repeat(64), hash.repeat(64))
      }
      await expect(
        admissionRepository.admitForUser(input('4'.repeat(64), '5'.repeat(64)))
      ).rejects.toBeInstanceOf(ProductionWorkflowRateLimitError)
    } finally {
      await withOwnerClient(async (client) => {
        await client.query(
          'DELETE FROM appsea.production_collection_workflow_admissions WHERE workspace_id = $1',
          [workspaceId]
        )
        await client.query(
          'DELETE FROM appsea.production_collection_workflow_start_buckets WHERE workspace_id = $1',
          [workspaceId]
        )
        await client.query('DELETE FROM appsea.workspace_memberships WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
        await client.query('DELETE FROM appsea.users WHERE user_id = $1', [userId])
      })
    }
  })

  it('requires the worker service principal for direct production admission', async () => {
    const workspaceId = 'workspace-service-admission'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES ($1, 'service-admission-workspace', 'Service Admission Workspace', 'private', false, 'active', $2, $2)`,
        [workspaceId, fixedAt]
      )
    })
    const admissionRepository = new PostgresProductionWorkflowAdmissionRepository(servicePool)
    try {
      await expect(
        admissionRepository.admitForService({
          workspaceId,
          idempotencyDigest: 'a'.repeat(64),
          inputHash: 'b'.repeat(64)
        })
      ).resolves.toMatchObject({ decision: 'admitted', replayed: false })
      await expect(
        admissionRepository.consumeForService(workspaceId, 'a'.repeat(64), 'b'.repeat(64))
      ).resolves.toBe(true)
      await expect(
        admissionRepository.admitForService({
          workspaceId,
          idempotencyDigest: 'a'.repeat(64),
          inputHash: 'c'.repeat(64)
        })
      ).rejects.toBeInstanceOf(ProductionWorkflowAdmissionConflictError)
    } finally {
      await withOwnerClient(async (client) => {
        await client.query(
          'DELETE FROM appsea.production_collection_workflow_admissions WHERE workspace_id = $1',
          [workspaceId]
        )
        await client.query(
          'DELETE FROM appsea.production_collection_workflow_start_buckets WHERE workspace_id = $1',
          [workspaceId]
        )
        await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
      })
    }
  })

  it('binds source collection leases to policy review and preserves replay timestamps', async () => {
    const workspaceId = 'workspace-lease'
    const sourceId = 'source-lease-test'
    const policyVersion = 'lease-v1'
    const policyHash = 'a'.repeat(64)
    const observedAt = '2026-07-10T00:00:00.000Z'
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES ($1, 'lease-workspace', 'Lease Workspace', 'private', false, 'active', $2, $2)`,
        [workspaceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.sources
           (source_id, display_name, source_type, lifecycle_state, current_policy_version,
            created_at, updated_at)
         VALUES ($1, 'Lease Source', 'api', 'disabled_pending_review', NULL, $2, $2)`,
        [sourceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.source_policy_versions
           (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
            access_method, retention_days, deletion_required, attribution_required,
            display_mode, coverage_notes, policy_document_ref, reviewed_at, expires_at,
            policy_payload, content_hash, created_at)
         VALUES ($1, $2, 'approved', ARRAY['opportunity-research'], 'allowed', 'test route',
                 30, true, true, 'excerpt', ARRAY['fixture-backed policy'],
                 'https://example.com/lease-policy', $3, NULL, '{}'::jsonb, $4, $3)`,
        [sourceId, policyVersion, fixedAt, policyHash]
      )
      await client.query(
        `INSERT INTO appsea.source_policy_reviews
           (review_id, source_id, policy_version, decision, reviewer,
            reviewer_identity, reviewer_role, independence_attested,
            approval_reference, notes, content_hash, reviewed_at, recorded_at)
         VALUES ('review:lease:test', $1, $2, 'approved', 'integration-test',
                 'integration-test', 'independent_operator', true,
                 'approval:lease:test', ARRAY['test-only'], $3, $4, $4)`,
        [sourceId, policyVersion, policyHash, fixedAt]
      )
      await client.query(
        `UPDATE appsea.sources
            SET lifecycle_state = 'active', current_policy_version = $2, updated_at = $3
          WHERE source_id = $1`,
        [sourceId, policyVersion, fixedAt]
      )
    })
    const leaseRepository = new PostgresSourceCollectionLeaseRepository(servicePool)
    const input = {
      workspaceId,
      leaseId: 'lease:source-collection:test',
      sourceId,
      policyVersion,
      inputHash: 'b'.repeat(64),
      observedAt,
      expiresAt
    }
    try {
      await expect(leaseRepository.acquire(input)).resolves.toMatchObject({
        decision: 'acquired',
        replayed: false,
        observedAt
      })
      await expect(leaseRepository.acquire(input)).resolves.toMatchObject({
        decision: 'replayed',
        replayed: true,
        observedAt
      })
      await expect(
        leaseRepository.assertActive(workspaceId, input.leaseId, input.inputHash)
      ).resolves.toBe(true)
      await expect(
        leaseRepository.release(workspaceId, input.leaseId, input.inputHash)
      ).resolves.toBe(true)
      await expect(
        leaseRepository.assertActive(workspaceId, input.leaseId, input.inputHash)
      ).resolves.toBe(false)
    } finally {
      await withOwnerClient(async (client) => {
        await client.query('DELETE FROM appsea.source_collection_leases WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query('DELETE FROM appsea.source_policy_reviews WHERE source_id = $1', [
          sourceId
        ])
        await client.query(
          `UPDATE appsea.sources
              SET current_policy_version = NULL, lifecycle_state = 'retired'
            WHERE source_id = $1`,
          [sourceId]
        )
        await client.query('DELETE FROM appsea.source_policy_versions WHERE source_id = $1', [
          sourceId
        ])
        await client.query('DELETE FROM appsea.sources WHERE source_id = $1', [sourceId])
        await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
      })
    }
  })

  it('finalizes a complete identifier snapshot and enqueues only missing active source items', async () => {
    const workspaceId = 'workspace-snapshot'
    const userId = 'user-snapshot-editor'
    const sourceId = 'source-snapshot-test'
    const policyVersion = 'snapshot-v1'
    const policyHash = 'c'.repeat(64)
    const reconciliationId = 'reconciliation:source:0123456789abcdef0123456789abcdef'
    const input = {
      workspaceId,
      reconciliationId,
      sourceId,
      policyVersion,
      idempotencyKey: 'd'.repeat(64),
      pageSize: 2,
      maxRecords: 10,
      requestedAt: fixedAt
    }
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES ($1, 'snapshot-workspace', 'Snapshot Workspace', 'private', false, 'active', $2, $2)`,
        [workspaceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.sources
           (source_id, display_name, source_type, lifecycle_state, current_policy_version,
            created_at, updated_at)
         VALUES ($1, 'Snapshot Source', 'api', 'disabled_pending_review', NULL, $2, $2)`,
        [sourceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.source_policy_versions
           (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
            access_method, retention_days, deletion_required, attribution_required,
            display_mode, coverage_notes, policy_document_ref, reviewed_at, expires_at,
            policy_payload, content_hash, created_at)
         VALUES ($1, $2, 'approved', ARRAY['deletion-reconciliation'], 'allowed', 'test route',
                 30, true, true, 'excerpt', ARRAY['identifier-only integration policy'],
                 'https://example.com/snapshot-policy', $3, NULL, '{}'::jsonb, $4, $3)`,
        [sourceId, policyVersion, fixedAt, policyHash]
      )
      await client.query(
        `INSERT INTO appsea.source_policy_reviews
           (review_id, source_id, policy_version, decision, reviewer,
            reviewer_identity, reviewer_role, independence_attested,
            approval_reference, notes, content_hash, reviewed_at, recorded_at)
         VALUES ('review:snapshot:test', $1, $2, 'approved', 'integration-test',
                 'integration-test', 'independent_operator', true,
                 'approval:snapshot:test', ARRAY['test-only'], $3, $4, $4)`,
        [sourceId, policyVersion, policyHash, fixedAt]
      )
      await client.query(
        `UPDATE appsea.sources
            SET lifecycle_state = 'active', current_policy_version = $2, updated_at = $3
          WHERE source_id = $1`,
        [sourceId, policyVersion, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.source_items
           (workspace_id, source_item_id, source_id, source_policy_version,
            source_record_id, canonical_locator, query_route, content_hash,
            captured_at, synthetic, collection_purpose, requested_display_mode, created_at)
         VALUES ($1, 'source-item-snapshot-missing', $2, $3, 'record-missing',
                 'https://example.com/record-missing', 'full-snapshot', repeat('e', 64),
                 $4, false, 'deletion-reconciliation', 'excerpt', $4),
                ($1, 'source-item-snapshot-present', $2, $3, 'record-present',
                 'https://example.com/record-present', 'full-snapshot', repeat('f', 64),
                 $4, false, 'deletion-reconciliation', 'excerpt', $4)`,
        [workspaceId, sourceId, policyVersion, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, 'snapshot-editor@example.test', 'Snapshot Editor', repeat('x', 64), $2, $2)`,
        [userId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'editor', $3, $3)`,
        [workspaceId, userId, fixedAt]
      )
    })

    const repository = new PostgresSourceSnapshotReconciliationRepository(servicePool)
    const leaseRepository = new PostgresSourceCollectionLeaseRepository(servicePool)
    try {
      await expect(repository.enqueue(input)).resolves.toMatchObject({ state: 'queued' })
      const claim = await repository.claimById(workspaceId, reconciliationId)
      expect(claim).toMatchObject({ state: 'running', observedAt: expect.any(String) })
      if (!claim) throw new Error('snapshot job was not claimed')
      const leaseId = `lease:source-snapshot:${reconciliationId}:attempt:${claim.attemptCount}`
      await expect(
        leaseRepository.acquire({
          workspaceId,
          leaseId,
          sourceId,
          policyVersion,
          inputHash: claim.inputHash,
          observedAt: claim.observedAt!
        })
      ).resolves.toMatchObject({ decision: 'acquired' })
      await repository.appendPage(workspaceId, reconciliationId, claim.claimToken, {
        offset: 0,
        pageSize: 2,
        sourceRecordCount: 1,
        sourceRecordIds: ['record-present'],
        shortPage: true,
        warnings: []
      })
      const finished = await repository.finish({
        workspaceId,
        reconciliationId,
        claimToken: claim.claimToken,
        fullSnapshot: true,
        coverageGaps: [],
        warnings: [],
        lease: { leaseId, inputHash: claim.inputHash }
      })
      expect(finished).toMatchObject({ state: 'completed', deletionCount: 1 })

      const userInput = {
        ...input,
        reconciliationId: 'reconciliation:source:fedcba9876543210fedcba9876543210',
        idempotencyKey: 'e'.repeat(64)
      }
      await expect(repository.enqueueForUser(userInput, userId)).resolves.toMatchObject({
        state: 'queued'
      })
      await expect(repository.enqueueForUser(userInput, userId)).resolves.toMatchObject({
        state: 'queued'
      })
      const tombstone = await withWorkspaceTransaction(
        servicePool,
        workspaceId,
        (client) =>
          client.query<{ count: string }>(
            `SELECT count(*)::text AS count
               FROM appsea.deletion_tombstones
              WHERE workspace_id = $1 AND source_id = $2 AND source_record_id = 'record-missing'`,
            [workspaceId, sourceId]
          ),
        { readOnly: true }
      )
      expect(tombstone.rows[0]?.count).toBe('1')
    } finally {
      await withOwnerClient(async (client) => {
        await client.query('DELETE FROM appsea.deletion_tombstones WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query(
          'DELETE FROM appsea.source_snapshot_reconciliation_jobs WHERE workspace_id = $1',
          [workspaceId]
        )
        await client.query('DELETE FROM appsea.source_collection_leases WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query('DELETE FROM appsea.source_items WHERE workspace_id = $1', [workspaceId])
        await client.query('DELETE FROM appsea.workspace_memberships WHERE workspace_id = $1', [
          workspaceId
        ])
        await client.query('DELETE FROM appsea.users WHERE user_id = $1', [userId])
        await client.query('DELETE FROM appsea.source_policy_reviews WHERE source_id = $1', [
          sourceId
        ])
        await client.query(
          `UPDATE appsea.sources
              SET lifecycle_state = 'retired', current_policy_version = NULL
            WHERE source_id = $1`,
          [sourceId]
        )
        await client.query('DELETE FROM appsea.source_policy_versions WHERE source_id = $1', [
          sourceId
        ])
        await client.query('DELETE FROM appsea.sources WHERE source_id = $1', [sourceId])
        await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
      })
    }
  })

  it('enumerates active workspaces only through the maintenance function', async () => {
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES
           ('maintenance-active', 'maintenance-active', 'Maintenance active', 'private', true,
            'active', $1, $1),
           ('maintenance-suspended', 'maintenance-suspended', 'Maintenance suspended', 'private', true,
            'suspended', $1, $1)`,
        [fixedAt]
      )
    })

    const directRead = await servicePool.query<{ workspace_id: string }>(
      `SELECT workspace_id
         FROM appsea.workspaces
        ORDER BY workspace_id`
    )
    expect(directRead.rows).toEqual([])

    const maintenanceRead = await servicePool.query<{ workspace_id: string }>(
      `SELECT workspace_id
         FROM appsea.list_active_workspaces_for_maintenance()`
    )
    expect(maintenanceRead.rows).toEqual([{ workspace_id: 'maintenance-active' }])

    await withOwnerClient((client) =>
      client.query(
        `DELETE FROM appsea.workspaces
          WHERE workspace_id IN ('maintenance-active', 'maintenance-suspended')`
      )
    )
  })

  it('stores hashed credentials and authorizes private workspace reads', async () => {
    const email = `auth-${Date.now()}@example.test`
    const password = 'a deliberately long integration password'
    const created = await authRepository.signUp({
      email,
      password,
      displayName: 'Integration User',
      workspaceName: 'Private Integration Workspace'
    })
    const workspace = created.session.workspaces[0]
    expect(workspace?.visibility).toBe('private')
    expect(created.token).not.toContain(password)
    const stored = await withOwnerClient((client) =>
      client.query<{ password_hash: string }>(
        'SELECT password_hash FROM appsea.users WHERE user_id = $1',
        [created.session.user.userId]
      )
    )
    expect(stored.rows[0]?.password_hash).toMatch(/^scrypt\$/)
    expect(stored.rows[0]?.password_hash).not.toContain(password)
    await expect(
      authRepository.signIn({ email, password: 'incorrect but also long' })
    ).rejects.toBeInstanceOf(AuthenticationError)
    const read = await authRepository.readSession(created.token)
    expect(read?.user.userId).toBe(created.session.user.userId)
    expect(read?.workspaces[0]?.workspaceId).toBe(workspace?.workspaceId)
    const secondSession = await authRepository.signIn({ email, password })
    const activeSessions = await authRepository.listActiveSessions(created.token)
    expect(activeSessions.map((session) => session.current)).toEqual([true, false])
    expect(activeSessions.map((session) => session.id)).toContain(secondSession.session.sessionId)
    await authRepository.revokeSessionById(created.token, secondSession.session.sessionId)
    await expect(authRepository.readSession(secondSession.token)).resolves.toBeNull()
    await expect(
      authRepository.revokeSessionById(created.token, created.session.sessionId)
    ).rejects.toBeInstanceOf(AuthSessionConflictError)
    await expect(authRepository.hasRecentReauthentication(created.token)).resolves.toBe(true)
    await expect(
      authRepository.reauthenticateSession(created.token, { password: 'incorrect but also long' })
    ).rejects.toBeInstanceOf(AuthenticationError)
    await authRepository.reauthenticateSession(created.token, { password })
    await expect(authRepository.hasRecentReauthentication(created.token)).resolves.toBe(true)
    await authRepository.revokeSession(created.token)
    await expect(authRepository.readSession(created.token)).resolves.toBeNull()

    await withOwnerClient(async (client) => {
      await client.query('DELETE FROM appsea.users WHERE user_id = $1', [
        created.session.user.userId
      ])
    })
  })

  it('keeps opportunity seed content immutable and requires owner approval', async () => {
    const created = await authRepository.signUp({
      email: `seed-review-${Date.now()}@example.test`,
      password: 'a deliberately long seed review password',
      displayName: 'Seed Review Owner',
      workspaceName: 'Seed Review Workspace'
    })
    const workspace = created.session.workspaces[0]
    if (!workspace) throw new Error('seed review workspace was not created')
    const seed = {
      id: 'opportunity:seed-review',
      slug: 'seed-review-opportunity',
      name: 'Seed Review Opportunity',
      oneLine: 'A reviewed opportunity seed.',
      thesis: 'A human-reviewed thesis kept separate from complaint evidence.',
      audience: 'Research operators',
      firstWedge: 'Evidence inspection',
      tags: ['integration'],
      competitors: [],
      contraryEvidence: ['Pricing still needs validation.'],
      scoreFactors: {
        complaintVolume: 20,
        painSeverity: 30,
        recurrence: 20,
        willingnessToPay: 10,
        competitiveGap: 20,
        buildFeasibility: 40,
        evidenceQuality: 50,
        contraryEvidencePenalty: 30
      },
      planFiles: ['README.md']
    }
    try {
      const createdReview = await seedReviewRepository.create(
        created.session.user.userId,
        workspace.workspaceId,
        { seedReviewId: 'seed-review:integration', seedVersion: 'seed-v1', seed }
      )
      expect(createdReview.reviewState).toBe('unreviewed')
      expect(createdReview.contentHash).toBe(contentHash(seed))

      const reviewed = await seedReviewRepository.updateApproval(
        created.session.user.userId,
        workspace.workspaceId,
        createdReview.seedReviewId,
        { action: 'reviewed' }
      )
      expect(reviewed.reviewState).toBe('reviewed')
      const approved = await seedReviewRepository.updateApproval(
        created.session.user.userId,
        workspace.workspaceId,
        createdReview.seedReviewId,
        { action: 'approved' }
      )
      expect(approved.reviewState).toBe('approved')
      await expect(
        seedReviewRepository.readApprovedForUser(
          created.session.user.userId,
          workspace.workspaceId,
          createdReview.seedReviewId
        )
      ).resolves.toMatchObject({ reviewState: 'approved', contentHash: contentHash(seed) })

      await expect(
        withWorkspaceTransaction(servicePool, workspace.workspaceId, async (client) => {
          await client.query(
            `UPDATE appsea.opportunity_seed_reviews
                SET seed_payload = '{}'::jsonb
              WHERE workspace_id = $1 AND seed_review_id = $2`,
            [workspace.workspaceId, createdReview.seedReviewId]
          )
        })
      ).rejects.toMatchObject({ code: '42501' })

      await expect(
        withAuthenticatedWorkspaceTransaction(
          servicePool,
          created.session.user.userId,
          workspace.workspaceId,
          async (client) => {
            await client.query(
              `UPDATE appsea.opportunity_seed_reviews
                SET review_state = 'reviewed'
              WHERE workspace_id = $1 AND seed_review_id = $2`,
              [workspace.workspaceId, createdReview.seedReviewId]
            )
          }
        )
      ).rejects.toMatchObject({ code: '23514' })

      await expect(
        withAuthenticatedWorkspaceTransaction(
          servicePool,
          created.session.user.userId,
          workspace.workspaceId,
          async (client) => {
            await client.query(
              `UPDATE appsea.opportunity_seed_reviews
                  SET approved_by = $3
                WHERE workspace_id = $1 AND seed_review_id = $2`,
              [workspace.workspaceId, createdReview.seedReviewId, created.session.user.userId]
            )
          }
        )
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await withOwnerClient(async (client) => {
        await client.query('DELETE FROM appsea.opportunity_seed_reviews WHERE workspace_id = $1', [
          workspace.workspaceId
        ])
        await client.query('DELETE FROM appsea.users WHERE user_id = $1', [
          created.session.user.userId
        ])
      })
    }
  })

  it('keeps workspace member administration owner-scoped and preserves an owner', async () => {
    const email = `members-${Date.now()}@example.test`
    const created = await authRepository.signUp({
      email,
      password: 'a deliberately long members password',
      displayName: 'Membership Owner',
      workspaceName: 'Membership Workspace'
    })
    const workspace = created.session.workspaces[0]
    if (!workspace) throw new Error('signup did not create a workspace')
    const editorId = 'user:membership-editor'
    const viewerId = 'user:membership-viewer'
    const coOwnerId = 'user:membership-co-owner'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES
           ($1, 'membership-editor@example.test', 'Membership Editor', repeat('x', 64), $3, $3),
           ($2, 'membership-viewer@example.test', 'Membership Viewer', repeat('x', 64), $3, $3),
           ($4, 'membership-co-owner@example.test', 'Membership Co-owner', repeat('x', 64), $3, $3)`,
        [editorId, viewerId, latestAt, coOwnerId]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES
           ($1, $2, 'editor', $3, $3),
           ($1, $4, 'viewer', $3, $3),
           ($1, $5, 'owner', $3, $3)`,
        [workspace.workspaceId, editorId, latestAt, viewerId, coOwnerId]
      )
    })

    const members = await authRepository.listWorkspaceMembers(
      created.session.user.userId,
      workspace.workspaceId
    )
    expect(members.map((member) => member.role).sort()).toEqual([
      'editor',
      'owner',
      'owner',
      'viewer'
    ])
    await expect(
      withAuthenticatedWorkspaceTransaction(
        servicePool,
        viewerId,
        workspace.workspaceId,
        (client) =>
          client.query(
            `UPDATE appsea.workspace_memberships
                SET role = 'owner'
              WHERE workspace_id = $1 AND user_id = $2`,
            [workspace.workspaceId, editorId]
          )
      )
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      withAuthenticatedWorkspaceTransaction(
        servicePool,
        created.session.user.userId,
        workspace.workspaceId,
        (client) =>
          client.query(
            `UPDATE appsea.workspace_memberships
                SET role = 'viewer'
              WHERE workspace_id = $1 AND role = 'owner'`,
            [workspace.workspaceId]
          )
      )
    ).rejects.toMatchObject({ code: '23514' })
    await withOwnerClient((client) =>
      client.query(
        `DELETE FROM appsea.workspace_memberships
          WHERE workspace_id = $1 AND user_id = $2`,
        [workspace.workspaceId, coOwnerId]
      )
    )
    await expect(
      authRepository.listWorkspaceMembers(viewerId, workspace.workspaceId)
    ).rejects.toBeInstanceOf(WorkspaceMembershipManagementError)
    await expect(
      authRepository.updateWorkspaceMemberRole(viewerId, workspace.workspaceId, editorId, {
        role: 'viewer'
      })
    ).rejects.toBeInstanceOf(WorkspaceMembershipManagementError)

    const updated = await authRepository.updateWorkspaceMemberRole(
      created.session.user.userId,
      workspace.workspaceId,
      editorId,
      { role: 'viewer' }
    )
    expect(updated.role).toBe('viewer')
    await authRepository.removeWorkspaceMember(
      created.session.user.userId,
      workspace.workspaceId,
      viewerId
    )
    await expect(
      authRepository.updateWorkspaceMemberRole(
        created.session.user.userId,
        workspace.workspaceId,
        created.session.user.userId,
        { role: 'viewer' }
      )
    ).rejects.toBeInstanceOf(WorkspaceMembershipConflictError)

    const receipts = await withWorkspaceTransaction(
      servicePool,
      workspace.workspaceId,
      async (client) => {
        const result = await client.query<{ audits: string; outbox: string }>(
          `SELECT
             (SELECT count(*)::text FROM appsea.audit_events
               WHERE workspace_id = $1 AND action LIKE 'workspace.membership.%') AS audits,
             (SELECT count(*)::text FROM appsea.outbox_events
               WHERE workspace_id = $1 AND event_type LIKE 'workspace.membership.%') AS outbox`,
          [workspace.workspaceId]
        )
        return result.rows[0]
      },
      { readOnly: true }
    )
    expect(receipts).toEqual({ audits: '3', outbox: '3' })

    await withOwnerClient((client) =>
      client.query('DELETE FROM appsea.users WHERE user_id = $1', [created.session.user.userId])
    )
    await withOwnerClient((client) =>
      client.query('DELETE FROM appsea.users WHERE user_id IN ($1, $2, $3)', [
        editorId,
        viewerId,
        coOwnerId
      ])
    )
  })

  it('forces the workspace policy on every workspace-scoped table', async () => {
    const violations = await servicePool.query<{ table_name: string }>(
      `SELECT relation.relname AS table_name
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'appsea'
          AND relation.relkind = 'r'
          AND EXISTS (
            SELECT 1
              FROM information_schema.columns column_definition
             WHERE column_definition.table_schema = 'appsea'
               AND column_definition.table_name = relation.relname
               AND column_definition.column_name = 'workspace_id'
          )
          AND (
            NOT relation.relrowsecurity
            OR NOT relation.relforcerowsecurity
            OR NOT EXISTS (
              SELECT 1
                FROM pg_policies policy
               WHERE policy.schemaname = 'appsea'
                 AND policy.tablename = relation.relname
                 AND policy.policyname = 'workspace_scope'
            )
          )
        ORDER BY relation.relname`
    )
    expect(violations.rows).toEqual([])
  })

  it('admits, consumes, releases, and preserves the actor for a manual analysis start', async () => {
    const workspaceId = 'workspace-analysis-admission'
    const userId = 'user-analysis-admission'
    const digest = 'a'.repeat(64)
    const inputHash = 'b'.repeat(64)
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES ($1, $2, 'Analysis admission workspace', 'private', false, 'active', $3, $3)`,
        [workspaceId, workspaceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, 'Analysis admission user', repeat('x', 64), $3, $3)`,
        [userId, `${userId}@example.com`, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'owner', $3, $3)`,
        [workspaceId, userId, fixedAt]
      )
    })

    const admissions = new PostgresProductionAnalysisAdmissionRepository(servicePool)
    await expect(
      admissions.admitForUser({
        workspaceId,
        userId,
        idempotencyDigest: digest,
        inputHash
      })
    ).resolves.toMatchObject({ decision: 'admitted', replayed: false })
    await expect(admissions.consume(workspaceId, digest, inputHash, userId)).resolves.toBe(true)
    await expect(admissions.release(workspaceId, digest, inputHash, userId)).resolves.toBe(true)

    const stored = await withWorkspaceTransaction(
      servicePool,
      workspaceId,
      async (client) => {
        const result = await client.query<{
          state: string
          requested_by_actor_type: string
          requested_by_actor_id: string
        }>(
          `SELECT state, requested_by_actor_type, requested_by_actor_id
             FROM appsea.production_analysis_workflow_admissions
            WHERE workspace_id = $1 AND idempotency_digest = $2`,
          [workspaceId, digest]
        )
        return result.rows[0]
      },
      { readOnly: true }
    )
    expect(stored).toEqual({
      state: 'released',
      requested_by_actor_type: 'user',
      requested_by_actor_id: userId
    })

    await withOwnerClient((client) =>
      client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
    )
    await withOwnerClient((client) =>
      client.query('DELETE FROM appsea.users WHERE user_id = $1', [userId])
    )
  })

  it('persists monotonic production-analysis activity attempts through the service role', async () => {
    const workspaceId = 'workspace-analysis-attempts'
    const campaignId = 'campaign-analysis-attempts'
    const runId = 'run-analysis-attempts'
    const analysisRunId = 'analysis-run-attempts'
    const analysisRepository = new PostgresProductionAnalysisRepository(servicePool, {} as never)

    try {
      await withOwnerClient(async (client) => {
        await client.query('BEGIN')
        try {
          await client.query(
            `INSERT INTO appsea.workspaces
               (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
             VALUES ($1, $1, 'Analysis attempts workspace', 'private', false, 'active', $2, $2)`,
            [workspaceId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.research_campaigns
               (workspace_id, campaign_id, name, purpose, state, configuration, budget, synthetic,
                created_at, updated_at)
             VALUES ($1, $2, 'Analysis attempts campaign', 'opportunity-research', 'completed',
                     '{}'::jsonb, '{}'::jsonb, false, $3, $3)`,
            [workspaceId, campaignId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.research_runs
               (workspace_id, run_id, campaign_id, idempotency_key, mode, state, artifact_id,
                input_hash, artifact_snapshot, requested_at, started_at, completed_at)
             VALUES ($1, $2, $3, 'analysis-attempts-collection-key', 'production', 'completed',
                     'artifact-analysis-attempts', repeat('a', 64), '{}'::jsonb, $4, $4, $4)`,
            [workspaceId, runId, campaignId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.production_analysis_runs
               (workspace_id, analysis_run_id, collection_run_id, idempotency_key,
                analysis_version, input_hash, artifact_id, artifact_snapshot, state,
                availability_state, seed_review_id, seed_content_hash, requested_at, started_at)
             VALUES ($1, $2, $3, 'analysis-attempts-analysis-key', 'production-analysis-v1',
                     repeat('b', 64), 'artifact-analysis-attempts-output', '{}'::jsonb,
                     'running', 'active', 'seed-analysis-attempts', repeat('c', 64), $4, $4)`,
            [workspaceId, analysisRunId, runId, fixedAt]
          )
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      })

      await analysisRepository.recordActivityAttemptStarted({
        workspaceId,
        collectionRunId: runId,
        analysisRunId,
        activityAttempt: 1
      })
      await analysisRepository.recordActivityAttemptHeartbeat({
        workspaceId,
        collectionRunId: runId,
        analysisRunId,
        activityAttempt: 1
      })
      await analysisRepository.recordActivityAttemptFinished({
        workspaceId,
        collectionRunId: runId,
        analysisRunId,
        activityAttempt: 1,
        state: 'failed',
        failureCode: 'analysis_activity_failed'
      })
      await analysisRepository.recordActivityAttemptStarted({
        workspaceId,
        collectionRunId: runId,
        analysisRunId,
        activityAttempt: 2
      })
      await analysisRepository.recordActivityAttemptFinished({
        workspaceId,
        collectionRunId: runId,
        analysisRunId,
        activityAttempt: 2,
        state: 'completed'
      })

      await withWorkspaceTransaction(servicePool, workspaceId, (client) =>
        client.query(
          `UPDATE appsea.production_analysis_runs
              SET activity_attempts = 3
            WHERE workspace_id = $1 AND analysis_run_id = $2`,
          [workspaceId, analysisRunId]
        )
      )
      const stored = await withWorkspaceTransaction(
        servicePool,
        workspaceId,
        (client) =>
          client.query<{
            activity_attempts: number
            attempt_history: Array<{
              activityAttempt: number
              state: string
              heartbeatCount: number
              failureCode: string | null
            }>
          }>(
            `SELECT activity_attempts,
                    (SELECT jsonb_agg(jsonb_build_object(
                              'activityAttempt', activity_attempt,
                              'state', state,
                              'heartbeatCount', heartbeat_count,
                              'failureCode', failure_code
                            ) ORDER BY activity_attempt)
                       FROM appsea.production_analysis_activity_attempts
                      WHERE workspace_id = $1 AND analysis_run_id = $2) AS attempt_history
               FROM appsea.production_analysis_runs
              WHERE workspace_id = $1 AND analysis_run_id = $2`,
            [workspaceId, analysisRunId]
          ),
        { readOnly: true }
      )
      expect(stored.rows[0]?.activity_attempts).toBe(3)
      expect(stored.rows[0]?.attempt_history).toEqual([
        {
          activityAttempt: 1,
          state: 'failed',
          heartbeatCount: 3,
          failureCode: 'analysis_activity_failed'
        },
        {
          activityAttempt: 2,
          state: 'completed',
          heartbeatCount: 2,
          failureCode: null
        }
      ])
      await analysisRepository.recordActivityAttemptStarted({
        workspaceId,
        collectionRunId: runId,
        analysisRunId,
        activityAttempt: 3
      })
      await analysisRepository.recordActivityAttemptStarted({
        workspaceId,
        collectionRunId: runId,
        analysisRunId,
        activityAttempt: 3
      })
      await expect(
        withWorkspaceTransaction(servicePool, workspaceId, (client) =>
          client.query(
            `UPDATE appsea.production_analysis_activity_attempts
                SET heartbeat_count = 1
              WHERE workspace_id = $1
                AND analysis_run_id = $2
                AND activity_attempt = 3`,
            [workspaceId, analysisRunId]
          )
        )
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        withWorkspaceTransaction(servicePool, workspaceId, (client) =>
          client.query(
            `UPDATE appsea.production_analysis_activity_attempts
                SET state = 'started'
              WHERE workspace_id = $1
                AND analysis_run_id = $2
                AND activity_attempt = 1`,
            [workspaceId, analysisRunId]
          )
        )
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        withWorkspaceTransaction(servicePool, workspaceId, (client) =>
          client.query(
            `UPDATE appsea.production_analysis_runs
                SET activity_attempts = 2
              WHERE workspace_id = $1 AND analysis_run_id = $2`,
            [workspaceId, analysisRunId]
          )
        )
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await withOwnerClient(async (client) => {
        await client.query('BEGIN')
        try {
          await client.query(
            'DELETE FROM appsea.production_analysis_activity_attempts WHERE workspace_id = $1',
            [workspaceId]
          )
          await client.query(
            'DELETE FROM appsea.production_analysis_runs WHERE workspace_id = $1',
            [workspaceId]
          )
          await client.query('DELETE FROM appsea.research_runs WHERE workspace_id = $1', [
            workspaceId
          ])
          await client.query('DELETE FROM appsea.research_campaigns WHERE workspace_id = $1', [
            workspaceId
          ])
          await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      })
    }
  })

  it('persists, replays, and proves normalized synthetic provenance', async () => {
    const input = await fixtureInput()
    const first = await repository.persist(input)
    const replay = await repository.persist(input)
    const stored = await repository.read(input.workspaceId, input.runId)
    const leaderboard = await repository.listOpportunities(input.workspaceId)

    expect(first).toMatchObject({
      replayed: false,
      sourceItemCount: 4,
      evidenceCount: 4,
      complaintCount: 4,
      clusterCount: 3,
      competitorCount: 3,
      state: 'completed'
    })
    expect(replay).toEqual({ ...first, replayed: true })
    expect(stored?.artifact).toEqual(input.artifact)
    expect(stored?.planPackage).toEqual(input.planPackage)
    expect(leaderboard[0]).toMatchObject({
      id: input.artifact.opportunity.id,
      synthetic: true,
      scoreSnapshot: input.artifact.opportunity.scoreSnapshot
    })

    const normalized = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const result = await client.query<{
          source_items: string
          evidence_records: string
          complaints: string
          policy_links: string
          synthetic_rows: string
          score: string
          runs: string
          audit_events: string
          outbox_events: string
          opportunity_links: string
          reports: string
          plan_report_links: string
          report_schema_version: string
        }>(
          `SELECT
             (SELECT count(*)::text FROM appsea.research_run_source_items
               WHERE workspace_id = $1 AND run_id = $2) AS source_items,
             (SELECT count(*)::text FROM appsea.evidence_records
               WHERE workspace_id = $1 AND synthetic) AS evidence_records,
             (SELECT count(*)::text FROM appsea.complaint_observations
               WHERE workspace_id = $1 AND synthetic) AS complaints,
             (SELECT count(*)::text FROM appsea.research_run_source_policies
               WHERE workspace_id = $1 AND run_id = $2) AS policy_links,
             (SELECT count(*)::text FROM appsea.source_items
               WHERE workspace_id = $1 AND synthetic AND requested_display_mode = 'fixture') AS synthetic_rows,
             (SELECT score::text FROM appsea.opportunity_score_snapshots
               WHERE workspace_id = $1 AND score_snapshot_id = $3) AS score,
             (SELECT count(*)::text FROM appsea.research_runs
               WHERE workspace_id = $1 AND run_id = $2) AS runs,
             (SELECT count(*)::text FROM appsea.audit_events
               WHERE workspace_id = $1 AND correlation_id = $2) AS audit_events,
             (SELECT count(*)::text FROM appsea.outbox_events
               WHERE workspace_id = $1 AND correlation_id = $2) AS outbox_events,
              (SELECT count(*)::text FROM appsea.research_run_opportunities
                WHERE workspace_id = $1 AND run_id = $2) AS opportunity_links,
              (SELECT count(*)::text FROM appsea.report_versions
                WHERE workspace_id = $1 AND opportunity_id = $4) AS reports,
              (SELECT count(*)::text FROM appsea.plan_package_versions
                WHERE workspace_id = $1 AND opportunity_id = $4 AND report_id IS NOT NULL) AS plan_report_links,
              (SELECT structured_report ->> 'schemaVersion' FROM appsea.report_versions
                WHERE workspace_id = $1 AND opportunity_id = $4
                ORDER BY generated_at DESC LIMIT 1) AS report_schema_version`,
          [input.workspaceId, input.runId, first.scoreSnapshotId, first.opportunityId]
        )
        return result.rows[0]!
      },
      { readOnly: true }
    )
    expect(normalized).toEqual({
      source_items: '4',
      evidence_records: '4',
      complaints: '4',
      policy_links: '1',
      synthetic_rows: '4',
      score: '80.3',
      runs: '1',
      audit_events: '1',
      outbox_events: '1',
      opportunity_links: '1',
      reports: '1',
      plan_report_links: '1',
      report_schema_version: '1.0.0'
    })

    const report = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const result = await client.query<{ structured_report: unknown }>(
          `SELECT structured_report
             FROM appsea.report_versions
            WHERE workspace_id = $1 AND opportunity_id = $2
            ORDER BY generated_at DESC LIMIT 1`,
          [input.workspaceId, first.opportunityId]
        )
        return result.rows[0]?.structured_report
      },
      { readOnly: true }
    )
    expect(opportunityReportSchema.parse(report).opportunity.id).toBe(first.opportunityId)

    const reportReaderId = 'user:report-reader'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, 'Report Reader', repeat('x', 64), $3, $3)`,
        [reportReaderId, 'report-reader@example.test', latestAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'owner', $3, $3)`,
        [input.workspaceId, reportReaderId, latestAt]
      )
    })
    const privateDetail = await authRepository.readWorkspaceOpportunity(
      reportReaderId,
      input.workspaceId,
      input.artifact.opportunity.slug
    )
    expect(privateDetail?.sourceCoverage).toMatchObject([
      {
        sourceId: input.artifact.sourcePolicies[0]?.sourceId,
        observationCount: 4,
        synthetic: true
      }
    ])
    expect(privateDetail?.report?.structuredReport.reportType).toBe('opportunity')
    const reportId = privateDetail?.report?.id
    if (!reportId) throw new Error('Fixture report was not persisted')
    await expect(
      authRepository.exportWorkspaceReport(reportReaderId, input.workspaceId, reportId)
    ).rejects.toBeInstanceOf(WorkspaceReportNotApprovedError)
    const reviewed = await authRepository.updateWorkspaceReportApproval(
      reportReaderId,
      input.workspaceId,
      reportId,
      { action: 'reviewed' }
    )
    expect(reviewed.approvalState).toBe('reviewed')
    const approved = await authRepository.updateWorkspaceReportApproval(
      reportReaderId,
      input.workspaceId,
      reportId,
      { action: 'approved' }
    )
    expect(approved.approvalState).toBe('approved')
    const exported = await authRepository.exportWorkspaceReport(
      reportReaderId,
      input.workspaceId,
      reportId
    )
    expect(exported.manifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(exported.report.approvalState).toBe('approved')
    const reportReceipts = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const result = await client.query<{ action: string; receipts: string }>(
          `SELECT action, count(*)::text AS receipts
             FROM appsea.audit_events
            WHERE workspace_id = $1
              AND target_type = 'report'
              AND target_id = $2
            GROUP BY action
            ORDER BY action`,
          [input.workspaceId, reportId]
        )
        return result.rows
      },
      { readOnly: true }
    )
    expect(reportReceipts).toEqual([
      { action: 'report.approved', receipts: '1' },
      { action: 'report.reviewed', receipts: '1' }
    ])
    await withOwnerClient((client) =>
      client.query('DELETE FROM appsea.users WHERE user_id = $1', [reportReaderId])
    )

    const fixtureComplaint = input.artifact.complaints[0]!
    const provenance = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const result = await client.query<{
          source_record_id: string
          query_route: string
          captured_at: Date
          published_at: Date | null
          source_policy_version: string
          collection_purpose: string
          requested_display_mode: string
          language: string
          allowed_representation: string
          redacted: boolean
          product_candidate: string
          company_candidate: string
          feature_candidate: string
          source_hash: string
          evidence_hash: string
        }>(
          `SELECT source_item.source_record_id,
                  source_item.query_route,
                  source_item.captured_at,
                  source_item.published_at,
                  source_item.source_policy_version,
                  source_item.collection_purpose,
                  source_item.requested_display_mode,
                  evidence.language,
                  evidence.allowed_representation,
                  evidence.redacted,
                  evidence.product_candidate,
                  evidence.company_candidate,
                  evidence.feature_candidate,
                  source_item.content_hash AS source_hash,
                  evidence.content_hash AS evidence_hash
             FROM appsea.complaint_observations complaint
             JOIN appsea.evidence_records evidence
               ON evidence.workspace_id = complaint.workspace_id
              AND evidence.evidence_id = complaint.evidence_id
             JOIN appsea.source_items source_item
               ON source_item.workspace_id = evidence.workspace_id
              AND source_item.source_item_id = evidence.source_item_id
            WHERE complaint.workspace_id = $1 AND complaint.complaint_id = $2`,
          [input.workspaceId, fixtureComplaint.id]
        )
        return result.rows[0]!
      },
      { readOnly: true }
    )
    expect(provenance).toMatchObject({
      source_record_id: fixtureComplaint.sourceRecordId,
      query_route: fixtureComplaint.query,
      collection_purpose: 'testing',
      requested_display_mode: 'fixture',
      language: fixtureComplaint.language,
      allowed_representation: fixtureComplaint.allowedRepresentation,
      redacted: fixtureComplaint.redacted,
      product_candidate: fixtureComplaint.product,
      company_candidate: fixtureComplaint.company,
      feature_candidate: fixtureComplaint.feature
    })
    expect(provenance.captured_at.toISOString()).toBe(fixtureComplaint.capturedAt)
    expect(provenance.published_at?.toISOString() ?? null).toBe(fixtureComplaint.publishedAt)
    expect(provenance.source_policy_version).toMatch(/^fixture-[a-f0-9]{12}$/)
    expect(provenance.source_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(provenance.evidence_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('applies idempotent field redaction without erasing provenance or immutable analysis', async () => {
    const input = await fixtureInput(
      'workspace-redaction',
      'campaign-redaction',
      'run-redaction',
      'fixture-redaction-key'
    )
    await repository.persist(input)
    const userId = 'user:evidence-redaction'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, 'Evidence redaction reviewer', repeat('x', 64), $3, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, 'evidence-redaction@example.test', latestAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'owner', $3, $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [input.workspaceId, userId, latestAt]
      )
    })

    const complaint = input.artifact.complaints[0]!
    const before = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const result = await client.query<{
          evidence_id: string
          normalized_text: string
          product_candidate: string
          evidence_hash: string
          source_hash: string
          source_captured_at: Date
          analysis_snapshot: unknown
        }>(
          `SELECT evidence.evidence_id,
                  evidence.normalized_text,
                  evidence.product_candidate,
                  evidence.content_hash AS evidence_hash,
                  source_item.content_hash AS source_hash,
                  source_item.captured_at AS source_captured_at,
                  complaint.analysis_snapshot
             FROM appsea.complaint_observations complaint
             JOIN appsea.evidence_records evidence
               ON evidence.workspace_id = complaint.workspace_id
              AND evidence.evidence_id = complaint.evidence_id
             JOIN appsea.source_items source_item
               ON source_item.workspace_id = evidence.workspace_id
              AND source_item.source_item_id = evidence.source_item_id
            WHERE complaint.workspace_id = $1
              AND complaint.complaint_id = $2`,
          [input.workspaceId, complaint.id]
        )
        return result.rows[0]!
      },
      { readOnly: true }
    )

    const redactionInput: EvidenceRedactionInput = {
      redactionId: 'redaction:evidence:one',
      fields: ['text', 'product', 'canonicalLocator'],
      reason: 'pii'
    }
    const first = await evidenceRedactionRepository.redact(
      userId,
      input.workspaceId,
      input.runId,
      complaint.id,
      before.evidence_id,
      redactionInput
    )
    expect(first.replayed).toBe(false)
    expect(first.fields).toEqual(['canonicalLocator', 'product', 'text'])
    await expect(
      evidenceRedactionRepository.redact(
        userId,
        input.workspaceId,
        input.runId,
        complaint.id,
        before.evidence_id,
        redactionInput
      )
    ).resolves.toMatchObject({ replayed: true })
    await expect(
      evidenceRedactionRepository.redact(
        userId,
        input.workspaceId,
        input.runId,
        complaint.id,
        before.evidence_id,
        { ...redactionInput, fields: ['text'] }
      )
    ).rejects.toThrow('conflicts')

    const after = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const result = await client.query<{
          normalized_text: string
          product_candidate: string
          canonical_locator: string | null
          evidence_hash: string
          source_hash: string
          source_captured_at: Date
          evidence_redacted_fields: string[]
          source_redacted_fields: string[]
          analysis_snapshot: unknown
        }>(
          `SELECT evidence.normalized_text,
                  evidence.product_candidate,
                  source_item.canonical_locator,
                  evidence.content_hash AS evidence_hash,
                  source_item.content_hash AS source_hash,
                  source_item.captured_at AS source_captured_at,
                  evidence.redacted_fields AS evidence_redacted_fields,
                  source_item.redacted_fields AS source_redacted_fields,
                  complaint.analysis_snapshot
             FROM appsea.complaint_observations complaint
             JOIN appsea.evidence_records evidence
               ON evidence.workspace_id = complaint.workspace_id
              AND evidence.evidence_id = complaint.evidence_id
             JOIN appsea.source_items source_item
               ON source_item.workspace_id = evidence.workspace_id
              AND source_item.source_item_id = evidence.source_item_id
            WHERE complaint.workspace_id = $1
              AND complaint.complaint_id = $2`,
          [input.workspaceId, complaint.id]
        )
        return result.rows[0]!
      },
      { readOnly: true }
    )
    expect(after.normalized_text).toBe('[Content redacted by workspace privacy policy]')
    expect(after.product_candidate).toBe('[Field redacted by workspace privacy policy]')
    expect(after.canonical_locator).toBeNull()
    expect(after.evidence_hash).toBe(before.evidence_hash)
    expect(after.source_hash).toBe(before.source_hash)
    expect(after.source_captured_at.toISOString()).toBe(before.source_captured_at.toISOString())
    expect(after.analysis_snapshot).toEqual(before.analysis_snapshot)
    expect(after.evidence_redacted_fields).toEqual(['product', 'text'])
    expect(after.source_redacted_fields).toEqual(['canonicalLocator'])

    const privateDetail = await authRepository.readWorkspaceOpportunity(
      userId,
      input.workspaceId,
      input.artifact.opportunity.slug
    )
    const privateEvidence = privateDetail?.evidence.find((entry) => entry.id === before.evidence_id)
    expect(privateEvidence).toMatchObject({
      text: '[Content redacted by workspace privacy policy]',
      product: '[Content redacted by workspace privacy policy]',
      canonicalLocator: null,
      redactedFields: ['canonicalLocator', 'product', 'text']
    })
    expect(privateDetail?.opportunity.name).toBe('[Content redacted by workspace privacy policy]')
    expect(privateDetail?.summary.name).toBe('[Content redacted by workspace privacy policy]')
    expect(privateDetail?.plan?.files[0]?.content).toBe(
      '[Content redacted by workspace privacy policy]'
    )

    await expect(
      withWorkspaceTransaction(servicePool, input.workspaceId, (client) =>
        client.query(
          `UPDATE appsea.evidence_records
              SET normalized_text = 'runtime tamper'
            WHERE workspace_id = $1 AND evidence_id = $2`,
          [input.workspaceId, before.evidence_id]
        )
      )
    ).rejects.toMatchObject({ code: '42501' })

    await withOwnerClient(async (client) => {
      await client.query('DELETE FROM appsea.users WHERE user_id = $1', [userId])
    })
  })

  it('keeps competitive observation provenance policy-gated and reviewable', async () => {
    const input = await fixtureInput(
      'workspace-competitor-observation',
      'campaign-competitor-observation',
      'run-competitor-observation',
      'fixture-competitor-observation'
    )
    const persisted = await repository.persist(input)
    const userId = 'user:competitor-observation'
    const observationId = 'observation:fixture'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, 'Competitive reviewer', repeat('x', 64), $3, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, 'competitor-observation@example.test', latestAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'owner', $3, $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [input.workspaceId, userId, latestAt]
      )
    })

    const references = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const competitor = await client.query<{ competitor_id: string }>(
          `SELECT competitor_id
             FROM appsea.opportunity_competitors
            WHERE workspace_id = $1 AND opportunity_id = $2
            ORDER BY competitor_id LIMIT 1`,
          [input.workspaceId, persisted.opportunityId]
        )
        const evidence = await client.query<{ source_item_id: string; evidence_id: string }>(
          `SELECT evidence.source_item_id, evidence.evidence_id
             FROM appsea.research_run_source_items run_item
             JOIN appsea.evidence_records evidence
               ON evidence.workspace_id = run_item.workspace_id
              AND evidence.source_item_id = run_item.source_item_id
            WHERE run_item.workspace_id = $1 AND run_item.run_id = $2
            ORDER BY evidence.evidence_id LIMIT 1`,
          [input.workspaceId, input.runId]
        )
        return {
          competitorId: competitor.rows[0]?.competitor_id,
          sourceItemId: evidence.rows[0]?.source_item_id,
          evidenceId: evidence.rows[0]?.evidence_id
        }
      },
      { readOnly: true }
    )
    expect(references.competitorId).toBeTruthy()
    expect(references.sourceItemId).toBeTruthy()
    expect(references.evidenceId).toBeTruthy()

    const competitiveRepository = new PostgresCompetitiveResearchRepository(servicePool)
    const created = await competitiveRepository.create(
      userId,
      input.workspaceId,
      persisted.opportunityId,
      {
        observationId,
        competitorId: references.competitorId!,
        sourceItemId: references.sourceItemId!,
        evidenceId: references.evidenceId!,
        claimType: 'feature',
        claim: 'Synthetic fixture claim requiring explicit review.',
        observedAt: fixedAt,
        confidence: 0.5
      }
    )
    expect(created).toMatchObject({
      observationId,
      reviewState: 'unreviewed',
      synthetic: true,
      allowedRepresentation: 'fixture'
    })

    const confirmed = await competitiveRepository.updateReview(
      userId,
      input.workspaceId,
      persisted.opportunityId,
      observationId,
      { action: 'confirmed' }
    )
    expect(confirmed.reviewState).toBe('confirmed')
    const listed = await competitiveRepository.listForUser(
      userId,
      input.workspaceId,
      persisted.opportunityId
    )
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ observationId, sourceId: expect.any(String) })

    await withOwnerClient(async (client) => {
      await client.query(
        'DELETE FROM appsea.competitor_research_observations WHERE workspace_id = $1 AND observation_id = $2',
        [input.workspaceId, observationId]
      )
      await client.query(
        'DELETE FROM appsea.workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [input.workspaceId, userId]
      )
      await client.query('DELETE FROM appsea.users WHERE user_id = $1', [userId])
    })
  })

  it('persists an idempotent workflow projection, checkpoints, lineage, and terminal ledger', async () => {
    const rawIdempotencyKey = 'sentinel-workflow-secret-key'
    const input = durableWorkflowInput(
      'workspace-workflow-a',
      'campaign-workflow-a',
      'run-workflow-a',
      rawIdempotencyKey
    )
    const execution = durableWorkflowExecution(
      `workflow:fixture:${input.workspaceId}:${input.idempotencyDigest.slice(0, 32)}`,
      '10000000-0000-4000-8000-000000000001'
    )
    const initialized = await workflowRepository.initialize({
      execution,
      input,
      occurredAt: laterAt
    })
    const replay = await workflowRepository.initialize({ execution, input, occurredAt: laterAt })
    expect(replay).toEqual(initialized)
    expect(initialized).toMatchObject({
      state: 'running',
      checkpoint: 'initialized',
      inputHash: input.inputHash,
      idempotencyDigest: input.idempotencyDigest,
      requestedBy: { actorType: 'service', actorId: 'appsea-worker' },
      consumedCostMicros: 0
    })

    await workflowRepository.recordCheckpoint({
      execution,
      workspaceId: input.workspaceId,
      checkpointKey: 'checkpoint:inspected',
      sequenceNo: 200,
      checkpoint: 'inspected',
      state: 'running',
      activityAttempt: 1,
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: laterAt
    })
    await workflowRepository.recordCheckpoint({
      execution,
      workspaceId: input.workspaceId,
      checkpointKey: 'checkpoint:budget-approved',
      sequenceNo: 300,
      checkpoint: 'budget_approved',
      state: 'running',
      activityAttempt: 1,
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: laterAt
    })
    await workflowRepository.recordCheckpoint({
      execution,
      workspaceId: input.workspaceId,
      checkpointKey: 'activity:persisting:attempt:1',
      sequenceNo: 401,
      checkpoint: 'persisting',
      state: 'running',
      activityAttempt: 1,
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: laterAt
    })

    const persistenceInput = await fixtureInput(
      input.workspaceId,
      input.campaignId,
      input.runId,
      `workflow:${input.idempotencyDigest}`,
      laterAt
    )
    const persisted = await repository.persist(persistenceInput)
    await workflowRepository.recordCheckpoint({
      execution,
      workspaceId: input.workspaceId,
      checkpointKey: 'activity:persisted:attempt:1',
      sequenceNo: 402,
      checkpoint: 'persisted',
      state: 'running',
      activityAttempt: 1,
      consumedSourceItems: persisted.sourceItemCount,
      consumedCostMicros: 0,
      occurredAt: latestAt
    })
    const completionInput = {
      execution,
      workspaceId: input.workspaceId,
      result: {
        persistence: persisted,
        sourceItemsProcessed: persisted.sourceItemCount,
        costMicros: 0,
        activityAttempt: 1
      },
      occurredAt: latestAt
    } as const
    const completed = await workflowRepository.complete(completionInput)
    const completionReplay = await workflowRepository.complete(completionInput)
    const recovered = await new PostgresWorkflowJobRepository(servicePool).read(
      input.workspaceId,
      execution.workflowId
    )
    const checkpoints = await workflowRepository.listCheckpoints(
      input.workspaceId,
      execution.workflowId
    )

    expect(completionReplay).toEqual(completed)
    expect(recovered).toEqual(completed)
    expect(completed).toMatchObject({
      state: 'completed',
      checkpoint: 'completed',
      persistedRunId: input.runId,
      opportunityId: persisted.opportunityId,
      scoreSnapshotId: persisted.scoreSnapshotId,
      planPackageId: persisted.planPackageId,
      consumedSourceItems: 4,
      consumedCostMicros: 0,
      activityAttempts: 1
    })
    expect(checkpoints.map((checkpoint) => checkpoint.sequenceNo)).toEqual([
      100, 200, 300, 401, 402, 900
    ])

    const receipts = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const result = await client.query<{
          workflow_jobs: string
          costs: string
          audits: string
          audit_actor: string
          outbox: string
          stored_text: string
        }>(
          `SELECT
             (SELECT count(*)::text FROM appsea.workflow_job_executions
               WHERE workspace_id = $1 AND workflow_id = $2) AS workflow_jobs,
             (SELECT count(*)::text FROM appsea.cost_ledger_entries
               WHERE workspace_id = $1 AND cost_type = 'fixture_workflow'
                 AND campaign_id = $3) AS costs,
             (SELECT count(*)::text FROM appsea.audit_events
               WHERE workspace_id = $1 AND correlation_id = $2) AS audits,
             (SELECT actor_type || ':' || actor_id FROM appsea.audit_events
               WHERE workspace_id = $1 AND correlation_id = $2
               ORDER BY occurred_at DESC LIMIT 1) AS audit_actor,
             (SELECT count(*)::text FROM appsea.outbox_events
               WHERE workspace_id = $1 AND correlation_id = $2) AS outbox,
             (SELECT row_to_json(job)::text
                FROM appsea.workflow_job_executions job
               WHERE workspace_id = $1 AND workflow_id = $2) AS stored_text`,
          [input.workspaceId, execution.workflowId, input.campaignId]
        )
        return result.rows[0]!
      },
      { readOnly: true }
    )
    expect(receipts).toMatchObject({
      workflow_jobs: '1',
      costs: '1',
      audits: '1',
      audit_actor: 'service:appsea-worker',
      outbox: '1'
    })
    expect(receipts.stored_text).not.toContain(rawIdempotencyKey)

    await expect(
      withWorkspaceTransaction(servicePool, input.workspaceId, async (client) => {
        await client.query(
          `UPDATE appsea.workflow_job_executions
              SET state = 'running', checkpoint = 'persisted', finished_at = NULL,
                  persisted_run_id = NULL, opportunity_id = NULL,
                  score_snapshot_id = NULL, plan_package_id = NULL
            WHERE workspace_id = $1 AND workflow_id = $2`,
          [input.workspaceId, execution.workflowId]
        )
      })
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      servicePool.query(`UPDATE appsea.workflow_job_executions SET input_hash = $1 WHERE false`, [
        'f'.repeat(64)
      ])
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      servicePool.query(`UPDATE appsea.workflow_job_checkpoints SET sequence_no = 999 WHERE false`)
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('persists an authenticated workflow actor into the terminal audit event', async () => {
    const workspaceId = 'workspace-workflow-user'
    const userId = 'user:workflow-owner'
    await withOwnerClient(async (client) => {
      await client.query(
        `INSERT INTO appsea.workspaces
           (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
         VALUES ($1, $2, 'Workflow user workspace', 'private', true, 'active', $3, $3)`,
        [workspaceId, workspaceId, fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.users
           (user_id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, 'Workflow Owner', $3, $4, $4)`,
        [userId, 'workflow-owner@example.test', 'x'.repeat(64), fixedAt]
      )
      await client.query(
        `INSERT INTO appsea.workspace_memberships
           (workspace_id, user_id, role, created_at, updated_at)
         VALUES ($1, $2, 'owner', $3, $3)`,
        [workspaceId, userId, fixedAt]
      )
    })

    const actor = { actorType: 'user' as const, actorId: userId }
    const input = durableWorkflowInput(
      workspaceId,
      'campaign-workflow-user',
      'run-workflow-user',
      'workflow-user-actor-secret-key',
      10,
      actor
    )
    const execution = durableWorkflowExecution(
      `workflow:fixture:${workspaceId}:${input.idempotencyDigest.slice(0, 32)}`,
      '30000000-0000-4000-8000-000000000003'
    )
    const initialized = await workflowRepository.initialize({
      execution,
      input,
      occurredAt: laterAt
    })
    expect(initialized.requestedBy).toEqual(actor)
    await withOwnerClient(async (client) => {
      await client.query(
        `DELETE FROM appsea.workspace_memberships
          WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId]
      )
    })

    const terminated = await workflowRepository.terminate({
      execution,
      input,
      state: 'budget_rejected',
      checkpoint: 'budget_rejected',
      failureCode: 'source_item_budget_exceeded',
      failureSummary: 'Integration budget rejection',
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: latestAt
    })
    expect(terminated.requestedBy).toEqual(actor)
    const audit = await withWorkspaceTransaction(
      servicePool,
      workspaceId,
      async (client) => {
        const result = await client.query<{ actor_type: string; actor_id: string }>(
          `SELECT actor_type, actor_id
             FROM appsea.audit_events
            WHERE workspace_id = $1 AND target_id = $2`,
          [workspaceId, execution.workflowId]
        )
        return result.rows[0]
      },
      { readOnly: true }
    )
    expect(audit).toEqual({ actor_type: 'user', actor_id: userId })
  })

  it('rejects conflicting workflow and checkpoint replays', async () => {
    const rawKey = 'workflow-conflict-secret-key'
    const input = durableWorkflowInput(
      'workspace-workflow-conflict',
      'campaign-workflow-conflict',
      'run-workflow-conflict',
      rawKey
    )
    const execution = durableWorkflowExecution(
      `workflow:fixture:${input.workspaceId}:${input.idempotencyDigest.slice(0, 32)}`,
      '20000000-0000-4000-8000-000000000002'
    )
    await workflowRepository.initialize({ execution, input, occurredAt: laterAt })

    const changed = durableWorkflowInput(
      input.workspaceId,
      input.campaignId,
      input.runId,
      rawKey,
      9
    )
    await expect(
      workflowRepository.initialize({ execution, input: changed, occurredAt: laterAt })
    ).rejects.toBeInstanceOf(WorkflowJobConflictError)

    const checkpoint = {
      execution,
      workspaceId: input.workspaceId,
      checkpointKey: 'checkpoint:inspected',
      sequenceNo: 200,
      checkpoint: 'inspected' as const,
      state: 'running' as const,
      activityAttempt: 1,
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: laterAt
    }
    await workflowRepository.recordCheckpoint(checkpoint)
    await expect(
      workflowRepository.recordCheckpoint({ ...checkpoint, consumedSourceItems: 1 })
    ).rejects.toBeInstanceOf(WorkflowCheckpointConflictError)
  })

  it('rejects forged or skipped checkpoint history at the database boundary', async () => {
    const input = durableWorkflowInput(
      'workspace-workflow-checkpoint-guard',
      'campaign-workflow-checkpoint-guard',
      'run-workflow-checkpoint-guard',
      'workflow-checkpoint-guard-secret-key'
    )
    const execution = durableWorkflowExecution(
      `workflow:fixture:${input.workspaceId}:${input.idempotencyDigest.slice(0, 32)}`,
      '21000000-0000-4000-8000-000000000021'
    )
    await workflowRepository.initialize({ execution, input, occurredAt: laterAt })

    await expect(
      withWorkspaceTransaction(servicePool, input.workspaceId, (client) =>
        client.query(
          `INSERT INTO appsea.workflow_job_checkpoints
             (workspace_id, workflow_id, checkpoint_key, sequence_no, checkpoint, state,
              activity_attempt, consumed_source_items, consumed_cost_micros, content_hash, occurred_at)
           VALUES ($1, $2, 'checkpoint:forged', 999, 'completed', 'completed', 1, 0, 0, repeat('f', 64), $3)`,
          [input.workspaceId, execution.workflowId, laterAt]
        )
      )
    ).rejects.toThrow(/requires persisted state/)
  })

  it('rejects cross-wired workflow completion output at the database boundary', async () => {
    const input = durableWorkflowInput(
      'workspace-workflow-a',
      'campaign-workflow-crosswire',
      'run-workflow-crosswire',
      'workflow-crosswire-secret-key'
    )
    const execution = durableWorkflowExecution(
      `workflow:fixture:${input.workspaceId}:${input.idempotencyDigest.slice(0, 32)}`,
      '22500000-0000-4000-8000-000000000022'
    )
    await workflowRepository.initialize({ execution, input, occurredAt: latestAt })

    const persistenceInput = await fixtureInput(
      input.workspaceId,
      input.campaignId,
      input.runId,
      `workflow:${input.idempotencyDigest}`,
      latestAt
    )
    persistenceInput.artifact.id = 'research-fixture-workflow-crosswire'
    persistenceInput.artifact.opportunity.id = 'opportunity-workflow-crosswire'
    persistenceInput.artifact.opportunity.name = 'Workflow Crosswire Fixture'
    persistenceInput.planPackage = generatePlanPackage(persistenceInput.artifact, latestAt)
    persistenceInput.artifact.opportunity.slug = 'inbox-relay-crosswire'
    persistenceInput.planPackage.opportunitySlug = persistenceInput.artifact.opportunity.slug
    const ownOutput = await repository.persist(persistenceInput)
    const unrelatedOutput = await workflowRepository.read(
      input.workspaceId,
      `workflow:fixture:${input.workspaceId}:${durableWorkflowInput(
        input.workspaceId,
        'campaign-workflow-a',
        'run-workflow-a',
        'sentinel-workflow-secret-key'
      ).idempotencyDigest.slice(0, 32)}`
    )
    expect(unrelatedOutput?.scoreSnapshotId).not.toBeNull()

    await expect(
      withWorkspaceTransaction(servicePool, input.workspaceId, async (client) => {
        await client.query(
          `UPDATE appsea.workflow_job_executions
              SET state = 'completed', checkpoint = 'completed',
                  consumed_source_items = 4, activity_attempts = 1,
                  persisted_run_id = $3, opportunity_id = $4,
                  score_snapshot_id = $5, plan_package_id = $6,
                  updated_at = $7, finished_at = $7
            WHERE workspace_id = $1 AND workflow_id = $2`,
          [
            input.workspaceId,
            execution.workflowId,
            ownOutput.runId,
            ownOutput.opportunityId,
            unrelatedOutput!.scoreSnapshotId,
            ownOutput.planPackageId,
            latestAt
          ]
        )
      })
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('coalesces concurrent identical workflow initialization', async () => {
    const input = durableWorkflowInput(
      'workspace-workflow-concurrent',
      'campaign-workflow-concurrent',
      'run-workflow-concurrent',
      'workflow-concurrent-secret-key'
    )
    const execution = durableWorkflowExecution(
      `workflow:fixture:${input.workspaceId}:${input.idempotencyDigest.slice(0, 32)}`,
      '25000000-0000-4000-8000-000000000025'
    )

    const [first, second] = await Promise.all([
      workflowRepository.initialize({ execution, input, occurredAt: laterAt }),
      workflowRepository.initialize({ execution, input, occurredAt: laterAt })
    ])

    expect(second).toEqual(first)
    const checkpoints = await workflowRepository.listCheckpoints(
      input.workspaceId,
      execution.workflowId
    )
    expect(checkpoints).toHaveLength(1)
  })

  it('records budget rejection without creating research output and keeps RLS isolated', async () => {
    const input = durableWorkflowInput(
      'workspace-workflow-budget',
      'campaign-workflow-budget',
      'run-workflow-budget',
      'workflow-budget-secret-key',
      0
    )
    const execution = durableWorkflowExecution(
      `workflow:fixture:${input.workspaceId}:${input.idempotencyDigest.slice(0, 32)}`,
      '30000000-0000-4000-8000-000000000003'
    )
    await workflowRepository.initialize({ execution, input, occurredAt: laterAt })
    const terminalInput = {
      execution,
      input,
      state: 'budget_rejected' as const,
      checkpoint: 'budget_rejected' as const,
      failureCode: 'source_item_budget_exceeded' as const,
      failureSummary: 'Fixture source-item estimate exceeds the approved workflow budget.',
      consumedSourceItems: 0,
      consumedCostMicros: 0,
      occurredAt: latestAt
    }
    const rejected = await workflowRepository.terminate(terminalInput)
    const replay = await workflowRepository.terminate(terminalInput)
    expect(replay).toEqual(rejected)
    expect(rejected).toMatchObject({
      state: 'budget_rejected',
      checkpoint: 'budget_rejected',
      persistedRunId: null,
      opportunityId: null,
      failureCode: 'source_item_budget_exceeded'
    })

    const runCount = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) =>
        client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2`,
          [input.workspaceId, input.runId]
        ),
      { readOnly: true }
    )
    expect(runCount.rows[0]?.count).toBe('0')
    expect(await workflowRepository.read('workspace-workflow-a', execution.workflowId)).toBeNull()
  })

  it('returns one accepted result for concurrent identical starts', async () => {
    const input = await fixtureInput(
      'workspace-concurrent',
      'campaign-concurrent',
      'run-concurrent',
      'fixture-concurrent-key'
    )
    const results = await Promise.all([repository.persist(input), repository.persist(input)])
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true])
    const sideEffects = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) =>
        client.query<{ runs: string; audits: string; outbox: string }>(
          `SELECT
             (SELECT count(*)::text FROM appsea.research_runs
               WHERE workspace_id = $1 AND idempotency_key = $2) AS runs,
             (SELECT count(*)::text FROM appsea.audit_events
               WHERE workspace_id = $1 AND correlation_id = $3) AS audits,
             (SELECT count(*)::text FROM appsea.outbox_events
               WHERE workspace_id = $1 AND correlation_id = $3) AS outbox`,
          [input.workspaceId, input.idempotencyKey, input.runId]
        ),
      { readOnly: true }
    )
    expect(sideEffects.rows[0]).toEqual({ runs: '1', audits: '1', outbox: '1' })
  })

  it('accepts only one of two concurrent starts that reuse a key with different input', async () => {
    const original = await fixtureInput(
      'workspace-concurrent-conflict',
      'campaign-concurrent-conflict',
      'run-concurrent-conflict',
      'fixture-concurrent-conflict-key'
    )
    const changed = structuredClone(original)
    changed.artifact.id = 'research-fixture-concurrent-conflict'
    const settled = await Promise.allSettled([
      repository.persist(original),
      repository.persist(changed)
    ])
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = settled.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected' })
    if (rejected?.status !== 'rejected') throw new Error('Expected one rejected start')
    expect(rejected.reason).toBeInstanceOf(IdempotencyConflictError)
  })

  it('rejects the same idempotency key with different input', async () => {
    const original = await fixtureInput()
    const changed = structuredClone(original)
    changed.artifact.id = 'research-fixture-idempotency-conflict'
    await expect(repository.persist(changed)).rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it('rejects a caller-forged deterministic score before opening a run', async () => {
    const input = await fixtureInput(
      'workspace-score-tamper',
      'campaign-score-tamper',
      'run-score-tamper',
      'fixture-score-tamper'
    )
    input.artifact.opportunity.scoreSnapshot.score += 1
    await expect(repository.persist(input)).rejects.toBeInstanceOf(InvalidScoreSnapshotError)
    const workspace = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) =>
        client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM appsea.workspaces WHERE workspace_id = $1',
          [input.workspaceId]
        ),
      { readOnly: true }
    )
    expect(workspace.rows[0]?.count).toBe('0')
  })

  it('reuses content-addressed plans while preserving historical run lineage', async () => {
    const original = await fixtureInput()
    const second = structuredClone(original)
    second.campaignId = 'campaign-fixture-second'
    second.runId = 'run-fixture-second'
    second.idempotencyKey = 'fixture-persistence-second'
    second.requestedAt = laterAt
    second.artifact.id = 'research-fixture-inbox-relay-second'

    await repository.persist(second)
    const stored = await repository.read(second.workspaceId, second.runId)
    expect(stored?.planPackage).toEqual(second.planPackage)

    const lineage = await withWorkspaceTransaction(
      servicePool,
      second.workspaceId,
      async (client) => {
        const result = await client.query<{ plan_count: string; link_count: string }>(
          `SELECT
             (SELECT count(*)::text FROM appsea.plan_package_versions
               WHERE workspace_id = $1) AS plan_count,
             (SELECT count(*)::text FROM appsea.research_run_plan_packages
               WHERE workspace_id = $1) AS link_count`,
          [second.workspaceId]
        )
        return result.rows[0]!
      },
      { readOnly: true }
    )
    expect(lineage).toEqual({ plan_count: '1', link_count: '2' })

    const originalCluster = await withWorkspaceTransaction(
      servicePool,
      original.workspaceId,
      async (client) =>
        client.query<{ cluster_version_id: string }>(
          `SELECT cluster_version_id
             FROM appsea.research_run_cluster_versions
            WHERE workspace_id = $1 AND run_id = $2
            ORDER BY cluster_version_id
            LIMIT 1`,
          [original.workspaceId, original.runId]
        ),
      { readOnly: true }
    )
    await expect(
      withWorkspaceTransaction(servicePool, second.workspaceId, async (client) => {
        await client.query(
          `INSERT INTO appsea.research_run_cluster_versions
             (workspace_id, run_id, opportunity_id, cluster_version_id, linked_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            second.workspaceId,
            second.runId,
            second.artifact.opportunity.id,
            originalCluster.rows[0]!.cluster_version_id,
            laterAt
          ]
        )
      })
    ).rejects.toMatchObject({ code: '23503' })

    const replay = await repository.persist(original)
    expect(replay).toMatchObject({ runId: original.runId, replayed: true, competitorCount: 3 })
    await expect(
      withWorkspaceTransaction(servicePool, original.workspaceId, async (client) => {
        await client.query(
          `UPDATE appsea.opportunities
              SET current_score_snapshot_id = $3
            WHERE workspace_id = $1 AND opportunity_id = $2`,
          [original.workspaceId, original.artifact.opportunity.id, replay.scoreSnapshotId]
        )
      })
    ).rejects.toMatchObject({ code: '23503' })
    const workspaceTime = await withWorkspaceTransaction(
      servicePool,
      original.workspaceId,
      async (client) =>
        client.query<{ updated_at: Date }>(
          'SELECT updated_at FROM appsea.workspaces WHERE workspace_id = $1',
          [original.workspaceId]
        ),
      { readOnly: true }
    )
    expect(workspaceTime.rows[0]?.updated_at.toISOString()).toBe(laterAt)
  })

  it('projects only the latest run relations without changing historical counts', async () => {
    const input = await fixtureInput(
      'workspace-fixture-a',
      'campaign-fixture-refresh',
      'run-fixture-refresh',
      'fixture-persistence-refresh',
      latestAt
    )
    input.artifact.id = 'research-fixture-inbox-relay-refresh'
    const removedCluster = input.artifact.clusters.at(-1)
    if (!removedCluster) throw new Error('Fixture cluster is missing')
    const removedComplaintIds = new Set(removedCluster.complaintIds)
    input.artifact.clusters = input.artifact.clusters.slice(0, -1)
    input.artifact.complaints = input.artifact.complaints.filter(
      (complaint) => !removedComplaintIds.has(complaint.id)
    )
    input.artifact.analyses = input.artifact.analyses.filter(
      (analysis) => !removedComplaintIds.has(analysis.complaintId)
    )
    input.artifact.opportunity.complaintIds = input.artifact.clusters.flatMap(
      (cluster) => cluster.complaintIds
    )
    input.artifact.opportunity.competitors = input.artifact.opportunity.competitors.slice(0, 2)
    input.planPackage = generatePlanPackage(input.artifact, latestAt)

    const refreshed = await repository.persist(input)
    const current = await repository.listOpportunities(input.workspaceId)
    const originalReplay = await repository.persist(await fixtureInput())
    expect(refreshed).toMatchObject({ complaintCount: 3, clusterCount: 2, competitorCount: 2 })
    expect(current[0]?.complaintIds).toHaveLength(3)
    expect(current[0]?.competitors).toHaveLength(2)
    expect(originalReplay).toMatchObject({ complaintCount: 4, competitorCount: 3 })
    expect(originalReplay.planPackageId).not.toBe(refreshed.planPackageId)
    await expect(
      withWorkspaceTransaction(servicePool, input.workspaceId, async (client) => {
        await client.query(
          `UPDATE appsea.opportunities
              SET current_plan_package_id = $3
            WHERE workspace_id = $1 AND opportunity_id = $2`,
          [input.workspaceId, input.artifact.opportunity.id, originalReplay.planPackageId]
        )
      })
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('records the policy version used by each run without rewriting prior source items', async () => {
    const sourceId = 'fixture-policy-rotation-source'
    const original = await fixtureInput(
      'workspace-fixture-policy',
      'campaign-fixture-policy-original',
      'run-fixture-policy-original',
      'fixture-persistence-policy-original',
      laterAt
    )
    original.artifact.id = 'research-fixture-inbox-relay-policy-original'
    original.artifact.sourcePolicies[0]!.sourceId = sourceId
    original.artifact.complaints.forEach((complaint) => {
      complaint.sourceId = sourceId
    })
    await repository.persist(original)

    const input = await fixtureInput(
      'workspace-fixture-policy',
      'campaign-fixture-policy',
      'run-fixture-policy',
      'fixture-persistence-policy',
      latestAt
    )
    input.artifact.id = 'research-fixture-inbox-relay-policy'
    input.artifact.sourcePolicies[0]!.sourceId = sourceId
    input.artifact.complaints.forEach((complaint) => {
      complaint.sourceId = sourceId
    })
    input.artifact.sourcePolicies[0]!.coverageNotes.push('Second reviewed fixture policy version')
    input.artifact.sourcePolicies[0]!.reviewedAt = latestAt
    await repository.persist(input)

    const provenance = await withWorkspaceTransaction(
      servicePool,
      input.workspaceId,
      async (client) => {
        const result = await client.query<{
          policy_versions: string
          source_items: string
          current_policy: string
          run_policies: string[]
          acquisition_policies: string[]
          original_acquisition_policies: string[]
        }>(
          `SELECT
             (SELECT count(*)::text
                FROM appsea.source_policy_versions
               WHERE source_id = $3) AS policy_versions,
             (SELECT count(*)::text
                FROM appsea.source_items
               WHERE workspace_id = $1 AND source_id = $3) AS source_items,
             source.current_policy_version AS current_policy,
             (SELECT array_agg(policy_version ORDER BY policy_version)
                FROM appsea.research_run_source_policies
               WHERE workspace_id = $1 AND run_id = $2 AND source_id = $3) AS run_policies,
             (SELECT array_agg(DISTINCT source_policy_version ORDER BY source_policy_version)
                FROM appsea.research_run_source_items
               WHERE workspace_id = $1 AND run_id = $2 AND source_id = $3) AS acquisition_policies,
             (SELECT array_agg(DISTINCT source_policy_version ORDER BY source_policy_version)
                FROM appsea.research_run_source_items
               WHERE workspace_id = $1 AND run_id = $4 AND source_id = $3)
               AS original_acquisition_policies
            FROM appsea.sources source
           WHERE source.source_id = $3`,
          [
            input.workspaceId,
            input.runId,
            input.artifact.sourcePolicies[0]!.sourceId,
            original.runId
          ]
        )
        return result.rows[0]!
      },
      { readOnly: true }
    )
    expect(provenance.policy_versions).toBe('2')
    expect(provenance.source_items).toBe('4')
    expect(provenance.run_policies).toContain(provenance.current_policy)
    expect(provenance.run_policies).toEqual(expect.arrayContaining(provenance.acquisition_policies))
    expect(provenance.acquisition_policies).toEqual(provenance.original_acquisition_policies)
    expect(provenance.acquisition_policies).not.toContain(provenance.current_policy)

    await expect(
      withWorkspaceTransaction(servicePool, input.workspaceId, async (client) => {
        await client.query(
          `INSERT INTO appsea.research_campaigns
             (workspace_id, campaign_id, name, purpose, state, configuration, budget, synthetic,
              created_at, updated_at)
           VALUES ($1, 'campaign-policy-mismatch', 'Policy mismatch', 'internal_quality',
                   'running', '{}'::jsonb, '{}'::jsonb, true, $2, $2)`,
          [input.workspaceId, latestAt]
        )
        await client.query(
          `INSERT INTO appsea.research_runs
             (workspace_id, run_id, campaign_id, idempotency_key, mode, state, artifact_id,
              input_hash, artifact_snapshot, requested_at, started_at)
           VALUES ($1, 'run-policy-mismatch', 'campaign-policy-mismatch',
                   'policy-mismatch-idempotency', 'fixture', 'running', 'artifact-policy-mismatch',
                   $3, '{}'::jsonb, $2, $2)`,
          [input.workspaceId, latestAt, '9'.repeat(64)]
        )
        const item = await client.query<{
          source_item_id: string
          source_id: string
          current_policy_version: string
        }>(
          `SELECT source_item.source_item_id,
                  source_item.source_id,
                  source.current_policy_version
             FROM appsea.source_items source_item
             JOIN appsea.sources source ON source.source_id = source_item.source_id
            WHERE source_item.workspace_id = $1 AND source_item.source_id = $2
            ORDER BY source_item.source_item_id
            LIMIT 1`,
          [input.workspaceId, sourceId]
        )
        const row = item.rows[0]!
        await client.query(
          `INSERT INTO appsea.research_run_source_policies
             (workspace_id, run_id, source_id, policy_version, linked_at)
           VALUES ($1, 'run-policy-mismatch', $2, $3, $4)`,
          [input.workspaceId, row.source_id, row.current_policy_version, latestAt]
        )
        await client.query(
          `INSERT INTO appsea.research_run_source_items
             (workspace_id, run_id, source_item_id, source_id, source_policy_version)
           VALUES ($1, 'run-policy-mismatch', $2, $3, $4)`,
          [input.workspaceId, row.source_item_id, row.source_id, row.current_policy_version]
        )
      })
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('reuses a workspace-global competitor and rejects cross-opportunity pointers', async () => {
    const input = await fixtureInput(
      'workspace-fixture-a',
      'campaign-fixture-other-opportunity',
      'run-fixture-other-opportunity',
      'fixture-other-opportunity',
      latestAt
    )
    input.artifact.id = 'research-fixture-other-opportunity'
    input.artifact.opportunity.id = 'opportunity-other'
    input.artifact.opportunity.slug = 'other-opportunity'
    input.artifact.opportunity.name = 'Other Opportunity'
    input.planPackage = {
      opportunitySlug: input.artifact.opportunity.slug,
      generatedAt: latestAt,
      files: input.artifact.opportunity.planFiles.map((path) => ({
        path,
        content: `Synthetic integration placeholder for ${path}; not a product plan.`
      }))
    }
    const secondOpportunity = await repository.persist(input)

    const opportunities = await repository.listOpportunities(input.workspaceId)
    expect(opportunities).toHaveLength(2)
    await expect(
      withWorkspaceTransaction(servicePool, input.workspaceId, async (client) => {
        await client.query(
          `UPDATE appsea.opportunities
              SET current_score_snapshot_id = $3
            WHERE workspace_id = $1 AND opportunity_id = $2`,
          [input.workspaceId, 'opp-inbox-relay', secondOpportunity.scoreSnapshotId]
        )
      })
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('enforces cross-workspace RLS for direct reads and writes', async () => {
    const secondWorkspace = await fixtureInput(
      'workspace-fixture-b',
      'campaign-fixture-b',
      'run-fixture-b',
      'fixture-persistence-b'
    )
    await repository.persist(secondWorkspace)

    const crossWorkspace = await withWorkspaceTransaction(
      servicePool,
      'workspace-fixture-a',
      async (client) =>
        client.query<{ opportunities: string; evidence: string }>(
          `SELECT
             (SELECT count(*)::text FROM appsea.opportunities
               WHERE workspace_id = 'workspace-fixture-b') AS opportunities,
             (SELECT count(*)::text FROM appsea.evidence_records
               WHERE workspace_id = 'workspace-fixture-b') AS evidence`,
          []
        ),
      { readOnly: true }
    )
    expect(crossWorkspace.rows[0]).toEqual({ opportunities: '0', evidence: '0' })
    await expect(
      withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
        await client.query(
          `INSERT INTO appsea.workspaces
             (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
           VALUES ('workspace-forbidden', 'workspace-forbidden', 'Forbidden', 'private', true,
                   'active', $1, $1)`,
          [fixedAt]
        )
      })
    ).rejects.toMatchObject({ code: '42501' })

    const failClosed = await servicePool.query<{
      visible: string
      workspace_setting: string | null
    }>(
      `SELECT
         (SELECT count(*)::text FROM appsea.opportunities) AS visible,
         current_setting('appsea.workspace_id', true) AS workspace_setting`
    )
    expect(failClosed.rows[0]?.visible).toBe('0')
    expect(failClosed.rows[0]?.workspace_setting ?? '').toBe('')
  })

  it('blocks pending source policies at the database collection boundary', async () => {
    await withOwnerClient(async (client) => {
      await client.query(`
        INSERT INTO appsea.sources
          (source_id, display_name, source_type, lifecycle_state, current_policy_version,
           created_at, updated_at)
        VALUES
          ('fixture-pending-source', 'Pending fixture', 'fixture', 'disabled_pending_review', NULL,
           '${fixedAt}', '${fixedAt}');
        INSERT INTO appsea.source_policy_versions
          (source_id, policy_version, policy_state, permitted_purposes, commercial_use,
           access_method, retention_days, deletion_required, attribution_required, display_mode,
           reviewed_at, policy_payload, content_hash, created_at)
        VALUES
          ('fixture-pending-source', 'pending-v1', 'pending_review', ARRAY['testing'], 'allowed',
           'fixture', 0, false, false, 'fixture', '${fixedAt}', '{}'::jsonb, repeat('3', 64),
           '${fixedAt}');
        UPDATE appsea.sources
           SET current_policy_version = 'pending-v1', lifecycle_state = 'active'
         WHERE source_id = 'fixture-pending-source';
      `)
    })

    await expect(
      withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
        await client.query(
          `INSERT INTO appsea.source_items
             (workspace_id, source_item_id, source_id, source_policy_version, source_record_id,
              query_route, content_hash, captured_at, synthetic, created_at,
              collection_purpose, requested_display_mode)
           VALUES ($1, 'source-item:pending', 'fixture-pending-source', 'pending-v1',
                   'pending-record', 'fixture', $2, $3, true, $3, 'testing', 'fixture')`,
          ['workspace-fixture-a', '4'.repeat(64), fixedAt]
        )
      })
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('blocks evidence representations that exceed the collected display policy', async () => {
    await expect(
      withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
        const sourceItem = await client.query<{ source_item_id: string }>(
          `SELECT source_item_id
             FROM appsea.source_items
            WHERE workspace_id = 'workspace-fixture-a'
            ORDER BY source_item_id
            LIMIT 1`
        )
        await client.query(
          `INSERT INTO appsea.evidence_records
             (workspace_id, evidence_id, source_item_id, normalized_text, language,
              allowed_representation, redacted, synthetic, normalization_version, content_hash,
              product_candidate, company_candidate, feature_candidate, category_candidate,
              created_at)
           VALUES ('workspace-fixture-a', 'evidence:forbidden-display', $1, 'Fixture text', 'en',
                   'excerpt', false, true, 'fixture-normalizer-v1', $2,
                   'Product', 'Company', 'Feature', 'Category', $3)`,
          [sourceItem.rows[0]!.source_item_id, '8'.repeat(64), fixedAt]
        )
      })
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('prevents unsafe fixture purposes, policy rollback, and kill-switch override', async () => {
    await expect(
      registerFixturePolicy(
        'fixture-unsafe-purpose',
        'unsafe-v1',
        fixedAt,
        ['testing', 'commercial-research'],
        '5'.repeat(64)
      )
    ).rejects.toMatchObject({ code: '22023' })

    const sourceId = 'fixture-policy-guard'
    await registerFixturePolicy(
      sourceId,
      'fixture-policy-v1',
      fixedAt,
      ['development', 'testing'],
      '6'.repeat(64)
    )
    await registerFixturePolicy(
      sourceId,
      'fixture-policy-v2',
      latestAt,
      ['development', 'testing'],
      '7'.repeat(64)
    )
    await expect(
      registerFixturePolicy(
        sourceId,
        'fixture-policy-v1',
        fixedAt,
        ['development', 'testing'],
        '6'.repeat(64)
      )
    ).rejects.toMatchObject({ code: '22023' })

    await withOwnerClient(async (client) => {
      await client.query(
        `UPDATE appsea.sources
            SET lifecycle_state = 'disabled_operator', updated_at = $2
          WHERE source_id = $1`,
        [sourceId, latestAt]
      )
    })
    await expect(
      registerFixturePolicy(
        sourceId,
        'fixture-policy-v2',
        latestAt,
        ['development', 'testing'],
        '7'.repeat(64)
      )
    ).rejects.toMatchObject({ code: '42501' })
    const guarded = await servicePool.query<{
      lifecycle_state: string
      current_policy_version: string
    }>(
      `SELECT lifecycle_state, current_policy_version
         FROM appsea.sources
        WHERE source_id = $1`,
      [sourceId]
    )
    expect(guarded.rows[0]).toEqual({
      lifecycle_state: 'disabled_operator',
      current_policy_version: 'fixture-policy-v2'
    })
  })

  it('rolls back changed evidence-only content without a partial run', async () => {
    const original = await fixtureInput()
    const changed = structuredClone(original)
    changed.runId = 'run-fixture-conflict'
    changed.campaignId = 'campaign-fixture-conflict'
    changed.idempotencyKey = 'fixture-persistence-conflict'
    changed.artifact.id = 'research-fixture-inbox-relay-conflict'
    changed.artifact.complaints[0]!.language = 'fr'

    await expect(repository.persist(changed)).rejects.toBeInstanceOf(ImmutableRecordConflictError)
    const runCount = await withWorkspaceTransaction(
      servicePool,
      original.workspaceId,
      async (client) =>
        client.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM appsea.research_runs
            WHERE workspace_id = $1 AND run_id = $2`,
          [original.workspaceId, changed.runId]
        ),
      { readOnly: true }
    )
    expect(runCount.rows[0]?.count).toBe('0')
  })

  it('guards active content and retries tombstone failures within a bounded budget', async () => {
    const target = await withWorkspaceTransaction(
      servicePool,
      'workspace-fixture-a',
      async (client) => {
        const result = await client.query<{
          source_item_id: string
          source_id: string
          source_record_id: string
          evidence_id: string
        }>(
          `SELECT source_item.source_item_id, source_item.source_id,
                  source_item.source_record_id, evidence.evidence_id
             FROM appsea.source_items source_item
             JOIN appsea.evidence_records evidence
               ON evidence.workspace_id = source_item.workspace_id
              AND evidence.source_item_id = source_item.source_item_id
            WHERE source_item.workspace_id = $1
              AND source_item.deletion_state = 'active'
              AND evidence.deletion_state = 'active'
            ORDER BY source_item.source_item_id
            LIMIT 1`,
          ['workspace-fixture-a']
        )
        return result.rows[0]
      },
      { readOnly: true }
    )
    if (!target) throw new Error('Deletion integrity fixture target was not found')

    await expect(
      withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
        await client.query(
          `UPDATE appsea.source_items
              SET raw_object_ref = 'active-rewrite-forbidden'
            WHERE workspace_id = $1 AND source_item_id = $2`,
          ['workspace-fixture-a', target.source_item_id]
        )
      })
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
        await client.query(
          `UPDATE appsea.evidence_records
              SET normalized_text = 'active-rewrite-forbidden'
            WHERE workspace_id = $1 AND evidence_id = $2`,
          ['workspace-fixture-a', target.evidence_id]
        )
      })
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
        await client.query(
          `UPDATE appsea.evidence_records
              SET redacted = true
            WHERE workspace_id = $1 AND evidence_id = $2`,
          ['workspace-fixture-a', target.evidence_id]
        )
      })
    ).rejects.toMatchObject({ code: '42501' })

    const tombstone = await deletionRepository.enqueue({
      workspaceId: 'workspace-fixture-a',
      tombstoneId: 'tombstone:integrity-guard',
      sourceId: target.source_id,
      sourceRecordId: target.source_record_id,
      reason: 'integrity-test',
      receivedAt: fixedAt
    })
    expect(tombstone.state).toBe('pending')

    await withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
      await client.query(
        `UPDATE appsea.source_items
            SET raw_object_ref = NULL,
                deletion_state = 'source_deleted',
                deletion_tombstone_id = $3
          WHERE workspace_id = $1 AND source_item_id = $2`,
        ['workspace-fixture-a', target.source_item_id, tombstone.tombstoneId]
      )
      await client.query(
        `UPDATE appsea.evidence_records
            SET normalized_text = '[Content removed under source deletion policy]',
                redacted = true,
                deletion_state = 'source_deleted',
                deletion_tombstone_id = $3
          WHERE workspace_id = $1 AND evidence_id = $2`,
        ['workspace-fixture-a', target.evidence_id, tombstone.tombstoneId]
      )
    })

    const claimed = await deletionRepository.claimNext('workspace-fixture-a')
    expect(claimed?.state).toBe('processing')
    expect(claimed?.attemptCount).toBe(1)
    const completed = await deletionRepository.complete(
      'workspace-fixture-a',
      tombstone.tombstoneId,
      2
    )
    expect(completed.state).toBe('completed')
    expect(completed.affectedObjectCount).toBe(2)

    const retryTombstone = await deletionRepository.enqueue({
      workspaceId: 'workspace-fixture-a',
      tombstoneId: 'tombstone:retryable-integrity',
      sourceId: target.source_id,
      sourceRecordId: 'record-without-evidence',
      reason: 'retry-integrity-test',
      receivedAt: fixedAt
    })
    const retryClaim = await deletionRepository.claimNext('workspace-fixture-a')
    expect(retryClaim).toMatchObject({
      tombstoneId: retryTombstone.tombstoneId,
      state: 'processing',
      attemptCount: 1
    })
    const failed = await deletionRepository.fail('workspace-fixture-a', retryTombstone.tombstoneId)
    expect(failed).toMatchObject({
      state: 'failed',
      attemptCount: 1,
      failureCode: 'deletion_propagation_failed'
    })
    expect(failed.nextAttemptAt).not.toBeNull()
    await withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
      await client.query(
        `UPDATE appsea.deletion_tombstones
            SET next_attempt_at = clock_timestamp() - interval '1 second'
          WHERE workspace_id = $1 AND tombstone_id = $2`,
        ['workspace-fixture-a', retryTombstone.tombstoneId]
      )
    })
    const reclaimedRetry = await deletionRepository.claimNext('workspace-fixture-a')
    expect(reclaimedRetry).toMatchObject({
      tombstoneId: retryTombstone.tombstoneId,
      state: 'processing',
      attemptCount: 2
    })
    expect(reclaimedRetry?.failureCode).toBeNull()
    await deletionRepository.complete('workspace-fixture-a', retryTombstone.tombstoneId, 0)

    const exhaustedTombstone = await deletionRepository.enqueue({
      workspaceId: 'workspace-fixture-a',
      tombstoneId: 'tombstone:exhausted-integrity',
      sourceId: target.source_id,
      sourceRecordId: 'record-exhausted',
      reason: 'exhausted-integrity-test',
      receivedAt: fixedAt
    })
    await withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
      await client.query(
        `UPDATE appsea.deletion_tombstones
            SET state = 'processing',
                attempt_count = 8,
                processing_started_at = $3,
                next_attempt_at = NULL
          WHERE workspace_id = $1 AND tombstone_id = $2`,
        ['workspace-fixture-a', exhaustedTombstone.tombstoneId, fixedAt]
      )
    })
    expect(await deletionRepository.claimNext('workspace-fixture-a')).toBeNull()
    const exhausted = await withWorkspaceTransaction(
      servicePool,
      'workspace-fixture-a',
      (client) =>
        client.query<{
          state: string
          attempt_count: number
          next_attempt_at: string | null
          failure_code: string | null
        }>(
          `SELECT state, attempt_count, next_attempt_at, failure_code
             FROM appsea.deletion_tombstones
            WHERE workspace_id = $1 AND tombstone_id = $2`,
          ['workspace-fixture-a', exhaustedTombstone.tombstoneId]
        ),
      { readOnly: true }
    )
    expect(exhausted.rows[0]).toMatchObject({
      state: 'failed',
      attempt_count: 8,
      next_attempt_at: null,
      failure_code: 'deletion_propagation_failed'
    })

    await expect(
      withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
        await client.query(
          `UPDATE appsea.deletion_tombstones
              SET affected_object_count = 99
            WHERE workspace_id = $1 AND tombstone_id = $2`,
          ['workspace-fixture-a', tombstone.tombstoneId]
        )
      })
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      withWorkspaceTransaction(servicePool, 'workspace-fixture-a', async (client) => {
        await client.query(
          `UPDATE appsea.deletion_tombstones
              SET state = 'pending'
            WHERE workspace_id = $1 AND tombstone_id = $2`,
          ['workspace-fixture-a', tombstone.tombstoneId]
        )
      })
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('queues complete analysis object references when a source deletion invalidates a run', async () => {
    const workspaceId = 'workspace-object-purge'
    const analysisRunId = 'analysis-run-object-purge'
    const fixedReference = (
      kind: 'workflow-artifact' | 'report-json' | 'plan-package',
      hash: string
    ) => ({
      version: 1,
      uri: `appsea-object://${workspaceId}/${kind}/${hash}`,
      workspaceId,
      kind,
      contentHash: hash,
      byteLength: 1,
      contentType: kind === 'report-json' ? 'application/json' : 'application/octet-stream',
      createdAt: fixedAt,
      retentionUntil: fixedAt,
      deletionState: 'active',
      deletedAt: null,
      deletionReason: null
    })
    const artifactReference = fixedReference('workflow-artifact', 'a'.repeat(64))
    const reportReference = fixedReference('report-json', 'b'.repeat(64))
    const planReference = fixedReference('plan-package', 'c'.repeat(64))

    try {
      await withOwnerClient(async (client) => {
        await client.query('BEGIN')
        try {
          await client.query("SELECT set_config('appsea.workspace_id', $1, true)", [workspaceId])
          await client.query(
            `INSERT INTO appsea.workspaces
               (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
             VALUES ($1, 'workspace-object-purge', 'Object purge test', 'private', false, 'active', $2, $2)`,
            [workspaceId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.research_campaigns
               (workspace_id, campaign_id, name, purpose, state, configuration, budget, synthetic,
                created_at, updated_at)
             VALUES ($1, 'campaign-object-purge', 'Object purge test', 'deletion', 'completed', '{}', '{}', false, $2, $2)`,
            [workspaceId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.research_runs
               (workspace_id, run_id, campaign_id, idempotency_key, mode, state, artifact_id,
                input_hash, artifact_snapshot, requested_at, started_at, completed_at)
             VALUES ($1, 'run-object-purge', 'campaign-object-purge',
                     'object-purge-run-idempotency', 'production', 'completed',
                     'artifact-object-purge', repeat('d', 64), '{}', $2, $2, $2)`,
            [workspaceId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.production_analysis_runs
               (workspace_id, analysis_run_id, collection_run_id, idempotency_key,
                analysis_version, input_hash, artifact_id, artifact_snapshot,
                artifact_object_ref, report_object_ref, plan_object_ref, state,
                availability_state, seed_review_id, seed_content_hash, requested_at, started_at)
             VALUES ($1, $2, 'run-object-purge', 'object-purge-analysis-idempotency',
                     'production-analysis-v1', repeat('e', 64), 'artifact-object-purge-analysis', '{}',
                     $3::jsonb, $4::jsonb, $5::jsonb, 'running', 'active',
                     'seed-object-purge', repeat('f', 64), $6, $6)`,
            [
              workspaceId,
              analysisRunId,
              JSON.stringify(artifactReference),
              JSON.stringify(reportReference),
              JSON.stringify(planReference),
              fixedAt
            ]
          )
          await client.query(
            `UPDATE appsea.production_analysis_runs
                SET availability_state = 'invalidated',
                    invalidated_at = $3,
                    invalidation_reason = 'Source deletion tombstone object-purge'
              WHERE workspace_id = $1 AND analysis_run_id = $2`,
            [workspaceId, analysisRunId, laterAt]
          )
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      })

      const queued = await withWorkspaceTransaction(
        servicePool,
        workspaceId,
        (client) =>
          client.query<{ object_kind: string; state: string; object_uri: string }>(
            `SELECT object_kind, state, object_uri
               FROM appsea.production_analysis_object_purge_jobs
              WHERE workspace_id = $1
              ORDER BY object_kind`,
            [workspaceId]
          ),
        { readOnly: true }
      )
      expect(queued.rows).toHaveLength(3)
      expect(queued.rows.every((row) => row.state === 'pending')).toBe(true)
      expect(queued.rows.map((row) => row.object_kind)).toEqual([
        'plan-package',
        'report-json',
        'workflow-artifact'
      ])
    } finally {
      await withOwnerClient(async (client) => {
        await client.query('BEGIN')
        try {
          await client.query(
            'DELETE FROM appsea.production_analysis_object_purge_jobs WHERE workspace_id = $1',
            [workspaceId]
          )
          await client.query(
            'DELETE FROM appsea.production_analysis_runs WHERE workspace_id = $1',
            [workspaceId]
          )
          await client.query('DELETE FROM appsea.research_runs WHERE workspace_id = $1', [
            workspaceId
          ])
          await client.query('DELETE FROM appsea.research_campaigns WHERE workspace_id = $1', [
            workspaceId
          ])
          await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      })
    }
  })

  it('reclaims a stale production-analysis recomputation dispatch claim', async () => {
    const workspaceId = 'workspace-recompute-reclaim'
    const sourceId = 'source-recompute-reclaim'
    const userId = 'user-recompute-reclaim'
    const campaignId = 'campaign-recompute-reclaim'
    const runId = 'run-recompute-reclaim'
    const opportunityId = 'opportunity-recompute-reclaim'
    const seedReviewId = 'seed-review-recompute-reclaim'
    const tombstoneId = 'tombstone-recompute-reclaim'
    const recomputeId = `recompute:analysis:${'a'.repeat(32)}`
    const analysisRunId = `analysis-run:${'b'.repeat(32)}`
    const recompute = new PostgresProductionAnalysisRecomputeRepository(servicePool)
    const maintenanceRecompute = new PostgresProductionAnalysisRecomputeRepository(maintenancePool)

    try {
      await withOwnerClient(async (client) => {
        await client.query('BEGIN')
        try {
          await client.query(
            `INSERT INTO appsea.users
               (user_id, email, display_name, password_hash, created_at, updated_at)
             VALUES ($1, $2, 'Recompute test user', repeat('x', 64), $3, $3)`,
            [userId, `${userId}@example.test`, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.workspaces
               (workspace_id, slug, display_name, visibility, fixture_only, status, created_at, updated_at)
             VALUES ($1, 'recompute-reclaim', 'Recompute reclaim test', 'private', false, 'active', $2, $2)`,
            [workspaceId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.sources
               (source_id, display_name, source_type, lifecycle_state, created_at, updated_at)
             VALUES ($1, 'Recompute reclaim source', 'manual', 'disabled_pending_review', $2, $2)`,
            [sourceId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.research_campaigns
               (workspace_id, campaign_id, name, purpose, state, configuration, budget, synthetic,
                created_at, updated_at)
             VALUES ($1, $2, 'Recompute reclaim campaign', 'deletion-repair', 'completed', '{}', '{}', false, $3, $3)`,
            [workspaceId, campaignId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.research_runs
               (workspace_id, run_id, campaign_id, idempotency_key, mode, state, artifact_id,
                input_hash, artifact_snapshot, requested_at, started_at, completed_at)
             VALUES ($1, $2, $3, 'recompute-reclaim-run-key', 'production', 'completed',
                     'artifact-recompute-reclaim', repeat('c', 64), '{}', $4, $4, $4)`,
            [workspaceId, runId, campaignId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.opportunities
               (workspace_id, opportunity_id, slug, name, one_line, thesis, audience, first_wedge,
                complaint_count, synthetic, state, source_run_id, invalidated_at, invalidation_reason,
                availability_state, created_at, updated_at)
             VALUES ($1, $2, 'recompute-reclaim', 'Recompute reclaim opportunity', 'Repair test',
                     'Repair test thesis', 'Test operators', 'Repair dispatch', 1, false, 'researched',
                     $3, $4, 'Source deletion test', 'invalidated', $4, $4)`,
            [workspaceId, opportunityId, runId, laterAt]
          )
          await client.query(
            `INSERT INTO appsea.research_run_opportunities
               (workspace_id, run_id, opportunity_id, linked_at)
             VALUES ($1, $2, $3, $4)`,
            [workspaceId, runId, opportunityId, laterAt]
          )
          await client.query(
            `INSERT INTO appsea.opportunity_seed_reviews
               (workspace_id, seed_review_id, seed_version, seed_payload, content_hash, review_state,
                created_by, reviewed_by, reviewed_at, approved_by, approved_at, created_at, updated_at)
             VALUES ($1, $2, 'seed-v1', $3::jsonb, repeat('d', 64), 'approved',
                     $4, $4, $5, $4, $5, $5, $5)`,
            [workspaceId, seedReviewId, JSON.stringify({ id: opportunityId }), userId, fixedAt]
          )
          await client.query(
            `INSERT INTO appsea.deletion_tombstones
               (workspace_id, tombstone_id, source_id, source_record_id, reason, state,
                received_at, completed_at, affected_object_count)
             VALUES ($1, $2, $3, 'recompute-record', 'source deletion', 'completed', $4, $5, 1)`,
            [workspaceId, tombstoneId, sourceId, fixedAt, laterAt]
          )
          await client.query(
            `INSERT INTO appsea.production_analysis_recompute_jobs
               (workspace_id, recompute_id, opportunity_id, collection_run_id, seed_review_id,
                source_tombstone_id, analysis_run_id, idempotency_key, requested_at, state,
                attempt_count, next_attempt_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'production-recompute-reclaim-key', $8,
                     'dispatching', 1, $8, $8)`,
            [
              workspaceId,
              recomputeId,
              opportunityId,
              runId,
              seedReviewId,
              tombstoneId,
              analysisRunId,
              fixedAt
            ]
          )
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      })

      const alertObservations = await maintenanceRecompute.listAlertObservations(workspaceId, 10)
      expect(alertObservations).toMatchObject([
        {
          state: 'dispatching',
          attemptCount: 1,
          requestedAt: fixedAt,
          nextAttemptAt: fixedAt,
          updatedAt: fixedAt
        }
      ])
      await expect(
        maintenancePool.query(
          'SELECT * FROM appsea.production_analysis_recompute_jobs WHERE workspace_id = $1',
          [workspaceId]
        )
      ).rejects.toMatchObject({ code: '42501' })

      const reclaimed = await recompute.claimNext(workspaceId)
      expect(reclaimed).toMatchObject({
        recomputeId,
        state: 'dispatching',
        attemptCount: 2
      })
    } finally {
      await withOwnerClient(async (client) => {
        await client.query('BEGIN')
        try {
          await client.query(
            'DELETE FROM appsea.production_analysis_recompute_jobs WHERE workspace_id = $1',
            [workspaceId]
          )
          await client.query(
            'DELETE FROM appsea.opportunity_seed_reviews WHERE workspace_id = $1',
            [workspaceId]
          )
          await client.query('DELETE FROM appsea.opportunities WHERE workspace_id = $1', [
            workspaceId
          ])
          await client.query('DELETE FROM appsea.deletion_tombstones WHERE workspace_id = $1', [
            workspaceId
          ])
          await client.query('DELETE FROM appsea.research_runs WHERE workspace_id = $1', [
            workspaceId
          ])
          await client.query('DELETE FROM appsea.research_campaigns WHERE workspace_id = $1', [
            workspaceId
          ])
          await client.query('DELETE FROM appsea.workspaces WHERE workspace_id = $1', [workspaceId])
          await client.query('DELETE FROM appsea.sources WHERE source_id = $1', [sourceId])
          await client.query('DELETE FROM appsea.users WHERE user_id = $1', [userId])
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      })
    }
  })

  it('rejects unknown applied migration history', async () => {
    try {
      await withOwnerClient(async (client) => {
        await client.query(
          `INSERT INTO public.appsea_schema_migrations
             (version, filename, checksum, execution_ms)
           VALUES ('9999', '9999_unknown.sql', $1, 0)`,
          ['9'.repeat(64)]
        )
      })
      await expect(migrateDatabase(migrationPool, migrationOptions)).rejects.toBeInstanceOf(
        MigrationHistoryError
      )
    } finally {
      await withOwnerClient(async (client) => {
        await client.query("DELETE FROM public.appsea_schema_migrations WHERE version = '9999'")
      })
    }
  })
})
