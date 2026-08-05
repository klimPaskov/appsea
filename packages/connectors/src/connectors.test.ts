import { describe, expect, it, vi } from 'vitest'
import { sourcePolicySchema } from '@appsea/contracts'
import {
  CfpbConnector,
  FixtureConnector,
  ManualImportConnector,
  SourceCollectionPreflightDeniedError,
  SourceQuotaExceededError,
  SourceQuotaReservationReplayError,
  SourceResponseTooLargeError,
  StackExchangeConnector,
  type SourceQuotaLedger,
  assertPolicyAllowsCollection,
  cfpbSourcePolicy,
  fixtureSourcePolicy,
  manualOwnerImportPolicyVersion,
  manualOwnerImportSourcePolicy,
  mapStackExchangeQuestion,
  mapCfpbRecord,
  isProductionConnectorSourceId,
  parseManualImportContent,
  productionConnectorSourceIds,
  stackExchangeSourcePolicy,
  syncCfpbDeletions
} from './index'

const approvedCfpbPolicy = sourcePolicySchema.parse({
  ...cfpbSourcePolicy,
  enabled: true,
  policyState: 'approved',
  expiresAt: null
})

const cfpbRecord = {
  complaint_id: 123456,
  date_received: '2026-07-20',
  product: 'Credit card',
  sub_product: 'General-purpose credit card',
  issue: 'Managing an account',
  sub_issue: 'Deposits and withdrawals',
  company: 'Synthetic Bank',
  complaint_what_happened: 'Synthetic redacted narrative used only for connector tests.'
}

const approvedStackExchangePolicy = sourcePolicySchema.parse({
  ...stackExchangeSourcePolicy,
  enabled: true,
  policyState: 'approved',
  expiresAt: null
})

const stackExchangeQuestion = {
  question_id: 42,
  creation_date: 1763856000,
  title: 'How do I preserve handoff history?',
  body: '<p>I lose the <strong>handoff history</strong> when a teammate takes over.</p><script>alert(1)</script>',
  tags: ['workflow', 'collaboration'],
  link: 'https://stackoverflow.com/questions/42/how-do-i-preserve-handoff-history'
}

describe('connector policy gate', () => {
  it('exposes only reviewed production connector identities to the worker registry', () => {
    expect(productionConnectorSourceIds).toEqual([
      'cfpb-consumer-complaints',
      'stackexchange-stackoverflow',
      'manual-owner-import'
    ])
    expect(isProductionConnectorSourceId('cfpb-consumer-complaints')).toBe(true)
    expect(isProductionConnectorSourceId('stackexchange-stackoverflow')).toBe(true)
    expect(isProductionConnectorSourceId('manual-owner-import')).toBe(true)
    expect(isProductionConnectorSourceId('fixture-community-feed')).toBe(false)
  })

  it('keeps the current owner-import policy private and purpose-bounded', () => {
    expect(manualOwnerImportPolicyVersion).toBe('manual-owner-import-v2')
    expect(manualOwnerImportSourcePolicy.permittedPurposes).toEqual(
      expect.arrayContaining(['competitor-research', 'contrary-evidence'])
    )
    expect(manualOwnerImportSourcePolicy.coverageNotes.join(' ')).toContain(
      'not public market coverage'
    )
  })

  it('collects labeled fixture records through an allowed request', async () => {
    const result = await new FixtureConnector().collect({
      query: 'handoff',
      limit: 10,
      purpose: 'testing',
      requestedDisplayMode: 'fixture'
    })
    expect(result.complaints.length).toBeGreaterThan(0)
    expect(result.complaints.every((entry) => entry.synthetic)).toBe(true)
    expect(result.costMicros).toBe(0)
  })

  it('normalizes bounded owner CSV imports and scrubs personal data without fetching URLs', () => {
    const parsed = parseManualImportContent(
      'source_record_id,text,canonical_locator,captured_at\n' +
        'ticket-1,"Email me at jane@example.com; token=secret-value",https://example.com/ticket/1,2026-08-01',
      { format: 'csv', defaultQuery: 'support export', now: '2026-08-03T00:00:00.000Z' }
    )
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toMatchObject({
      sourceRecordId: 'ticket-1',
      canonicalLocator: 'https://example.com/ticket/1',
      capturedAt: '2026-08-01T00:00:00.000Z'
    })
    expect(parsed.records[0]?.text).not.toContain('jane@example.com')
    expect(parsed.records[0]?.text).toContain('[redacted-email]')
    expect(parsed.warnings).toContain('AppSea does not fetch URLs from imported records.')
  })

  it('skips malformed owner JSON rows while retaining valid provenance', () => {
    const parsed = parseManualImportContent(
      JSON.stringify([
        { id: 'one', text: 'A valid complaint', captured_at: '2026-08-01T00:00:00Z' },
        { id: 'two', text: '', captured_at: 'not-a-date' }
      ]),
      { format: 'json', now: '2026-08-03T00:00:00.000Z' }
    )
    expect(parsed.records).toHaveLength(1)
    expect(parsed.rejectedCount).toBe(1)
    expect(parsed.warnings.some((warning) => warning.includes('Row 2 rejected'))).toBe(true)
  })

  it('collects staged owner records through a lease-checked connector', async () => {
    let leaseChecks = 0
    const connector = new ManualImportConnector({
      batchReader: {
        async readForCollection() {
          return {
            records: [
              {
                sourceRecordId: 'ticket-1',
                canonicalLocator: null,
                capturedAt: '2026-08-01T00:00:00.000Z',
                publishedAt: null,
                query: 'support export',
                product: 'Imported product',
                company: 'Imported company',
                feature: 'handoff',
                category: 'workflow',
                text: 'The handoff history disappears.',
                language: 'en'
              }
            ],
            warnings: ['batch warning']
          }
        }
      },
      now: () => '2026-08-03T00:00:00.000Z',
      policy: { ...manualOwnerImportSourcePolicy, expiresAt: null }
    })
    const result = await connector.collect({
      query: 'support export',
      limit: 1,
      purpose: 'opportunity-research',
      requestedDisplayMode: 'excerpt',
      workspaceId: 'workspace:one',
      runId: 'run:manual-1',
      policyVersion: manualOwnerImportPolicyVersion,
      manualImportBatchId: 'batch:one',
      beforeRequest: async () => {
        leaseChecks += 1
        return true
      }
    })
    expect(leaseChecks).toBe(1)
    expect(result.complaints[0]).toMatchObject({
      sourceId: 'manual-owner-import',
      synthetic: false,
      redacted: true,
      allowedRepresentation: 'excerpt'
    })
    expect(result.warnings).toContain('batch warning')
  })

  it('fails closed for an unapproved purpose', () => {
    expect(() =>
      assertPolicyAllowsCollection(fixtureSourcePolicy, {
        query: '',
        limit: 1,
        purpose: 'production-surveillance',
        requestedDisplayMode: 'fixture'
      })
    ).toThrow(/not permitted/)
  })

  it('fails closed for pending and expired source policy states', () => {
    expect(() =>
      assertPolicyAllowsCollection(
        sourcePolicySchema.parse({ ...cfpbSourcePolicy, enabled: true }),
        {
          query: 'card',
          limit: 1,
          purpose: 'testing',
          requestedDisplayMode: 'excerpt'
        }
      )
    ).toThrow(/not approved/)
    expect(() =>
      assertPolicyAllowsCollection(
        sourcePolicySchema.parse({ ...approvedCfpbPolicy, expiresAt: '2020-01-01T00:00:00.000Z' }),
        {
          query: 'card',
          limit: 1,
          purpose: 'testing',
          requestedDisplayMode: 'excerpt'
        }
      )
    ).toThrow(/expired/)
  })

  it('defaults omitted policy state to pending review', () => {
    expect(
      sourcePolicySchema.parse({ ...cfpbSourcePolicy, policyState: undefined }).policyState
    ).toBe('pending_review')
  })

  it('rejects unsafe query and connector identity inputs', () => {
    expect(() =>
      assertPolicyAllowsCollection(approvedCfpbPolicy, {
        query: 'x'.repeat(501),
        limit: 1,
        purpose: 'testing',
        requestedDisplayMode: 'excerpt'
      })
    ).toThrow(/too long/)
    expect(() => new CfpbConnector({ baseUrl: 'http://127.0.0.1:8080/' })).toThrow(
      /official HTTPS API origin/
    )
    expect(
      () =>
        new CfpbConnector({
          policy: sourcePolicySchema.parse({ ...approvedCfpbPolicy, sourceId: 'other-source' })
        })
    ).toThrow(/policy identity/)
  })

  it('requires a durable quota ledger for approved runtime policies', () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(() => new CfpbConnector({ policy: approvedCfpbPolicy })).toThrow(
        /durable quota ledger/
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('requires a durable quota ledger for owner imports outside tests', () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(
        () =>
          new ManualImportConnector({
            policy: { ...manualOwnerImportSourcePolicy, expiresAt: null },
            batchReader: {
              async readForCollection() {
                return { records: [], warnings: [] }
              }
            }
          })
      ).toThrow(/durable quota ledger/)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('maps an approved public record without retaining the raw payload', () => {
    const complaint = mapCfpbRecord(cfpbRecord, '2026-07-24T00:00:00.000Z', 'card')
    expect(complaint).toMatchObject({
      id: 'cfpb-complaint-123456',
      sourceRecordId: '123456',
      synthetic: false,
      redacted: true,
      allowedRepresentation: 'excerpt'
    })
    expect(complaint.text).not.toContain('complaint_id')
    expect(complaint.canonicalLocator).toContain('consumerfinance.gov')
  })

  it('keeps Stack Exchange disabled until its independent source review is complete', () => {
    expect(() =>
      assertPolicyAllowsCollection(stackExchangeSourcePolicy, {
        query: 'handoff history',
        limit: 1,
        purpose: 'competitor-research',
        requestedDisplayMode: 'excerpt'
      })
    ).toThrow(/disabled/)
  })

  it('pins Stack Exchange requests to the exact official API version path', () => {
    expect(
      () =>
        new StackExchangeConnector({
          baseUrl: 'https://api.stackexchange.com/2.3.evil/',
          policy: approvedStackExchangePolicy
        })
    ).toThrow(/official HTTPS API origin/)
  })

  it('maps a Stack Overflow question to a sanitized, attributed complaint', () => {
    const complaint = mapStackExchangeQuestion(
      stackExchangeQuestion,
      '2026-08-02T00:00:00.000Z',
      'handoff history'
    )
    expect(complaint).toMatchObject({
      id: 'stackexchange-question-42',
      sourceId: stackExchangeSourcePolicy.sourceId,
      sourceRecordId: 'stackoverflow:42',
      canonicalLocator: stackExchangeQuestion.link,
      synthetic: false,
      redacted: true,
      allowedRepresentation: 'excerpt'
    })
    expect(complaint.text).toContain('How do I preserve handoff history?')
    expect(complaint.text).toContain('I lose the handoff history')
    expect(complaint.text).not.toContain('<strong>')
    expect(complaint.text).not.toContain('alert(1)')
  })

  it('collects only a bounded official Stack Exchange query and exposes coverage limits', async () => {
    let requestedUrl: URL | undefined
    const events: string[] = []
    const connector = new StackExchangeConnector({
      policy: approvedStackExchangePolicy,
      fetchImpl: async (url) => {
        events.push('http')
        requestedUrl = new URL(String(url))
        return new Response(JSON.stringify({ items: [stackExchangeQuestion], has_more: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      },
      now: () => '2026-08-02T00:00:00.000Z'
    })
    const result = await connector.collect({
      query: 'handoff history',
      limit: 5,
      purpose: 'competitor-research',
      requestedDisplayMode: 'excerpt',
      beforeRequest: async () => {
        events.push('preflight')
        return true
      }
    })
    expect(requestedUrl?.origin).toBe('https://api.stackexchange.com')
    expect(requestedUrl?.pathname).toBe('/2.3/search/advanced')
    expect(requestedUrl?.searchParams.get('site')).toBe('stackoverflow')
    expect(requestedUrl?.searchParams.get('filter')).toBe('withbody')
    expect(requestedUrl?.searchParams.get('q')).toBe('handoff history')
    expect(result.complaints).toHaveLength(1)
    expect(result.deletions).toEqual([])
    expect(events).toEqual(['preflight', 'http'])
    expect(result.warnings).toContain(
      'Filtered Stack Exchange search cannot establish deletion absence; no deletion tombstones were emitted.'
    )
  })

  it('uses the exact Stack Exchange question route for reviewed re-collection', async () => {
    let requestedUrl: URL | undefined
    const connector = new StackExchangeConnector({
      policy: approvedStackExchangePolicy,
      fetchImpl: async (url) => {
        requestedUrl = new URL(String(url))
        return new Response(JSON.stringify({ items: [stackExchangeQuestion] }), { status: 200 })
      },
      now: () => '2026-08-02T00:00:00.000Z'
    })
    await connector.collect({
      query: 'ignored for exact lookup',
      limit: 1,
      purpose: 'contrary-evidence',
      requestedDisplayMode: 'excerpt',
      sourceRecordId: 'stackoverflow:42'
    })
    expect(requestedUrl?.pathname).toBe('/2.3/questions/42')
    expect(requestedUrl?.searchParams.get('site')).toBe('stackoverflow')
  })

  it('uses the exact complaint route for an explicit tombstone re-collection', async () => {
    let requestedUrl: URL | undefined
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      fetchImpl: async (url) => {
        requestedUrl = new URL(String(url))
        return new Response(JSON.stringify(cfpbRecord), { status: 200 })
      },
      now: () => '2026-07-24T00:00:00.000Z'
    })
    const result = await connector.collect({
      query: 'card',
      limit: 1,
      purpose: 'testing',
      requestedDisplayMode: 'excerpt',
      sourceRecordId: '123456',
      runId: 'run-cfpb-recollection'
    })
    expect(requestedUrl?.pathname).toMatch(/\/123456$/)
    expect(requestedUrl?.search).toBe('')
    expect(result.complaints).toHaveLength(1)
    expect(result.complaints[0]?.sourceRecordId).toBe('123456')
    expect(result.warnings).toContain(
      'This exact source-record re-collection used the official complaint-by-ID route and emitted no deletion tombstones.'
    )
  })

  it('runs the lease preflight before CFPB HTTP and releases denied quota', async () => {
    const events: string[] = []
    let released = false
    let requestCount = 0
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      quotaLedger: {
        async reserve(input) {
          return {
            reservationId: input.reservationId,
            status: 'reserved' as const,
            replayed: false,
            requestedRecords: input.requestedRecords,
            requestedCostMicros: input.requestedCostMicros
          }
        },
        async commit() {
          throw new Error('denied preflight must not settle quota')
        },
        async release() {
          events.push('quota-release')
          released = true
        }
      },
      fetchImpl: async () => {
        requestCount += 1
        return new Response(JSON.stringify([cfpbRecord]), { status: 200 })
      },
      now: () => '2026-07-24T00:00:00.000Z'
    })

    await expect(
      connector.collect({
        query: 'card',
        limit: 1,
        purpose: 'testing',
        requestedDisplayMode: 'excerpt',
        workspaceId: 'workspace:one',
        runId: 'run-cfpb-preflight',
        policyVersion: 'cfpb-policy-v1',
        idempotencyKey: 'preflight-key',
        beforeRequest: async () => {
          events.push('preflight')
          return false
        }
      })
    ).rejects.toBeInstanceOf(SourceCollectionPreflightDeniedError)
    expect(events).toEqual(['preflight', 'quota-release'])
    expect(released).toBe(true)
    expect(requestCount).toBe(0)
  })

  it('runs the lease preflight before an identifier-only CFPB snapshot request', async () => {
    const events: string[] = []
    let requestCount = 0
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      fetchImpl: async () => {
        events.push('http')
        requestCount += 1
        return new Response(JSON.stringify([cfpbRecord]), { status: 200 })
      },
      now: () => '2026-07-24T00:00:00.000Z'
    })
    const result = await connector.collectSnapshotPage({
      offset: 0,
      limit: 2,
      purpose: 'deletion-reconciliation',
      requestedDisplayMode: 'excerpt',
      reconciliationId: 'reconciliation:source:preflight',
      beforeRequest: async () => {
        events.push('preflight')
        return true
      }
    })
    expect(result.completeSnapshot).toBe(true)
    expect(events).toEqual(['preflight', 'http'])
    expect(requestCount).toBe(1)
  })

  it('enforces request and per-run quotas before making a request', async () => {
    let requestCount = 0
    const connector = new CfpbConnector({
      policy: sourcePolicySchema.parse({
        ...approvedCfpbPolicy,
        quota: { ...approvedCfpbPolicy.quota, maxRecordsPerRequest: 1, maxRecordsPerRun: 1 }
      }),
      fetchImpl: async (_url, init) => {
        expect(init?.redirect).toBe('error')
        requestCount += 1
        return new Response(JSON.stringify([cfpbRecord]), { status: 200 })
      },
      now: () => '2026-07-24T00:00:00.000Z'
    })
    await expect(
      connector.collect({
        query: 'card',
        limit: 2,
        purpose: 'testing',
        requestedDisplayMode: 'excerpt',
        runId: 'run-cfpb-quota'
      })
    ).rejects.toBeInstanceOf(SourceQuotaExceededError)
    expect(requestCount).toBe(0)
    await connector.collect({
      query: 'card',
      limit: 1,
      purpose: 'testing',
      requestedDisplayMode: 'excerpt',
      runId: 'run-cfpb-quota'
    })
    await expect(
      connector.collect({
        query: 'card',
        limit: 1,
        purpose: 'testing',
        requestedDisplayMode: 'excerpt',
        runId: 'run-cfpb-quota'
      })
    ).rejects.toBeInstanceOf(SourceQuotaExceededError)
  })

  it('uses a durable quota capability and refuses committed reservation replays', async () => {
    const reservations = new Map<string, 'reserved' | 'committed'>()
    const inputs: string[] = []
    let settledCostMicros = -1
    const ledger: SourceQuotaLedger = {
      async reserve(input) {
        inputs.push(input.idempotencyKey)
        const existing = reservations.get(input.idempotencyKey)
        if (existing) {
          return {
            reservationId: 'quota:one',
            status: existing,
            replayed: true,
            requestedRecords: input.requestedRecords,
            requestedCostMicros: input.requestedCostMicros
          }
        }
        reservations.set(input.idempotencyKey, 'reserved')
        return {
          reservationId: 'quota:one',
          status: 'reserved',
          replayed: false,
          requestedRecords: input.requestedRecords,
          requestedCostMicros: input.requestedCostMicros
        }
      },
      async commit(input) {
        expect(input.workspaceId).toBe('workspace:one')
        settledCostMicros = input.actualCostMicros
        reservations.set(inputs[0]!, 'committed')
      },
      async release() {
        throw new Error('release is not expected after a dispatched request')
      }
    }
    let requestCount = 0
    const connector = new CfpbConnector({
      policy: sourcePolicySchema.parse({
        ...approvedCfpbPolicy,
        quota: { ...approvedCfpbPolicy.quota, costPerRequestMicros: 17 }
      }),
      quotaLedger: ledger,
      fetchImpl: async () => {
        requestCount += 1
        return new Response(JSON.stringify([cfpbRecord]), { status: 200 })
      },
      now: () => '2026-07-24T00:00:00.000Z'
    })
    const request = {
      query: 'card',
      limit: 1,
      purpose: 'testing',
      requestedDisplayMode: 'excerpt' as const,
      workspaceId: 'workspace:one',
      runId: 'run-cfpb-durable',
      policyVersion: 'cfpb-policy-v1',
      idempotencyKey: 'sensitive query material'
    }
    const result = await connector.collect(request)
    expect(result.costMicros).toBe(17)
    expect(settledCostMicros).toBe(17)
    expect(inputs[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(inputs[0]).not.toContain('sensitive')
    await expect(connector.collect(request)).rejects.toBeInstanceOf(
      SourceQuotaReservationReplayError
    )
    expect(requestCount).toBe(1)
  })

  it('does not dispatch a replayed in-flight reservation or reuse it for another request', async () => {
    const reservations = new Set<string>()
    let requestCount = 0
    const ledger: SourceQuotaLedger = {
      async reserve(input) {
        const replayed = reservations.has(input.idempotencyKey)
        reservations.add(input.idempotencyKey)
        return {
          reservationId: input.reservationId,
          status: 'reserved',
          replayed,
          requestedRecords: input.requestedRecords,
          requestedCostMicros: input.requestedCostMicros
        }
      },
      async commit() {
        // Keep this fixture reservation in-flight to exercise the replay guard.
      },
      async release() {}
    }
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      quotaLedger: ledger,
      fetchImpl: async () => {
        requestCount += 1
        return new Response(JSON.stringify([cfpbRecord]), { status: 200 })
      },
      now: () => '2026-07-24T00:00:00.000Z'
    })
    const request = {
      query: 'card',
      limit: 1,
      purpose: 'testing',
      requestedDisplayMode: 'excerpt' as const,
      workspaceId: 'workspace:one',
      runId: 'run-cfpb-in-flight',
      policyVersion: 'cfpb-policy-v1',
      idempotencyKey: 'same-client-key'
    }
    await connector.collect(request)
    await expect(connector.collect(request)).rejects.toBeInstanceOf(
      SourceQuotaReservationReplayError
    )
    await connector.collect({ ...request, query: 'mortgage' })
    expect(requestCount).toBe(2)
  })

  it('skips malformed or non-narrative records and exposes a coverage warning', async () => {
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            cfpbRecord,
            { ...cfpbRecord, complaint_id: 123457, complaint_what_happened: null },
            { product: 'Credit card' }
          ]),
          { status: 200 }
        ),
      now: () => '2026-07-24T00:00:00.000Z'
    })
    const result = await connector.collect({
      query: 'card',
      limit: 3,
      purpose: 'testing',
      requestedDisplayMode: 'excerpt',
      runId: 'run-cfpb-malformed'
    })
    expect(result.complaints).toHaveLength(1)
    expect(result.warnings.some((warning) => warning.includes('skipped'))).toBe(true)
    expect(result.deletions).toEqual([])
  })

  it('collects identifier-only unfiltered snapshot pages without retaining narratives', async () => {
    let requestedUrl: URL | undefined
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      fetchImpl: async (url) => {
        requestedUrl = url as URL
        return new Response(JSON.stringify([cfpbRecord]), { status: 200 })
      },
      now: () => '2026-07-24T00:00:00.000Z'
    })
    const result = await connector.collectSnapshotPage({
      offset: 100,
      limit: 2,
      purpose: 'deletion-reconciliation',
      requestedDisplayMode: 'excerpt',
      reconciliationId: 'reconciliation:source:0123456789abcdef0123456789abcdef'
    })
    expect(result).toMatchObject({
      offset: 100,
      pageSize: 2,
      sourceRecordCount: 1,
      sourceRecordIds: ['123456'],
      shortPage: true,
      completeSnapshot: true,
      warnings: []
    })
    expect(requestedUrl?.searchParams.get('frm')).toBe('100')
    expect(requestedUrl?.searchParams.get('size')).toBe('2')
    expect(requestedUrl?.searchParams.get('search_term')).toBeNull()
  })

  it('marks malformed identifier pages unsafe for deletion absence', async () => {
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      fetchImpl: async () =>
        new Response(JSON.stringify([{ complaint_id: 'not-numeric' }]), { status: 200 }),
      now: () => '2026-07-24T00:00:00.000Z'
    })
    const result = await connector.collectSnapshotPage({
      offset: 0,
      limit: 10,
      purpose: 'deletion-reconciliation',
      requestedDisplayMode: 'excerpt',
      reconciliationId: 'reconciliation:source:fedcba9876543210fedcba9876543210'
    })
    expect(result.sourceRecordIds).toEqual([])
    expect(result.shortPage).toBe(true)
    expect(result.completeSnapshot).toBe(false)
    expect(result.warnings[0]).toMatch(/valid complaint identifier/)
  })

  it('rejects filtered-purpose snapshot requests before network access', async () => {
    let requestCount = 0
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      fetchImpl: async () => {
        requestCount += 1
        return new Response('[]', { status: 200 })
      }
    })
    await expect(
      connector.collectSnapshotPage({
        offset: 0,
        limit: 1,
        purpose: 'opportunity-research',
        requestedDisplayMode: 'excerpt'
      })
    ).rejects.toThrow(/deletion-reconciliation/)
    expect(requestCount).toBe(0)
  })

  it('rejects a response whose declared body exceeds the byte budget', async () => {
    const connector = new CfpbConnector({
      policy: approvedCfpbPolicy,
      fetchImpl: async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(32 * 1024 * 1024 + 1) }
        }),
      now: () => '2026-07-24T00:00:00.000Z'
    })
    await expect(
      connector.collect({
        query: 'card',
        limit: 1,
        purpose: 'testing',
        requestedDisplayMode: 'excerpt',
        runId: 'run-cfpb-large-response'
      })
    ).rejects.toBeInstanceOf(SourceResponseTooLargeError)
  })

  it('only emits deletion events after a full snapshot', () => {
    const filtered = syncCfpbDeletions({
      knownSourceRecordIds: ['1', '2'],
      currentSourceRecordIds: ['1'],
      fullSnapshot: false,
      observedAt: '2026-07-24T00:00:00.000Z'
    })
    expect(filtered.deletions).toHaveLength(0)
    expect(filtered.warnings).toHaveLength(1)
    const full = syncCfpbDeletions({
      knownSourceRecordIds: ['1', '2'],
      currentSourceRecordIds: ['1'],
      fullSnapshot: true,
      observedAt: '2026-07-24T00:00:00.000Z'
    })
    expect(full.deletions).toMatchObject([
      {
        sourceId: 'cfpb-consumer-complaints',
        sourceRecordId: '2'
      }
    ])
  })
})
