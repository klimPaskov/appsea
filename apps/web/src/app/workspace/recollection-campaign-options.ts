import {
  researchCampaignConfigurationSchema,
  researchJobBudgetSchema,
  type ProductionCollectionRecollectionTarget,
  type ResearchCampaignReadModel
} from '@appsea/contracts'
import type { ProductionRecollectionCampaignOption } from './production-recollection-action'

export function recollectionCampaignOptions(
  target: ProductionCollectionRecollectionTarget,
  campaigns: ResearchCampaignReadModel[]
): ProductionRecollectionCampaignOption[] {
  return campaigns.flatMap((campaign) => {
    if (campaign.synthetic || campaign.state === 'archived') return []
    const configuration = researchCampaignConfigurationSchema.safeParse(campaign.configuration)
    const budget = researchJobBudgetSchema.safeParse(campaign.budget)
    if (!configuration.success || !budget.success) return []
    if (!configuration.data.sourceIds.includes(target.sourceId)) return []
    const source = campaign.sources.find((candidate) => candidate.sourceId === target.sourceId)
    if (
      !source ||
      source.synthetic ||
      source.sourceType === 'manual' ||
      !source.enabled ||
      source.policyState !== 'approved' ||
      source.policyVersion === null ||
      !source.permittedPurposes.includes(campaign.purpose) ||
      source.displayMode !== configuration.data.requestedDisplayMode
    ) {
      return []
    }
    return [
      {
        campaignId: campaign.campaignId,
        campaignName: campaign.name,
        policyVersion: source.policyVersion,
        query: configuration.data.query,
        dateRange: configuration.data.dateRange,
        purpose: campaign.purpose,
        requestedDisplayMode: configuration.data.requestedDisplayMode,
        budget: budget.data
      }
    ]
  })
}
