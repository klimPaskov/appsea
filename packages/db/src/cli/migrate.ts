import { createDatabasePool, databaseConfigFromEnv } from '../config'
import { migrateDatabase } from '../migrations'

const migrationDatabaseUrl = process.env.APPSEA_MIGRATION_DATABASE_URL
if (!migrationDatabaseUrl) throw new Error('APPSEA_MIGRATION_DATABASE_URL is required')
const migrationRole = process.env.APPSEA_DATABASE_MIGRATION_ROLE
if (!migrationRole) throw new Error('APPSEA_DATABASE_MIGRATION_ROLE is required')
const pool = createDatabasePool(
  databaseConfigFromEnv({ ...process.env, DATABASE_URL: migrationDatabaseUrl })
)

try {
  const result = await migrateDatabase(pool, { role: migrationRole })
  console.log(
    `database migrations complete: ${result.applied.length} applied, ${result.alreadyApplied.length} already present`
  )
} finally {
  await pool.end()
}
