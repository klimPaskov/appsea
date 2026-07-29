import type {
  SourceQuotaLedger,
  SourceQuotaReservationInput,
  SourceQuotaSettlementInput
} from '@appsea/connectors'
import { PostgresSourceQuotaRepository } from '@appsea/db'
import type { Pool } from 'pg'

/** Keep the connector capability narrow while the database owns SQL policy. */
export function createSourceQuotaLedger(pool: Pool): SourceQuotaLedger {
  const repository = new PostgresSourceQuotaRepository(pool)
  return {
    reserve: (input: SourceQuotaReservationInput) => repository.reserve(input),
    commit: (input: SourceQuotaSettlementInput) => repository.commit(input),
    release: (input) => repository.release(input)
  }
}
