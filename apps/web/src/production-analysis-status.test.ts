import { describe, expect, it } from 'vitest'
import { mapProductionAnalysisWorkflowStatus } from './server/production-analysis-status'

const workflowId = 'workflow:analysis:workspace:one:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('production analysis status mapping', () => {
  it('maps queued workflow state without returning the Temporal input hash', () => {
    const mapped = mapProductionAnalysisWorkflowStatus(
      {
        workflowId,
        temporalFirstExecutionRunId: '00000000-0000-4000-8000-000000000001',
        inputHash: 'a'.repeat(64),
        state: 'running',
        checkpoint: 'persisting',
        activityAttempts: 1,
        result: null
      },
      'analysis:one'
    )

    expect(mapped).toMatchObject({
      analysisRunId: 'analysis:one',
      state: 'running',
      checkpoint: 'persisting',
      activityAttempts: 1,
      availabilityState: 'pending'
    })
    expect(mapped).not.toHaveProperty('inputHash')
  })
})
