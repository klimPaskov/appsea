import { cfpbSourcePolicy } from '@appsea/connectors'
import type { SourcePolicy } from '@appsea/contracts'
import { contentHash } from '@appsea/db'

export const cfpbSourcePolicyManifestVersion = 'cfpb-source-policy-review-v1' as const
export const cfpbSourcePolicyDefaultVersion = 'cfpb-2026-07-v1' as const
export const cfpbSourcePolicyEvidenceAsOf = '2026-08-06' as const

export const cfpbSourcePolicyEvidence = [
  {
    id: 'official-api-documentation',
    url: 'https://cfpb.github.io/api/ccdb/api.html',
    observedAt: cfpbSourcePolicyEvidenceAsOf,
    finding:
      'CFPB Open Tech documents a public Consumer Complaint Database API and invites developers to build tools with it.'
  },
  {
    id: 'official-api-openapi',
    url: 'https://cfpb.github.io/ccdb5-api/documentation/',
    observedAt: cfpbSourcePolicyEvidenceAsOf,
    finding:
      'The first-party API documentation exposes complaint search and complaint-by-ID routes and displays a CC0 license notice.'
  },
  {
    id: 'complaint-publication-program',
    url: 'https://www.consumerfinance.gov/compliance/consumer-complaint-program/',
    observedAt: cfpbSourcePolicyEvidenceAsOf,
    finding:
      'The CFPB says narratives are published only when consumers opt in and after personal-information removal; publication timing is tied to a company response or 15 days.'
  },
  {
    id: 'narrative-scrubbing-standard',
    url: 'https://files.consumerfinance.gov/f/documents/201503_cfpb_Narrative-Scrubbing-Standard.pdf',
    observedAt: cfpbSourcePolicyEvidenceAsOf,
    finding:
      'The first-party scrubbing standard describes consent, screening, personal-information removal, withdrawal handling, and the risk that downloaded copies cannot be recalled.'
  },
  {
    id: 'privacy-impact-assessment',
    url: 'https://files.consumerfinance.gov/f/documents/06022023_Publication-of-Consumer-Response-Complaint-Narratives.pdf',
    observedAt: cfpbSourcePolicyEvidenceAsOf,
    finding:
      'The first-party privacy assessment describes opt-in narrative publication, de-identification, withdrawal, public downloadability, and residual re-identification risk.'
  }
] as const

export interface CfpbSourcePolicyReviewManifest {
  manifestVersion: typeof cfpbSourcePolicyManifestVersion
  evidenceAsOf: typeof cfpbSourcePolicyEvidenceAsOf
  sourceId: string
  policyVersion: string
  policyContentHash: string
  policyState: 'pending_review'
  connectorEnabled: false
  policy: {
    permittedPurposes: readonly string[]
    commercialUse: SourcePolicy['commercialUse']
    requiredReviewerRoles: readonly ['legal', 'privacy', 'security']
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
  firstPartyEvidence: typeof cfpbSourcePolicyEvidence
  approvalGate: {
    activationFunction: 'appsea.approve_source_policy'
    requiredReviewerRoles: readonly ['legal', 'privacy', 'security']
    reviewerMustBeIndependentOfPolicyOwner: true
    approvalReferenceRequired: true
    counselConfirmationRequiredForCommercialUse: true
    activationAllowed: false
  }
  coverageGaps: readonly string[]
}

function policyVersion(value: string): string {
  const trimmed = value.trim()
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(trimmed)) {
    throw new Error('CFPB policy version must be a bounded lowercase identifier')
  }
  return trimmed
}

/**
 * Build a deterministic, secret-free handoff for an independent source-policy
 * review. This function never contacts CFPB, changes the registry, or enables
 * the connector.
 */
export function buildCfpbSourcePolicyReviewManifest(
  requestedPolicyVersion: string = cfpbSourcePolicyDefaultVersion
): CfpbSourcePolicyReviewManifest {
  return {
    manifestVersion: cfpbSourcePolicyManifestVersion,
    evidenceAsOf: cfpbSourcePolicyEvidenceAsOf,
    sourceId: cfpbSourcePolicy.sourceId,
    policyVersion: policyVersion(requestedPolicyVersion),
    policyContentHash: contentHash(cfpbSourcePolicy),
    policyState: 'pending_review',
    connectorEnabled: false,
    policy: {
      permittedPurposes: cfpbSourcePolicy.permittedPurposes,
      commercialUse: cfpbSourcePolicy.commercialUse,
      requiredReviewerRoles: ['legal', 'privacy', 'security'],
      retentionDays: cfpbSourcePolicy.retentionDays,
      deletionRequired: cfpbSourcePolicy.deletionRequired,
      attributionRequired: cfpbSourcePolicy.attributionRequired,
      displayMode: cfpbSourcePolicy.displayMode,
      quota: cfpbSourcePolicy.quota,
      deletion: cfpbSourcePolicy.deletion
    },
    firstPartyEvidence: cfpbSourcePolicyEvidence,
    approvalGate: {
      activationFunction: 'appsea.approve_source_policy',
      requiredReviewerRoles: ['legal', 'privacy', 'security'],
      reviewerMustBeIndependentOfPolicyOwner: true,
      approvalReferenceRequired: true,
      counselConfirmationRequiredForCommercialUse: true,
      activationAllowed: false
    },
    coverageGaps: cfpbSourcePolicy.coverageNotes
  }
}
