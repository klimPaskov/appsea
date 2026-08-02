import { describe, expect, it } from 'vitest'
import { complaintAnalysisSchema, type ComplaintAnalysis } from '@appsea/contracts'
import {
  correctionPayloadFromDraft,
  draftFromAnalysis
} from './workspace/complaint-correction-form'

const analysis: ComplaintAnalysis = complaintAnalysisSchema.parse({
  complaintId: 'complaint:one',
  classification: 'complaint',
  complaintType: 'workflow_gap',
  problemStatement: 'Ownership disappears during handoff.',
  expectedOutcome: null,
  observedOutcome: 'The next shift repeats the work.',
  consequence: null,
  affectedWorkflow: 'Support handoff',
  workaround: null,
  featureMentions: ['handoff'],
  userSegmentHints: ['support'],
  severity: 3,
  recurrence: 'repeated',
  switchingIntent: 'possible',
  paymentSignal: 'weak',
  actionabilityProbability: 0.8,
  classificationConfidence: 0.9,
  entityConfidence: 0.7,
  manipulationRisk: 0,
  piiFlags: [],
  policyFlags: ['source-policy-representation-applied'],
  reviewState: 'unreviewed',
  extractionVersion: 'test-v1',
  derivation: {
    skillVersion: 'test-skill',
    modelVersion: 'test-model',
    promptVersion: 'none'
  },
  entities: {
    product: {
      entityType: 'product',
      surfaceText: 'TeamMail',
      canonicalName: 'TeamMail',
      confidence: 0.9,
      resolution: 'exact',
      evidence: 'source-field'
    },
    company: {
      entityType: 'company',
      surfaceText: 'Example Inc.',
      canonicalName: 'Example Inc.',
      confidence: 0.8,
      resolution: 'exact',
      evidence: 'source-field'
    },
    feature: {
      entityType: 'feature',
      surfaceText: 'handoff',
      canonicalName: 'handoff',
      confidence: 0.7,
      resolution: 'normalized',
      evidence: 'source-field'
    },
    substitutes: [],
    competitors: [],
    unresolvedTypes: ['substitute', 'competitor']
  }
})

describe('complaint correction form mapping', () => {
  it('round-trips stored derived fields without exposing source metadata', () => {
    const draft = draftFromAnalysis(analysis)
    const payload = correctionPayloadFromDraft(draft)

    expect(payload).toMatchObject({
      complaintType: 'workflow_gap',
      severity: 3,
      expectedOutcome: null,
      featureMentions: ['handoff'],
      piiFlags: []
    })
    expect(payload).not.toHaveProperty('policyFlags')
    expect(payload).not.toHaveProperty('extractionVersion')
    expect(payload.entities?.product.evidence).toBe('source-field')
  })

  it('normalizes optional text and duplicate list entries', () => {
    const draft = draftFromAnalysis(analysis)
    draft.expectedOutcome = '  '
    draft.featureMentions = 'handoff\nhandoff\nreassignment'
    draft.piiFlags = 'email\nemail'

    const payload = correctionPayloadFromDraft(draft)
    expect(payload.expectedOutcome).toBeNull()
    expect(payload.featureMentions).toEqual(['handoff', 'reassignment'])
    expect(payload.piiFlags).toEqual(['email'])
  })

  it('fails before the request for invalid required or bounded values', () => {
    const draft = draftFromAnalysis(analysis)
    draft.problemStatement = ''
    expect(() => correctionPayloadFromDraft(draft)).toThrow('Problem statement is required')

    draft.problemStatement = 'A valid problem'
    draft.severity = '6'
    expect(() => correctionPayloadFromDraft(draft)).toThrow('Severity must be between 0 and 5')
  })
})
