import { seedOpportunities } from '@appsea/catalog'

export function GET() {
  return Response.json({
    data: seedOpportunities,
    meta: {
      mode: 'fixture',
      synthetic: true,
      scoreVersion: seedOpportunities[0]?.scoreSnapshot.version ?? null
    }
  })
}
