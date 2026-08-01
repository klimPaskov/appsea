import type { Pool, PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  PostgresResearchCampaignRepository,
  ResearchCampaignSourceError
} from './research-campaign-repository'

const now = '2026-08-01T00:00:00.000Z'
const configuration = {
  schemaVersion: 'campaign-v1' as const,
  goal: 'Find recurring billing workflow problems.',
  query: 'billing workflow',
  seeds: ['billing'],
  sourceIds: ['source:cfpb'],
  languages: ['en'],
  geographies: [],
  dateRange: { from: null, to: null },
  exclusions: [],
  maxEvidenceCount: 100,
  refreshPolicy: 'manual' as const,
  sensitiveTopicPolicy: 'review' as const,
  requestedDisplayMode: 'excerpt' as const
}
const budget = {
  currency: 'USD' as const,
  maxSourceItems: 100,
  maxCostMicros: 0,
  maxActivityAttempts: 3
}

const sourceRow = {
  source_id: 'source:cfpb',
  display_name: 'CFPB',
  source_type: 'api' as const,
  lifecycle_state: 'active',
  policy_version: 'cfpb-v1',
  policy_state: 'pending_review' as 'approved' | 'pending_review' | 'expired' | 'revoked',
  permitted_purposes: ['opportunity-research'],
  policy_enabled: false,
  coverage_notes: ['Pending review'],
  reviewed_at: null,
  expires_at: null
}

function campaignRow(configurationValue: unknown = configuration) {
  return {
    workspace_id: 'workspace:one',
    campaign_id: 'campaign:billing',
    name: 'Billing workflow research',
    purpose: 'opportunity-research',
    state: 'draft',
    configuration: configurationValue,
    budget,
    synthetic: false,
    created_at: now,
    updated_at: now
  }
}

class FakeClient {
  readonly statements: string[] = []
  readonly campaigns = new Map<string, ReturnType<typeof campaignRow>>()

  constructor(private readonly configuredSource = sourceRow) {}

  async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    this.statements.push(text)
    if (text.startsWith('BEGIN') || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [], rowCount: 0 } as unknown as { rows: T[]; rowCount: number }
    }
    if (text.includes("set_config('appsea.auth_user_id'")) {
      return { rows: [], rowCount: 1 } as unknown as { rows: T[]; rowCount: number }
    }
    if (text.includes("set_config('appsea.workspace_id'")) {
      return { rows: [], rowCount: 1 } as unknown as { rows: T[]; rowCount: number }
    }
    if (text.includes('SELECT 1') && text.includes('workspace_memberships')) {
      return { rows: [{}], rowCount: 1 } as unknown as { rows: T[]; rowCount: number }
    }
    if (text.includes('SELECT role') && text.includes('workspace_memberships')) {
      return { rows: [{ role: 'editor' }], rowCount: 1 } as unknown as {
        rows: T[]
        rowCount: number
      }
    }
    if (text.includes('FROM appsea.workspaces')) {
      return {
        rows: [{ fixture_only: false, visibility: 'private', status: 'active' }],
        rowCount: 1
      } as unknown as { rows: T[]; rowCount: number }
    }
    if (text.includes('FROM appsea.sources source')) {
      return {
        rows: [this.configuredSource],
        rowCount: 1
      } as unknown as { rows: T[]; rowCount: number }
    }
    if (text.includes('FROM appsea.research_campaigns')) {
      const row = this.campaigns.get(String(values[1] ?? ''))
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 } as unknown as {
        rows: T[]
        rowCount: number
      }
    }
    if (text.startsWith('INSERT INTO appsea.research_campaigns')) {
      const row = campaignRow(JSON.parse(String(values[4])))
      this.campaigns.set(row.campaign_id, row)
      return { rows: [row], rowCount: 1 } as unknown as { rows: T[]; rowCount: number }
    }
    if (
      text.includes('INSERT INTO appsea.audit_events') ||
      text.includes('INSERT INTO appsea.outbox_events')
    ) {
      return { rows: [], rowCount: 1 } as unknown as { rows: T[]; rowCount: number }
    }
    throw new Error(`Unexpected SQL in test double: ${text}`)
  }

  release(): void {}
}

function fakePool(client: FakeClient): Pool {
  return { connect: async () => client as unknown as PoolClient } as unknown as Pool
}

describe('research campaign repository', () => {
  it('creates a private draft with source readiness and audit/outbox receipts', async () => {
    const client = new FakeClient()
    const repository = new PostgresResearchCampaignRepository(fakePool(client))
    const result = await repository.createForUser('user:one', 'workspace:one', {
      campaignId: 'campaign:billing',
      name: 'Billing workflow research',
      purpose: 'opportunity-research',
      configuration,
      budget
    })

    expect(result.state).toBe('draft')
    expect(result.sources).toEqual([
      expect.objectContaining({
        sourceId: 'source:cfpb',
        policyState: 'pending_review',
        enabled: false
      })
    ])
    expect(
      client.statements.some((statement) => statement.includes('INSERT INTO appsea.audit_events'))
    ).toBe(true)
    expect(
      client.statements.some((statement) => statement.includes('INSERT INTO appsea.outbox_events'))
    ).toBe(true)
  })

  it('rejects unknown sources before inserting a campaign', async () => {
    const client = new FakeClient()
    const repository = new PostgresResearchCampaignRepository(fakePool(client))
    await expect(
      repository.createForUser('user:one', 'workspace:one', {
        campaignId: 'campaign:missing',
        name: 'Missing source',
        purpose: 'opportunity-research',
        configuration: { ...configuration, sourceIds: ['source:missing'] },
        budget
      })
    ).rejects.toBeInstanceOf(ResearchCampaignSourceError)
    expect(
      client.statements.some((statement) =>
        statement.includes('INSERT INTO appsea.research_campaigns')
      )
    ).toBe(false)
  })

  it('derives source readiness from registry state, not the immutable draft flag', async () => {
    const client = new FakeClient({
      ...sourceRow,
      lifecycle_state: 'active',
      policy_state: 'approved',
      expires_at: null
    })
    const repository = new PostgresResearchCampaignRepository(fakePool(client))
    const result = await repository.createForUser('user:one', 'workspace:one', {
      campaignId: 'campaign:billing',
      name: 'Billing workflow research',
      purpose: 'opportunity-research',
      configuration,
      budget
    })

    expect(result.sources[0]?.enabled).toBe(true)
  })

  it('reads legacy workflow campaigns without claiming the new configuration shape', async () => {
    const client = new FakeClient()
    client.campaigns.set('campaign:billing', campaignRow({ mode: 'production-collection' }))
    const repository = new PostgresResearchCampaignRepository(fakePool(client))
    const result = await repository.readForUser('user:one', 'workspace:one', 'campaign:billing')
    expect(result?.configuration).toEqual({ mode: 'production-collection' })
    expect(result?.state).toBe('draft')
  })
})
