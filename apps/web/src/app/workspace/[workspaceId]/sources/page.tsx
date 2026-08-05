import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { appseaIdentifierSchema, type WorkspaceSourceReadModel } from '@appsea/contracts'
import { PostgresSourcePolicyRepository } from '@appsea/db/source-policy'
import { readSession } from '../../../../server/auth-session'
import { getDatabasePool } from '../../../../server/database'
import { decodePathParam } from '../../../../server/path-params'

export const dynamic = 'force-dynamic'

function formatQuota(source: WorkspaceSourceReadModel): string {
  if (!source.quota) return 'Not recorded'
  return `${source.quota.requestsPerMinute.toLocaleString('en-US')} requests/minute · ${source.quota.maxRecordsPerRun.toLocaleString('en-US')} records/run`
}

function formatRetention(source: WorkspaceSourceReadModel): string {
  if (source.retentionDays === null) return 'Not recorded'
  return `${source.retentionDays.toLocaleString('en-US')} days${source.deletionRequired ? ' · deletion required' : ''}`
}

function statusLabel(source: WorkspaceSourceReadModel): string {
  if (source.collectible) return 'Collectible'
  if (source.synthetic && source.enabled) return 'Fixture enabled'
  if (source.policyState === 'pending_review') return 'Pending review'
  if (source.policyState === 'expired') return 'Policy expired'
  if (source.policyState === 'revoked') return 'Policy revoked'
  return 'Not collectible'
}

function healthLabel(source: WorkspaceSourceReadModel): string {
  switch (source.health.state) {
    case 'healthy':
      return 'Healthy'
    case 'degraded':
      return 'Degraded'
    case 'blocked':
      return 'Blocked'
    default:
      return 'Unknown'
  }
}

function freshnessLabel(source: WorkspaceSourceReadModel): string {
  switch (source.health.freshness.state) {
    case 'fresh':
      return 'Fresh'
    case 'stale':
      return 'Stale'
    case 'on_demand':
      return 'On demand'
    case 'blocked':
      return 'Blocked'
    default:
      return 'Unknown'
  }
}

function freshnessWindow(source: WorkspaceSourceReadModel): string {
  const { expectedIntervalHours, allowedDelayHours } = source.health.freshness
  if (expectedIntervalHours === null || allowedDelayHours === null) {
    return 'No scheduled window recorded'
  }
  return `${expectedIntervalHours}h interval · ${allowedDelayHours}h allowed delay`
}

function healthDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('en-US') : 'Not observed'
}

export default async function WorkspaceSourcesPage({
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
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace || workspace.visibility !== 'private') notFound()

  let sources: WorkspaceSourceReadModel[] | null = null
  try {
    sources = await new PostgresSourcePolicyRepository(getDatabasePool()).listForUser(
      session.user.userId,
      parsedWorkspaceId.data
    )
  } catch (error) {
    console.error('AppSea source coverage page read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
  }

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Source coverage</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Source coverage</h1>
          <p className="auth-intro">
            Review the permitted source registry, policy state, quotas, deletion duties, and known
            coverage gaps before planning research.
          </p>
        </div>
        <strong className="workspace-score">{sources?.length ?? '—'}</strong>
      </div>
      <section className="workspace-section" aria-labelledby="source-registry-heading">
        <div className="section-intro">
          <h2 id="source-registry-heading">Registered sources</h2>
          <p>
            This is a read-only policy view. It cannot activate connectors or override legal,
            privacy, security, quota, or deletion review.
          </p>
        </div>
        {sources === null ? (
          <p className="empty-state">
            Source coverage is temporarily unavailable. Refresh after the private research service
            reconnects.
          </p>
        ) : sources.length === 0 ? (
          <p className="empty-state">No source policy records are registered yet.</p>
        ) : (
          <ul className="source-registry-list">
            {sources.map((source) => (
              <li key={source.sourceId}>
                <article className="source-registry-card">
                  <div className="source-registry-heading">
                    <div>
                      <div className="complaint-meta">
                        <span>{source.sourceId}</span>
                        <span>{source.synthetic ? 'Synthetic fixture' : 'Production source'}</span>
                      </div>
                      <h3>{source.displayName}</h3>
                    </div>
                    <strong
                      className={`source-registry-state${source.enabled ? ' is-enabled' : ''}`}
                    >
                      {statusLabel(source)}
                    </strong>
                  </div>
                  <p className="muted-note">
                    {source.collectible
                      ? 'The current approved policy and independent review gate permit production collection.'
                      : source.synthetic
                        ? 'Synthetic fixture evidence is available only inside a fixture workspace and is not market research.'
                        : 'This source remains visible as a coverage gap until its current policy gate permits collection.'}
                  </p>
                  <div
                    className="source-health"
                    aria-label={`${source.displayName} connector health`}
                  >
                    <div>
                      <p className="label">Connector health</p>
                      <strong className={`source-health-state is-${source.health.state}`}>
                        {healthLabel(source)}
                      </strong>
                      <p className="muted-note">{source.health.note}</p>
                    </div>
                    <div>
                      <p className="label">Source freshness</p>
                      <strong className={`source-health-state is-${source.health.freshness.state}`}>
                        {freshnessLabel(source)}
                      </strong>
                      <p className="muted-note">
                        {source.health.freshness.note} {freshnessWindow(source)}
                      </p>
                    </div>
                    <dl className="source-health-stats">
                      <div>
                        <dt>Last success</dt>
                        <dd>{healthDate(source.health.lastSuccessfulCollectionAt)}</dd>
                      </div>
                      <div>
                        <dt>Active records</dt>
                        <dd>{source.health.activeRecordCount.toLocaleString('en-US')}</dd>
                      </div>
                      <div>
                        <dt>Open deletions</dt>
                        <dd>{source.health.openDeletionCount.toLocaleString('en-US')}</dd>
                      </div>
                      <div>
                        <dt>Last failure</dt>
                        <dd>{source.health.lastFailureCode ?? 'None recorded'}</dd>
                      </div>
                      <div>
                        <dt>Last observed</dt>
                        <dd>{healthDate(source.health.freshness.lastObservedAt)}</dd>
                      </div>
                      <div>
                        <dt>Observation age</dt>
                        <dd>
                          {source.health.freshness.ageHours === null
                            ? 'Not observed'
                            : `${source.health.freshness.ageHours.toLocaleString('en-US')} hours`}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <dl className="detail-grid source-registry-details">
                    <div>
                      <dt className="label">Lifecycle</dt>
                      <dd>{source.lifecycleState}</dd>
                    </div>
                    <div>
                      <dt className="label">Policy</dt>
                      <dd>
                        {source.policyVersion ?? 'No current policy'}
                        {source.policyState ? ` · ${source.policyState}` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="label">Access method</dt>
                      <dd>{source.accessMethod ?? 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt className="label">Permitted purposes</dt>
                      <dd>{source.permittedPurposes.join(' · ') || 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt className="label">Quota</dt>
                      <dd>{formatQuota(source)}</dd>
                    </div>
                    <div>
                      <dt className="label">Retention and deletion</dt>
                      <dd>{formatRetention(source)}</dd>
                    </div>
                    <div>
                      <dt className="label">Reviewed</dt>
                      <dd>{source.reviewedAt ?? 'Not reviewed'}</dd>
                    </div>
                    <div>
                      <dt className="label">Policy expiry</dt>
                      <dd>{source.expiresAt ?? 'No expiry recorded'}</dd>
                    </div>
                  </dl>
                  <div className="source-coverage-notes">
                    <p className="label">Coverage notes</p>
                    {source.coverageNotes.length > 0 ? (
                      <ul>
                        {source.coverageNotes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted-note">No additional source-specific gap is recorded.</p>
                    )}
                  </div>
                  {source.policyDocumentRef ? (
                    <p className="source-policy-link">
                      <a href={source.policyDocumentRef} target="_blank" rel="noopener noreferrer">
                        Open policy document
                      </a>
                    </p>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
