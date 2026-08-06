import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
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
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/leaderboard`)
      if (response.status === 200) return
    } catch {
      // The Next.js server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('local web server did not become ready within 45 seconds')
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

async function capture(chrome, output, route, viewport, userDataDirectory) {
  const filename = `${route.id}-${viewport.id}.png`
  const target = path.join(output, filename)
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
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=1000',
    '--force-device-scale-factor=1',
    `--user-data-dir=${userDataDirectory}`,
    `--window-size=${viewport.width},${viewport.height}`,
    `--screenshot=${target}`,
    `${baseUrl}${route.path}`
  ]
  if (process.platform !== 'win32') args.unshift('--no-sandbox')
  await run(chrome, args)
  return { filename, route: route.path, viewport }
}

export async function captureLocalUi({ output = defaultOutput } = {}) {
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
  try {
    await waitForServer()
    const captures = []
    for (const route of captureRoutes) {
      for (const viewport of captureViewports) {
        captures.push(await capture(chrome, output, route, viewport, userDataDirectory))
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      baseUrl,
      output,
      captures,
      privateRoutes: 'Not captured: authenticated PostgreSQL/Temporal stack is required.'
    }
  } finally {
    await stop(server)
    await rm(userDataDirectory, { recursive: true, force: true })
  }
}

async function main() {
  const persist = process.argv.includes('--persist')
  const output = persist
    ? path.join(
        repositoryRoot,
        'artifacts',
        'ui-reference-loop',
        new Date().toISOString().slice(0, 10)
      )
    : defaultOutput
  const manifest = await captureLocalUi({ output })
  console.log(JSON.stringify(manifest, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
