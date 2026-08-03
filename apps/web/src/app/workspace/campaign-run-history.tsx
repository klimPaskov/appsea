import Link from 'next/link'
import type { ResearchCampaignRunReadModel } from '@appsea/contracts'
import { ProductionWorkflowCancelAction } from './production-workflow-cancel-action'

export function ResearchCampaignRunHistory({
  workspaceId,
  runs,
  fullHistoryHref,
  nextPageHref
}: {
  workspaceId: string
  runs: ResearchCampaignRunReadModel[]
  fullHistoryHref?: string | undefined
  nextPageHref?: string | undefined
}) {
  return (
    <div className="workspace-campaign-runs">
      <div className="workspace-actions">
        <p className="label">Recent production runs</p>
        {fullHistoryHref ? (
          <Link className="quiet-button" href={fullHistoryHref}>
            View all history
          </Link>
        ) : null}
      </div>
      {runs.length === 0 ? (
        <p className="muted-note">No production collection runs have been recorded.</p>
      ) : (
        <ul>
          {runs.map((run) => (
            <li key={run.workflowId}>
              <div className="complaint-meta">
                <span>{run.state}</span>
                <span>{run.checkpoint}</span>
                <span>{run.sourceId}</span>
                <span>{run.consumedSourceItems} items</span>
              </div>
              <code>{run.runId}</code>
              <div className="workspace-actions">
                <Link
                  className="quiet-button"
                  href={`/workspace/${workspaceId}/research/workflows/${run.workflowId}`}
                >
                  View status
                </Link>
                {run.state === 'completed' ? (
                  <Link
                    className="quiet-button"
                    href={`/workspace/${workspaceId}/research/${run.runId}`}
                  >
                    Inspect evidence
                  </Link>
                ) : null}
                <ProductionWorkflowCancelAction
                  workspaceId={workspaceId}
                  workflowId={run.workflowId}
                  state={run.state}
                  cancellationRequestedAt={run.cancellationRequestedAt}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {nextPageHref ? (
        <p className="workspace-actions">
          <Link className="quiet-button" href={nextPageHref}>
            Older runs
          </Link>
        </p>
      ) : null}
    </div>
  )
}
