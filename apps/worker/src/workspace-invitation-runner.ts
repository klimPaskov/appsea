import { workspaceInvitationDeliveryBatchInputSchema } from '@appsea/contracts'
import type { PostgresAuthRepository, WorkspaceInvitationDeliveryRecord } from '@appsea/db'
import { MaintenanceSchedulerLeaseLostError } from './maintenance-scheduler'

export interface WorkspaceInvitationBatchResult {
  claimed: number
  sent: number
  failed: number
}

export interface WorkspaceInvitationBatchDependencies {
  assertLease?: () => Promise<void>
  auth: Pick<
    PostgresAuthRepository,
    | 'claimWorkspaceInvitationDeliveries'
    | 'completeWorkspaceInvitationDelivery'
    | 'failWorkspaceInvitationDelivery'
  >
  delivery: { send(record: WorkspaceInvitationDeliveryRecord): Promise<void> }
}

export async function runWorkspaceInvitationBatch(
  batchSize: number,
  dependencies: WorkspaceInvitationBatchDependencies
): Promise<WorkspaceInvitationBatchResult> {
  const input = workspaceInvitationDeliveryBatchInputSchema.parse({ batchSize })
  const assertLease = dependencies.assertLease ?? (async () => undefined)
  await assertLease()
  const records = await dependencies.auth.claimWorkspaceInvitationDeliveries(input.batchSize)
  let sent = 0
  let failed = 0
  for (const record of records) {
    try {
      await assertLease()
      if (
        !Number.isFinite(Date.parse(record.expiresAt)) ||
        Date.parse(record.expiresAt) <= Date.now()
      ) {
        throw new Error('expired delivery')
      }
      await dependencies.delivery.send(record)
      await assertLease()
      await dependencies.auth.completeWorkspaceInvitationDelivery(record.deliveryId)
      sent += 1
    } catch (error) {
      if (error instanceof MaintenanceSchedulerLeaseLostError) throw error
      failed += 1
      try {
        await assertLease()
        await dependencies.auth.failWorkspaceInvitationDelivery(
          record.deliveryId,
          'APPSEA_WORKSPACE_INVITATION_DELIVERY_FAILED'
        )
      } catch {
        // The database lease remains recoverable; preserve the fixed failure
        // event instead of logging a provider or database error.
      }
    }
  }
  return { claimed: records.length, sent, failed }
}
