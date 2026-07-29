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

function runPnpm(args, env) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], {
      env
    })
  }
  return run('pnpm', args, { env })
}

async function waitForService(service, healthArgs, label) {
  const deadline = Date.now() + 60_000
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
  throw new Error(`${label} did not become ready within 60 seconds`)
}

const localEnvironment = {
  DATABASE_URL: 'postgres://appsea_service:appsea-service-local-only@localhost:5433/appsea',
  APPSEA_MIGRATION_DATABASE_URL:
    'postgres://appsea_migrator:appsea-migrator-local-only@localhost:5433/appsea',
  APPSEA_DATABASE_MIGRATION_ROLE: 'appsea_owner',
  APPSEA_DATABASE_SSL_MODE: 'disable',
  APPSEA_TEMPORAL_ADDRESS: '127.0.0.1:7233',
  NODE_ENV: 'development'
}

async function main() {
  if (fresh) {
    console.warn('Removing AppSea local PostgreSQL and Temporal containers and volumes (--fresh).')
    await run('docker', ['compose', '-f', composeFile, 'down', '--volumes', '--remove-orphans'])
  }
  await run('docker', ['compose', '-f', composeFile, 'up', '-d', 'postgres', 'temporal'])
  await Promise.all([
    waitForService('postgres', ['pg_isready', '-U', 'postgres', '-d', 'postgres'], 'PostgreSQL'),
    waitForService(
      'temporal',
      ['temporal', 'operator', 'cluster', 'health', '--address', '127.0.0.1:7233'],
      'Temporal'
    )
  ])
  await runPnpm(['db:migrate'], localEnvironment)
  await runPnpm(['--filter', '@appsea/worker', 'workflow:fixture'], localEnvironment)

  await run('docker', ['compose', '-f', composeFile, 'restart', 'temporal'])
  await waitForService(
    'temporal',
    ['temporal', 'operator', 'cluster', 'health', '--address', '127.0.0.1:7233'],
    'Temporal after restart'
  )
  await runPnpm(['--filter', '@appsea/worker', 'workflow:fixture'], localEnvironment)

  const counts = await run(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'appsea',
      '-Atc',
      `SELECT count(*) || ':' ||
              (SELECT count(*) FROM appsea.research_runs WHERE workspace_id = 'workspace-fixture-workflow-local')
         FROM appsea.workflow_job_executions
        WHERE workspace_id = 'workspace-fixture-workflow-local'`
    ],
    { capture: true }
  )
  if (counts.stdout.trim() !== '1:1') {
    throw new Error(`Durable workflow replay created unexpected rows: ${counts.stdout.trim()}`)
  }
  const workflowIdentity = await run(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'appsea',
      '-Atc',
      `SELECT workflow_id FROM appsea.workflow_job_executions
        WHERE workspace_id = 'workspace-fixture-workflow-local'`
    ],
    { capture: true }
  )
  const historyResult = await run(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      'exec',
      '-T',
      'temporal',
      'temporal',
      'workflow',
      'show',
      '--workflow-id',
      workflowIdentity.stdout.trim(),
      '--output',
      'json'
    ],
    { capture: true }
  )
  const history = JSON.parse(historyResult.stdout)
  const decodedPayloads = []
  const inspectPayloads = (value) => {
    if (Array.isArray(value)) {
      value.forEach(inspectPayloads)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'data' && typeof entry === 'string') {
        decodedPayloads.push(Buffer.from(entry, 'base64').toString('utf8'))
      } else {
        inspectPayloads(entry)
      }
    }
  }
  inspectPayloads(history)
  if (decodedPayloads.join('\n').includes('fixture-workflow-local-v1')) {
    throw new Error('Raw workflow idempotency key leaked into Temporal history')
  }
  console.log('durable workflow integration verified: 1 workflow job, 1 research run after restart')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
