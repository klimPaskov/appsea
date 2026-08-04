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

test('local smoke accepts healthy loopback responses and sparse fixture disclosure', () => {
  assert.doesNotThrow(() => assertLocalStackResponses(healthyResponses))
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
