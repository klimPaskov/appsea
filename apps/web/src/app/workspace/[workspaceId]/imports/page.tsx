import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  appseaIdentifierSchema,
  researchCampaignConfigurationSchema,
  researchJobBudgetSchema,
  type ManualImportBatchReadModel
} from '@appsea/contracts'
import { PostgresManualImportRepository } from '@appsea/db'
import { PostgresResearchCampaignRepository } from '@appsea/db/research-campaign'
import { readSession } from '../../../../server/auth-session'
import { getDatabasePool } from '../../../../server/database'
import { decodePathParam } from '../../../../server/path-params'
import { ManualImportActions } from '../../manual-import-actions'

export const dynamic = 'force-dynamic'

export interface ManualImportCampaignOption {
  campaignId: string
  name: string
  query: string
  maxSourceItems: number
}

function manualCampaigns(
  campaigns: Awaited<ReturnType<PostgresResearchCampaignRepository['listForUser']>>
) {
  const options: ManualImportCampaignOption[] = []
  for (const campaign of campaigns) {
    if (campaign.synthetic || campaign.state === 'archived') continue
    const parsed = researchCampaignConfigurationSchema.safeParse(campaign.configuration)
    const budget = researchJobBudgetSchema.safeParse(campaign.budget)
    if (
      !parsed.success ||
      !budget.success ||
      !parsed.data.sourceIds.includes('manual-owner-import')
    ) {
      continue
    }
    options.push({
      campaignId: campaign.campaignId,
      name: campaign.name,
      query: parsed.data.query,
      maxSourceItems: budget.data.maxSourceItems
    })
  }
  return options
}

export default async function ManualImportsPage({
  params
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const session = await readSession()
  if (!session) redirect('/login')
  const { workspaceId: encodedWorkspaceId } = await params
  const workspaceId = decodePathParam(encodedWorkspaceId)
  const parsedWorkspaceId = appseaIdentifierSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) notFound()
  const workspace = session.workspaces.find(
    (candidate) => candidate.workspaceId === parsedWorkspaceId.data
  )
  if (!workspace || workspace.visibility !== 'private') notFound()

  const pool = getDatabasePool()
  const campaigns = await new PostgresResearchCampaignRepository(pool).listForUser(
    session.user.userId,
    parsedWorkspaceId.data
  )
  let batches: ManualImportBatchReadModel[] = []
  try {
    batches = await new PostgresManualImportRepository(pool).listForUser(
      session.user.userId,
      parsedWorkspaceId.data
    )
  } catch (error) {
    console.error('AppSea manual import page read failed', {
      name: error instanceof Error ? error.name : 'unknown'
    })
  }

  const canUpload =
    !workspace.fixtureOnly && workspace.role === 'owner' && workspace.visibility === 'private'
  const options = manualCampaigns(campaigns)

  return (
    <main className="workspace-page">
      <p className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>Owner imports</span>
      </p>
      <div className="workspace-toolbar workspace-opportunity-heading">
        <div>
          <p className="eyebrow">Private research workspace</p>
          <h1>Owner imports</h1>
          <p className="auth-intro">
            Bring an export you are authorized to analyze into a reviewed campaign. AppSea keeps
            normalized, PII-scrubbed fields and never fetches imported URLs.
          </p>
        </div>
        <strong className="workspace-score">{batches.length}</strong>
      </div>
      <section className="workspace-section" aria-labelledby="manual-import-policy-heading">
        <div className="section-intro">
          <h2 id="manual-import-policy-heading">Coverage boundary</h2>
          <p>
            These records are tenant-private evidence. They do not establish public market coverage,
            prevalence, or absence of complaints.
          </p>
        </div>
        <ul className="manual-import-policy-list">
          <li>CSV or JSON only, bounded to 2 MiB and 5,000 normalized records.</li>
          <li>Raw upload bytes are discarded after staging; only scrubbed fields remain.</li>
          <li>Owners can delete a batch, clear staged payloads, and emit provenance tombstones.</li>
        </ul>
      </section>
      {canUpload ? (
        <section className="workspace-section" aria-labelledby="manual-import-upload-heading">
          <div className="section-intro">
            <h2 id="manual-import-upload-heading">Stage an authorized export</h2>
            <p>Choose a private production campaign that explicitly allows manual imports.</p>
          </div>
          <ManualImportActions
            workspaceId={parsedWorkspaceId.data}
            campaigns={options}
            batches={batches}
            canUpload
          />
        </section>
      ) : (
        <section className="workspace-section" aria-labelledby="manual-import-read-heading">
          <div className="section-intro">
            <h2 id="manual-import-read-heading">Batch history</h2>
            <p>Only the workspace owner can stage or delete imported evidence.</p>
          </div>
          <ManualImportActions
            workspaceId={parsedWorkspaceId.data}
            campaigns={options}
            batches={batches}
            canUpload={false}
          />
        </section>
      )}
    </main>
  )
}
