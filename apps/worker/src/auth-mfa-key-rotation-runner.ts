import {
  authMfaKeyRotationRewrapInputSchema,
  type AuthMfaKeyRotationRewrapResult,
  type MaintenanceSchedulerFence
} from '@appsea/contracts'
import type { PostgresAuthRepository } from '@appsea/db'

export interface AuthMfaKeyRotationDependencies {
  assertLease?: () => Promise<void>
  fence?: MaintenanceSchedulerFence
  auth: Pick<PostgresAuthRepository, 'rewrapMfaKeyBatch'>
}

/**
 * Run exactly one bounded, idempotent MFA ciphertext rewrap batch. The
 * scheduler owns the outer loop so a lease loss stops before the next
 * transaction and a later invocation can resume by key version.
 */
export async function runAuthMfaKeyRotationBatch(
  batchSize: number,
  dependencies: AuthMfaKeyRotationDependencies
): Promise<AuthMfaKeyRotationRewrapResult> {
  const input = authMfaKeyRotationRewrapInputSchema.parse({ batchSize })
  const assertLease = dependencies.assertLease ?? (async () => undefined)
  await assertLease()
  return dependencies.auth.rewrapMfaKeyBatch(input, dependencies.fence)
}
