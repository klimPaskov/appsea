import type { ProductionOpportunitySeedRead } from '@appsea/contracts'
import { contentHash } from './hash'

/**
 * Feature matrices were added after opportunity seed reviews already existed.
 * Empty matrices preserve the legacy seed digest; populated matrices become
 * part of the immutable seed content identity.
 */
export function opportunitySeedContentHash(seed: ProductionOpportunitySeedRead): string {
  return contentHash({
    ...seed,
    competitors: seed.competitors.map((competitor) => {
      if (competitor.featureMatrix.length === 0) {
        const { featureMatrix, ...legacyCompetitor } = competitor
        void featureMatrix
        return legacyCompetitor
      }
      return competitor
    })
  })
}
