import { pathToFileURL } from 'node:url'
import {
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresSourcePolicyRepository
} from '@appsea/db'

export interface SourcePolicyStatusEnvironment {
  databaseUrl: string
  sourceId: string
  policyVersion: string
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function sourcePolicyStatusEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): SourcePolicyStatusEnvironment {
  return {
    databaseUrl: required(environment, 'APPSEA_POLICY_DATABASE_URL'),
    sourceId: required(environment, 'APPSEA_POLICY_SOURCE_ID'),
    policyVersion: required(environment, 'APPSEA_POLICY_VERSION')
  }
}

export async function runSourcePolicyStatus(
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const input = sourcePolicyStatusEnvironment(environment)
  const pool = createDatabasePool(
    databaseConfigFromEnv({ ...environment, DATABASE_URL: input.databaseUrl })
  )
  try {
    const status = await new PostgresSourcePolicyRepository(pool).readApprovalProgress(
      input.sourceId,
      input.policyVersion
    )
    if (!status) throw new Error('source policy was not found')
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runSourcePolicyStatus()
  } catch {
    process.stderr.write('source policy approval progress could not be read\n')
    process.exitCode = 1
  }
}
