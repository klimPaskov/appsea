import Link from 'next/link'
import type { ResearchCampaignOrchestrationReadModel } from '@appsea/contracts'
import { ResearchCampaignOrchestrationCancelAction } from './campaign-orchestration-cancel-action'

export function ResearchCampaignOrchestrationHistory({
  orchestrations,
  workspaceId,
  canCancel,
  fullHistoryHref,
  nextPageHref
}: {
  orchestrations: ResearchCampaignOrchestrationReadModel[]
  workspaceId: string
  canCancel: boolean
  fullHistoryHref?: string | undefined
  nextPageHref?: string | undefined
}) {
  if (orchestrations.length === 0) return null
  return (
    <details className="workspace-campaign-orchestration-history">
      <summary>
        Multi-source run history ({orchestrations.length})
        {fullHistoryHref ? (
          <Link className="quiet-button" href={fullHistoryHref}>
            View all history
          </Link>
        ) : null}
      </summary>
      <ul className="seed-review-list">
        {orchestrations.map((orchestration) => (
          <li key={orchestration.orchestrationId}>
            <div className="complaint-meta">
              <span>{orchestration.orchestrationId}</span>
              <span>{orchestration.state}</span>
              <span>
                {orchestration.completedSourceCount}/{orchestration.sourceCount} sources complete
              </span>
              {orchestration.failedSourceCount > 0 ? (
                <span>{orchestration.failedSourceCount} failed</span>
              ) : null}
              <ResearchCampaignOrchestrationCancelAction
                workspaceId={workspaceId}
                campaignId={orchestration.campaignId}
                orchestrationId={orchestration.orchestrationId}
                canCancel={canCancel}
                cancellationRequestedAt={orchestration.cancellationRequestedAt}
                terminal={['completed', 'partial', 'failed', 'canceled'].includes(
                  orchestration.state
                )}
              />
            </div>
            <ul className="complaint-list">
              {orchestration.sources.map((source) => (
                <li key={source.sourceId}>
                  <span>{source.sourceId}</span>
                  <span>{source.state}</span>
                  {source.failureSummary ? <span>{source.failureSummary}</span> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {nextPageHref ? (
        <p className="workspace-actions">
          <Link className="quiet-button" href={nextPageHref}>
            Older multi-source runs
          </Link>
        </p>
      ) : null}
    </details>
  )
}
