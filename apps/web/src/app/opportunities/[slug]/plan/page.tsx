import { notFound } from 'next/navigation'
import { getOpportunity } from '@appsea/catalog'
import { OpportunityShell } from '../../../../components/opportunity-shell'

interface PageProps {
  params: Promise<{ slug: string }>
}

const buildSteps = [
  'Define the provider and normalized conversation contracts.',
  'Implement an idempotent read-only sync job.',
  'Store ownership history and unresolved handoffs.',
  'Build the operator queue and shift summary.',
  'Validate the workflow end to end before adding providers.'
]

export default async function PlanPage({ params }: PageProps) {
  const { slug } = await params
  const opportunity = getOpportunity(slug)
  if (!opportunity) notFound()

  return (
    <OpportunityShell opportunity={opportunity} active="plan">
      <section className="content-stack">
        <div className="section-intro">
          <h2>Coding-agent package</h2>
          <p>A focused handoff with product, architecture, tasks, and validation.</p>
        </div>
        <div className="plan-layout">
          <div>
            <p className="label">Package files</p>
            <ol className="file-list">
              {opportunity.planFiles.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ol>
          </div>
          <div>
            <p className="label">First build sequence</p>
            <ol className="build-steps">
              {buildSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </OpportunityShell>
  )
}
