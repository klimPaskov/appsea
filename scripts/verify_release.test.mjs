import { readdir, readFile } from 'node:fs/promises'
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
    migrationFilenames: (await readdir(path.join(root, 'packages/db/migrations')))
      .filter((filename) => filename.endsWith('.sql'))
      .sort(),
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

test('the release boundary requires the reviewed Temporal task queue', async () => {
  const current = await inputs()
  const findings = releaseBoundaryFindings({
    ...current,
    envExample: current.envExample.replace(
      'APPSEA_TEMPORAL_TASK_QUEUE=appsea-research-v1',
      'APPSEA_TEMPORAL_TASK_QUEUE=unreviewed-queue'
    )
  })
  assert.ok(
    findings.includes(
      'APPSEA_TEMPORAL_TASK_QUEUE must equal the reviewed appsea-research-v1 task queue'
    )
  )
})

test('the release boundary requires a bounded worker drain window and wiring', async () => {
  const current = await inputs()
  const invalidEnv = releaseBoundaryFindings({
    ...current,
    envExample: current.envExample.replace(
      'APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS=120',
      'APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS=901'
    )
  })
  assert.ok(
    invalidEnv.includes(
      'APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS must be an integer between 30 and 900 seconds'
    )
  )

  const invalidCompose = releaseBoundaryFindings({
    ...current,
    compose: current.compose.replace(
      "stop_grace_period: '${APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS:-120}s'",
      'stop_grace_period: 120s'
    )
  })
  assert.ok(
    invalidCompose.includes(
      'worker must use the configured bounded drain window as its stop grace period'
    )
  )
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

test('the release boundary requires the long-lived alerts supervisor', async () => {
  const current = await inputs()
  const withoutAlerts = current.compose.replace(/\n  alerts:\n[\s\S]*$/, '\n')
  const findings = releaseBoundaryFindings({ ...current, compose: withoutAlerts })
  assert.ok(findings.includes('production compose is missing alerts'))
})

test('the release boundary requires the contiguous reviewed migration head', async () => {
  const current = await inputs()
  const missingLatest = current.migrationFilenames.filter(
    (filename) => !filename.startsWith('0123_')
  )
  const findings = releaseBoundaryFindings({ ...current, migrationFilenames: missingLatest })
  assert.ok(findings.includes('database migration inventory must contain exactly 123 SQL files'))
  assert.ok(
    findings.includes(
      'database migration inventory must be a contiguous ordered prefix ending at 0123'
    )
  )

  const invalid = [...current.migrationFilenames, '0001_duplicate.sql', 'notes.txt']
  const invalidFindings = releaseBoundaryFindings({ ...current, migrationFilenames: invalid })
  assert.ok(invalidFindings.includes('database migration filename is invalid: notes.txt'))
  assert.ok(invalidFindings.includes('database migration versions must be unique: 0001'))
})

test('long-lived services cannot inherit the migration database credential', async () => {
  const current = await inputs()
  const weakened = current.compose
    .replace(/      APPSEA_MIGRATION_DATABASE_URL: ''\n/g, '')
    .replace(/      APPSEA_DATABASE_MIGRATION_ROLE: ''\n/g, '')
  const findings = releaseBoundaryFindings({ ...current, compose: weakened })
  assert.ok(findings.includes('web must not receive the migration database credential'))
  assert.ok(findings.includes('worker must not receive the migration database credential'))
  assert.ok(findings.includes('maintenance must not receive the migration database credential'))
  assert.ok(findings.includes('alerts must not receive the migration database credential'))
  assert.ok(findings.includes('web must not receive the migration role override'))
  assert.ok(findings.includes('worker must not receive the migration role override'))
  assert.ok(findings.includes('maintenance must not receive the migration role override'))
  assert.ok(findings.includes('alerts must not receive the migration role override'))
})

test('static-only verification runs without opening providers', async () => {
  await assert.doesNotReject(() => verifyRelease({ repositoryRoot: root, staticOnly: true }))
})
