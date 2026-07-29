import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool, PoolClient } from 'pg'
import { sha256 } from './hash'

const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/
const migrationLockKey = '728813485468916211'

export const defaultMigrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../migrations'
)

export interface MigrationFile {
  version: string
  filename: string
  checksum: string
  sql: string
}

export interface MigrationResult {
  applied: string[]
  alreadyApplied: string[]
}

export interface MigrationOptions {
  directory?: string
  throughVersion?: string
  role?: string
}

export class MigrationChecksumError extends Error {
  constructor(version: string) {
    super(`Applied migration ${version} has a different checksum`)
    this.name = 'MigrationChecksumError'
  }
}

export class MigrationHistoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationHistoryError'
  }
}

export async function loadMigrations(
  directory = defaultMigrationsDirectory
): Promise<MigrationFile[]> {
  const filenames = (await readdir(directory))
    .filter((filename) => migrationNamePattern.test(filename))
    .sort((left, right) => left.localeCompare(right))

  const versions = new Set<string>()
  const migrations: MigrationFile[] = []
  for (const filename of filenames) {
    const version = filename.slice(0, 4)
    if (versions.has(version)) throw new Error(`Duplicate migration version ${version}`)
    versions.add(version)
    const sql = (await readFile(resolve(directory, filename), 'utf8')).replace(/\r\n?/g, '\n')
    migrations.push({ filename, version, checksum: sha256(sql), sql })
  }

  if (migrations.length === 0) throw new Error('No database migrations were found')
  return migrations
}

interface AppliedMigrationRow {
  version: string
  filename: string
  checksum: string
}

async function validateAppliedHistory(
  client: PoolClient,
  migrations: MigrationFile[]
): Promise<AppliedMigrationRow[]> {
  const applied = await client.query<AppliedMigrationRow>(
    `SELECT version, filename, checksum
       FROM public.appsea_schema_migrations
      ORDER BY version`
  )

  applied.rows.forEach((stored, index) => {
    const local = migrations[index]
    if (!local) {
      throw new MigrationHistoryError(
        `Database contains unknown migration ${stored.version} (${stored.filename})`
      )
    }
    if (stored.version !== local.version || stored.filename !== local.filename) {
      throw new MigrationHistoryError(
        `Applied migration history is not the local ordered prefix at ${stored.version}`
      )
    }
    if (stored.checksum !== local.checksum) {
      throw new MigrationChecksumError(stored.version)
    }
  })
  return applied.rows
}

function validatedRole(role: string | undefined): string | undefined {
  if (role === undefined) return undefined
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error('Migration role must be a lowercase PostgreSQL identifier')
  }
  return role
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.appsea_schema_migrations (
      version text PRIMARY KEY,
      filename text NOT NULL,
      checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      execution_ms integer NOT NULL CHECK (execution_ms >= 0),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `)
}

export async function migrateDatabase(
  pool: Pool,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const migrations = await loadMigrations(options.directory ?? defaultMigrationsDirectory)
  const role = validatedRole(options.role)
  const throughIndex =
    options.throughVersion === undefined
      ? migrations.length - 1
      : migrations.findIndex((migration) => migration.version === options.throughVersion)
  if (throughIndex < 0) {
    throw new Error(`Unknown target migration ${options.throughVersion}`)
  }
  const targetMigrations = migrations.slice(0, throughIndex + 1)
  const client = await pool.connect()
  const result: MigrationResult = { applied: [], alreadyApplied: [] }
  let lockAcquired = false
  let roleSet = false

  try {
    if (role) {
      await client.query(`SET ROLE ${role}`)
      roleSet = true
    }
    await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockKey])
    lockAcquired = true
    await ensureMigrationTable(client)
    const appliedHistory = await validateAppliedHistory(client, migrations)
    if (appliedHistory.length > targetMigrations.length) {
      throw new MigrationHistoryError(
        `Database is already beyond requested migration ${options.throughVersion}`
      )
    }

    for (const migration of targetMigrations) {
      if (appliedHistory.some((stored) => stored.version === migration.version)) {
        result.alreadyApplied.push(migration.version)
        continue
      }

      const startedAt = performance.now()
      try {
        await client.query('BEGIN')
        await client.query(migration.sql)
        await client.query(
          `INSERT INTO public.appsea_schema_migrations
             (version, filename, checksum, execution_ms)
           VALUES ($1, $2, $3, $4)`,
          [
            migration.version,
            migration.filename,
            migration.checksum,
            Math.max(0, Math.round(performance.now() - startedAt))
          ]
        )
        await client.query('COMMIT')
        result.applied.push(migration.version)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    return result
  } finally {
    try {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLockKey])
      }
    } finally {
      try {
        if (roleSet) await client.query('RESET ROLE')
      } finally {
        client.release()
      }
    }
  }
}
