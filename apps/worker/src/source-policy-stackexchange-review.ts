import { stackExchangeSourcePolicy } from '@appsea/connectors'
import {
  contentHash,
  createDatabasePool,
  databaseConfigFromEnv,
  PostgresSourcePolicyRepository
} from '@appsea/db'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requiredTrue(name: string): true {
  if (required(name).toLowerCase() !== 'true') {
    throw new Error(`${name} must be true for source-policy approval`)
  }
  return true
}

const action = required('APPSEA_SOURCE_POLICY_ACTION')
if (action !== 'draft' && action !== 'approve') {
  throw new Error('APPSEA_SOURCE_POLICY_ACTION must be draft or approve')
}
const policyVersion = required('APPSEA_STACKEXCHANGE_POLICY_VERSION')
const databaseUrl = required('APPSEA_POLICY_DATABASE_URL')
const pool = createDatabasePool(
  databaseConfigFromEnv({ ...process.env, DATABASE_URL: databaseUrl })
)

try {
  const repository = new PostgresSourcePolicyRepository(pool)
  const draftHash = contentHash(stackExchangeSourcePolicy)
  if (action === 'draft') {
    await repository.registerDraft({
      policy: stackExchangeSourcePolicy,
      policyVersion,
      recordedAt: required('APPSEA_POLICY_RECORDED_AT')
    })
    console.log(
      JSON.stringify({
        action,
        sourceId: stackExchangeSourcePolicy.sourceId,
        policyVersion,
        contentHash: draftHash
      })
    )
  } else {
    await repository.approve({
      sourceId: stackExchangeSourcePolicy.sourceId,
      policyVersion,
      reviewId: required('APPSEA_POLICY_REVIEW_ID'),
      reviewer: required('APPSEA_POLICY_REVIEWER'),
      reviewerIdentity: required('APPSEA_POLICY_REVIEWER_IDENTITY'),
      reviewerRole: required('APPSEA_POLICY_REVIEWER_ROLE') as
        'legal' | 'privacy' | 'security' | 'independent_operator',
      independenceAttested: requiredTrue('APPSEA_POLICY_INDEPENDENCE_ATTESTED'),
      approvalReference: required('APPSEA_POLICY_APPROVAL_REFERENCE'),
      notes: (process.env.APPSEA_POLICY_REVIEW_NOTES ?? '')
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
      contentHash: process.env.APPSEA_POLICY_CONTENT_HASH?.trim() || draftHash,
      reviewedAt: required('APPSEA_POLICY_REVIEWED_AT'),
      expiresAt: process.env.APPSEA_POLICY_EXPIRES_AT?.trim() || null,
      recordedAt: required('APPSEA_POLICY_RECORDED_AT')
    })
    console.log(
      JSON.stringify({ action, sourceId: stackExchangeSourcePolicy.sourceId, policyVersion })
    )
  }
} finally {
  await pool.end()
}
