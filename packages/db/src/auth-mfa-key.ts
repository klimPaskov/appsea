import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const mfaKeyBytes = 32
const mfaKeyVersionMin = 1
const mfaKeyVersionMax = 32_767

export interface MfaEncryptionKey {
  readonly version: number
  readonly key: Buffer
}

export interface MfaEncryptionConfig {
  readonly current: MfaEncryptionKey
  readonly previous: MfaEncryptionKey | null
}

export interface EncryptedMfaSecret {
  readonly ciphertext: string
  readonly nonce: string
  readonly tag: string
  readonly keyVersion: number
}

export interface DecryptedMfaSecret {
  readonly secret: string
  readonly keyVersion: number
}

export class MfaEncryptionKeyConfigurationError extends Error {
  constructor() {
    super('MFA encryption key configuration is invalid')
    this.name = 'MfaEncryptionKeyConfigurationError'
  }
}

function parseVersion(value: string | undefined, fallback: number): number {
  const normalized = value?.trim() ?? ''
  if (normalized === '') return fallback
  if (!/^[1-9][0-9]{0,4}$/.test(normalized)) {
    throw new MfaEncryptionKeyConfigurationError()
  }
  const version = Number(normalized)
  if (!Number.isSafeInteger(version) || version < mfaKeyVersionMin || version > mfaKeyVersionMax) {
    throw new MfaEncryptionKeyConfigurationError()
  }
  return version
}

function parseKey(value: string | undefined, allowTestFallback: boolean): Buffer {
  const normalized = value?.trim() ?? ''
  if (normalized === '') {
    if (allowTestFallback) return Buffer.alloc(mfaKeyBytes, 8)
    throw new MfaEncryptionKeyConfigurationError()
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
    throw new MfaEncryptionKeyConfigurationError()
  }
  const key = Buffer.from(normalized, 'base64url')
  if (key.length !== mfaKeyBytes) throw new MfaEncryptionKeyConfigurationError()
  return key
}

/**
 * Read the current and optional previous MFA encryption keys without ever
 * returning their encoded values. The test fallback keeps fixture/unit tests
 * deterministic; production preflight still requires an explicit key.
 */
export function mfaEncryptionConfigFromEnv(
  environment: NodeJS.ProcessEnv = process.env
): MfaEncryptionConfig {
  const allowTestFallback = environment.NODE_ENV === 'test'
  const current = {
    version: parseVersion(environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION, 1),
    key: parseKey(environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY, allowTestFallback)
  }
  const previousValue = environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS?.trim() ?? ''
  const previousVersionValue =
    environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION?.trim() ?? ''
  if ((previousValue === '') !== (previousVersionValue === '')) {
    throw new MfaEncryptionKeyConfigurationError()
  }
  const previous =
    previousValue === ''
      ? null
      : {
          version: parseVersion(previousVersionValue, 0),
          key: parseKey(previousValue, false)
        }
  if (previous && (previous.version >= current.version || previous.key.equals(current.key))) {
    throw new MfaEncryptionKeyConfigurationError()
  }
  return { current, previous }
}

export function encryptMfaSecret(secret: string, config: MfaEncryptionConfig): EncryptedMfaSecret {
  if (secret.length === 0) throw new MfaEncryptionKeyConfigurationError()
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', config.current.key, nonce)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64url'),
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    keyVersion: config.current.version
  }
}

function rowKeyVersion(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 1
  const version = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(version) || version < mfaKeyVersionMin || version > mfaKeyVersionMax) {
    throw new MfaEncryptionKeyConfigurationError()
  }
  return version
}

function keyForVersion(config: MfaEncryptionConfig, version: number): Buffer {
  if (config.current.version === version) return config.current.key
  if (config.previous?.version === version) return config.previous.key
  throw new MfaEncryptionKeyConfigurationError()
}

export function decryptMfaSecret(
  row: {
    secret_ciphertext: string
    secret_nonce: string
    secret_tag: string
    secret_key_version?: number | string | null
  },
  config: MfaEncryptionConfig
): DecryptedMfaSecret {
  const keyVersion = rowKeyVersion(row.secret_key_version)
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyForVersion(config, keyVersion),
      Buffer.from(row.secret_nonce, 'base64url')
    )
    decipher.setAuthTag(Buffer.from(row.secret_tag, 'base64url'))
    const secret = Buffer.concat([
      decipher.update(Buffer.from(row.secret_ciphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8')
    if (secret.length === 0) throw new MfaEncryptionKeyConfigurationError()
    return { secret, keyVersion }
  } catch (error) {
    if (error instanceof MfaEncryptionKeyConfigurationError) throw error
    throw new MfaEncryptionKeyConfigurationError()
  }
}
