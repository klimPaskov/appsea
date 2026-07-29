import { notFound } from 'next/navigation'
import { getOpportunity } from '@appsea/catalog'
import { OpportunityShell } from '../../../../components/opportunity-shell'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function CompetitorsPage({ params }: PageProps) {
  const { slug } = await params
  const opportunity = getOpportunity(slug)
  if (!opportunity) notFound()

  return (
    <OpportunityShell opportunity={opportunity} active="competitors">
      <section className="content-stack">
        <div className="section-intro">
          <h2>Competitors and alternatives</h2>
          <p>Direct products, platform features, and manual workarounds.</p>
        </div>
        <div className="competitor-list">
          {opportunity.competitors.map((competitor) => (
            <article key={competitor.name}>
              <div className="competitor-heading">
                <h3>{competitor.name}</h3>
                <span>{competitor.type}</span>
              </div>
              <p>{competitor.positioning}</p>
              <p className="weakness">{competitor.weaknesses.join(' · ')}</p>
            </article>
          ))}
        </div>
        <div className="risk-block">
          <p className="label">Contrary evidence</p>
          <ul>
            {opportunity.contraryEvidence.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
      </section>
    </OpportunityShell>
  )
}
