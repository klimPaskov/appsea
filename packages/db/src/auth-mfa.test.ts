import { describe, expect, it } from 'vitest'

import {
  base32Decode,
  base32Encode,
  buildMfaOtpAuthUri,
  generateMfaRecoveryCodes,
  generateMfaSecret,
  hashMfaRecoveryCode,
  isMfaRecoveryCode,
  totpCodeAt,
  verifyMfaTotpCode
} from './auth-mfa'

describe('authentication MFA primitives', () => {
  it('round-trips base32 and generates an enrollment secret', () => {
    const bytes = Buffer.from('hello appsea', 'utf8')
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
    expect(generateMfaSecret()).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('matches RFC 6238 SHA-1 vectors and rejects replayed steps', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
    expect(totpCodeAt(secret, 59_000)).toBe('94287082'.slice(-6))
    const code = totpCodeAt(secret, 59_000)
    expect(verifyMfaTotpCode(secret, code, 59_000, null)).toBe(1)
    expect(verifyMfaTotpCode(secret, code, 59_000, 1)).toBeNull()
    expect(verifyMfaTotpCode(secret, code, 59_000, null, 0)).toBe(1)
  })

  it('creates high-entropy recovery codes and only hashes normalized values', () => {
    const codes = generateMfaRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    expect(codes.every(isMfaRecoveryCode)).toBe(true)
    expect(hashMfaRecoveryCode(codes[0]!)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashMfaRecoveryCode(codes[0]!)).toBe(
      hashMfaRecoveryCode(codes[0]!.replaceAll('-', '').toLowerCase())
    )
  })

  it('builds a standard authenticator provisioning URI without raw password material', () => {
    const uri = buildMfaOtpAuthUri('owner@example.com', 'JBSWY3DPEHPK3PXP')
    expect(uri).toBe(
      'otpauth://totp/AppSea%3Aowner%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=AppSea&algorithm=SHA1&digits=6&period=30'
    )
  })
})
