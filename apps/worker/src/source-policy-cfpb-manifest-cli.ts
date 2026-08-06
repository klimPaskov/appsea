import {
  buildCfpbSourcePolicyReviewManifest,
  cfpbSourcePolicyDefaultVersion
} from './source-policy-cfpb-manifest'

const version = process.env.APPSEA_CFPB_POLICY_VERSION?.trim() || cfpbSourcePolicyDefaultVersion
const manifest = buildCfpbSourcePolicyReviewManifest(version)

console.log(JSON.stringify(manifest))
