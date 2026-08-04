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
          manualImportBatchId: 'batch:smoke'
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
  campaignId: 'campaign:smoke',
  batchId: 'batch:smoke',
  runId: 'run:smoke'
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
    /coverage gap was not visible/
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
