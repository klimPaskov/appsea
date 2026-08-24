import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  composeFile,
  localEnvironment,
  localProcessCommands,
  parseDevLocalArgs
} from './dev_local.mjs'

test('local command accepts help, dry-run, and no arguments only', () => {
  assert.deepEqual(parseDevLocalArgs([]), { help: false, dryRun: false })
  assert.deepEqual(parseDevLocalArgs(['--dry-run']), { help: false, dryRun: true })
  assert.deepEqual(parseDevLocalArgs(['--help']), { help: true, dryRun: false })
  assert.throws(() => parseDevLocalArgs(['--fresh']), /Unknown option: --fresh/)
  assert.throws(() => parseDevLocalArgs(['--dry-run', '--fresh']), /Unknown option: --fresh/)
})

test('local environment is loopback-only and removes inherited remote boundaries', () => {
  const environment = localEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://appsea_service:remote@db.example/appsea',
    APPSEA_OBJECT_STORE_ROOT: 'C:\\remote-object-store',
    APPSEA_OBJECT_STORE_ENDPOINT: 'https://objects.example',
    APPSEA_OBJECT_STORE_BUCKET: 'production',
    APPSEA_OBJECT_STORE_ALLOW_INSECURE_LOCALHOST: 'true',
    APPSEA_TEMPORAL_API_KEY: 'remote-token',
    APPSEA_AUTH_OIDC_CLIENT_SECRET: 'remote-secret',
    APPSEA_AUTH_MFA_ENCRYPTION_KEY: 'remote-key',
    APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS: 'remote-previous-key',
    APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION: '9',
    APPSEA_SCHEDULER_OWNER_ID: 'remote-scheduler'
  })

  assert.equal(environment.NODE_ENV, 'development')
  assert.equal(
    environment.DATABASE_URL,
    'postgres://appsea_service:appsea-service-local-only@127.0.0.1:5433/appsea'
  )
  assert.equal(environment.APPSEA_TEMPORAL_ADDRESS, '127.0.0.1:7233')
  assert.equal(environment.APPSEA_OBJECT_STORE_ROOT, undefined)
  assert.equal(environment.APPSEA_OBJECT_STORE_ENDPOINT, 'http://127.0.0.1:9000')
  assert.equal(environment.APPSEA_OBJECT_STORE_BUCKET, 'appsea-local')
  assert.equal(environment.APPSEA_OBJECT_STORE_REGION, 'us-east-1')
  assert.equal(environment.APPSEA_OBJECT_STORE_ACCESS_KEY_ID, 'appsea-local-access')
  assert.equal(environment.APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY, 'appsea-local-secret')
  assert.equal(environment.APPSEA_OBJECT_STORE_FORCE_PATH_STYLE, 'true')
  assert.equal(environment.APPSEA_OBJECT_STORE_ALLOW_INSECURE_LOCALHOST, 'true')
  assert.equal(environment.APPSEA_TEMPORAL_API_KEY, undefined)
  assert.equal(environment.APPSEA_AUTH_OIDC_CLIENT_SECRET, undefined)
  assert.equal(environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS, undefined)
  assert.equal(environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION, undefined)
  assert.equal(environment.APPSEA_SCHEDULER_OWNER_ID, undefined)
  assert.equal(environment.APPSEA_PUBLIC_ORIGIN, 'http://localhost:3000')
  assert.equal(
    environment.APPSEA_AUTH_MFA_ENCRYPTION_KEY,
    Buffer.alloc(32, 7).toString('base64url')
  )
})

test('local stack starts every durable supervisor alongside the worker and web process', () => {
  assert.deepEqual(localProcessCommands(), [
    ['--filter', '@appsea/worker', 'workflow:worker'],
    ['--filter', '@appsea/worker', 'maintenance:loop'],
    ['--filter', '@appsea/worker', 'alerts:loop'],
    ['dev:web']
  ])
})

test('local compose provisions loopback MinIO and initializes its bucket idempotently', async () => {
  const compose = await readFile(composeFile, 'utf8')
  assert.match(compose, /image: minio\/minio:/)
  assert.match(compose, /image: minio\/mc:/)
  assert.match(compose, /127\.0\.0\.1:9000:9000/)
  assert.match(compose, /127\.0\.0\.1:9001:9001/)
  assert.match(compose, /\/minio\/health\/ready/)
  assert.match(compose, /condition: service_healthy/)
  assert.match(compose, /mc mb --ignore-existing appsea\/appsea-local/)
  assert.match(compose, /restart: 'no'/)
})
