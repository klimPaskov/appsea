import { workspaceInvitationDeliveryBatchInputSchema } from '@appsea/contracts'
import { createDatabasePool, databaseConfigFromEnv, PostgresAuthRepository } from '@appsea/db'
import { emitWorkerEvent } from './observability'
import { createWorkspaceInvitationDeliveryClient } from './workspace-invitation-delivery'
import { runWorkspaceInvitationBatch } from './workspace-invitation-runner'

const taskQueue = 'appsea-workspace-invitations-v1'
const enabled =
  process.env.NODE_ENV !== 'production' || process.env.APPSEA_AUTH_INVITATIONS_ENABLED === 'true'

if (!enabled) {
  emitWorkerEvent({
    event: 'workspace_invitation_delivery_disabled',
    taskQueue,
    failureCode: 'APPSEA_WORKSPACE_INVITATIONS_DISABLED'
  })
} else {
  const batchSize = Number(process.env.APPSEA_WORKSPACE_INVITATION_DELIVERY_BATCH_SIZE ?? '100')
  const input = workspaceInvitationDeliveryBatchInputSchema.safeParse({ batchSize })
  const jobId = `workspace-invitations:${Math.floor(Date.now() / 60_000)}`
  let pool: ReturnType<typeof createDatabasePool> | undefined
  try {
    if (!input.success) throw new Error('invalid batch size')
    const delivery = createWorkspaceInvitationDeliveryClient()
    pool = createDatabasePool(databaseConfigFromEnv())
    const result = await runWorkspaceInvitationBatch(input.data.batchSize, {
      auth: new PostgresAuthRepository(pool),
      delivery
    })
    emitWorkerEvent({
      event: 'workspace_invitation_delivery_finished',
      taskQueue,
      jobId,
      workspaceInvitationDeliveriesClaimed: result.claimed,
      workspaceInvitationDeliveriesSent: result.sent,
      workspaceInvitationDeliveriesFailed: result.failed
    })
  } catch {
    emitWorkerEvent({
      event: 'workspace_invitation_delivery_failed',
      taskQueue,
      jobId,
      failureCode: 'APPSEA_WORKSPACE_INVITATION_DELIVERY_FAILED'
    })
    process.exitCode = 1
  } finally {
    if (pool) await pool.end()
  }
}
