import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.join(repositoryRoot, 'apps', 'web')
const host = '127.0.0.1'
const port = 4313
const baseUrl = `http://${host}:${port}`
const defaultOutput = path.join(repositoryRoot, '.appsea', 'ui-reference-loop')

export const captureRoutes = [
  { id: 'leaderboard', path: '/leaderboard' },
  { id: 'opportunity', path: '/opportunities/inbox-relay' },
  { id: 'complaints', path: '/opportunities/inbox-relay/complaints' },
  { id: 'competitors', path: '/opportunities/inbox-relay/competitors' },
  { id: 'plan', path: '/opportunities/inbox-relay/plan' }
]

export const captureViewports = [
  { id: 'desktop-1280', width: 1280, height: 900 },
  { id: 'desktop-1024', width: 1024, height: 768 },
  { id: 'desktop-768', width: 768, height: 900 },
  { id: 'mobile-480', width: 480, height: 900 }
]

export const privateCaptureRoutes = [
  { id: 'workspace-sources', path: (workspaceId) => `/workspace/${workspaceId}/sources` },
  { id: 'workspace-campaigns', path: (workspaceId) => `/workspace/${workspaceId}/campaigns` },
  { id: 'workspace-imports', path: (workspaceId) => `/workspace/${workspaceId}/imports` },
  { id: 'workspace-seed-reviews', path: (workspaceId) => `/workspace/${workspaceId}/seed-reviews` },
  { id: 'workspace-members', path: (workspaceId) => `/workspace/${workspaceId}/members` },
  { id: 'workspace-agent-access', path: (workspaceId) => `/workspace/${workspaceId}/agent-access` },
  { id: 'workspace-activity', path: (workspaceId) => `/workspace/${workspaceId}/activity` },
  { id: 'workspace-usage', path: (workspaceId) => `/workspace/${workspaceId}/usage` },
  { id: 'account-security', path: () => '/account/security' }
]

const runtimeErrorPatterns = [
  /Application error: a client-side exception has occurred/i,
  /Unhandled Runtime Error/i,
  /Internal Server Error/i
]

export function summarizeUiAudit({
  title = '',
  innerWidth = 0,
  scrollWidth = 0,
  hasMain = false,
  hasRuntimeError = false
} = {}) {
  const failures = []
  if (hasRuntimeError) failures.push('runtime-error')
  if (!hasMain) failures.push('missing-main')
  if (!title.trim()) failures.push('missing-title')
  if (scrollWidth > innerWidth + 1) failures.push('horizontal-overflow')
  return {
    status: failures.length === 0 ? 'ok' : 'failed',
    failures,
    hasRuntimeError,
    hasMain,
    innerWidth,
    scrollWidth
  }
}

async function collectUiAudit(cdp) {
  const evaluation = await cdp.command('Runtime.evaluate', {
    expression: `(() => {
      const bodyText = document.body?.innerText ?? '';
      const hasRuntimeError = Boolean(
        document.querySelector('[data-nextjs-dialog]') ||
        ${runtimeErrorPatterns.map((pattern) => pattern.toString()).join('.test(bodyText) || ')}.test(bodyText)
      );
      return {
        title: document.title ?? '',
        innerWidth: window.innerWidth,
        scrollWidth: Math.max(
          document.documentElement?.scrollWidth ?? 0,
          document.body?.scrollWidth ?? 0
        ),
        hasMain: Boolean(document.querySelector('main')),
        hasRuntimeError
      };
    })()`,
    returnByValue: true,
    awaitPromise: false
  })
  const value = evaluation.result?.value
  if (!value || typeof value !== 'object') {
    throw new Error('local UI audit did not return a page summary')
  }
  return summarizeUiAudit(value)
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
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
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}${
            stderr.trim() ? `: ${stderr.trim()}` : ''
          }`
        )
      )
    })
  })
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('unable to allocate a local browser debugging port'))
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function waitForJson(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`local browser endpoint ${url} was not ready: ${lastError}`)
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const onError = (event) => reject(new Error(`browser debugging connection failed: ${event}`))
    socket.addEventListener('error', onError, { once: true })
    socket.addEventListener(
      'open',
      () => {
        socket.removeEventListener('error', onError)
        resolve(socket)
      },
      { once: true }
    )
  })
}

async function startCdpPage(chrome, userDataDirectory) {
  const port = await findFreePort()
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDirectory}`,
    'about:blank'
  ]
  if (process.platform !== 'win32') args.unshift('--no-sandbox')
  const browser = spawn(chrome, args, { stdio: 'ignore' })
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`)
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`)
  const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
  if (!target) {
    await stop(browser)
    throw new Error('headless browser did not expose a page target')
  }
  const socket = await connectWebSocket(target.webSocketDebuggerUrl)
  let nextCommandId = 1
  const pending = new Map()
  const eventWaiters = new Map()
  socket.addEventListener('message', (event) => {
    const raw =
      typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')
    const message = JSON.parse(raw)
    if (message.id !== undefined) {
      const resolver = pending.get(message.id)
      if (!resolver) return
      pending.delete(message.id)
      if (message.error) resolver.reject(new Error(message.error.message ?? 'CDP command failed'))
      else resolver.resolve(message.result ?? {})
      return
    }
    const waiters = eventWaiters.get(message.method)
    const waiter = waiters?.shift()
    if (waiter) {
      if (waiters.length === 0) eventWaiters.delete(message.method)
      waiter.resolve(message.params ?? {})
    }
  })
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextCommandId++
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const waitForEvent = (method, timeoutMs = 15_000) =>
    new Promise((resolve, reject) => {
      const entry = {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject
      }
      const timer = setTimeout(() => {
        const waiters = eventWaiters.get(method) ?? []
        const index = waiters.indexOf(entry)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error(`browser event ${method} was not observed`))
      }, timeoutMs)
      const waiters = eventWaiters.get(method) ?? []
      waiters.push(entry)
      eventWaiters.set(method, waiters)
    })
  const close = async () => {
    try {
      socket.close()
    } catch {
      // The browser may already have closed the debugging socket.
    }
    await stop(browser)
  }
  return { command, waitForEvent, close, version }
}

async function waitForBaseUrl(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health/live`)
      if (response.status === 200) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`local web server ${url} did not become ready: ${lastError}`)
}

async function disableNextDevIndicator(url) {
  const response = await fetch(`${url}/__nextjs_disable_dev_indicator`, { method: 'POST' })
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`local web server dev-indicator control returned HTTP ${response.status}`)
  }
}

async function removeCaptureProfile(directory) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

function sessionCookieFrom(response) {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? '']
  const cookie = cookies.find((value) => /(?:^|;\s*)(?:__Host-)?appsea_session=/.test(value))
  const pair = cookie?.split(';', 1)[0]
  if (!pair) throw new Error('local capture signup did not return a session cookie')
  const separator = pair.indexOf('=')
  if (separator <= 0) throw new Error('local capture session cookie was malformed')
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    header: pair
  }
}

async function createCaptureSession(baseUrl) {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const originHeaders = {
    origin: baseUrl,
    'x-forwarded-for': `ui-capture-${nonce}`
  }
  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { ...originHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `appsea-ui-capture-${nonce}@example.test`,
      password: 'local-ui-capture-password-2026',
      displayName: 'Local UI capture owner',
      workspaceName: 'Local UI capture workspace'
    })
  })
  if (signup.status !== 201) {
    throw new Error(`local capture signup returned HTTP ${signup.status}`)
  }
  const sessionCookie = sessionCookieFrom(signup)
  const workspaceResponse = await fetch(`${baseUrl}/api/workspaces`, {
    headers: { cookie: sessionCookie.header }
  })
  if (!workspaceResponse.ok) {
    throw new Error(`local capture workspace read returned HTTP ${workspaceResponse.status}`)
  }
  const workspacePayload = await workspaceResponse.json()
  const workspace = workspacePayload?.data?.find(
    (candidate) =>
      candidate?.visibility === 'private' &&
      candidate?.fixtureOnly === false &&
      candidate?.role === 'owner'
  )
  if (!workspace?.workspaceId) throw new Error('local capture signup returned no private workspace')
  return { sessionCookie, workspaceId: workspace.workspaceId }
}

async function exists(candidate) {
  try {
    await access(candidate)
    return true
  } catch {
    return false
  }
}

async function findChrome() {
  const configured = process.env.APPSEA_CHROME_PATH
  const candidates = [
    configured,
    process.platform === 'win32'
      ? path.join(
          process.env.PROGRAMFILES ?? 'C:\\Program Files',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        )
      : undefined,
    process.platform === 'win32'
      ? path.join(
          process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        )
      : undefined,
    process.platform === 'win32'
      ? path.join(
          process.env.PROGRAMFILES ?? 'C:\\Program Files',
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        )
      : undefined,
    'google-chrome',
    'chromium',
    'chromium-browser'
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && (await exists(candidate))) return candidate
    if (!path.isAbsolute(candidate)) {
      const probe = await run(process.platform === 'win32' ? 'where' : 'which', [candidate], {
        capture: true
      }).catch(() => undefined)
      const resolved = probe?.stdout.trim().split(/\r?\n/)[0]
      if (resolved) return resolved
    }
  }
  throw new Error(
    'Chrome or Chromium was not found. Set APPSEA_CHROME_PATH to a local browser executable.'
  )
}

function nextStartCommand() {
  const suffix = process.platform === 'win32' ? '.cmd' : ''
  const local = path.join(webRoot, 'node_modules', '.bin', `next${suffix}`)
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        `pnpm --filter @appsea/web start --hostname ${host} --port ${String(port)}`
      ],
      cwd: repositoryRoot,
      shell: false
    }
  }
  return {
    command: local,
    args: ['start', '--hostname', host, '--port', String(port)],
    cwd: webRoot,
    shell: false
  }
}

async function waitForServer() {
  await waitForBaseUrl(baseUrl)
}

async function stop(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], { capture: true }).catch(
      () => undefined
    )
  } else {
    processHandle.kill('SIGTERM')
  }
}

export async function captureLocalUi({ output = defaultOutput, persistManifest = false } = {}) {
  if (!(await exists(path.join(webRoot, '.next', 'BUILD_ID')))) {
    throw new Error('Build the web app before capturing it (run pnpm --filter @appsea/web build).')
  }
  const chrome = await findChrome()
  await mkdir(output, { recursive: true })
  const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'appsea-ui-chrome-'))
  const start = nextStartCommand()
  const server = spawn(start.command, start.args, {
    cwd: start.cwd,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    shell: start.shell,
    stdio: 'ignore'
  })
  let cdp
  try {
    await waitForServer()
    await disableNextDevIndicator(baseUrl)
    cdp = await startCdpPage(chrome, userDataDirectory)
    await cdp.command('Page.enable')
    await cdp.command('Runtime.enable')
    const captures = []
    for (const route of captureRoutes) {
      for (const viewport of captureViewports) {
        await cdp.command('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false
        })
        const load = cdp.waitForEvent('Page.loadEventFired')
        await cdp.command('Page.navigate', { url: `${baseUrl}${route.path}` })
        await load
        await new Promise((resolve) => setTimeout(resolve, 500))
        const audit = await collectUiAudit(cdp)
        if (audit.status !== 'ok') {
          throw new Error(
            `${route.id} at ${viewport.id} failed local UI audit: ${audit.failures.join(', ')}`
          )
        }
        const screenshot = await cdp.command('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false
        })
        const filename = `${route.id}-${viewport.id}.png`
        await writeFile(path.join(output, filename), Buffer.from(screenshot.data, 'base64'))
        captures.push({ filename, route: route.path, viewport, audit })
      }
    }
    const manifest = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      output,
      captures,
      privateRoutes: 'Not captured: authenticated PostgreSQL/Temporal stack is required.'
    }
    if (persistManifest) {
      await writeFile(
        path.join(output, 'public-capture-manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8'
      )
    }
    return manifest
  } finally {
    if (cdp) await cdp.close()
    await stop(server)
    await removeCaptureProfile(userDataDirectory)
  }
}

export async function captureAuthenticatedLocalUi({
  baseUrl: privateBaseUrl = 'http://localhost:3000',
  output = defaultOutput
} = {}) {
  await waitForBaseUrl(privateBaseUrl)
  await disableNextDevIndicator(privateBaseUrl)
  const chrome = await findChrome()
  await mkdir(output, { recursive: true })
  const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'appsea-private-ui-chrome-'))
  let cdp
  const captures = []
  try {
    const session = await createCaptureSession(privateBaseUrl)
    cdp = await startCdpPage(chrome, userDataDirectory)
    await cdp.command('Page.enable')
    await cdp.command('Network.enable')
    await cdp.command('Runtime.enable')
    await cdp.command('Network.setCookie', {
      name: session.sessionCookie.name,
      value: session.sessionCookie.value,
      url: `${privateBaseUrl}/`,
      path: '/',
      httpOnly: true,
      secure: privateBaseUrl.startsWith('https:'),
      sameSite: 'Lax'
    })
    for (const route of privateCaptureRoutes) {
      for (const viewport of captureViewports) {
        await cdp.command('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false
        })
        const load = cdp.waitForEvent('Page.loadEventFired')
        await cdp.command('Page.navigate', {
          url: `${privateBaseUrl}${route.path(encodeURIComponent(session.workspaceId))}`
        })
        await load
        await new Promise((resolve) => setTimeout(resolve, 500))
        const audit = await collectUiAudit(cdp)
        if (audit.status !== 'ok') {
          throw new Error(
            `${route.id} at ${viewport.id} failed local UI audit: ${audit.failures.join(', ')}`
          )
        }
        const screenshot = await cdp.command('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false
        })
        const filename = `${route.id}-${viewport.id}.png`
        await writeFile(path.join(output, filename), Buffer.from(screenshot.data, 'base64'))
        captures.push({
          filename,
          route: route.path('<workspaceId>'),
          viewport,
          audit
        })
      }
    }
    const manifest = {
      generatedAt: new Date().toISOString(),
      baseUrl: privateBaseUrl,
      output,
      captures,
      privateWorkspace: true
    }
    await writeFile(
      path.join(output, 'private-capture-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    )
    return manifest
  } finally {
    if (cdp) await cdp.close()
    await removeCaptureProfile(userDataDirectory)
  }
}

async function main() {
  const privateMode = process.argv.includes('--private')
  const persist = process.argv.includes('--persist')
  const output = persist
    ? path.join(
        repositoryRoot,
        'artifacts',
        'ui-reference-loop',
        new Date().toISOString().slice(0, 10)
      )
    : defaultOutput
  const manifest = privateMode
    ? await captureAuthenticatedLocalUi({ output })
    : await captureLocalUi({ output, persistManifest: persist })
  console.log(JSON.stringify(manifest, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
