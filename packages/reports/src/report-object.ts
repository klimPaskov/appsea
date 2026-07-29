import {
  opportunityReportSchema,
  type ObjectReference,
  type OpportunityReport
} from '@appsea/contracts'
import type { ObjectStore, ObjectStorePutInput } from '@appsea/object-store'

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function encodeOpportunityReport(report: OpportunityReport): Uint8Array {
  const parsed = opportunityReportSchema.parse(report)
  return new TextEncoder().encode(stableJson(parsed))
}

export function decodeOpportunityReport(body: Uint8Array): OpportunityReport {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    return opportunityReportSchema.parse(JSON.parse(text))
  } catch {
    throw new Error('Stored opportunity report is invalid')
  }
}

export function storeOpportunityReport(
  store: ObjectStore,
  input: Omit<ObjectStorePutInput, 'kind' | 'body' | 'contentType'> & {
    report: OpportunityReport
  }
): Promise<ObjectReference> {
  return store.put({
    ...input,
    kind: 'report-json',
    body: encodeOpportunityReport(input.report),
    contentType: 'application/json; charset=utf-8'
  })
}
