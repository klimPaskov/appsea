import type {
  FixtureResearchInspection,
  FixtureResearchPersistenceActivityResult,
  FixtureResearchWorkflowInput,
  PersistFixtureResearchActivityInput,
  WorkflowJobCheckpointWrite,
  WorkflowJobCompletionInput,
  WorkflowJobInitializeInput,
  WorkflowJobTerminationInput
} from '@appsea/contracts'
import type {
  PersistProductionAnalysisWorkflowActivityInput,
  ProductionAnalysisWorkflowPersistenceActivityResult
} from '@appsea/contracts'
import type {
  PersistProductionCollectionWorkflowActivityInput,
  ProductionCollectionWorkflowCheckpointWrite,
  ProductionCollectionWorkflowCompletionInput,
  ProductionCollectionWorkflowJobInitializeInput,
  ProductionCollectionWorkflowPersistenceActivityResult,
  ProductionCollectionWorkflowTerminationInput
} from '@appsea/contracts'

export interface TerminateFixtureResearchActivityResult {
  state: 'completed' | 'failed' | 'canceled' | 'budget_rejected'
  reconciled: FixtureResearchPersistenceActivityResult | null
}

export interface TerminateProductionCollectionActivityResult {
  state: 'completed' | 'failed' | 'canceled' | 'budget_rejected'
  reconciled: ProductionCollectionWorkflowPersistenceActivityResult | null
}

export interface FixtureResearchActivities {
  initializeFixtureResearchJob(input: WorkflowJobInitializeInput): Promise<{ state: string }>
  inspectFixtureResearch(input: FixtureResearchWorkflowInput): Promise<FixtureResearchInspection>
  recordFixtureResearchCheckpoint(input: WorkflowJobCheckpointWrite): Promise<{ state: string }>
  persistFixtureResearch(
    input: PersistFixtureResearchActivityInput
  ): Promise<FixtureResearchPersistenceActivityResult>
  completeFixtureResearchJob(input: WorkflowJobCompletionInput): Promise<{ state: string }>
  terminateFixtureResearchJob(
    input: WorkflowJobTerminationInput
  ): Promise<TerminateFixtureResearchActivityResult>
}

export interface ProductionCollectionActivities {
  initializeProductionCollectionJob(
    input: ProductionCollectionWorkflowJobInitializeInput
  ): Promise<{ state: string }>
  recordProductionCollectionCheckpoint(
    input: ProductionCollectionWorkflowCheckpointWrite
  ): Promise<{ state: string }>
  persistProductionCollection(
    input: PersistProductionCollectionWorkflowActivityInput
  ): Promise<ProductionCollectionWorkflowPersistenceActivityResult>
  completeProductionCollectionJob(
    input: ProductionCollectionWorkflowCompletionInput
  ): Promise<{ state: string }>
  terminateProductionCollectionJob(
    input: ProductionCollectionWorkflowTerminationInput
  ): Promise<TerminateProductionCollectionActivityResult>
}

export interface ProductionAnalysisActivities {
  persistProductionAnalysis(
    input: PersistProductionAnalysisWorkflowActivityInput
  ): Promise<ProductionAnalysisWorkflowPersistenceActivityResult>
}
