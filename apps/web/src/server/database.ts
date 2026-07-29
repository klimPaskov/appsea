import { createDatabasePool, databaseConfigFromEnv } from '@appsea/db/auth'

type DatabasePool = ReturnType<typeof createDatabasePool>

declare global {
  // Next.js reloads server modules during development. Keeping one pool on the
  // global object prevents a reload from exhausting PostgreSQL connections.
  // The pool is created lazily so public fixture pages do not require a DB.
  var appseaDatabasePool: DatabasePool | undefined
}

export function getDatabasePool(): DatabasePool {
  if (globalThis.appseaDatabasePool) return globalThis.appseaDatabasePool
  const pool = createDatabasePool(databaseConfigFromEnv())
  if (process.env.NODE_ENV !== 'test') {
    pool.on('error', (error) => {
      console.error('AppSea database pool error', { name: error.name })
    })
  }
  globalThis.appseaDatabasePool = pool
  return pool
}
