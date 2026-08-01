import { healthResponseHeaders, livenessPayload } from '../../../../server/health'

export const runtime = 'nodejs'

export function GET(): Response {
  return Response.json(livenessPayload(), { headers: healthResponseHeaders })
}
