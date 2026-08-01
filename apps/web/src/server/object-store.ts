import { resolve } from 'node:path'
import { objectStoreFromEnv, type ObjectStore } from '@appsea/object-store'

declare global {
  var appseaObjectStore: ObjectStore | undefined
}

/**
 * The web process only receives an object-store adapter; it never derives
 * storage paths from request data. Production must provide an explicit
 * encrypted/versioned S3-compatible adapter; local development may use the
 * filesystem adapter through the default root below.
 */
export function getObjectStore(): ObjectStore {
  if (globalThis.appseaObjectStore) return globalThis.appseaObjectStore
  const defaultRoot =
    process.env.NODE_ENV === 'production'
      ? undefined
      : resolve(process.cwd(), '.appsea-object-store')
  const store = objectStoreFromEnv(process.env, defaultRoot === undefined ? {} : { defaultRoot })
  if (process.env.NODE_ENV !== 'test') globalThis.appseaObjectStore = store
  return store
}
