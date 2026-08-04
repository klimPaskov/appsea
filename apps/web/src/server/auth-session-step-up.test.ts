import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  hasRecentReauthentication: vi.fn(),
  hasRecentMfaReauthentication: vi.fn()
}))

vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('../server/database', () => ({ getDatabasePool: () => ({}) }))
vi.mock('@appsea/db/auth', () => ({
  PostgresAuthRepository: class {
    hasRecentReauthentication = mocks.hasRecentReauthentication
    hasRecentMfaReauthentication = mocks.hasRecentMfaReauthentication
  }
}))

import { requireRecentMutationStepUp, sessionCookieName } from './auth-session'

describe('requireRecentMutationStepUp', () => {
  beforeEach(() => {
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'a'.repeat(48) }) })
    mocks.hasRecentReauthentication.mockReset()
    mocks.hasRecentMfaReauthentication.mockReset()
    mocks.hasRecentReauthentication.mockResolvedValue(true)
    mocks.hasRecentMfaReauthentication.mockResolvedValue(true)
  })

  it('returns unauthorized when the session cookie is absent or malformed', async () => {
    const get = vi.fn().mockReturnValue(undefined)
    mocks.cookies.mockResolvedValue({ get })

    const response = await requireRecentMutationStepUp()

    expect(response?.status).toBe(401)
    expect(get).toHaveBeenCalledWith(sessionCookieName)
    expect(mocks.hasRecentReauthentication).not.toHaveBeenCalled()
  })

  it('requires a recent password step-up before checking MFA', async () => {
    mocks.hasRecentReauthentication.mockResolvedValue(false)

    const response = await requireRecentMutationStepUp()

    expect(response?.status).toBe(428)
    await expect(response?.json()).resolves.toEqual({ error: 'Recent reauthentication required' })
    expect(mocks.hasRecentMfaReauthentication).not.toHaveBeenCalled()
  })

  it('requires a recent MFA proof when the account policy requires it', async () => {
    mocks.hasRecentMfaReauthentication.mockResolvedValue(false)

    const response = await requireRecentMutationStepUp()

    expect(response?.status).toBe(428)
    await expect(response?.json()).resolves.toEqual({ error: 'Recent MFA verification required' })
  })

  it('allows the mutation after both session-bound proofs pass', async () => {
    await expect(requireRecentMutationStepUp()).resolves.toBeNull()
    expect(mocks.hasRecentReauthentication).toHaveBeenCalledWith('a'.repeat(48))
    expect(mocks.hasRecentMfaReauthentication).toHaveBeenCalledWith('a'.repeat(48))
  })
})
