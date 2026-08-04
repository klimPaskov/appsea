import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseBoundaryFindings, verifyRelease } from './verify_release.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function inputs() {
  return {
    compose: await readFile(path.join(root, 'infra/production/compose.yaml'), 'utf8'),
    envExample: await readFile(path.join(root, 'infra/production/production.env.example'), 'utf8'),
    webDockerfile: await readFile(path.join(root, 'Dockerfile.web'), 'utf8'),
    workerDockerfile: await readFile(path.join(root, 'Dockerfile.worker'), 'utf8'),
    trackedProductionEnv: false
  }
}

test('the checked-in production boundary passes static release checks', async () => {
  const findings = releaseBoundaryFindings(await inputs())
  assert.deepEqual(findings, [])
})

test('the release boundary rejects tracked credentials and weakened defaults', async () => {
  const current = await inputs()
  const findings = releaseBoundaryFindings({
    ...current,
    trackedProductionEnv: true,
    envExample: current.envExample
      .replace('APPSEA_AUTH_RECOVERY_ENABLED=false', 'APPSEA_AUTH_RECOVERY_ENABLED=true')
      .replace('APPSEA_TEMPORAL_API_KEY=', 'APPSEA_TEMPORAL_API_KEY=committed-secret')
      .replace('DATABASE_URL=', 'DATABASE_URL=postgres://appsea_service:secret@example.test/appsea')
  })
  assert.ok(findings.includes('infra/production/production.env must remain untracked'))
  assert.ok(
    findings.includes('DATABASE_URL must not contain a committed secret or live credential')
  )
  assert.ok(
    findings.includes('APPSEA_TEMPORAL_API_KEY must be blank in the committed environment example')
  )
  assert.ok(findings.includes('account recovery must remain disabled by default'))
})

test('the release boundary rejects a service that can bypass preflight', async () => {
  const current = await inputs()
  const weakened = current.compose.replace(
    'condition: service_completed_successfully',
    'condition: service_started'
  )
  const findings = releaseBoundaryFindings({ ...current, compose: weakened })
  assert.ok(findings.some((finding) => finding.includes('successful preflight')))
})

test('static-only verification runs without opening providers', async () => {
  await assert.doesNotReject(() => verifyRelease({ repositoryRoot: root, staticOnly: true }))
})
