import { campaignHistoryCursorSchema, type CampaignHistoryCursor } from '@appsea/contracts'

export type CampaignHistoryCursorKind = 'runs' | 'orchestrations'

function cursorItemId(value: string): string {
  const parsed = campaignHistoryCursorSchema.shape.itemId.safeParse(value)
  if (!parsed.success) throw new Error('Campaign history cursor item ID is invalid')
  return parsed.data
}

export function encodeCampaignHistoryCursor(
  kind: CampaignHistoryCursorKind,
  requestedAt: string,
  itemId: string
): string {
  const parsed = campaignHistoryCursorSchema.parse({
    version: 1,
    requestedAt,
    itemId: cursorItemId(itemId)
  })
  return Buffer.from(JSON.stringify({ ...parsed, kind }), 'utf8').toString('base64url')
}

export function decodeCampaignHistoryCursor(
  value: string,
  expectedKind: CampaignHistoryCursorKind
): CampaignHistoryCursor {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const candidate = JSON.parse(decoded) as unknown
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      (candidate as { kind?: unknown }).kind !== expectedKind
    ) {
      throw new Error('Campaign history cursor kind mismatch')
    }
    const payload = { ...(candidate as Record<string, unknown>) }
    delete payload.kind
    return campaignHistoryCursorSchema.parse(payload)
  } catch {
    throw new Error('Campaign history cursor is invalid')
  }
}
