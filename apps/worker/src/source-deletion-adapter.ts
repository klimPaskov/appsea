import { sourceDeletionEventSchema, type SourceDeletionEvent } from '@appsea/contracts'
import { contentHash } from '@appsea/db'
import type { DeletionTombstoneRecord, PostgresDeletionPropagationRepository } from '@appsea/db'

/** Convert connector deletion events into durable, deterministic tombstones. */
export async function persistConnectorDeletions(
  repository: PostgresDeletionPropagationRepository,
  workspaceId: string,
  events: readonly SourceDeletionEvent[]
): Promise<DeletionTombstoneRecord[]> {
  const records: DeletionTombstoneRecord[] = []
  for (const rawEvent of events) {
    const event = sourceDeletionEventSchema.parse(rawEvent)
    const tombstoneId = `tombstone:${contentHash({
      workspaceId,
      sourceId: event.sourceId,
      sourceRecordId: event.sourceRecordId,
      reason: event.reason
    }).slice(0, 48)}`
    records.push(
      await repository.enqueue({
        workspaceId,
        tombstoneId,
        sourceId: event.sourceId,
        sourceRecordId: event.sourceRecordId,
        reason: event.reason,
        receivedAt: event.observedAt
      })
    )
  }
  return records
}
