import type { Pool } from 'pg'
import {
  productionAnalysisPersistenceInputSchema,
  type ProductionAnalysisPersistenceInput,
  type ProductionAnalysisResult
} from '@appsea/contracts'
import {
  PostgresProductionAnalysisRepository,
  ProductionAnalysisAvailabilityError
} from '@appsea/db'
import type { ObjectStore } from '@appsea/object-store'

/**
 * Durable-job seam for the post-collection analysis stage. Temporal (or a
 * scheduler) may retry this function freely: the repository owns the
 * idempotency key, immutable lineage checks, and terminal output commit.
 */
export async function runProductionAnalysis(
  pool: Pool,
  objectStore: ObjectStore,
  input: ProductionAnalysisPersistenceInput
): Promise<ProductionAnalysisResult> {
  const parsed = productionAnalysisPersistenceInputSchema.parse(input)
  return new PostgresProductionAnalysisRepository(pool, objectStore).persist(parsed)
}

export function isProductionAnalysisUnavailable(error: unknown): boolean {
  return error instanceof ProductionAnalysisAvailabilityError
}
