import type { ReactNode } from 'react'
import type { Opportunity } from '@appsea/contracts'
import { OpportunityNav } from './opportunity-nav'

interface OpportunityShellProps {
  opportunity: Opportunity
  active: 'overview' | 'complaints' | 'competitors' | 'plan'
  children: ReactNode
}

export function OpportunityShell({ opportunity, active, children }: OpportunityShellProps) {
  return (
    <main className="opportunity-page">
      <div className="breadcrumb">
        <a href="/">Leaderboard</a>
        <span aria-hidden="true">/</span>
        <span>{opportunity.name}</span>
      </div>
      <div className="opportunity-heading">
        <div>
          <p className="eyebrow">Opportunity {opportunity.scoreSnapshot.score.toFixed(1)}</p>
          <h1>{opportunity.name}</h1>
          <p className="lede">{opportunity.oneLine}</p>
        </div>
      </div>
      <OpportunityNav slug={opportunity.slug} active={active} />
      {children}
    </main>
  )
}
