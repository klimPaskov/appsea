import { authRetentionInputSchema } from '@appsea/contracts'
import { createDatabasePool, databaseConfigFromEnv, PostgresAuthRepository } from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { runAuthRetention } from './maintenance-runner'

const taskQueue = 'appsea-auth-maintenance-v1'
const retentionDays = Number(process.env.APPSEA_AUTH_RETENTION_DAYS ?? '7')
const batchSize = Number(process.env.APPSEA_AUTH_RETENTION_BATCH_SIZE ?? '1000')
const input = {
  jobId:
    process.env.APPSEA_AUTH_MAINTENANCE_JOB_ID ??
    `maintenance:auth:${Math.floor(Date.now() / 60_000)}`,
  retentionDays,
  batchSize
}
const validatedJobId = authRetentionInputSchema.safeParse(input).success
  ? authRetentionInputSchema.parse(input).jobId
  : undefined
const pool = createDatabasePool(databaseConfigFromEnv())

try {
  const result = await runAuthRetention(input, {
    auth: new PostgresAuthRepository(pool)
  })
  emitWorkerEvent({
    event: 'auth_retention_finished',
    taskQueue,
    jobId: result.jobId,
    sessionsDeleted: result.sessionsDeleted,
    rateLimitsDeleted: result.rateLimitsDeleted,
    passwordResetTokensDeleted: result.passwordResetTokensDeleted,
    workspaceInvitationsDeleted: result.workspaceInvitationsDeleted
  })
} catch {
  emitWorkerEvent({
    event: 'auth_retention_failed',
    taskQueue,
    ...(validatedJobId ? { jobId: validatedJobId } : {}),
    failureCode: 'APPSEA_AUTH_RETENTION_FAILED'
  })
  process.exitCode = 1
} finally {
  await pool.end()
}
