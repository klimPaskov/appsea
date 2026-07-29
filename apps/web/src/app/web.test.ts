import { describe, expect, it, vi } from 'vitest'
import { seedOpportunities } from '@appsea/catalog'
import { sameOriginRequest, sessionCookieOptions } from '../server/auth-session'

describe('leaderboard data', () => {
  it('has the four fields required by the sparse leaderboard', () => {
    const row = seedOpportunities[0]
    expect(row).toBeDefined()
    expect({
      rank: 1,
      opportunity: row!.name,
      complaints: row!.complaintCount,
      score: row!.scoreSnapshot.score
    }).toEqual({
      rank: 1,
      opportunity: 'Inbox Relay',
      complaints: 482,
      score: row!.scoreSnapshot.score
    })
  })

  it('requires the configured HTTPS origin and secure cookie settings in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APPSEA_PUBLIC_ORIGIN', 'https://appsea.example')
    try {
      expect(
        sameOriginRequest(
          new Request('https://appsea.example/api/auth/login', {
            headers: { origin: 'https://appsea.example' }
          })
        )
      ).toBe(true)
      expect(sameOriginRequest(new Request('https://appsea.example/api/auth/login'))).toBe(false)
      expect(
        sameOriginRequest(
          new Request('https://appsea.example/api/auth/login', {
            headers: { origin: 'https://evil.example' }
          })
        )
      ).toBe(false)
      expect(
        sameOriginRequest(
          new Request('https://appsea.example/api/auth/login', {
            headers: {
              origin: 'https://appsea.example',
              'sec-fetch-site': 'cross-site'
            }
          })
        )
      ).toBe(false)
      expect(sessionCookieOptions().secure).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
