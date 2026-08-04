import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { composeFile, repositoryRoot } from './dev_local.mjs'

const localHost = '127.0.0.1'
const localWebUrl = `http://${localHost}:3000`

function pnpmInvocation(args) {
  if (process.platform === 'win32') {
    return [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`]]
  }
  return ['pnpm', args]
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
      const detail = sanitize(`${stderr}\n${stdout}`.trim())
      reject(
        new Error(
          `${command} ${args.join(' ')} exited with code ${code}${detail ? `: ${detail}` : ''}`
        )
      )
    })
  })
}

function sanitize(value, maxLines = 80) {
  return value
    .replace(/postgres:\/\/[^\s]+/gi, 'postgres://[redacted]')
    .replace(/(APPSEA_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|URL))=[^\s]+/gi, '$1=[redacted]')
    .split(/\r?\n/)
    .slice(-maxLines)
    .join('\n')
}

function diagnosticOutput(value) {
  const sanitizedValue = sanitize(value, 100_000)
  const lines = sanitizedValue.split(/\r?\n/)
  const structured = lines.filter((line) =>
    /"event"\s*:|"failureCode"\s*:|"failureContext"\s*:|APPSEA_ACTIVITY_FAILED/.test(line)
  )
  const tail = lines.slice(-80)
  return [...new Set([...structured.slice(-200), ...tail])].join('\n')
}

function startLocalStack() {
  const [command, args] = pnpmInvocation(['dev:local'])
  const output = []
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32'
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => output.push(chunk))
  child.stderr.on('data', (chunk) => output.push(chunk))
  return { child, output }
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
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 10_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function fetchResponse(route, init = {}) {
  return fetch(`${localWebUrl}${route}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(5_000)
  })
}

async function waitForResponse(route, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetchResponse(route)
      const body = await response.text()
      if (predicate(response, body)) return { response, body }
      lastError = `${route} returned HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${route} did not become ready within ${timeoutMs}ms: ${lastError}`)
}

async function waitForLocalWeb(child, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(
        `local stack exited before web readiness (code ${child.exitCode ?? 'signal'})`
      )
    }
    try {
      const response = await fetchResponse('/api/health/live')
      if (response.status === 200) return
    } catch {
      // The web process may still be compiling or waiting for dependencies.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`local web process did not become reachable within ${timeoutMs}ms`)
}

function parseJson(body, route) {
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${route} did not return JSON`)
  }
}

async function requestJson(route, init = {}) {
  const response = await fetchResponse(route, init)
  const body = await response.text()
  return { response, payload: parseJson(body, route) }
}

async function waitForJsonResponse(route, init, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'
  while (Date.now() < deadline) {
    try {
      const result = await requestJson(route, init)
      if (predicate(result.response, result.payload)) return result
      lastError = `${route} returned HTTP ${result.response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${route} did not reach the expected state within ${timeoutMs}ms: ${lastError}`)
}

function sessionCookieFrom(response) {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? '']
  const cookie = cookies.find((value) => /(?:^|;\s*)(?:__Host-)?appsea_session=/.test(value))
  const pair = cookie?.split(';', 1)[0]
  if (!pair) throw new Error('signup did not return a private session cookie')
  return pair
}

function assertPrivateWorkspaceResponses({
  signup,
  workspace,
  campaign,
  importStart,
  workflow,
  batch,
  run,
  sources,
  campaignId,
  batchId,
  runId
}) {
  if (signup.status !== 201 || signup.hasSessionCookie !== true) {
    throw new Error('private signup did not establish a session')
  }
  const workspaces = workspace.payload?.data
  const privateWorkspace = Array.isArray(workspaces)
    ? workspaces.find(
        (candidate) =>
          candidate?.visibility === 'private' &&
          candidate?.fixtureOnly === false &&
          candidate?.role === 'owner'
      )
    : undefined
  if (!privateWorkspace) throw new Error('signup did not return an owner private workspace')
  if (workspace.status !== 200) throw new Error('private workspace list was not readable')
  if (campaign.status !== 201 || campaign.payload?.data?.campaignId !== campaignId) {
    throw new Error('private production campaign was not created')
  }
  if (importStart.status !== 202 || importStart.payload?.data?.batch?.batchId !== batchId) {
    throw new Error('owner-authorized import was not admitted')
  }
  if (
    workflow.status !== 200 ||
    workflow.payload?.data?.state !== 'completed' ||
    workflow.payload?.data?.result?.state !== 'completed'
  ) {
    throw new Error('owner-authorized import workflow did not complete')
  }
  if (batch.status !== 200 || batch.payload?.data?.state !== 'consumed') {
    throw new Error('owner-authorized import batch was not durably consumed')
  }
  if (
    run.status !== 200 ||
    run.payload?.data?.result?.state !== 'completed' ||
    run.payload?.data?.result?.runId !== runId ||
    run.payload?.data?.result?.manualImportBatchId !== batchId
  ) {
    throw new Error('private production collection read model was not completed')
  }
  const coverageGaps = run.payload?.data?.result?.coverageGaps
  if (
    !Array.isArray(coverageGaps) ||
    !coverageGaps.some((gap) => gap.includes('does not establish public market coverage'))
  ) {
    throw new Error('private import public-market coverage gap was not visible')
  }
  const sourcePolicies = sources.payload?.data
  const manualSource = Array.isArray(sourcePolicies)
    ? sourcePolicies.find((source) => source?.sourceId === 'manual-owner-import')
    : undefined
  const publicSource = Array.isArray(sourcePolicies)
    ? sourcePolicies.find((source) => source?.sourceId === 'cfpb-consumer-complaints')
    : undefined
  if (!manualSource || manualSource.collectible !== true) {
    throw new Error('owner-authorized source policy was not collectible')
  }
  if (publicSource && publicSource.collectible === true) {
    throw new Error('disabled public source was incorrectly marked collectible')
  }
}

export function assertLocalStackResponses({
  live,
  ready,
  leaderboard,
  signup,
  login,
  privateWorkspace
}) {
  if (
    live.status !== 200 ||
    live.payload?.service !== 'appsea-web' ||
    live.payload?.status !== 'ok'
  ) {
    throw new Error('local liveness response was not the bounded ok payload')
  }
  if (ready.status !== 200 || ready.payload?.status !== 'ready') {
    throw new Error('local readiness response was not ready')
  }
  for (const name of ['database', 'temporal', 'objectStore']) {
    if (ready.payload?.checks?.[name] !== 'ok') {
      throw new Error(`local readiness check ${name} was not ok`)
    }
  }
  for (const [route, body, required] of [
    ['/', leaderboard, ['Leaderboard', 'Synthetic fixture ranking']],
    ['/signup', signup, ['Create a workspace']],
    ['/login', login, ['Sign in']]
  ]) {
    for (const value of required) {
      if (!body.includes(value)) throw new Error(`${route} is missing ${value}`)
    }
  }
  if (leaderboard.includes('Thesis') || leaderboard.includes('Research status')) {
    throw new Error('public leaderboard leaked private research detail')
  }
  if (privateWorkspace) assertPrivateWorkspaceResponses(privateWorkspace)
}

async function runPrivateWorkspaceSmoke() {
  const nonce = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const campaignId = `campaign:smoke-${nonce}`
  const batchId = `batch:smoke-${nonce}`
  const runId = `run:smoke-${nonce}`
  const email = `appsea-smoke-${nonce.replace(/[^a-z0-9]/gi, '')}@example.test`
  const originHeaders = { origin: 'http://localhost:3000' }
  const signup = await requestJson('/api/auth/signup', {
    method: 'POST',
    headers: { ...originHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'local-smoke-password-2026',
      displayName: 'Local smoke owner',
      workspaceName: 'Local smoke workspace'
    })
  })
  const sessionCookie = sessionCookieFrom(signup.response)
  const privateHeaders = { cookie: sessionCookie }
  const workspace = await requestJson('/api/workspaces', { headers: privateHeaders })
  const workspaceId = workspace.payload?.data?.find(
    (candidate) =>
      candidate?.visibility === 'private' &&
      candidate?.fixtureOnly === false &&
      candidate?.role === 'owner'
  )?.workspaceId
  if (!workspaceId) throw new Error('signup did not return a usable owner workspace')

  const campaign = await requestJson(`/api/workspaces/${workspaceId}/campaigns`, {
    method: 'POST',
    headers: { ...privateHeaders, ...originHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      campaignId,
      name: 'Local owner import smoke',
      purpose: 'opportunity-research',
      configuration: {
        schemaVersion: 'campaign-v1',
        goal: 'Verify owner-authorized intake',
        query: 'workflow problem',
        seeds: ['workflow problem'],
        sourceIds: ['manual-owner-import'],
        languages: ['en'],
        geographies: [],
        dateRange: { from: null, to: null },
        exclusions: [],
        maxEvidenceCount: 10,
        refreshPolicy: 'manual',
        sensitiveTopicPolicy: 'review',
        requestedDisplayMode: 'excerpt'
      },
      budget: { currency: 'USD', maxSourceItems: 10, maxCostMicros: 0, maxActivityAttempts: 3 }
    })
  })
  if (campaign.response.status !== 201 || typeof campaign.payload?.data?.campaignId !== 'string') {
    throw new Error(`private campaign create returned HTTP ${campaign.response.status}`)
  }
  const importStart = await requestJson(`/api/workspaces/${workspaceId}/imports`, {
    method: 'POST',
    headers: { ...privateHeaders, ...originHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      campaignId,
      batchId,
      runId,
      filename: 'authorized-export.json',
      format: 'json',
      content: JSON.stringify([
        {
          sourceRecordId: 'smoke-ticket-1',
          text: 'Smoke-only owner import; not market evidence.',
          product: 'Inbox Relay',
          company: 'Example Systems',
          feature: 'routing',
          category: 'missing_alert',
          language: 'en'
        }
      ]),
      idempotencyKey: `manual-import-smoke-${nonce}`,
      authorizationAttested: true
    })
  })
  const workflowId = importStart.payload?.data?.workflowId
  if (typeof workflowId !== 'string')
    throw new Error('owner import did not return a workflow identifier')
  const workflow = await waitForJsonResponse(
    `/api/workspaces/${workspaceId}/research/production/workflow/${workflowId}`,
    { headers: privateHeaders },
    (_response, payload) =>
      ['completed', 'failed', 'canceled', 'budget_rejected'].includes(payload?.data?.state)
  )
  const batch = await requestJson(`/api/workspaces/${workspaceId}/imports/${batchId}`, {
    headers: privateHeaders
  })
  const run = await requestJson(`/api/workspaces/${workspaceId}/research/production/${runId}`, {
    headers: privateHeaders
  })
  const sources = await requestJson(`/api/workspaces/${workspaceId}/sources`, {
    headers: privateHeaders
  })

  return {
    signup: { status: signup.response.status, hasSessionCookie: Boolean(sessionCookie) },
    workspace: { status: workspace.response.status, payload: workspace.payload },
    campaign: { status: campaign.response.status, payload: campaign.payload },
    importStart: { status: importStart.response.status, payload: importStart.payload },
    workflow: { status: workflow.response.status, payload: workflow.payload },
    batch: { status: batch.response.status, payload: batch.payload },
    run: { status: run.response.status, payload: run.payload },
    sources: { status: sources.response.status, payload: sources.payload },
    campaignId,
    batchId,
    runId
  }
}

async function main() {
  const localStack = startLocalStack()
  try {
    await waitForLocalWeb(localStack.child)
    const live = await waitForResponse('/api/health/live', (response) => response.status === 200)
    const ready = await waitForResponse('/api/health/ready', (response) => response.status === 200)
    const leaderboard = await waitForResponse(
      '/',
      (response, body) => response.status === 200 && body.includes('Leaderboard')
    )
    const signup = await waitForResponse(
      '/signup',
      (response, body) => response.status === 200 && body.includes('Create a workspace')
    )
    const login = await waitForResponse(
      '/login',
      (response, body) => response.status === 200 && body.includes('Sign in')
    )

    assertLocalStackResponses({
      live: { status: live.response.status, payload: parseJson(live.body, '/api/health/live') },
      ready: { status: ready.response.status, payload: parseJson(ready.body, '/api/health/ready') },
      leaderboard: leaderboard.body,
      signup: signup.body,
      login: login.body,
      privateWorkspace: await runPrivateWorkspaceSmoke()
    })
    console.log(
      'local private-workspace stack smoke passed for readiness, authenticated owner intake, and fixture disclosure'
    )
  } catch (error) {
    const output = diagnosticOutput(localStack.output.join(''))
    if (output) console.error(output)
    throw error
  } finally {
    await terminate(localStack.child)
    await run('docker', ['compose', '-f', composeFile, 'down', '--remove-orphans']).catch(
      (error) => {
        console.error(`local dependency cleanup failed: ${sanitize(error.message)}`)
      }
    )
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      `local private-workspace stack smoke failed: ${sanitize(error instanceof Error ? error.message : String(error))}`
    )
    process.exitCode = 1
  })
}
