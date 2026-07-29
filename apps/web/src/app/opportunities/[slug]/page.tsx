import { notFound } from 'next/navigation'
import { getOpportunity } from '@appsea/catalog'
import { OpportunityShell } from '../../../components/opportunity-shell'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function OpportunityPage({ params }: PageProps) {
  const { slug } = await params
  const opportunity = getOpportunity(slug)
  if (!opportunity) notFound()

  return (
    <OpportunityShell opportunity={opportunity} active="overview">
      <section className="content-stack" aria-label="Opportunity overview">
        <div className="statement-block">
          <p className="label">Thesis</p>
          <p className="statement">{opportunity.thesis}</p>
        </div>
        <div className="detail-grid">
          <div>
            <p className="label">Audience</p>
            <p>{opportunity.audience}</p>
          </div>
          <div>
            <p className="label">First wedge</p>
            <p>{opportunity.firstWedge}</p>
          </div>
        </div>
        <div className="quiet-metrics" aria-label="Opportunity facts">
          <div>
            <span>Complaints</span>
            <strong>{opportunity.complaintCount.toLocaleString('en-US')}</strong>
          </div>
          <div>
            <span>Score</span>
            <strong>{opportunity.scoreSnapshot.score.toFixed(1)}</strong>
          </div>
          <div>
            <span>Evidence</span>
            <strong>Fixture</strong>
          </div>
        </div>
      </section>
    </OpportunityShell>
  )
}
