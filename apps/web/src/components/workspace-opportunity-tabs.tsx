import Link from 'next/link'

export type WorkspaceOpportunitySection =
  'overview' | 'evidence' | 'competitors' | 'report' | 'plan'

interface WorkspaceOpportunityTabsProps {
  workspaceId: string
  slug: string
  active: WorkspaceOpportunitySection
}

const sections: ReadonlyArray<readonly [WorkspaceOpportunitySection, string]> = [
  ['overview', 'Overview'],
  ['evidence', 'Evidence'],
  ['competitors', 'Competitors'],
  ['report', 'Report'],
  ['plan', 'Plan']
]

export function WorkspaceOpportunityTabs({
  workspaceId,
  slug,
  active
}: WorkspaceOpportunityTabsProps) {
  const basePath = `/workspace/${workspaceId}/opportunities/${slug}`

  return (
    <nav className="tabs" aria-label="Opportunity research sections">
      {sections.map(([section, label]) => (
        <Link
          className={`tab${section === active ? ' active' : ''}`}
          href={section === 'overview' ? basePath : `${basePath}/${section}`}
          aria-current={section === active ? 'page' : undefined}
          key={section}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
