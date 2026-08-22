import type { ProductionAnalysisHandoffReadModel } from '@appsea/contracts'

export function analysisHandoffNeedsManualRetry(
  handoff: ProductionAnalysisHandoffReadModel | null
): boolean {
  return handoff?.state === 'failed'
}

export function analysisHandoffStatusCopy(
  state: ProductionAnalysisHandoffReadModel['state']
): string {
  switch (state) {
    case 'queued':
      return 'Queued for the durable worker from the retained evidence and approved seed.'
    case 'dispatching':
      return 'The durable worker is starting this reviewed handoff.'
    case 'started':
      return 'The durable analysis workflow is running.'
    case 'failed':
      return 'The automatic handoff stopped; review the failure and retry explicitly if needed.'
  }
}
