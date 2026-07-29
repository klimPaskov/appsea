import { planPackageSchema, type ObjectReference, type PlanPackage } from '@appsea/contracts'
import { type ObjectStore, type ObjectStorePutInput } from '@appsea/object-store'

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function encodePlanPackage(planPackage: PlanPackage): Uint8Array {
  const parsed = planPackageSchema.parse(planPackage)
  return new TextEncoder().encode(stableJson(parsed))
}

export function decodePlanPackage(body: Uint8Array): PlanPackage {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    return planPackageSchema.parse(JSON.parse(text))
  } catch {
    throw new Error('Stored plan package is not valid AppSea package JSON')
  }
}

export async function storePlanPackage(
  store: ObjectStore,
  input: Omit<ObjectStorePutInput, 'kind' | 'body' | 'contentType'> & { planPackage: PlanPackage }
): Promise<ObjectReference> {
  return store.put({
    workspaceId: input.workspaceId,
    kind: 'plan-package',
    body: encodePlanPackage(input.planPackage),
    contentType: 'application/json',
    createdAt: input.createdAt,
    retentionUntil: input.retentionUntil ?? null
  })
}
