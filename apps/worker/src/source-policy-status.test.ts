import { describe, expect, it } from 'vitest'
import { sourcePolicyStatusEnvironment } from './source-policy-status'

describe('source policy status command', () => {
  it('requires the operator database and policy identity inputs', () => {
    expect(() => sourcePolicyStatusEnvironment({})).toThrow('APPSEA_POLICY_DATABASE_URL')
    expect(() =>
      sourcePolicyStatusEnvironment({ APPSEA_POLICY_DATABASE_URL: 'postgres://operator/db' })
    ).toThrow('APPSEA_POLICY_SOURCE_ID')
  })

  it('trims bounded operator inputs', () => {
    expect(
      sourcePolicyStatusEnvironment({
        APPSEA_POLICY_DATABASE_URL: ' postgres://operator/db ',
        APPSEA_POLICY_SOURCE_ID: ' cfpb-consumer-complaints ',
        APPSEA_POLICY_VERSION: ' cfpb-v1 '
      })
    ).toEqual({
      databaseUrl: 'postgres://operator/db',
      sourceId: 'cfpb-consumer-complaints',
      policyVersion: 'cfpb-v1'
    })
  })
})
