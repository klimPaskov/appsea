import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

function runPnpm(args, env, options = {}) {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], {
      env,
      ...options
    })
  }
  return run('pnpm', args, { env, ...options })
}

function spawnPnpm(args, env) {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
  const commandArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', `pnpm ${args.join(' ')}`] : args
  const child = spawn(command, commandArgs, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32'
  })
  const lines = []
  const listeners = []
  let buffer = ''
  let closeResult
  let closeResolve
  let closeReject
  const closePromise = new Promise((resolve, reject) => {
    closeResolve = resolve
    closeReject = reject
  })
  const acceptChunk = (chunk) => {
    buffer += chunk.toString()
    const chunks = buffer.split(/\r?\n/)
    buffer = chunks.pop() ?? ''
    for (const line of chunks) {
      lines.push(line)
      for (const listener of [...listeners]) listener(line)
    }
  }
  child.stdout.on('data', acceptChunk)
  child.stderr.on('data', acceptChunk)
  child.once('error', (error) => closeReject(error))
  child.once('close', (code, signal) => {
    if (buffer) {
      lines.push(buffer)
      for (const listener of [...listeners]) listener(buffer)
    }
    closeResult = { code, signal }
    closeResolve(closeResult)
  })
  return {
    child,
    lines,
    waitForLine(predicate, timeoutMs = 60_000) {
      const existing = lines.find((line) => predicate(line))
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.splice(listeners.indexOf(listener), 1)
          reject(new Error('Worker process did not emit the expected lifecycle event'))
        }, timeoutMs)
        const listener = (line) => {
          if (!predicate(line)) return
          clearTimeout(timer)
          listeners.splice(listeners.indexOf(listener), 1)
          resolve(line)
        }
        listeners.push(listener)
        if (closeResult) {
          clearTimeout(timer)
          listeners.splice(listeners.indexOf(listener), 1)
          reject(new Error('Worker process exited before the expected lifecycle event'))
        }
      })
    },
    waitForExit: () => closePromise
  }
}

async function terminateProcess(processHandle) {
  if (!processHandle || processHandle.child.exitCode !== null || processHandle.child.signalCode) {
    return
  }
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(processHandle.child.pid), '/T', '/F'], {
      capture: true
    }).catch(() => undefined)
  } else {
    try {
      process.kill(-processHandle.child.pid, 'SIGKILL')
    } catch {
      try {
        process.kill(processHandle.child.pid, 'SIGKILL')
      } catch {
        // The process exited between the state check and the signal.
      }
    }
  }
  await processHandle.waitForExit()
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

async function query(sql) {
  const result = await run(
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
      sql
    ],
    { capture: true }
  )
  return result.stdout.trim()
}

async function waitForQuery(sql, predicate, label) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const value = await query(sql)
      if (predicate(value)) return value
    } catch {
      // The workflow may not have initialized its workspace yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${label} did not reach the expected state within 60 seconds`)
}

function historyPayloads(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => historyPayloads(entry, output))
    return output
  }
  if (!value || typeof value !== 'object') return output
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'data' && typeof entry === 'string') {
      output.push(Buffer.from(entry, 'base64').toString('utf8'))
    } else {
      historyPayloads(entry, output)
    }
  }
  return output
}

async function main() {
  const suffix = `recovery-${Date.now()}`
  const workspaceId = `workspace-fixture-workflow-${suffix}`
  const idempotencyKey = `fixture-workflow-${suffix}-v1`
  const objectStoreRoot = await mkdtemp(path.join(os.tmpdir(), 'appsea-worker-recovery-'))
  const localEnvironment = {
    DATABASE_URL: 'postgres://appsea_service:appsea-service-local-only@localhost:5433/appsea',
    APPSEA_MIGRATION_DATABASE_URL:
      'postgres://appsea_migrator:appsea-migrator-local-only@localhost:5433/appsea',
    APPSEA_DATABASE_MIGRATION_ROLE: 'appsea_owner',
    APPSEA_DATABASE_SSL_MODE: 'disable',
    APPSEA_TEMPORAL_ADDRESS: '127.0.0.1:7233',
    APPSEA_OBJECT_STORE_ROOT: objectStoreRoot,
    NODE_ENV: 'development'
  }
  let firstWorker
  let replacementWorker
  let workflowClient
  try {
    if (fresh) {
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

    firstWorker = spawnPnpm(['--filter', '@appsea/worker', 'workflow:worker'], {
      ...localEnvironment,
      APPSEA_TEST_WORKER_PERSIST_PAUSE_MS: '20000'
    })
    await firstWorker.waitForLine((line) => line.includes('"event":"worker_started"'))

    workflowClient = spawnPnpm(['--filter', '@appsea/worker', 'workflow:fixture'], {
      ...localEnvironment,
      APPSEA_WORKFLOW_FIXTURE_EXTERNAL_WORKER: 'true',
      APPSEA_WORKFLOW_FIXTURE_ID_SUFFIX: suffix
    })
    await waitForQuery(
      `SELECT count(*) FROM appsea.workflow_job_checkpoints
        WHERE workspace_id = '${workspaceId}' AND checkpoint = 'persisting'`,
      (value) => value === '1',
      'the fixture persist checkpoint'
    )
    await terminateProcess(firstWorker)
    firstWorker = undefined

    replacementWorker = spawnPnpm(
      ['--filter', '@appsea/worker', 'workflow:worker'],
      localEnvironment
    )
    await replacementWorker.waitForLine((line) => line.includes('"event":"worker_started"'))
    const workflowResult = await workflowClient.waitForExit()
    workflowClient = undefined
    if (workflowResult.code !== 0) {
      throw new Error('Fixture workflow did not complete after worker replacement')
    }

    const jobState = await waitForQuery(
      `SELECT state || ':' || checkpoint || ':' || activity_attempts
         FROM appsea.workflow_job_executions
        WHERE workspace_id = '${workspaceId}'`,
      (value) => value.startsWith('completed:completed:'),
      'the completed workflow job'
    )
    const rowCounts = await query(
      `SELECT (SELECT count(*) FROM appsea.workflow_job_executions WHERE workspace_id = '${workspaceId}') || ':' ||
              (SELECT count(*) FROM appsea.research_runs WHERE workspace_id = '${workspaceId}') || ':' ||
              (SELECT count(*) FROM appsea.workflow_job_checkpoints WHERE workspace_id = '${workspaceId}') || ':' ||
              (SELECT count(*) FROM appsea.cost_ledger_entries WHERE workspace_id = '${workspaceId}') || ':' ||
              (SELECT count(*) FROM appsea.outbox_events WHERE workspace_id = '${workspaceId}')`
    )
    if (rowCounts !== '1:1:7:1:1') {
      throw new Error(`Worker replacement produced unexpected durable rows: ${rowCounts}`)
    }
    const workflowIdentity = await query(
      `SELECT workflow_id FROM appsea.workflow_job_executions WHERE workspace_id = '${workspaceId}'`
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
        workflowIdentity,
        '--output',
        'json'
      ],
      { capture: true }
    )
    const history = historyPayloads(JSON.parse(historyResult.stdout)).join('\n')
    if (history.includes(idempotencyKey)) {
      throw new Error('Raw workflow idempotency key leaked into Temporal history')
    }
    const fixtureSourceExcerpts = [
      'Synthetic example: assigned messages disappear from the team view after ownership changes.',
      'Synthetic example: a teammate cannot see why a conversation was reassigned or what happened before.',
      'Synthetic example: solved threads return as unread and create duplicate work for the next shift.',
      'Synthetic example: the team cannot tell who changed an owner, status, or priority during a busy handoff.'
    ]
    if (fixtureSourceExcerpts.some((excerpt) => history.includes(excerpt))) {
      throw new Error('Raw fixture source text leaked into Temporal history')
    }
    console.log(`worker replacement integration verified: ${jobState}; rows=${rowCounts}`)
  } finally {
    await terminateProcess(workflowClient)
    await terminateProcess(firstWorker)
    await terminateProcess(replacementWorker)
    await rm(objectStoreRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
