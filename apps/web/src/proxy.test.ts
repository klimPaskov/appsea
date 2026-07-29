import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from './proxy'

describe('reset-password proxy security boundary', () => {
  it('emits a per-response nonce CSP without unsafe inline scripts', () => {
    const response = proxy(new NextRequest('https://appsea.example/reset-password'))
    const policy = response.headers.get('content-security-policy') ?? ''

    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+'/)
    expect(policy).not.toContain("'unsafe-inline'")
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })
})
