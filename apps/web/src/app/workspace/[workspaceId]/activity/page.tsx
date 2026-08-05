import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  appseaIdentifierSchema,
  auditEventHistoryPageQuerySchema,
  type AuditEventReadModel
} from '@appsea/contracts'
import { PostgresAuditEventRepository } from '@appsea/db'
import { readSession } from '../../../../server/auth-session'
import { getDatabasePool } from '../../../../server/database'
import { decodePathParam } from '../../../../server/path-params'

export const dynamic = 'force-dynamic'

const AUDIT_PAGE_SIZE = 25

type SearchParams = Record<string, string | string[] | undefined>

function singleSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined
  return value
}

function readAuditQuery(searchParams: SearchParams | undefined) {
  const rawLimit = singleSearchParam(searchParams?.limit)
  const rawCursor = singleSearchParam(searchParams?.cursor)
  const supportedKeys = new Set(['limit', 'cursor'])
  if (searchParams && Object.keys(searchParams).some((key) => !supportedKeys.has(key))) {
    return null
  }
  if (
    (searchParams?.limit && Array.isArray(searchParams.limit) && searchParams.limit.length !== 1) ||
    (searchParams?.cursor && Array.isArray(searchParams.cursor) && searchParams.cursor.length !== 1)
  ) {
    return null
  }
  const parsed = auditEventHistoryPageQuerySchema.safeParse({
    limit: rawLimit === undefined ? AUDIT_PAGE_SIZE : Number(rawLimit),
    ...(rawCursor === undefined ? {} : { cursor: rawCursor })
  })
  return parsed.success ? parsed.data : null
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unavailable'
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatAction(action: string): string {
  return action
    .split(/[.:_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function AuditEventCard({ event }: { event: AuditEventReadModel }) {
  const metadata = Object.entries(event.metadata)
  return (
    <li className="audit-event-card">
      <div className="audit-event-heading">
        <div>
          <p className="complaint-meta">
            <span>{formatDate(event.occurredAt)}</span>
            <span>{event.actorType} actor</span>
          </p>
          <h3>{formatAction(event.action)}</h3>
        </div>
        <span className="audit-event-state">Read-only receipt</span>
      </div>
      <dl className="audit-event-details">
        <div>
          <dt>Target</dt>
          <dd>
            {event.targetType} · <span className="audit-event-code">{event.targetId}</span>
          </dd>
        </div>
        <div>
          <dt>Actor</dt>
          <dd className="audit-event-code">{event.actorId}</dd>
        </div>
        <div>
          <dt>Correlation</dt>
          <dd className="audit-event-code">{event.correlationId}</dd>
        </div>
      </dl>
      {metadata.length > 0 ? (
        <dl className="audit-event-metadata">
          {metadata.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value === null ? 'null' : String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  )
}

export default async function WorkspaceActivityPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>
  searchParams?: Promise<SearchParams>
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

  const query = readAuditQuery(searchParams ? await searchParams : undefined)
  if (!query) notFound()

  let page: Awaited<ReturnType<PostgresAuditEventRepository['listPageForUser']>> | null = null
  try {
    page = await new PostgresAuditEventRepository(getDatabasePool()).listPageForUser(
      session.user.userId,
      parsedWorkspaceId.data,
      query
    )
  } catch (error) {
    console.error('AppSea workspace activity read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
  }

  const nextHref = page?.nextCursor
    ? `/workspace/${encodeURIComponent(parsedWorkspaceId.data)}/activity?limit=${query.limit}&cursor=${encodeURIComponent(page.nextCursor)}`
    : null

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Activity</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Activity</h1>
          <p className="auth-intro">
            Inspect bounded, workspace-scoped receipts for research and access changes. Imported
            source content and raw payloads are never shown here.
          </p>
        </div>
        <Link className="quiet-button" href="/workspace">
          Back to workspace
        </Link>
      </div>

      <section className="workspace-section" aria-labelledby="activity-history-heading">
        <div className="section-intro">
          <h2 id="activity-history-heading">Audit history</h2>
          <p>
            Newest receipts first. This page is read-only; approvals, source policy, membership, and
            workflow transitions remain server-authorized operations.
          </p>
        </div>
        {page === null ? (
          <p className="empty-state">
            Activity is temporarily unavailable. Refresh after the private research service
            reconnects.
          </p>
        ) : page.data.length === 0 ? (
          <p className="empty-state">No audit receipts have been recorded for this workspace.</p>
        ) : (
          <>
            <ol className="audit-event-list">
              {page.data.map((event) => (
                <AuditEventCard key={event.auditEventId} event={event} />
              ))}
            </ol>
            {nextHref ? (
              <p className="audit-next-link">
                <Link className="quiet-button" href={nextHref}>
                  Load older receipts
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  )
}

export { formatAction, formatDate, readAuditQuery }
