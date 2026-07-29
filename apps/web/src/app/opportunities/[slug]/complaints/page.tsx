import { notFound } from 'next/navigation'
import { getOpportunity, getOpportunityComplaints } from '@appsea/catalog'
import { OpportunityShell } from '../../../../components/opportunity-shell'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function ComplaintsPage({ params }: PageProps) {
  const { slug } = await params
  const opportunity = getOpportunity(slug)
  if (!opportunity) notFound()
  const complaints = getOpportunityComplaints(opportunity)

  return (
    <OpportunityShell opportunity={opportunity} active="complaints">
      <section className="content-stack">
        <div className="section-intro">
          <h2>Curated complaints</h2>
          <p>Representative synthetic observations. Live evidence is not enabled.</p>
        </div>
        <ol className="complaint-list">
          {complaints.map((complaint) => (
            <li key={complaint.id}>
              <div className="complaint-meta">
                <span>{complaint.product}</span>
                <span>{complaint.category}</span>
              </div>
              <p>{complaint.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </OpportunityShell>
  )
}
