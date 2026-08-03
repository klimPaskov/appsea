import { describe, expect, it } from 'vitest'
import {
  decryptMfaSecret,
  encryptMfaSecret,
  MfaEncryptionKeyConfigurationError,
  mfaEncryptionConfigFromEnv
} from './auth-mfa-key'

const currentKey = Buffer.alloc(32, 1).toString('base64url')
const previousKey = Buffer.alloc(32, 2).toString('base64url')

describe('MFA encryption key rotation', () => {
  it('encrypts with the current version and decrypts with the configured key', () => {
    const config = mfaEncryptionConfigFromEnv({
      NODE_ENV: 'production',
      APPSEA_AUTH_MFA_ENCRYPTION_KEY: currentKey,
      APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION: '4'
    })
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP', config)
    expect(encrypted.keyVersion).toBe(4)
    expect(
      decryptMfaSecret(
        {
          secret_ciphertext: encrypted.ciphertext,
          secret_nonce: encrypted.nonce,
          secret_tag: encrypted.tag,
          secret_key_version: encrypted.keyVersion
        },
        config
      )
    ).toEqual({ secret: 'JBSWY3DPEHPK3PXP', keyVersion: 4 })
  })

  it('decrypts a previous version and makes the current version available for rewrap', () => {
    const previousConfig = mfaEncryptionConfigFromEnv({
      NODE_ENV: 'production',
      APPSEA_AUTH_MFA_ENCRYPTION_KEY: previousKey,
      APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION: '3'
    })
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP', previousConfig)
    const rotatedConfig = mfaEncryptionConfigFromEnv({
      NODE_ENV: 'production',
      APPSEA_AUTH_MFA_ENCRYPTION_KEY: currentKey,
      APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION: '4',
      APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS: previousKey,
      APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION: '3'
    })
    const decrypted = decryptMfaSecret(
      {
        secret_ciphertext: encrypted.ciphertext,
        secret_nonce: encrypted.nonce,
        secret_tag: encrypted.tag,
        secret_key_version: encrypted.keyVersion
      },
      rotatedConfig
    )
    expect(decrypted).toEqual({ secret: 'JBSWY3DPEHPK3PXP', keyVersion: 3 })
    expect(encryptMfaSecret(decrypted.secret, rotatedConfig).keyVersion).toBe(4)
  })

  it('fails closed for incomplete, reused, or unsupported key configuration', () => {
    expect(() =>
      mfaEncryptionConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_MFA_ENCRYPTION_KEY: currentKey,
        APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION: '2',
        APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS: previousKey
      })
    ).toThrow(MfaEncryptionKeyConfigurationError)
    expect(() =>
      mfaEncryptionConfigFromEnv({
        NODE_ENV: 'production',
        APPSEA_AUTH_MFA_ENCRYPTION_KEY: currentKey,
        APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION: '2',
        APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS: currentKey,
        APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION: '1'
      })
    ).toThrow(MfaEncryptionKeyConfigurationError)
    const config = mfaEncryptionConfigFromEnv({
      NODE_ENV: 'production',
      APPSEA_AUTH_MFA_ENCRYPTION_KEY: currentKey,
      APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION: '2'
    })
    expect(() =>
      decryptMfaSecret(
        {
          secret_ciphertext: 'invalid',
          secret_nonce: 'invalid',
          secret_tag: 'invalid',
          secret_key_version: 1
        },
        config
      )
    ).toThrow(MfaEncryptionKeyConfigurationError)
    expect(() =>
      decryptMfaSecret(
        {
          secret_ciphertext: 'invalid',
          secret_nonce: 'invalid',
          secret_tag: 'invalid',
          secret_key_version: 7
        },
        config
      )
    ).toThrow(MfaEncryptionKeyConfigurationError)
  })
})
