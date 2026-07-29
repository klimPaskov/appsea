import Link from 'next/link'

interface OpportunityNavProps {
  slug: string
  active: 'overview' | 'complaints' | 'competitors' | 'plan'
}

const items = [
  ['overview', 'Overview', ''],
  ['complaints', 'Complaints', '/complaints'],
  ['competitors', 'Competitors', '/competitors'],
  ['plan', 'Coding plan', '/plan']
] as const

export function OpportunityNav({ slug, active }: OpportunityNavProps) {
  return (
    <nav className="tabs" aria-label="Opportunity sections">
      {items.map(([key, label, suffix]) => (
        <Link
          key={key}
          href={`/opportunities/${slug}${suffix}`}
          className={active === key ? 'tab active' : 'tab'}
          aria-current={active === key ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
