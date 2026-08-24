import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const composeFile = path.join(repositoryRoot, 'infra', 'local', 'compose.yaml')

const localDatabaseUrl = 'postgres://appsea_service:appsea-service-local-only@127.0.0.1:5433/appsea'
const localMaintenanceDatabaseUrl =
  'postgres://appsea_maintenance:appsea-maintenance-local-only@127.0.0.1:5433/appsea'
const localMigrationDatabaseUrl =
  'postgres://appsea_migrator:appsea-migrator-local-only@127.0.0.1:5433/appsea'

const cloudObjectStoreKeys = [
  'APPSEA_OBJECT_STORE_ROOT',
  'APPSEA_OBJECT_STORE_ENDPOINT',
  'APPSEA_OBJECT_STORE_BUCKET',
  'APPSEA_OBJECT_STORE_REGION',
  'APPSEA_OBJECT_STORE_ACCESS_KEY_ID',
  'APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY',
  'APPSEA_OBJECT_STORE_SESSION_TOKEN',
  'APPSEA_OBJECT_STORE_FORCE_PATH_STYLE',
  'APPSEA_OBJECT_STORE_ALLOW_INSECURE_LOCALHOST'
]

const remoteBoundaryKeys = [
  'APPSEA_TEMPORAL_API_KEY',
  'APPSEA_TEMPORAL_TLS_CA',
  'APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY',
  'APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS',
  'APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS_VERSION',
  'APPSEA_AUTH_RECOVERY_DELIVERY_URL',
  'APPSEA_AUTH_RECOVERY_DELIVERY_SECRET',
  'APPSEA_AUTH_OIDC_ISSUER',
  'APPSEA_AUTH_OIDC_CLIENT_ID',
  'APPSEA_AUTH_OIDC_CLIENT_SECRET',
  'APPSEA_AUTH_OIDC_ENDPOINT_ORIGINS',
  'APPSEA_ALERT_ROUTING_URL',
  'APPSEA_ALERT_ROUTING_SECRET',
  'APPSEA_TRUSTED_PROXY_SECRET',
  'APPSEA_SCHEDULER_OWNER_ID'
]

export function parseDevLocalArgs(argv) {
  const args = new Set(argv)
  if (args.has('--help') || args.has('-h')) return { help: true, dryRun: false }
  const unsupported = argv.filter((argument) => argument !== '--dry-run')
  if (unsupported.length > 0) {
    throw new Error(`Unknown option: ${unsupported[0]}`)
  }
  return { help: false, dryRun: args.has('--dry-run') }
}

export function localEnvironment(parent = process.env) {
  const environment = { ...parent }
  for (const key of [...cloudObjectStoreKeys, ...remoteBoundaryKeys]) delete environment[key]
  return {
    ...environment,
    NODE_ENV: 'development',
    DATABASE_URL: localDatabaseUrl,
    APPSEA_MAINTENANCE_DATABASE_URL: localMaintenanceDatabaseUrl,
    APPSEA_MIGRATION_DATABASE_URL: localMigrationDatabaseUrl,
    APPSEA_DATABASE_MIGRATION_ROLE: 'appsea_owner',
    APPSEA_DATABASE_SSL_MODE: 'disable',
    APPSEA_DATABASE_APPLICATION_NAME: 'appsea-local',
    APPSEA_TEMPORAL_ADDRESS: '127.0.0.1:7233',
    APPSEA_TEMPORAL_NAMESPACE: 'default',
    APPSEA_OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:9000',
    APPSEA_OBJECT_STORE_BUCKET: 'appsea-local',
    APPSEA_OBJECT_STORE_REGION: 'us-east-1',
    APPSEA_OBJECT_STORE_ACCESS_KEY_ID: 'appsea-local-access',
    APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY: 'appsea-local-secret',
    APPSEA_OBJECT_STORE_FORCE_PATH_STYLE: 'true',
    APPSEA_OBJECT_STORE_ALLOW_INSECURE_LOCALHOST: 'true',
    APPSEA_PUBLIC_ORIGIN: 'http://localhost:3000',
    APPSEA_AUTH_RECOVERY_ENABLED: 'false',
    APPSEA_AUTH_INVITATIONS_ENABLED: 'false',
    APPSEA_AUTH_OIDC_ENABLED: 'false',
    APPSEA_AUTH_OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/oidc/callback',
    APPSEA_AUTH_OIDC_ACCOUNT_LINKING: 'explicit',
    APPSEA_AUTH_OIDC_REVIEWED: 'false',
    APPSEA_AUTH_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
    APPSEA_AUTH_MFA_ENCRYPTION_KEY_VERSION: '1',
    APPSEA_ALERT_ROUTING_ENABLED: 'false'
  }
}

/**
 * Long-lived local processes that share the loopback dependency stack. Keep
 * this list explicit so the dry-run contract and shutdown path cannot drift.
 */
export function localProcessCommands() {
  return [
    ['--filter', '@appsea/worker', 'workflow:worker'],
    ['--filter', '@appsea/worker', 'maintenance:loop'],
    ['--filter', '@appsea/worker', 'alerts:loop'],
    ['dev:web']
  ]
}

function pnpmCommand() {
  return process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
}

function pnpmArgs(args) {
  return process.platform === 'win32' ? ['/d', '/s', '/c', `pnpm ${args.join(' ')}`] : args
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false
    })
    let stdout = ''
    let stderr = ''
    if (options.capture) {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
    }
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      const detail = stderr.trim() || stdout.trim()
      reject(
        new Error(
          `${command} ${args.join(' ')} exited with code ${code}${detail ? `: ${detail}` : ''}`
        )
      )
    })
  })
}

function start(command, args, environment) {
  return spawn(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    shell: false,
    detached: process.platform !== 'win32'
  })
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode) return
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(child.pid), '/T', '/F'], { capture: true }).catch(
      () => undefined
    )
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      process.kill(child.pid, 'SIGTERM')
    } catch {
      // The process exited between the state check and the signal.
    }
  }
}

export async function waitForService(service, healthArgs, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await run('docker', ['compose', '-f', composeFile, 'exec', '-T', service, ...healthArgs], {
        capture: true
      })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`)
}

async function runMigration(environment) {
  const migrationCommand = pnpmCommand()
  const migrationArgs = pnpmArgs(['db:migrate'])
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await run(migrationCommand, migrationArgs, { env: environment })
      return
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!/Connection terminated|ECONNREFUSED|ECONNRESET/i.test(message) || attempt === 5) {
        throw error
      }
      await waitForService(
        'postgres',
        ['pg_isready', '-U', 'appsea_migrator', '-d', 'appsea'],
        'PostgreSQL'
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

export function printHelp() {
  console.log(`AppSea local private-workspace stack

Starts the existing loopback PostgreSQL, Temporal, and MinIO services, creates
the local S3-compatible bucket, applies forward migrations with the dedicated
local migrator role, then runs the web app, durable worker, maintenance
supervisor, and alert supervisor in development mode.

Usage: pnpm dev:local [--dry-run]

The command never uses production endpoints or cloud object storage. Stop the
web, worker, maintenance, and alert processes with Ctrl+C; stop local
dependencies with:
  docker compose -f infra/local/compose.yaml down
`)
}

async function main() {
  const options = parseDevLocalArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const environment = localEnvironment()
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          composeFile,
          services: ['postgres', 'temporal', 'minio', 'minio-init'],
          commands: [
            'docker compose up -d postgres temporal minio',
            'docker compose run --rm --no-deps minio-init',
            'pnpm db:migrate',
            'pnpm --filter @appsea/worker workflow:worker',
            'pnpm --filter @appsea/worker maintenance:loop',
            'pnpm --filter @appsea/worker alerts:loop',
            'pnpm dev:web'
          ],
          endpoints: {
            web: 'http://localhost:3000',
            temporal: '127.0.0.1:7233',
            objectStore: 'http://127.0.0.1:9000'
          },
          databaseHost: '127.0.0.1:5433',
          objectStore: 'loopback signed S3 (MinIO)',
          nodeEnvironment: environment.NODE_ENV
        },
        null,
        2
      )
    )
    return
  }

  await run('docker', ['compose', '-f', composeFile, 'up', '-d', 'postgres', 'temporal', 'minio'])
  await Promise.all([
    waitForService(
      'postgres',
      ['pg_isready', '-U', 'appsea_migrator', '-d', 'appsea'],
      'PostgreSQL'
    ),
    waitForService(
      'temporal',
      ['temporal', 'operator', 'cluster', 'health', '--address', '127.0.0.1:7233'],
      'Temporal'
    ),
    waitForService('minio', ['curl', '-fsS', 'http://127.0.0.1:9000/minio/health/ready'], 'MinIO')
  ])
  await run('docker', ['compose', '-f', composeFile, 'run', '--rm', '--no-deps', 'minio-init'])
  await runMigration(environment)

  const children = localProcessCommands().map((args) =>
    start(pnpmCommand(), pnpmArgs(args), environment)
  )
  let stopping = false
  const stop = async (exitCode) => {
    if (stopping) return
    stopping = true
    await Promise.all(children.map((child) => terminate(child)))
    process.exit(exitCode)
  }
  process.once('SIGINT', () => void stop(130))
  process.once('SIGTERM', () => void stop(143))
  for (const child of children) {
    child.once('error', (error) => {
      console.error(error instanceof Error ? error.message : error)
      void stop(1)
    })
    child.once('exit', (code, signal) => {
      if (stopping) return
      console.error(`AppSea local process exited (${signal ?? code ?? 'unknown'})`)
      void stop(code && code > 0 ? code : 1)
    })
  }
  console.log('AppSea local stack is ready at http://localhost:3000')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
