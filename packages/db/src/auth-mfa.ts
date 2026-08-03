import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { sha256 } from './hash'

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const recoveryCodeGroupLength = 4
const recoveryCodeGroups = 4
const totpDigits = 6
const totpPeriodSeconds = 30

export const authMfaTotpPeriodSeconds = totpPeriodSeconds
export const authMfaRecoveryCodeCount = 10

function assertBase32(value: string): string {
  const normalized = value.trim().replace(/=+$/g, '').toUpperCase()
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('MFA secret is invalid')
  }
  return normalized
}

export function base32Encode(value: Uint8Array): string {
  let bits = 0
  let buffer = 0
  let output = ''
  for (const byte of value) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += base32Alphabet[(buffer >> bits) & 31]
    }
  }
  if (bits > 0) output += base32Alphabet[(buffer << (5 - bits)) & 31]
  return output
}

export function base32Decode(value: string): Buffer {
  const normalized = assertBase32(value)
  let bits = 0
  let buffer = 0
  const bytes: number[] = []
  for (const character of normalized) {
    buffer = (buffer << 5) | base32Alphabet.indexOf(character)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

export function generateMfaSecret(): string {
  return base32Encode(randomBytes(20))
}

function recoveryCodeFromBytes(value: Uint8Array): string {
  const raw = base32Encode(value).slice(0, recoveryCodeGroupLength * recoveryCodeGroups)
  return Array.from({ length: recoveryCodeGroups }, (_, index) =>
    raw.slice(index * recoveryCodeGroupLength, (index + 1) * recoveryCodeGroupLength)
  ).join('-')
}

export function generateMfaRecoveryCodes(count = authMfaRecoveryCodeCount): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) {
    throw new Error('MFA recovery-code count is invalid')
  }
  return Array.from({ length: count }, () => recoveryCodeFromBytes(randomBytes(10)))
}

export function normalizeMfaCode(value: string): string {
  return value.trim().replace(/[\s-]/g, '').toUpperCase()
}

export function hashMfaRecoveryCode(value: string): string {
  return sha256(normalizeMfaCode(value))
}

export function isMfaTotpCode(value: string): boolean {
  return /^\d{6}$/.test(normalizeMfaCode(value))
}

export function isMfaRecoveryCode(value: string): boolean {
  const normalized = normalizeMfaCode(value)
  return new RegExp(`^[A-Z2-7]{${recoveryCodeGroupLength * recoveryCodeGroups}}$`).test(normalized)
}

function codeForStep(secret: string, step: number): string {
  const message = Buffer.allocUnsafe(8)
  message.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!
  return String(binary % 10 ** totpDigits).padStart(totpDigits, '0')
}

export function totpCodeAt(secret: string, timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) throw new Error('MFA timestamp is invalid')
  return codeForStep(secret, Math.floor(timestampMs / 1_000 / totpPeriodSeconds))
}

export function verifyMfaTotpCode(
  secret: string,
  providedCode: string,
  timestampMs: number,
  lastUsedStep: number | null,
  window = 1
): number | null {
  const normalized = normalizeMfaCode(providedCode)
  if (!isMfaTotpCode(normalized)) return null
  if (!Number.isSafeInteger(window) || window < 0 || window > 2) {
    throw new Error('MFA verification window is invalid')
  }
  const currentStep = Math.floor(timestampMs / 1_000 / totpPeriodSeconds)
  for (let delta = -window; delta <= window; delta += 1) {
    const step = currentStep + delta
    if (step < 0 || (lastUsedStep !== null && step <= lastUsedStep)) continue
    const expected = Buffer.from(codeForStep(secret, step), 'ascii')
    const actual = Buffer.from(normalized, 'ascii')
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return step
  }
  return null
}

export function buildMfaOtpAuthUri(email: string, secret: string): string {
  const label = encodeURIComponent(`AppSea:${email}`)
  const encodedIssuer = encodeURIComponent('AppSea')
  return `otpauth://totp/${label}?secret=${encodeURIComponent(assertBase32(secret))}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${totpDigits}&period=${totpPeriodSeconds}`
}
