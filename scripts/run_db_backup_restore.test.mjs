import { describe, expect, it } from 'vitest'
import {
  assertLocalOnlyEnvironment,
  parseVerificationOutput,
  restoreDatabaseName
} from './run_db_backup_restore.mjs'

describe('PostgreSQL backup/restore verification helpers', () => {
  it('uses a fixed isolated restore database name', () => {
    expect(restoreDatabaseName).toBe('appsea_backup_restore_check')
  })

  it('refuses production and caller-selected remote databases', () => {
    expect(() => assertLocalOnlyEnvironment({ NODE_ENV: 'production' })).toThrow('local-only')
    expect(() =>
      assertLocalOnlyEnvironment({ APPSEA_BACKUP_RESTORE_DATABASE_URL: 'postgres://remote/db' })
    ).toThrow('does not accept a remote database URL')
    expect(() => assertLocalOnlyEnvironment({ NODE_ENV: 'development' })).not.toThrow()
  })

  it('accepts only the restored schema and privilege summary', () => {
    const summary = parseVerificationOutput(
      `noise\n${JSON.stringify({
        database: restoreDatabaseName,
        latestMigration: '0095',
        migrationCount: 95,
        appseaSchema: true,
        workspaceRlsForced: true,
        runtimeCanSelectOperationalOutbox: false,
        maintenanceCanClaimOperationalAlerts: true
      })}`
    )
    expect(summary.latestMigration).toBe('0095')
  })

  it('rejects malformed or privilege-weakened summaries', () => {
    expect(() => parseVerificationOutput('not-json')).toThrow('invalid database summary')
    expect(() =>
      parseVerificationOutput(
        JSON.stringify({
          database: restoreDatabaseName,
          latestMigration: '0095',
          migrationCount: 95,
          appseaSchema: true,
          workspaceRlsForced: true,
          runtimeCanSelectOperationalOutbox: true,
          maintenanceCanClaimOperationalAlerts: true
        })
      )
    ).toThrow('schema and privilege checks')
  })
})
