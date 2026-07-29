import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = path.join(repositoryRoot, 'infra', 'local', 'compose.yaml')
const fresh = process.argv.includes('--fresh')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...options.env },
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

function runPnpmIntegration(options) {
  if (process.platform === 'win32') {
    return run(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'pnpm db:test:integration'],
      options
    )
  }
  return run('pnpm', ['db:test:integration'], options)
}

async function waitForPostgres() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await run(
        'docker',
        [
          'compose',
          '-f',
          composeFile,
          'exec',
          '-T',
          'postgres',
          'pg_isready',
          '-U',
          'postgres',
          '-d',
          'postgres'
        ],
        { capture: true }
      )
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('The local PostgreSQL container did not become ready within 30 seconds')
}

async function main() {
  if (fresh) {
    console.warn('Removing the AppSea local PostgreSQL container and named data volume (--fresh).')
    await run('docker', ['compose', '-f', composeFile, 'down', '--volumes', '--remove-orphans'])
  }

  await run('docker', ['compose', '-f', composeFile, 'up', '-d', 'postgres'])
  await waitForPostgres()
  await runPnpmIntegration({
    env: {
      APPSEA_TEST_DATABASE_URL:
        'postgres://appsea_service:appsea-service-local-only@localhost:5433/appsea_test',
      APPSEA_TEST_MIGRATION_DATABASE_URL:
        'postgres://appsea_migrator:appsea-migrator-local-only@localhost:5433/appsea_test',
      APPSEA_ALLOW_DESTRUCTIVE_DB_TESTS: 'yes',
      APPSEA_DATABASE_SSL_MODE: 'disable'
    }
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
