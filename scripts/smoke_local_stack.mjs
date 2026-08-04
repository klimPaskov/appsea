import { spawn } from 'node:child_process'
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

function sanitize(value) {
  return value
    .replace(/postgres:\/\/[^\s]+/gi, 'postgres://[redacted]')
    .replace(/(APPSEA_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|URL))=[^\s]+/gi, '$1=[redacted]')
    .split(/\r?\n/)
    .slice(-80)
    .join('\n')
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

async function fetchResponse(route) {
  return fetch(`${localWebUrl}${route}`, { signal: AbortSignal.timeout(3_000) })
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

export function assertLocalStackResponses({ live, ready, leaderboard, signup, login }) {
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
      login: login.body
    })
    console.log(
      'local private-workspace stack smoke passed for readiness, auth pages, and fixture disclosure'
    )
  } catch (error) {
    const output = sanitize(localStack.output.join(''))
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
