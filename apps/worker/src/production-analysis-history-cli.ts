import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Connection } from '@temporalio/client'
import { temporalClientConfigFromEnv, temporalConnectionOptions } from '@appsea/workflows'
import {
  createProductionAnalysisHistoryVisibilityClient,
  inspectProductionAnalysisHistory,
  productionAnalysisHistoryCheckerDefaults,
  readProductionAnalysisHistoryManifest
} from './production-analysis-history'

function positiveIntegerFromEnv(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`)
  }
  return value
}

function invokedDirectly(): boolean {
  const modulePath = fileURLToPath(import.meta.url)
  return process.argv.slice(1).some((argument) => {
    try {
      return path.resolve(argument) === modulePath
    } catch {
      return false
    }
  })
}

async function main(): Promise<void> {
  const config = temporalClientConfigFromEnv()
  const connection = await Connection.connect(temporalConnectionOptions(config))
  try {
    const manifestPath = process.env.APPSEA_TEMPORAL_LEGACY_HISTORY_MANIFEST?.trim()
    const manifest = manifestPath
      ? await readProductionAnalysisHistoryManifest(manifestPath)
      : undefined
    const historyOptions = {
      pageSize: positiveIntegerFromEnv(
        'APPSEA_TEMPORAL_HISTORY_PAGE_SIZE',
        productionAnalysisHistoryCheckerDefaults.pageSize,
        100
      ),
      maxExecutions: positiveIntegerFromEnv(
        'APPSEA_TEMPORAL_HISTORY_MAX_EXECUTIONS',
        productionAnalysisHistoryCheckerDefaults.maxExecutions,
        10_000
      ),
      ...(manifest ? { manifest } : {})
    }
    const result = await inspectProductionAnalysisHistory(
      createProductionAnalysisHistoryVisibilityClient(connection.workflowService, config.namespace),
      historyOptions
    )
    console.log(JSON.stringify(result, null, 2))
    // A non-zero exit prevents a deployment from silently removing the v1
    // worker while old or unclassified histories remain visible.
    if (result.status !== 'clear') process.exitCode = 2
  } finally {
    await connection.close()
  }
}

if (invokedDirectly()) {
  await main()
}
