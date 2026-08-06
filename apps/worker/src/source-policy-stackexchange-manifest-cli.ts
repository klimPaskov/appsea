import { buildStackExchangeSourcePolicyReviewManifest } from './source-policy-stackexchange-manifest'

const requestedVersion = process.env.APPSEA_STACKEXCHANGE_POLICY_VERSION?.trim()
const manifest = buildStackExchangeSourcePolicyReviewManifest(requestedVersion || undefined)
console.log(JSON.stringify(manifest))
