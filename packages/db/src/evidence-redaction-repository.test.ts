import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transactionMocks = vi.hoisted(() => ({
  withAuthenticatedWorkspaceTransaction: vi.fn(),
  withWorkspaceTransaction: vi.fn()
}))

vi.mock('./transaction', () => transactionMocks)

import {
  EvidenceRedactionConflictError,
  EvidenceRedactionNotFoundError,
  EvidenceRedactionPermissionError,
  PostgresEvidenceRedactionRepository
} from './evidence-redaction-repository'

const now = '2026-08-02T00:00:00.000Z'

describe('evidence redaction repository', () => {
  const query = vi.fn()
  const client = { query } as unknown as PoolClient

  beforeEach(() => {
    query.mockReset()
    transactionMocks.withAuthenticatedWorkspaceTransaction.mockReset()
    transactionMocks.withWorkspaceTransaction.mockReset()
    transactionMocks.withAuthenticatedWorkspaceTransaction.mockImplementation(
      async (
        _pool: Pool,
        _userId: string,
        _workspaceId: string,
        operation: (transactionClient: PoolClient) => Promise<unknown>
      ) => operation(client)
    )
    transactionMocks.withWorkspaceTransaction.mockImplementation(
      async (
        _pool: Pool,
        _workspaceId: string,
        operation: (transactionClient: PoolClient) => Promise<unknown>
      ) => operation(client)
    )
  })

  it('binds redaction to the requested run and complaint and canonicalizes fields', async () => {
    query.mockResolvedValueOnce({ rows: [{}], rowCount: 1 }).mockResolvedValueOnce({
      rows: [
        {
          redaction_id: 'redaction:one',
          evidence_id: 'evidence:one',
          fields: ['canonicalLocator', 'text'],
          reason: 'pii',
          redacted_at: now,
          replayed: false
        }
      ],
      rowCount: 1
    })

    const repository = new PostgresEvidenceRedactionRepository({} as Pool)
    const result = await repository.redact(
      'user:editor',
      'workspace:one',
      'run:one',
      'complaint:one',
      'evidence:one',
      { redactionId: 'redaction:one', fields: ['text', 'canonicalLocator'], reason: 'pii' }
    )

    expect(result).toEqual({
      redactionId: 'redaction:one',
      evidenceId: 'evidence:one',
      fields: ['canonicalLocator', 'text'],
      reason: 'pii',
      redactedAt: now,
      replayed: false
    })
    expect(query.mock.calls[0]?.[0]).toContain('research_run_complaints')
    expect(query.mock.calls[0]?.[1]).toEqual([
      'workspace:one',
      'run:one',
      'complaint:one',
      'evidence:one'
    ])
    expect(query.mock.calls[1]?.[1]).toEqual([
      'workspace:one',
      'evidence:one',
      'redaction:one',
      ['canonicalLocator', 'text'],
      'pii'
    ])
  })

  it('keeps target and lifecycle failures bounded', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const repository = new PostgresEvidenceRedactionRepository({} as Pool)
    await expect(
      repository.redact(
        'user:editor',
        'workspace:one',
        'run:one',
        'complaint:one',
        'evidence:one',
        {
          redactionId: 'redaction:one',
          fields: ['text'],
          reason: 'pii'
        }
      )
    ).rejects.toBeInstanceOf(EvidenceRedactionNotFoundError)

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
    query.mockRejectedValueOnce({ code: '42501' })
    await expect(
      repository.redact(
        'user:editor',
        'workspace:one',
        'run:one',
        'complaint:one',
        'evidence:one',
        {
          redactionId: 'redaction:two',
          fields: ['text'],
          reason: 'pii'
        }
      )
    ).rejects.toBeInstanceOf(EvidenceRedactionPermissionError)

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
    query.mockRejectedValueOnce({ code: '23505' })
    await expect(
      repository.redact(
        'user:editor',
        'workspace:one',
        'run:one',
        'complaint:one',
        'evidence:one',
        {
          redactionId: 'redaction:three',
          fields: ['text'],
          reason: 'pii'
        }
      )
    ).rejects.toBeInstanceOf(EvidenceRedactionConflictError)
  })

  it('aggregates masks for a collection or analysis run', async () => {
    const rows: QueryResultRow[] = [
      { evidence_id: 'evidence:one', fields: ['canonicalLocator', 'text'] }
    ]
    query.mockResolvedValue({ rows, rowCount: rows.length })
    const repository = new PostgresEvidenceRedactionRepository({} as Pool)
    await expect(repository.listForRun('workspace:one', 'run:one')).resolves.toEqual([
      { evidenceId: 'evidence:one', fields: ['canonicalLocator', 'text'] }
    ])
    await expect(
      repository.listForAnalysisRun('workspace:one', 'analysis:one', 'user:viewer')
    ).resolves.toEqual([{ evidenceId: 'evidence:one', fields: ['canonicalLocator', 'text'] }])
    expect(query.mock.calls[0]?.[0]).toContain('research_run_source_items')
    expect(query.mock.calls[1]?.[0]).toContain('research_analysis_run_evidence')
    expect(query.mock.calls[1]?.[0]).toContain('research_analysis_run_competitor_observations')
  })
})
