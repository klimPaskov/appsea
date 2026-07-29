import { ApplicationFailure } from '@temporalio/activity'
import { describe, expect, it } from 'vitest'
import { sanitizedActivityFailure } from './workflow-activities'

describe('workflow activity failure boundary', () => {
  it('replaces arbitrary Temporal failures with a fixed retryable failure', () => {
    const failure = ApplicationFailure.create({
      message: 'raw complaint text and bearer-secret',
      type: 'RAW_SOURCE_FAILURE',
      details: ['private payload'],
      nonRetryable: true
    })
    const sanitized = sanitizedActivityFailure(failure)
    expect(sanitized.type).toBe('APPSEA_ACTIVITY_FAILED')
    expect(sanitized.message).toBe('The fixture workflow activity failed.')
    expect(sanitized.nonRetryable).toBe(false)
    expect(sanitized.details).toBeUndefined()
    expect(sanitized.message).not.toContain('bearer-secret')
  })

  it('preserves only an allowlisted fixed failure type and creates a new object', () => {
    const failure = ApplicationFailure.nonRetryable('raw invalid input', 'APPSEA_INPUT_INVALID')
    const sanitized = sanitizedActivityFailure(failure)
    expect(sanitized.type).toBe('APPSEA_INPUT_INVALID')
    expect(sanitized.message).toBe('The fixture workflow activity rejected the request.')
    expect(sanitized).not.toBe(failure)
  })

  it('maps ordinary errors to a bounded retryable failure', () => {
    const sanitized = sanitizedActivityFailure(new Error('database secret'))
    expect(sanitized.type).toBe('APPSEA_ACTIVITY_FAILED')
    expect(sanitized.message).toBe('The fixture workflow activity failed.')
  })
})
