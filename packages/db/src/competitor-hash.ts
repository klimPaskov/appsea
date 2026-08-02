import type { Competitor } from '@appsea/contracts'
import { contentHash } from './hash'

/**
 * Feature matrices were added after the first competitor rows shipped. Keep
 * empty matrices compatible with the original hash while including populated
 * matrices in new immutable content hashes.
 */
export function competitorContentHash(competitor: Competitor): string {
  if (competitor.featureMatrix.length === 0) {
    const { featureMatrix, ...legacyCompetitor } = competitor
    void featureMatrix
    return contentHash(legacyCompetitor)
  }
  return contentHash(competitor)
}
