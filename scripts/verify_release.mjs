import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const requiredServices = ['preflight', 'migrate', 'web', 'worker', 'maintenance', 'alerts']
const longLivedServices = ['web', 'worker', 'maintenance', 'alerts']
const requiredEnvironmentNames = [
  'DATABASE_URL',
  'APPSEA_MAINTENANCE_DATABASE_URL',
  'APPSEA_MIGRATION_DATABASE_URL',
  'APPSEA_TEMPORAL_ADDRESS',
  'APPSEA_OBJECT_STORE_ENDPOINT',
  'APPSEA_PUBLIC_ORIGIN',
  'APPSEA_AUTH_MFA_ENCRYPTION_KEY',
  'APPSEA_ALERT_ROUTING_URL',
  'APPSEA_ALERT_ROUTING_SECRET'
]
const requiredPlainEnvironmentNames = ['APPSEA_TEMPORAL_TASK_QUEUE']
const secretEnvironmentNames = [
  'APPSEA_TEMPORAL_API_KEY',
  'APPSEA_TEMPORAL_TLS_CA',
  'APPSEA_OBJECT_STORE_ACCESS_KEY_ID',
  'APPSEA_OBJECT_STORE_SECRET_ACCESS_KEY',
  'APPSEA_AUTH_RECOVERY_ENCRYPTION_KEY',
  'APPSEA_AUTH_RECOVERY_DELIVERY_SECRET',
  'APPSEA_AUTH_OIDC_CLIENT_SECRET',
  'APPSEA_AUTH_MFA_ENCRYPTION_KEY',
  'APPSEA_AUTH_MFA_ENCRYPTION_KEY_PREVIOUS',
  'APPSEA_TRUSTED_PROXY_SECRET'
]

const staticFiles = {
  compose: 'infra/production/compose.yaml',
  envExample: 'infra/production/production.env.example',
  webDockerfile: 'Dockerfile.web',
  workerDockerfile: 'Dockerfile.worker'
}

function section(text, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`^  ${escapedName}:\\n(?<body>(?:    .*\\n|\\n)*)`, 'm'))
  return match?.groups?.body ?? null
}

function requiredEnvValue(envExample, name) {
  const line = envExample.split(/\r?\n/).find((candidate) => candidate.startsWith(`${name}=`))
  return line?.slice(name.length + 1).trim() ?? null
}

/**
 * Return release-boundary findings without running Docker or touching a
 * provider. The checks deliberately inspect text rather than accepting
 * caller-supplied YAML/secret objects, so imported content cannot change the
 * verification rules at runtime.
 */
export function releaseBoundaryFindings({
  compose,
  envExample,
  webDockerfile,
  workerDockerfile,
  trackedProductionEnv = false
}) {
  const findings = []
  if (trackedProductionEnv) findings.push('infra/production/production.env must remain untracked')

  if (!/^services:\s*$/m.test(compose)) {
    findings.push('production compose must declare a services section')
  }

  for (const service of requiredServices) {
    if (!section(compose, service)) findings.push(`production compose is missing ${service}`)
  }

  const preflight = section(compose, 'preflight')
  if (preflight && !/command:\s*\[?['"]production:preflight['"]/.test(preflight)) {
    findings.push('preflight must run production:preflight')
  }
  if (preflight && !/restart:\s*['"]?no['"]?/.test(preflight)) {
    findings.push('preflight must not restart')
  }

  const migrate = section(compose, 'migrate')
  if (migrate && !/profiles:\s*\[\s*['"]migrate['"]\s*\]/.test(migrate)) {
    findings.push('migrate must remain behind the migrate profile')
  }
  if (migrate && !/service_completed_successfully/.test(migrate)) {
    findings.push('migrate must depend on successful preflight')
  }

  for (const service of longLivedServices) {
    const body = section(compose, service)
    if (!body) continue
    if (!/service_completed_successfully/.test(body)) {
      findings.push(`${service} must depend on successful preflight`)
    }
    if (!/read_only:\s*true/.test(body))
      findings.push(`${service} must use a read-only root filesystem`)
    if (!/cap_drop:\s*\[[^\]]*['"]ALL['"]/.test(body)) {
      findings.push(`${service} must drop all Linux capabilities`)
    }
    if (!/no-new-privileges:true/.test(body)) {
      findings.push(`${service} must set no-new-privileges`)
    }
    if (!/init:\s*true/.test(body)) findings.push(`${service} must use an init process`)
  }

  const web = section(compose, 'web')
  if (web && !/\$\{APPSEA_WEB_BIND_ADDRESS:-127\.0\.0\.1\}/.test(web)) {
    findings.push('web must default to a loopback bind address')
  }

  if (!/^NODE_ENV=production$/m.test(envExample)) {
    findings.push('production environment example must set NODE_ENV=production')
  }
  for (const name of requiredEnvironmentNames) {
    const value = requiredEnvValue(envExample, name)
    if (value === null) findings.push(`production environment example is missing ${name}`)
    else if (value !== '' && !value.startsWith('https://')) {
      findings.push(`${name} must not contain a committed secret or live credential`)
    }
  }
  for (const name of requiredPlainEnvironmentNames) {
    const value = requiredEnvValue(envExample, name)
    if (value === null) findings.push(`production environment example is missing ${name}`)
    else if (name === 'APPSEA_TEMPORAL_TASK_QUEUE' && value !== 'appsea-research-v1') {
      findings.push(`${name} must equal the reviewed appsea-research-v1 task queue`)
    }
  }
  for (const name of secretEnvironmentNames) {
    const value = requiredEnvValue(envExample, name)
    if (value === null) findings.push(`production environment example is missing ${name}`)
    else if (value !== '') {
      findings.push(`${name} must be blank in the committed environment example`)
    }
  }
  if (!/^APPSEA_AUTH_RECOVERY_ENABLED=false$/m.test(envExample)) {
    findings.push('account recovery must remain disabled by default')
  }
  if (!/^APPSEA_AUTH_INVITATIONS_ENABLED=false$/m.test(envExample)) {
    findings.push('workspace invitations must remain disabled by default')
  }
  if (!/^APPSEA_AUTH_OIDC_ENABLED=false$/m.test(envExample)) {
    findings.push('OIDC must remain disabled by default')
  }

  if (!/USER appsea/m.test(webDockerfile))
    findings.push('web image must run as the non-root appsea user')
  if (!/HEALTHCHECK\b/.test(webDockerfile)) findings.push('web image must declare a healthcheck')
  if (!/USER appsea/m.test(workerDockerfile)) {
    findings.push('worker image must run as the non-root appsea user')
  }
  if (!/ENTRYPOINT\s+\["pnpm"/.test(workerDockerfile)) {
    findings.push('worker image must retain the pnpm entrypoint boundary')
  }

  return findings
}

async function readReleaseInputs(repositoryRoot = root) {
  const entries = await Promise.all(
    Object.entries(staticFiles).map(async ([key, relativePath]) => [
      key,
      await readFile(path.join(repositoryRoot, relativePath), 'utf8')
    ])
  )
  return Object.fromEntries(entries)
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const usesWindowsCommandScript = process.platform === 'win32' && command.endsWith('.cmd')
    const executable = usesWindowsCommandScript ? 'cmd.exe' : command
    const executableArgs = usesWindowsCommandScript ? ['/d', '/s', '/c', command, ...args] : args
    const child = spawn(executable, executableArgs, {
      cwd: options.cwd ?? root,
      env: options.env,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }))
  })
}

function sanitizedEnvironment() {
  const allowed = new Set([
    'CI',
    'ComSpec',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'NODE_PATH',
    'PATH',
    'Path',
    'PATHEXT',
    'PNPM_HOME',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE'
  ])
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => allowed.has(name))
  )
  const pathValue = process.env.PATH ?? process.env.Path
  if (pathValue) {
    environment.PATH = pathValue
    environment.Path = pathValue
  }
  return environment
}

async function assertStaticBoundary(repositoryRoot = root) {
  const inputs = await readReleaseInputs(repositoryRoot)
  const trackedProductionEnv =
    (
      await run(
        'git',
        ['ls-files', '--error-unmatch', staticFiles.envExample.replace('.example', '')],
        {
          cwd: repositoryRoot,
          stdio: 'ignore'
        }
      ).catch(() => ({ code: 1 }))
    ).code === 0
  const findings = releaseBoundaryFindings({ ...inputs, trackedProductionEnv })
  if (findings.length > 0) {
    throw new Error(`release boundary failed:\n- ${findings.join('\n- ')}`)
  }
  return inputs
}

async function assertDockerBoundary(repositoryRoot = root) {
  const compose = await run(
    'docker',
    ['compose', '--file', path.join('infra', 'production', 'compose.yaml'), 'config', '--quiet'],
    { cwd: repositoryRoot }
  )
  if (compose.code !== 0) throw new Error('docker compose configuration validation failed')

  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const preflight = await run(pnpm, ['production:preflight'], {
    cwd: repositoryRoot,
    env: { ...sanitizedEnvironment(), NODE_ENV: 'production' },
    stdio: 'ignore'
  })
  if (preflight.code === 0) {
    throw new Error('production preflight unexpectedly accepted an empty environment')
  }
}

export async function verifyRelease({ repositoryRoot = root, staticOnly = false } = {}) {
  await assertStaticBoundary(repositoryRoot)
  if (!staticOnly) await assertDockerBoundary(repositoryRoot)
}

async function main() {
  const staticOnly = process.argv.includes('--static')
  if (process.argv.includes('--help')) {
    console.log('Usage: pnpm verify:release [--static]')
    console.log('  --static  skip Docker compose and preflight execution')
    return
  }
  try {
    await verifyRelease({ staticOnly })
    console.log(
      staticOnly
        ? 'release boundary static checks passed'
        : 'release boundary checks passed for topology and fail-closed preflight'
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'release boundary failed')
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
