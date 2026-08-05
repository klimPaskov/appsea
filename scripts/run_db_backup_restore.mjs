import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = path.join(repositoryRoot, 'infra', 'local', 'compose.yaml')
const localDatabaseName = 'appsea'
export const restoreDatabaseName = 'appsea_backup_restore_check'
const expectedMigrationCount = 100
const expectedLatestMigration = '0100'
const localPostgresPassword = 'postgres-local-bootstrap-only'
const localMigrationUrl =
  'postgres://appsea_migrator:appsea-migrator-local-only@127.0.0.1:5433/appsea'

export function assertLocalOnlyEnvironment(environment = process.env) {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Backup/restore verification is local-only and cannot run in production')
  }
  if (environment.APPSEA_BACKUP_RESTORE_DATABASE_URL) {
    throw new Error('Backup/restore verification does not accept a remote database URL')
  }
}

export function parseVerificationOutput(output) {
  const line = output
    .trim()
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1)
  if (!line) throw new Error('Backup/restore verification returned no database summary')

  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new Error('Backup/restore verification returned invalid database summary')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    parsed.database !== restoreDatabaseName ||
    typeof parsed.database !== 'string' ||
    typeof parsed.latestMigration !== 'string' ||
    typeof parsed.migrationCount !== 'number' ||
    parsed.latestMigration !== expectedLatestMigration ||
    parsed.migrationCount !== expectedMigrationCount ||
    parsed.appseaSchema !== true ||
    parsed.workspaceRlsForced !== true ||
    parsed.runtimeCanSelectOperationalOutbox !== false ||
    parsed.maintenanceCanClaimOperationalAlerts !== true
  ) {
    throw new Error('Restored database failed the AppSea schema and privilege checks')
  }

  return parsed
}

function redactCommand(args) {
  return args.map((argument) =>
    argument.startsWith('PGPASSWORD=') ? 'PGPASSWORD=[redacted]' : argument
  )
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
      shell: false
    })

    const stdoutChunks = []
    const stderrChunks = []
    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)))
    if (options.input !== undefined) child.stdin.end(options.input)

    child.on('error', reject)
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks)
      const stderr = Buffer.concat(stderrChunks)
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      const detail = stderr.toString('utf8').trim() || stdout.toString('utf8').trim()
      reject(
        new Error(
          `${command} ${redactCommand(args).join(' ')} exited with code ${code}${detail ? `: ${detail}` : ''}`
        )
      )
    })
  })
}

function pnpmCommand() {
  if (process.platform === 'win32') {
    return [
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'pnpm --filter @appsea/db migrate']
    ]
  }
  return ['pnpm', ['--filter', '@appsea/db', 'migrate']]
}

function dockerExec(args, options = {}) {
  return run(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${localPostgresPassword}`,
      'postgres',
      ...args
    ],
    options
  )
}

async function waitForPostgres() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await dockerExec(['pg_isready', '-U', 'postgres', '-d', 'postgres'])
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('The local PostgreSQL container did not become ready within 30 seconds')
}

async function runMigrations() {
  const [command, args] = pnpmCommand()
  await run(command, args, {
    env: {
      APPSEA_MIGRATION_DATABASE_URL: localMigrationUrl,
      APPSEA_DATABASE_MIGRATION_ROLE: 'appsea_owner',
      APPSEA_DATABASE_SSL_MODE: 'disable'
    }
  })
}

async function runPsql(database, sql, options = {}) {
  return dockerExec(
    [
      'psql',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      ...(options.flags ?? []),
      '-c',
      sql
    ],
    options
  )
}

async function dropRestoreDatabase() {
  await runPsql('postgres', `DROP DATABASE IF EXISTS ${restoreDatabaseName} WITH (FORCE)`)
}

async function createRestoreDatabase() {
  await dropRestoreDatabase()
  await runPsql('postgres', `CREATE DATABASE ${restoreDatabaseName} OWNER appsea_owner`)
}

async function dumpDatabase() {
  const result = await dockerExec([
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    localDatabaseName,
    '--format=plain',
    '--clean',
    '--if-exists'
  ])
  if (result.stdout.length === 0) throw new Error('PostgreSQL backup was empty')
  return result.stdout
}

async function restoreDatabase(backup) {
  await dockerExec(['psql', '-U', 'postgres', '-d', restoreDatabaseName, '-v', 'ON_ERROR_STOP=1'], {
    input: backup
  })
}

async function inspectRestoredDatabase() {
  const result = await runPsql(
    restoreDatabaseName,
    `SELECT json_build_object(
      'database', current_database(),
      'latestMigration', (SELECT version FROM public.appsea_schema_migrations ORDER BY version DESC LIMIT 1),
      'migrationCount', (SELECT count(*)::integer FROM public.appsea_schema_migrations),
      'appseaSchema', to_regnamespace('appsea') IS NOT NULL,
      'workspaceRlsForced', (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'appsea.workspaces'::regclass),
      'runtimeCanSelectOperationalOutbox', has_table_privilege('appsea_service', 'appsea.operational_alert_outbox', 'SELECT'),
      'maintenanceCanClaimOperationalAlerts', has_function_privilege('appsea_maintenance', 'appsea.claim_operational_alerts(text,uuid,integer,integer)', 'EXECUTE')
    )::text`,
    { flags: ['-At'] }
  )
  return parseVerificationOutput(result.stdout.toString('utf8'))
}

export async function verifyBackupRestore() {
  assertLocalOnlyEnvironment()
  await run('docker', ['compose', '-f', composeFile, 'up', '-d', 'postgres'])
  await waitForPostgres()
  await runMigrations()

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'appsea-backup-restore-'))
  const backupPath = path.join(temporaryDirectory, 'appsea.sql')
  let databaseCreated = false
  try {
    const backup = await dumpDatabase()
    await writeFile(backupPath, backup, { mode: 0o600 })
    const persistedBackup = await readFile(backupPath)
    await createRestoreDatabase()
    databaseCreated = true
    await restoreDatabase(persistedBackup)
    const summary = await inspectRestoredDatabase()
    console.log(
      `PostgreSQL backup/restore verification passed: ${summary.migrationCount} migrations restored through ${summary.latestMigration}; runtime privilege and forced-RLS checks passed`
    )
    return summary
  } finally {
    if (databaseCreated) await dropRestoreDatabase()
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  verifyBackupRestore().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
