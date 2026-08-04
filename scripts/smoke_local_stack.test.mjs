import test from 'node:test'
import assert from 'node:assert/strict'
import { assertLocalStackResponses } from './smoke_local_stack.mjs'

const healthyResponses = {
  live: { status: 200, payload: { service: 'appsea-web', status: 'ok' } },
  ready: {
    status: 200,
    payload: { status: 'ready', checks: { database: 'ok', temporal: 'ok', objectStore: 'ok' } }
  },
  leaderboard: '<h1>Leaderboard</h1><p>Synthetic fixture ranking</p>',
  signup: '<h1>Create a workspace</h1>',
  login: '<h1>Sign in</h1>'
}

const privateWorkspaceResponses = {
  signup: { status: 201, hasSessionCookie: true },
  workspace: {
    status: 200,
    payload: {
      data: [
        {
          workspaceId: 'workspace:smoke',
          visibility: 'private',
          fixtureOnly: false,
          role: 'owner'
        }
      ]
    }
  },
  campaign: { status: 201, payload: { data: { campaignId: 'campaign:smoke' } } },
  importStart: {
    status: 202,
    payload: { data: { batch: { batchId: 'batch:smoke' } } }
  },
  workflow: {
    status: 200,
    payload: { data: { state: 'completed', result: { state: 'completed' } } }
  },
  batch: { status: 200, payload: { data: { state: 'consumed' } } },
  run: {
    status: 200,
    payload: {
      data: {
        result: {
          state: 'completed',
          runId: 'run:smoke',
          manualImportBatchId: 'batch:smoke',
          coverageGaps: ['private import does not establish public market coverage']
        }
      }
    }
  },
  sources: {
    status: 200,
    payload: {
      data: [
        { sourceId: 'manual-owner-import', collectible: true },
        { sourceId: 'cfpb-consumer-complaints', collectible: false }
      ]
    }
  },
  complaintReview: { status: 200, payload: { data: { reviewState: 'confirmed' } } },
  seedCreate: {
    status: 201,
    payload: { data: { seedReviewId: 'seed-review:smoke', reviewState: 'unreviewed' } }
  },
  seedReviewed: { status: 200, payload: { data: { reviewState: 'reviewed' } } },
  seedApproved: { status: 200, payload: { data: { reviewState: 'approved' } } },
  analysisStart: {
    status: 202,
    payload: { data: { analysisRunId: 'analysis:smoke', workflowId: 'workflow:analysis:smoke' } }
  },
  analysisStatus: {
    status: 200,
    payload: { data: { state: 'completed', analysisRunId: 'analysis:smoke' } }
  },
  analysis: {
    status: 200,
    payload: {
      data: {
        result: { state: 'completed', analysisRunId: 'analysis:smoke' },
        artifact: {
          mode: 'production',
          opportunity: {
            slug: 'smoke-2026-01-01-aaaaaaaa',
            synthetic: false,
            scoreSnapshot: {
              version: 'opportunity-score-v1.0.0',
              rankingScore: 30,
              riskAdjustedScore: 35,
              evidenceConfidence: 0.7
            }
          }
        },
        report: { synthetic: false },
        planPackage: { files: ['README.md'] },
        governance: { reportApprovalState: 'draft', planApprovalState: 'unreviewed' }
      }
    }
  },
  opportunity: {
    status: 200,
    payload: {
      data: {
        opportunity: { slug: 'smoke-2026-01-01-aaaaaaaa', synthetic: false },
        report: { approvalState: 'draft' },
        plan: { approvalState: 'unreviewed' }
      }
    }
  },
  opportunityPage: { status: 200, body: 'Private research package' },
  reportPage: { status: 200, body: 'Evidence-backed report Coverage limits' },
  planPage: { status: 200, body: 'Coding-agent plan README.md' },
  usagePage: { status: 200, body: 'Cost summary Quota reconciliation' },
  privatePages: {
    sources: { status: 200, body: 'Source coverage' },
    seedReviews: { status: 200, body: 'Seed reviews' },
    campaigns: { status: 200, body: 'Research campaigns' },
    imports: { status: 200, body: 'Owner imports' },
    members: { status: 200, body: 'Members' },
    collection: { status: 200, body: 'Source collection' },
    analysis: { status: 200, body: 'Analysis status' },
    workflow: { status: 200, body: 'Collection status' },
    campaignRuns: { status: 200, body: 'run history' }
  },
  campaignId: 'campaign:smoke',
  batchId: 'batch:smoke',
  runId: 'run:smoke',
  analysisRunId: 'analysis:smoke',
  seedReviewId: 'seed-review:smoke',
  opportunitySlug: 'smoke-2026-01-01-aaaaaaaa'
}

test('local smoke accepts healthy loopback responses and sparse fixture disclosure', () => {
  assert.doesNotThrow(() => assertLocalStackResponses(healthyResponses))
})

test('local smoke accepts an authenticated private owner-import workflow', () => {
  assert.doesNotThrow(() =>
    assertLocalStackResponses({ ...healthyResponses, privateWorkspace: privateWorkspaceResponses })
  )
})

test('local smoke rejects an unapproved public source presented as collectible', () => {
  assert.throws(
    () =>
      assertLocalStackResponses({
        ...healthyResponses,
        privateWorkspace: {
          ...privateWorkspaceResponses,
          sources: {
            ...privateWorkspaceResponses.sources,
            payload: {
              data: [
                { sourceId: 'manual-owner-import', collectible: true },
                { sourceId: 'cfpb-consumer-complaints', collectible: true }
              ]
            }
          }
        }
      }),
    /disabled public source was incorrectly marked collectible/
  )
})

test('local smoke rejects private detail leaking into the public leaderboard', () => {
  assert.throws(
    () =>
      assertLocalStackResponses({
        ...healthyResponses,
        leaderboard: `${healthyResponses.leaderboard} Research status`
      }),
    /leaked private research detail/
  )
})

test('local smoke rejects failed dependency readiness', () => {
  assert.throws(
    () =>
      assertLocalStackResponses({
        ...healthyResponses,
        ready: {
          status: 503,
          payload: { status: 'not_ready', checks: { database: 'failed' } }
        }
      }),
    /readiness response was not ready/
  )
})
