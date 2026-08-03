import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthMfaVerificationError } from '@appsea/db/auth'
import { POST as completeMfaLogin } from './api/auth/mfa/login/route'
import { GET as readMfaStatus } from './api/auth/mfa/status/route'
import { POST as beginMfaEnrollment } from './api/auth/mfa/enroll/route'
import { POST as confirmMfaEnrollment } from './api/auth/mfa/enroll/confirm/route'
import { DELETE as disableMfa } from './api/auth/mfa/route'

const mocks = vi.hoisted(() => ({
  repository: {
    completeMfaSignIn: vi.fn(),
    readMfaStatus: vi.fn(),
    beginMfaEnrollment: vi.fn(),
    confirmMfaEnrollment: vi.fn(),
    disableMfa: vi.fn(),
    hasRecentReauthentication: vi.fn()
  },
  allowAuthAttempt: vi.fn(),
  readSession: vi.fn(),
  readSessionToken: vi.fn(),
  sameOriginRequest: vi.fn()
}))

vi.mock('../server/auth-session', () => ({
  allowAuthAttempt: mocks.allowAuthAttempt,
  authRepository: () => mocks.repository,
  invalidRequest: (message: string) =>
    Response.json(
      { error: message },
      { status: 400, headers: { 'cache-control': 'private, no-store' } }
    ),
  privateResponseHeaders: { 'cache-control': 'private, no-store' },
  readSession: mocks.readSession,
  readSessionToken: mocks.readSessionToken,
  reauthenticationRequiredResponse: () =>
    Response.json(
      { error: 'Recent reauthentication required' },
      { status: 428, headers: { 'cache-control': 'private, no-store' } }
    ),
  sameOriginRequest: mocks.sameOriginRequest,
  sessionCookieName: 'appsea_session',
  sessionCookieOptions: () => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 2_592_000,
    priority: 'high'
  }),
  unauthorizedResponse: () =>
    Response.json(
      { error: 'Authentication required' },
      { status: 401, headers: { 'cache-control': 'private, no-store' } }
    )
}))

const token = 'a'.repeat(48)
const session = {
  user: { userId: 'user:one', email: 'user@example.com' },
  workspaces: [{ workspaceId: 'workspace:one', role: 'owner' }]
}
const status = { enabled: false, enrolledAt: null, recoveryCodesRemaining: 0 }
const enrollment = {
  secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  otpauthUri:
    'otpauth://totp/AppSea%3Auser%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=AppSea&algorithm=SHA1&digits=6&period=30',
  recoveryCodes: [
    'ABCD-EFGH-IJKL-MNOP',
    'QRST-UVWX-YZ23-4567',
    'ABCD-EFGH-IJKL-MNO2',
    'QRST-UVWX-YZ23-456A',
    'ABCD-EFGH-IJKL-MNO3',
    'QRST-UVWX-YZ23-456B',
    'ABCD-EFGH-IJKL-MNO4',
    'QRST-UVWX-YZ23-456C',
    'ABCD-EFGH-IJKL-MNO5',
    'QRST-UVWX-YZ23-456D'
  ],
  expiresAt: '2026-08-03T00:10:00.000Z'
}

function request(path: string, body?: unknown): Request {
  return new Request(`https://appsea.example${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}

describe('MFA authentication routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.allowAuthAttempt.mockResolvedValue(true)
    mocks.readSessionToken.mockResolvedValue(token)
    mocks.readSession.mockResolvedValue(session)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    mocks.repository.readMfaStatus.mockResolvedValue(status)
    mocks.repository.beginMfaEnrollment.mockResolvedValue(enrollment)
    mocks.repository.confirmMfaEnrollment.mockResolvedValue({
      enabled: true,
      enrolledAt: '2026-08-03T00:00:00.000Z',
      recoveryCodesRemaining: 10
    })
    mocks.repository.disableMfa.mockResolvedValue(status)
    mocks.repository.completeMfaSignIn.mockResolvedValue({
      mfaRequired: false,
      token: 'b'.repeat(48),
      session
    })
  })

  it('keeps MFA challenges separate from session cookies and rate limits attempts', async () => {
    const response = await completeMfaLogin(
      request('/api/auth/mfa/login', { challengeToken: token, code: '123456' })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('appsea_session=')
    expect(mocks.allowAuthAttempt).toHaveBeenCalledWith(expect.any(Request), token, 'mfa')

    mocks.allowAuthAttempt.mockResolvedValue(false)
    const limited = await completeMfaLogin(
      request('/api/auth/mfa/login', { challengeToken: token, code: '123456' })
    )
    expect(limited.status).toBe(429)
    expect(mocks.repository.completeMfaSignIn).toHaveBeenCalledTimes(1)
  })

  it('requires same-origin, session step-up, and an exact enrollment confirmation', async () => {
    mocks.sameOriginRequest.mockReturnValue(false)
    expect((await beginMfaEnrollment(request('/api/auth/mfa/enroll', {}))).status).toBe(403)

    mocks.sameOriginRequest.mockReturnValue(true)
    mocks.repository.hasRecentReauthentication.mockResolvedValue(false)
    expect((await beginMfaEnrollment(request('/api/auth/mfa/enroll', {}))).status).toBe(428)
    expect(mocks.repository.beginMfaEnrollment).not.toHaveBeenCalled()

    mocks.repository.hasRecentReauthentication.mockResolvedValue(true)
    const started = await beginMfaEnrollment(request('/api/auth/mfa/enroll', {}))
    expect(started.status).toBe(200)
    await expect(started.json()).resolves.toEqual({ data: enrollment })

    const confirmed = await confirmMfaEnrollment(
      request('/api/auth/mfa/enroll/confirm', { code: '123456' })
    )
    expect(confirmed.status).toBe(200)
    expect(mocks.repository.confirmMfaEnrollment).toHaveBeenCalledWith(token, { code: '123456' })
    expect(mocks.allowAuthAttempt).toHaveBeenCalledWith(expect.any(Request), token, 'mfa')

    mocks.allowAuthAttempt.mockResolvedValue(false)
    const limited = await confirmMfaEnrollment(
      request('/api/auth/mfa/enroll/confirm', { code: '123456' })
    )
    expect(limited.status).toBe(429)
    expect(mocks.repository.confirmMfaEnrollment).toHaveBeenCalledTimes(1)
  })

  it('exposes only bounded MFA status and protects disable with step-up and code', async () => {
    const statusResponse = await readMfaStatus()
    expect(statusResponse.status).toBe(200)
    await expect(statusResponse.json()).resolves.toEqual({ data: status })

    const disabled = await disableMfa(request('/api/auth/mfa', { code: 'ABCD-EFGH-IJKL-MNOP' }))
    expect(disabled.status).toBe(200)
    expect(mocks.repository.disableMfa).toHaveBeenCalledWith(token, {
      code: 'ABCD-EFGH-IJKL-MNOP'
    })

    mocks.repository.disableMfa.mockRejectedValue(new AuthMfaVerificationError())
    const invalid = await disableMfa(request('/api/auth/mfa', { code: 'ABCD-EFGH-IJKL-MNOP' }))
    expect(invalid.status).toBe(422)
  })
})
