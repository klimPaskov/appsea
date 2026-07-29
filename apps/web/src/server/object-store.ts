import { resolve } from 'node:path'
import { FileObjectStore, type ObjectStore } from '@appsea/object-store'

declare global {
  var appseaObjectStore: ObjectStore | undefined
}

/**
 * The web process only receives an object-store adapter; it never derives
 * storage paths from request data. Production must provide an explicit,
 * encrypted/versioned adapter root (or replace this factory at deployment).
 */
export function getObjectStore(): ObjectStore {
  if (globalThis.appseaObjectStore) return globalThis.appseaObjectStore
  const configuredRoot = process.env.APPSEA_OBJECT_STORE_ROOT
  if (!configuredRoot && process.env.NODE_ENV === 'production') {
    throw new Error('APPSEA_OBJECT_STORE_ROOT is required for private production analysis reads')
  }
  const root = configuredRoot ?? resolve(process.cwd(), '.appsea-object-store')
  const store = new FileObjectStore(root)
  if (process.env.NODE_ENV !== 'test') globalThis.appseaObjectStore = store
  return store
}
