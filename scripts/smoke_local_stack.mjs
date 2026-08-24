import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { composeFile, repositoryRoot } from './dev_local.mjs'

const localHost = '127.0.0.1'
const localWebUrl = `http://${localHost}:3000`
// Next.js may compile a route on its first request in the local stack. Keep
// that cold-start allowance separate from the bounded workflow polling loops.
const localRequestTimeoutMs = 60_000

const balancedScoreFactorKeys = [
  'demand.complaintFrequency',
  'demand.independentUserCount',
  'demand.sourceDiversity',
  'demand.recentVelocity',
  'demand.timePersistence',
  'demand.segmentDensity',
  'pain.severity',
  'pain.workflowCriticality',
  'pain.workaroundCost',
  'pain.switchingIntent',
  'marketOpening.competitorDissatisfaction',
  'marketOpening.unresolvedSolutionGap',
  'marketOpening.substituteWeakness',
  'marketOpening.timing',
  'businessQuality.willingnessToPay',
  'businessQuality.repeatUseRetention',
  'businessQuality.audienceReachability',
  'businessQuality.expansionPotential',
  'executionQuality.mvpFeasibility',
  'executionQuality.dataIntegrationFeasibility',
  'executionQuality.trustComplianceFeasibility',
  'executionQuality.platformIndependence',
  'risk.sourceLegal',
  'risk.platformConcentration',
  'risk.commoditization',
  'risk.regulatoryTrust',
  'risk.manipulation',
  'risk.eventDriven',
  'confidence.sample',
  'confidence.sourceDiversity',
  'confidence.directness',
  'confidence.entityConfidence',
  'confidence.timeStability',
  'confidence.manipulationSpam',
  'confidence.methodAgreementHumanReview'
]

function reviewedSeedFactorEvidence(seedReviewId) {
  return Object.fromEntries(
    balancedScoreFactorKeys.map((key) => [
      key,
      {
        basis: 'reviewed-seed',
        evidenceIds: [
          `reviewed-seed:${seedReviewId}:${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
        ]
      }
    ])
  )
}

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
    signal: init.signal ?? AbortSignal.timeout(localRequestTimeoutMs)
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
  complaintReview,
  seedCreate,
  seedReviewed,
  seedApproved,
  analysisStart,
  analysisStatus,
  analysis,
  opportunity,
  opportunityPage,
  reportPage,
  planPage,
  usagePage,
  auditEvents,
  privatePages,
  campaignId,
  batchId,
  runId,
  analysisRunId,
  seedReviewId,
  opportunitySlug
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
  if (
    complaintReview.status !== 200 ||
    complaintReview.payload?.data?.reviewState !== 'confirmed'
  ) {
    throw new Error('owner complaint review did not confirm retained evidence')
  }
  if (
    seedCreate.status !== 201 ||
    seedCreate.payload?.data?.seedReviewId !== seedReviewId ||
    seedCreate.payload?.data?.reviewState !== 'unreviewed'
  ) {
    throw new Error('reviewed opportunity seed was not registered as unreviewed')
  }
  if (
    seedReviewed.status !== 200 ||
    seedReviewed.payload?.data?.reviewState !== 'reviewed' ||
    seedApproved.status !== 200 ||
    seedApproved.payload?.data?.reviewState !== 'approved'
  ) {
    throw new Error('opportunity seed review did not reach owner-approved state')
  }
  const analysisWorkflowId = analysisStart.payload?.data?.workflowId
  if (
    analysisStart.status !== 202 ||
    analysisStart.payload?.data?.analysisRunId !== analysisRunId ||
    typeof analysisWorkflowId !== 'string'
  ) {
    throw new Error('approved production analysis was not admitted')
  }
  if (
    analysisStatus.status !== 200 ||
    analysisStatus.payload?.data?.state !== 'completed' ||
    analysisStatus.payload?.data?.analysisRunId !== analysisRunId
  ) {
    throw new Error('production analysis workflow did not complete')
  }
  const analysisData = analysis.payload?.data
  if (
    analysis.status !== 200 ||
    analysisData?.result?.state !== 'completed' ||
    analysisData?.result?.analysisRunId !== analysisRunId ||
    analysisData?.artifact?.mode !== 'production' ||
    analysisData?.artifact?.opportunity?.slug !== opportunitySlug ||
    analysisData?.artifact?.opportunity?.synthetic !== false ||
    analysisData?.artifact?.opportunity?.scoreSnapshot?.version !== 'opportunity-score-v1.0.0' ||
    typeof analysisData?.artifact?.opportunity?.scoreSnapshot?.rankingScore !== 'number' ||
    typeof analysisData?.artifact?.opportunity?.scoreSnapshot?.riskAdjustedScore !== 'number' ||
    typeof analysisData?.artifact?.opportunity?.scoreSnapshot?.evidenceConfidence !== 'number' ||
    analysisData?.report?.synthetic !== false ||
    analysisData?.planPackage?.files?.length < 1 ||
    analysisData?.governance?.reportApprovalState !== 'draft' ||
    analysisData?.governance?.planApprovalState !== 'unreviewed'
  ) {
    throw new Error('production analysis did not persist a private report and plan package')
  }
  const opportunityData = opportunity.payload?.data
  if (
    opportunity.status !== 200 ||
    opportunityData?.opportunity?.slug !== opportunitySlug ||
    opportunityData?.opportunity?.synthetic !== false ||
    opportunityData?.report?.approvalState !== 'draft' ||
    opportunityData?.plan?.approvalState !== 'unreviewed'
  ) {
    throw new Error('private opportunity package readback was not available')
  }
  if (
    opportunityPage.status !== 200 ||
    !opportunityPage.body.includes('Private research package') ||
    reportPage.status !== 200 ||
    !reportPage.body.includes('Evidence-backed report') ||
    !reportPage.body.includes('Coverage limits') ||
    planPage.status !== 200 ||
    !planPage.body.includes('Coding-agent plan') ||
    !planPage.body.includes('README.md') ||
    usagePage.status !== 200 ||
    !usagePage.body.includes('Cost summary') ||
    !usagePage.body.includes('Quota reconciliation') ||
    auditEvents.status !== 200 ||
    !Array.isArray(auditEvents.payload?.data)
  ) {
    throw new Error('private report, coding-plan, usage, and audit reads were not available')
  }
  const expectedPrivatePages = [
    ['source coverage', privatePages?.sources, 'Source coverage'],
    ['seed reviews', privatePages?.seedReviews, 'Seed reviews'],
    ['campaigns', privatePages?.campaigns, 'Research campaigns'],
    ['owner imports', privatePages?.imports, 'Owner imports'],
    ['members', privatePages?.members, 'Members'],
    ['collection detail', privatePages?.collection, 'Collection scope'],
    ['analysis detail', privatePages?.analysis, 'Analysis status'],
    ['workflow detail', privatePages?.workflow, 'Collection status'],
    ['campaign history', privatePages?.campaignRuns, 'run history']
  ]
  const missingPrivatePage = expectedPrivatePages.find(
    ([, page, marker]) => page?.status !== 200 || !page.body.includes(marker)
  )
  if (missingPrivatePage) {
    throw new Error(`private ${missingPrivatePage[0]} page was not renderable`)
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
  const analysisRunId = `analysis:smoke-${nonce}`
  const seedReviewId = `seed-review:smoke-${nonce}`
  const opportunitySlug = `smoke-${nonce}`
  const email = `appsea-smoke-${nonce.replace(/[^a-z0-9]/gi, '')}@example.test`
  const originHeaders = {
    origin: 'http://localhost:3000',
    // The development auth limiter accepts a bounded forwarded marker. A
    // per-run marker keeps repeated local smoke runs isolated without
    // changing production proxy trust rules.
    'x-forwarded-for': `smoke-${nonce}`
  }
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
  if (signup.response.status !== 201) {
    throw new Error(
      `private signup returned HTTP ${signup.response.status}: ${JSON.stringify(signup.payload)}`
    )
  }
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
  const evidence = run.payload?.data?.evidence
  const complaintId = Array.isArray(evidence) ? evidence[0]?.complaintId : undefined
  if (typeof complaintId !== 'string') {
    throw new Error('private collection did not return a complaint for review')
  }
  const complaintReview = await requestJson(
    `/api/workspaces/${workspaceId}/research/production/${runId}/complaints/${complaintId}`,
    {
      method: 'PATCH',
      headers: { ...privateHeaders, ...originHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirmed' })
    }
  )
  const scoreAt = new Date().toISOString()
  const seed = {
    id: `opportunity:smoke-${nonce}`,
    slug: opportunitySlug,
    name: 'Smoke-only reviewed opportunity',
    oneLine: 'A smoke-only private opportunity package.',
    thesis: 'This reviewed seed exists only to prove the private workflow boundary.',
    audience: 'Local smoke owners',
    firstWedge: 'Confirm one owner-authorized evidence row.',
    tags: ['smoke-only'],
    competitors: [],
    contraryEvidence: ['This is not market research.'],
    scoreFactors: {
      complaintVolume: 10,
      painSeverity: 20,
      recurrence: 30,
      willingnessToPay: 0,
      competitiveGap: 10,
      buildFeasibility: 30,
      evidenceQuality: 20,
      contraryEvidencePenalty: 10
    },
    balancedScoreInput: {
      profile: 'balanced',
      demand: {
        complaintFrequency: 60,
        independentUserCount: 45,
        sourceDiversity: 35,
        recentVelocity: 40,
        timePersistence: 55,
        segmentDensity: 30
      },
      pain: {
        severity: 70,
        workflowCriticality: 65,
        workaroundCost: 55,
        switchingIntent: 35
      },
      marketOpening: {
        competitorDissatisfaction: 35,
        unresolvedSolutionGap: 50,
        substituteWeakness: 45,
        timing: 30
      },
      businessQuality: {
        willingnessToPay: 25,
        repeatUseRetention: 35,
        audienceReachability: 45,
        expansionPotential: 25
      },
      executionQuality: {
        mvpFeasibility: 80,
        dataIntegrationFeasibility: 70,
        trustComplianceFeasibility: 75,
        platformIndependence: 65
      },
      riskPenalties: {
        sourceLegal: 0,
        platformConcentration: 1,
        commoditization: 1,
        regulatoryTrust: 0,
        manipulation: 0,
        eventDriven: 0
      },
      confidenceComponents: {
        sample: 0.65,
        sourceDiversity: 0.55,
        directness: 0.75,
        entityConfidence: 0.8,
        timeStability: 0.7,
        manipulationSpam: 0.95,
        methodAgreementHumanReview: 0.7
      },
      evidenceSnapshotId: `evidence-snapshot:smoke-${nonce}`,
      factorEvidence: reviewedSeedFactorEvidence(seedReviewId),
      coverageSummary: {
        sourceCount: 1,
        observationCount: 1,
        independentUserCount: 1,
        gapCount: 1,
        summary: 'Tenant-private owner import with public coverage unavailable.'
      },
      freshnessSummary: {
        oldestObservationAt: scoreAt,
        newestObservationAt: scoreAt,
        asOf: scoreAt,
        ageDays: 0,
        summary: 'Owner-import smoke evidence is captured at run time.'
      }
    },
    planFiles: [
      'README.md',
      '01-product-brief.md',
      '02-mvp-scope.md',
      '03-architecture.md',
      '04-task-graph.json',
      '05-validation.md'
    ]
  }
  const seedCreate = await requestJson(`/api/workspaces/${workspaceId}/seed-reviews`, {
    method: 'POST',
    headers: { ...privateHeaders, ...originHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ seedReviewId, seedVersion: 'smoke-seed-v1', seed })
  })
  const seedReviewed = await requestJson(
    `/api/workspaces/${workspaceId}/seed-reviews/${seedReviewId}`,
    {
      method: 'PATCH',
      headers: { ...privateHeaders, ...originHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reviewed' })
    }
  )
  const seedApproved = await requestJson(
    `/api/workspaces/${workspaceId}/seed-reviews/${seedReviewId}`,
    {
      method: 'PATCH',
      headers: { ...privateHeaders, ...originHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approved' })
    }
  )
  const analysisStart = await requestJson(
    `/api/workspaces/${workspaceId}/research/production/${runId}/analysis`,
    {
      method: 'POST',
      headers: { ...privateHeaders, ...originHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        analysisRunId,
        idempotencyKey: `production-analysis-smoke-${nonce}`,
        requestedAt: new Date().toISOString(),
        seedReviewId
      })
    }
  )
  const analysisWorkflowId = analysisStart.payload?.data?.workflowId
  if (typeof analysisWorkflowId !== 'string') {
    throw new Error('production analysis did not return a workflow identifier')
  }
  const analysisStatus = await waitForJsonResponse(
    `/api/workspaces/${workspaceId}/analysis/${analysisRunId}/status?workflowId=${encodeURIComponent(analysisWorkflowId)}`,
    { headers: privateHeaders },
    (_response, payload) =>
      _response.status === 200 && ['completed', 'failed'].includes(payload?.data?.state)
  )
  if (analysisStatus.payload?.data?.state !== 'completed') {
    throw new Error(
      `production analysis workflow failed: ${JSON.stringify(analysisStatus.payload?.data ?? {})}`
    )
  }
  const analysis = await waitForJsonResponse(
    `/api/workspaces/${workspaceId}/analysis/${analysisRunId}`,
    { headers: privateHeaders },
    (_response, payload) => _response.status === 200 && payload?.data?.result?.state === 'completed'
  )
  const opportunity = await requestJson(
    `/api/workspaces/${workspaceId}/opportunities/${encodeURIComponent(opportunitySlug)}`,
    { headers: privateHeaders }
  )
  const encodedWorkspaceId = encodeURIComponent(workspaceId)
  const opportunityPageResponse = await fetchResponse(
    `/workspace/${encodedWorkspaceId}/opportunities/${encodeURIComponent(opportunitySlug)}`,
    { headers: privateHeaders }
  )
  const opportunityPage = {
    status: opportunityPageResponse.status,
    body: await opportunityPageResponse.text()
  }
  const reportPageResponse = await fetchResponse(
    `/workspace/${encodedWorkspaceId}/opportunities/${encodeURIComponent(opportunitySlug)}/report`,
    { headers: privateHeaders }
  )
  const reportPage = { status: reportPageResponse.status, body: await reportPageResponse.text() }
  const planPageResponse = await fetchResponse(
    `/workspace/${encodedWorkspaceId}/opportunities/${encodeURIComponent(opportunitySlug)}/plan`,
    { headers: privateHeaders }
  )
  const planPage = { status: planPageResponse.status, body: await planPageResponse.text() }
  const usagePageResponse = await fetchResponse(`/workspace/${encodedWorkspaceId}/usage`, {
    headers: privateHeaders
  })
  const usagePage = { status: usagePageResponse.status, body: await usagePageResponse.text() }
  const auditEvents = await requestJson(`/api/workspaces/${workspaceId}/audit-events?limit=25`, {
    headers: privateHeaders
  })
  const privatePageResponse = async (route) => {
    const response = await fetchResponse(`/workspace/${encodedWorkspaceId}${route}`, {
      headers: privateHeaders
    })
    return { status: response.status, body: await response.text() }
  }
  const privatePages = {
    sources: await privatePageResponse('/sources'),
    seedReviews: await privatePageResponse('/seed-reviews'),
    campaigns: await privatePageResponse('/campaigns'),
    imports: await privatePageResponse('/imports'),
    members: await privatePageResponse('/members'),
    collection: await privatePageResponse(`/research/${encodeURIComponent(runId)}`),
    analysis: await privatePageResponse(
      `/research/analysis/${encodeURIComponent(analysisRunId)}?workflowId=${encodeURIComponent(analysisWorkflowId)}`
    ),
    workflow: await privatePageResponse(`/research/workflows/${encodeURIComponent(workflowId)}`),
    campaignRuns: await privatePageResponse(`/campaigns/${encodeURIComponent(campaignId)}/runs`)
  }

  return {
    signup: { status: signup.response.status, hasSessionCookie: Boolean(sessionCookie) },
    workspace: { status: workspace.response.status, payload: workspace.payload },
    campaign: { status: campaign.response.status, payload: campaign.payload },
    importStart: { status: importStart.response.status, payload: importStart.payload },
    workflow: { status: workflow.response.status, payload: workflow.payload },
    batch: { status: batch.response.status, payload: batch.payload },
    run: { status: run.response.status, payload: run.payload },
    sources: { status: sources.response.status, payload: sources.payload },
    complaintReview: { status: complaintReview.response.status, payload: complaintReview.payload },
    seedCreate: { status: seedCreate.response.status, payload: seedCreate.payload },
    seedReviewed: { status: seedReviewed.response.status, payload: seedReviewed.payload },
    seedApproved: { status: seedApproved.response.status, payload: seedApproved.payload },
    analysisStart: { status: analysisStart.response.status, payload: analysisStart.payload },
    analysisStatus: { status: analysisStatus.response.status, payload: analysisStatus.payload },
    analysis: { status: analysis.response.status, payload: analysis.payload },
    opportunity: { status: opportunity.response.status, payload: opportunity.payload },
    opportunityPage,
    reportPage,
    planPage,
    usagePage,
    auditEvents: { status: auditEvents.response.status, payload: auditEvents.payload },
    privatePages,
    campaignId,
    batchId,
    runId,
    analysisRunId,
    seedReviewId,
    opportunitySlug
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
      'local private-workspace stack smoke passed for readiness, owner intake, reviewed production analysis, private report/plan readback, and fixture disclosure'
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
