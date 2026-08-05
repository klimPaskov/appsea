import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceOpportunityTabs } from './workspace-opportunity-tabs'

describe('workspace opportunity tabs', () => {
  it('links every private research surface and marks only the active page', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceOpportunityTabs workspaceId="workspace:one" slug="inbox-relay" active="report" />
    )

    expect(markup).toContain('aria-label="Opportunity research sections"')
    expect(markup).toContain('href="/workspace/workspace:one/opportunities/inbox-relay"')
    expect(markup).toContain('href="/workspace/workspace:one/opportunities/inbox-relay/evidence"')
    expect(markup).toContain(
      'href="/workspace/workspace:one/opportunities/inbox-relay/competitors"'
    )
    expect(markup).toContain('href="/workspace/workspace:one/opportunities/inbox-relay/report"')
    expect(markup).toContain('href="/workspace/workspace:one/opportunities/inbox-relay/plan"')
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1)
    expect(markup).toContain('>Report</a>')
  })
})
