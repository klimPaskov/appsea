import { getObjectStore } from '../../../../server/object-store'
import { getDatabasePool } from '../../../../server/database'
import { checkTemporalWorkflowClient } from '../../../../server/temporal'
import {
  evaluateReadiness,
  healthResponseHeaders,
  type ReadinessCheck
} from '../../../../server/health'

export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const checks: ReadinessCheck[] = [
    {
      name: 'database',
      run: async () => {
        await getDatabasePool().query('SELECT 1')
      }
    },
    {
      name: 'temporal',
      run: checkTemporalWorkflowClient
    },
    {
      name: 'objectStore',
      run: () => {
        getObjectStore()
      }
    }
  ]
  const report = await evaluateReadiness(checks)
  return Response.json(
    {
      service: 'appsea-web',
      ...report,
      observedAt: new Date().toISOString()
    },
    { status: report.status === 'ready' ? 200 : 503, headers: healthResponseHeaders }
  )
}
