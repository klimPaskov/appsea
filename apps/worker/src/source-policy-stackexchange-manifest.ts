import { stackExchangeSourcePolicy } from '@appsea/connectors'
import type { SourcePolicy } from '@appsea/contracts'
import { contentHash } from '@appsea/db'

export const stackExchangeSourcePolicyManifestVersion =
  'stackexchange-source-policy-review-v1' as const
export const stackExchangeSourcePolicyDefaultVersion = 'stackexchange-2026-08-v1' as const
export const stackExchangeSourcePolicyEvidenceAsOf = '2026-08-06' as const

/**
 * First-party references for an independent review. These are evidence links,
 * not permission grants; the AUP still requires a separate written consent or
 * commercial-exception record before the connector can be activated.
 */
export const stackExchangeSourcePolicyEvidence = [
  {
    id: 'official-api-advanced-search',
    url: 'https://api.stackexchange.com/docs/advanced-search',
    observedAt: stackExchangeSourcePolicyEvidenceAsOf,
    finding:
      'The official API documentation exposes the bounded advanced-search route used by the connector.'
  },
  {
    id: 'official-api-terms',
    url: 'https://engineering.stackexchange.com/legal/api-terms-of-use',
    observedAt: stackExchangeSourcePolicyEvidenceAsOf,
    finding:
      'The API terms require visible Stack Exchange attribution and state that exceptions to attribution rules must be requested in advance.'
  },
  {
    id: 'network-acceptable-use-policy',
    url: 'https://stackoverflow.com/legal/acceptable-use-policy',
    observedAt: stackExchangeSourcePolicyEvidenceAsOf,
    finding:
      'The Network AUP restricts automated collection for similar or competitive products and generative-AI work unless express prior written consent or a commercial license exception is obtained.'
  },
  {
    id: 'public-network-terms',
    url: 'https://stackoverflow.com/legal/terms-of-service/public',
    observedAt: stackExchangeSourcePolicyEvidenceAsOf,
    finding:
      'The public terms direct API use to the API terms and restrict non-personal/noncommercial copying of other Network content without permission.'
  },
  {
    id: 'public-contribution-licensing',
    url: 'https://stackoverflow.com/help/licensing',
    observedAt: stackExchangeSourcePolicyEvidenceAsOf,
    finding:
      'The licensing page describes time-dependent CC BY-SA terms for publicly accessible user contributions and directs readers to the full license text.'
  }
] as const

export interface StackExchangeSourcePolicyReviewManifest {
  manifestVersion: typeof stackExchangeSourcePolicyManifestVersion
  evidenceAsOf: typeof stackExchangeSourcePolicyEvidenceAsOf
  sourceId: string
  policyVersion: string
  policyContentHash: string
  policyState: 'pending_review'
  connectorEnabled: false
  policy: {
    permittedPurposes: readonly string[]
    commercialUse: SourcePolicy['commercialUse']
    permissionEvidenceRequired: true
    retentionDays: number
    deletionRequired: boolean
    attributionRequired: boolean
    displayMode: string
    quota: {
      requestsPerMinute: number
      maxRecordsPerRequest: number
      maxRecordsPerRun: number
      costPerRequestMicros: number
    }
    deletion: {
      sourceRecordIdField: string
      supportsTombstones: boolean
      deletionPollIntervalHours: number
      retentionAction: string
    }
  }
  firstPartyEvidence: typeof stackExchangeSourcePolicyEvidence
  approvalGate: {
    activationFunction: 'appsea.approve_source_policy'
    requiredReviewerRoles: readonly ['legal', 'privacy', 'security']
    reviewerMustBeIndependentOfPolicyOwner: true
    approvalReferenceRequired: true
    permissionEvidenceReferenceRequired: true
    writtenConsentOrCommercialExceptionRequired: true
    activationAllowed: false
  }
  coverageGaps: readonly string[]
}

function policyVersion(value: string): string {
  const trimmed = value.trim()
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(trimmed)) {
    throw new Error('Stack Exchange policy version must be a bounded lowercase identifier')
  }
  return trimmed
}

/**
 * Build a deterministic, secret-free handoff for independent source-policy
 * review. It never contacts Stack Exchange, changes the registry, or enables
 * the connector.
 */
export function buildStackExchangeSourcePolicyReviewManifest(
  requestedPolicyVersion: string = stackExchangeSourcePolicyDefaultVersion
): StackExchangeSourcePolicyReviewManifest {
  return {
    manifestVersion: stackExchangeSourcePolicyManifestVersion,
    evidenceAsOf: stackExchangeSourcePolicyEvidenceAsOf,
    sourceId: stackExchangeSourcePolicy.sourceId,
    policyVersion: policyVersion(requestedPolicyVersion),
    policyContentHash: contentHash(stackExchangeSourcePolicy),
    policyState: 'pending_review',
    connectorEnabled: false,
    policy: {
      permittedPurposes: stackExchangeSourcePolicy.permittedPurposes,
      commercialUse: stackExchangeSourcePolicy.commercialUse,
      permissionEvidenceRequired: true,
      retentionDays: stackExchangeSourcePolicy.retentionDays,
      deletionRequired: stackExchangeSourcePolicy.deletionRequired,
      attributionRequired: stackExchangeSourcePolicy.attributionRequired,
      displayMode: stackExchangeSourcePolicy.displayMode,
      quota: stackExchangeSourcePolicy.quota,
      deletion: stackExchangeSourcePolicy.deletion
    },
    firstPartyEvidence: stackExchangeSourcePolicyEvidence,
    approvalGate: {
      activationFunction: 'appsea.approve_source_policy',
      requiredReviewerRoles: ['legal', 'privacy', 'security'],
      reviewerMustBeIndependentOfPolicyOwner: true,
      approvalReferenceRequired: true,
      permissionEvidenceReferenceRequired: true,
      writtenConsentOrCommercialExceptionRequired: true,
      activationAllowed: false
    },
    coverageGaps: stackExchangeSourcePolicy.coverageNotes
  }
}
