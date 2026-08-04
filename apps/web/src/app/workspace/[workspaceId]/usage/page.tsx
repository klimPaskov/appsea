import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  appseaIdentifierSchema,
  type SourceQuotaReconciliationCase,
  type WorkspaceCostSummaryReadModel
} from '@appsea/contracts'
import { PostgresSourceQuotaRepository, PostgresWorkspaceCostRepository } from '@appsea/db'
import { readSession } from '../../../../server/auth-session'
import { getDatabasePool } from '../../../../server/database'
import { decodePathParam } from '../../../../server/path-params'

export const dynamic = 'force-dynamic'

function formatMicros(value: string | number | null, currency: string): string {
  if (value === null) return 'Not recorded'
  const raw = String(value)
  if (!/^(?:0|[1-9][0-9]{0,17})$/.test(raw)) return 'Unavailable'
  const padded = raw.padStart(7, '0')
  return `${currency} ${padded.slice(0, -6)}.${padded.slice(-6)}`
}

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unavailable'
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function quotaStatus(caseItem: SourceQuotaReconciliationCase): string {
  return caseItem.state === 'open'
    ? 'Open review'
    : caseItem.resolutionCode === 'linked_result'
      ? 'Linked result'
      : 'Voided without result'
}

function CostSummary({ summary }: { summary: WorkspaceCostSummaryReadModel }) {
  return (
    <>
      <p className="muted-note usage-period">
        {formatDate(summary.periodStart)} to {formatDate(summary.periodEnd)} · observed{' '}
        {formatDate(summary.asOf)}
      </p>
      {summary.currencies.length === 0 ? (
        <p className="empty-state">No cost ledger entries were recorded in this period.</p>
      ) : (
        <ul className="usage-summary-list">
          {summary.currencies.map((currency) => (
            <li key={currency.currency} className="usage-summary-card">
              <div className="usage-summary-heading">
                <div>
                  <span className="complaint-meta">
                    <span>{currency.currency}</span>
                    <span>{currency.entryCount.toLocaleString('en-US')} entries</span>
                  </span>
                  <h3>{formatMicros(currency.totalCostMicros, currency.currency)}</h3>
                </div>
                <span className="usage-summary-state">Recorded total</span>
              </div>
              <dl className="usage-summary-metrics">
                <div>
                  <dt>Estimated</dt>
                  <dd>{formatMicros(currency.estimatedCostMicros, currency.currency)}</dd>
                </div>
                <div>
                  <dt>Actual</dt>
                  <dd>{formatMicros(currency.actualCostMicros, currency.currency)}</dd>
                </div>
              </dl>
              <div className="usage-cost-types">
                <p className="label">By cost type</p>
                <ul>
                  {currency.byCostType.map((costType) => (
                    <li key={costType.costType}>
                      <span>{costType.costType}</span>
                      <strong>{formatMicros(costType.totalCostMicros, currency.currency)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function QuotaReconciliation({ cases }: { cases: SourceQuotaReconciliationCase[] }) {
  if (cases.length === 0) {
    return <p className="empty-state">No settled source requests need reconciliation.</p>
  }
  return (
    <ul className="quota-reconciliation-list">
      {cases.map((caseItem) => (
        <li key={caseItem.reservationId} className="quota-reconciliation-row">
          <div className="quota-reconciliation-heading">
            <div>
              <span className="complaint-meta">
                <span>{caseItem.sourceId}</span>
                <span>{caseItem.policyVersion}</span>
              </span>
              <h3>{caseItem.reservationId}</h3>
            </div>
            <strong className="quota-reconciliation-state">{quotaStatus(caseItem)}</strong>
          </div>
          <dl className="quota-reconciliation-details">
            <div>
              <dt>Requested</dt>
              <dd>
                {caseItem.requestedRecords.toLocaleString('en-US')} records ·{' '}
                {caseItem.requestedCostMicros.toLocaleString('en-US')} micros
              </dd>
            </div>
            <div>
              <dt>Observed</dt>
              <dd>
                {caseItem.actualRecords === null
                  ? 'No completed result'
                  : `${caseItem.actualRecords.toLocaleString('en-US')} records · ${caseItem.actualCostMicros?.toLocaleString('en-US') ?? '0'} micros`}
              </dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{formatDate(caseItem.lastSeenAt)}</dd>
            </div>
            <div>
              <dt>Run</dt>
              <dd>{caseItem.runId}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  )
}

export default async function WorkspaceUsagePage({
  params
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId: encodedWorkspaceId } = await params
  const workspaceId = decodePathParam(encodedWorkspaceId)
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) notFound()
  const workspace = session.workspaces.find(
    (candidate) =>
      candidate.workspaceId === parsedWorkspaceId.data && candidate.visibility === 'private'
  )
  if (!workspace) notFound()

  const pool = getDatabasePool()
  const [costResult, quotaResult] = await Promise.all([
    new PostgresWorkspaceCostRepository(pool)
      .readForUser(session.user.userId, parsedWorkspaceId.data, {})
      .then((data) => ({ data, unavailable: false }))
      .catch((error) => {
        console.error('AppSea workspace usage cost read failed', {
          name: error instanceof Error ? error.name : 'unknown'
        })
        return { data: null, unavailable: true }
      }),
    new PostgresSourceQuotaRepository(pool)
      .listReconciliationCasesForUser(session.user.userId, parsedWorkspaceId.data, { limit: 50 })
      .then((data) => ({ data, unavailable: false }))
      .catch((error) => {
        console.error('AppSea workspace usage quota read failed', {
          name: error instanceof Error ? error.name : 'unknown'
        })
        return { data: null, unavailable: true }
      })
  ])

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Usage</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Usage</h1>
          <p className="auth-intro">
            Inspect recorded research costs and settled source requests that still need an
            operator-owned reconciliation decision.
          </p>
        </div>
        <Link className="quiet-button" href="/workspace">
          Back to workspace
        </Link>
      </div>

      <section className="workspace-section" aria-labelledby="usage-cost-heading">
        <div className="section-intro">
          <h2 id="usage-cost-heading">Cost summary</h2>
          <p>Exact ledger totals for the last 30 days. Currencies are never combined.</p>
        </div>
        {costResult.unavailable ? (
          <p className="empty-state">
            Cost totals are temporarily unavailable. Refresh after the private research service
            reconnects.
          </p>
        ) : costResult.data ? (
          <CostSummary summary={costResult.data} />
        ) : null}
      </section>

      <section className="workspace-section" aria-labelledby="usage-quota-heading">
        <div className="section-intro">
          <h2 id="usage-quota-heading">Quota reconciliation</h2>
          <p>
            A read-only view of settled source reservations without a completed production result.
          </p>
        </div>
        {quotaResult.unavailable ? (
          <p className="empty-state">
            Quota reconciliation is temporarily unavailable. No automatic retry or refund is started
            by this page.
          </p>
        ) : quotaResult.data ? (
          <QuotaReconciliation cases={quotaResult.data} />
        ) : null}
        <p className="muted-note usage-boundary-note">
          Maintenance operators resolve cases through the reviewed worker boundary. This page cannot
          refund quota, re-fetch a source, or change a research result.
        </p>
      </section>
    </main>
  )
}

export { formatDate, formatMicros, quotaStatus }
