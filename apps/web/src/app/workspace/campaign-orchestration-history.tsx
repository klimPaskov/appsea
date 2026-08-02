import type { ResearchCampaignOrchestrationReadModel } from '@appsea/contracts'

export function ResearchCampaignOrchestrationHistory({
  orchestrations
}: {
  orchestrations: ResearchCampaignOrchestrationReadModel[]
}) {
  if (orchestrations.length === 0) return null
  return (
    <details className="workspace-campaign-orchestration-history">
      <summary>Multi-source run history ({orchestrations.length})</summary>
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
    </details>
  )
}
