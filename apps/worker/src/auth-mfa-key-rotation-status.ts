import { createDatabasePool, databaseConfigFromEnv, PostgresAuthRepository } from '@appsea/db'

const pool = createDatabasePool(databaseConfigFromEnv())

try {
  const status = await new PostgresAuthRepository(pool).readMfaKeyRotationStatus()
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
} catch {
  // Keep operator output free of connection details and key material.
  process.stderr.write('MFA key rotation status could not be read\n')
  process.exitCode = 1
} finally {
  await pool.end()
}
