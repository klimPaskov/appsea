import type { Complaint, Competitor, Opportunity, ScoreFactors } from '@appsea/contracts'
import { complaintSchema, opportunitySchema } from '@appsea/contracts'
import { calculateOpportunityScore } from '@appsea/scoring'

const calculatedAt = '2026-07-10T00:00:00.000Z'
const capturedAt = '2026-07-09T18:00:00.000Z'

function fixtureFeature(
  feature: string,
  status: 'supported' | 'partial' | 'missing' | 'unknown',
  notes: string
): Competitor['featureMatrix'][number] {
  return {
    feature,
    status,
    evidenceBasis: 'fixture',
    observationIds: [],
    notes
  }
}

function complaint(
  id: string,
  product: string,
  company: string,
  feature: string,
  category: string,
  text: string
): Complaint {
  return complaintSchema.parse({
    id,
    sourceId: 'fixture-community-feed',
    sourceRecordId: `fixture-${id}`,
    capturedAt,
    publishedAt: '2026-07-08T12:00:00.000Z',
    query: `${product} ${category} complaint`,
    product,
    company,
    feature,
    category,
    text,
    language: 'en',
    synthetic: true,
    redacted: false,
    allowedRepresentation: 'fixture'
  })
}

export const seedComplaints: Complaint[] = [
  complaint(
    'cmp-inbox-1',
    'TeamMail',
    'Synthetic Mail Co',
    'shared inbox assignment',
    'handoff loss',
    'Synthetic example: assigned messages disappear from the team view after ownership changes.'
  ),
  complaint(
    'cmp-inbox-2',
    'TeamMail',
    'Synthetic Mail Co',
    'conversation history',
    'handoff loss',
    'Synthetic example: a teammate cannot see why a conversation was reassigned or what happened before.'
  ),
  complaint(
    'cmp-inbox-3',
    'SupportBox',
    'Fixture Support Inc',
    'status sync',
    'state drift',
    'Synthetic example: solved threads return as unread and create duplicate work for the next shift.'
  ),
  complaint(
    'cmp-inbox-4',
    'SupportBox',
    'Fixture Support Inc',
    'audit trail',
    'accountability gap',
    'Synthetic example: the team cannot tell who changed an owner, status, or priority during a busy handoff.'
  ),
  complaint(
    'cmp-receipt-1',
    'ExpenseCloud',
    'Synthetic Finance Co',
    'receipt matching',
    'missing receipts',
    'Synthetic example: card transactions remain unmatched even after the receipt was forwarded by email.'
  ),
  complaint(
    'cmp-receipt-2',
    'ExpenseCloud',
    'Synthetic Finance Co',
    'mobile upload',
    'capture failure',
    'Synthetic example: mobile uploads look successful but the receipt is not attached to the transaction.'
  ),
  complaint(
    'cmp-receipt-3',
    'BookDesk',
    'Fixture Books Ltd',
    'accounting export',
    'reconciliation work',
    'Synthetic example: month-end requires manually hunting for receipts across email, chat, and folders.'
  ),
  complaint(
    'cmp-subscription-1',
    'SpendView',
    'Synthetic Spend Co',
    'subscription detection',
    'hidden renewals',
    'Synthetic example: a renewal is discovered only after the annual charge appears on the statement.'
  ),
  complaint(
    'cmp-subscription-2',
    'SpendView',
    'Synthetic Spend Co',
    'owner mapping',
    'unknown owner',
    'Synthetic example: finance can see a recurring charge but cannot find the employee who owns it.'
  ),
  complaint(
    'cmp-subscription-3',
    'CardAdmin',
    'Fixture Card Inc',
    'cancellation workflow',
    'cancellation friction',
    'Synthetic example: cancelling a tool requires several messages because the original buyer has left.'
  ),
  complaint(
    'cmp-memory-1',
    'AgentDesk',
    'Synthetic Agent Co',
    'project context',
    'context loss',
    'Synthetic example: every new coding session repeats architecture questions already answered in prior work.'
  ),
  complaint(
    'cmp-memory-2',
    'AgentDesk',
    'Synthetic Agent Co',
    'handoff notes',
    'stale handoff',
    'Synthetic example: handoff files grow large and contradict the code after several agent sessions.'
  ),
  complaint(
    'cmp-memory-3',
    'CodePilot',
    'Fixture Code Labs',
    'decision recall',
    'decision rediscovery',
    'Synthetic example: a coding agent reopens a rejected approach because the reason was never indexed.'
  ),
  complaint(
    'cmp-form-1',
    'FormFlow',
    'Synthetic Forms Co',
    'conditional logic',
    'invisible failure',
    'Synthetic example: a form branch fails only for one answer combination and the builder gives no trace.'
  ),
  complaint(
    'cmp-form-2',
    'FormFlow',
    'Synthetic Forms Co',
    'webhook delivery',
    'delivery uncertainty',
    'Synthetic example: a webhook did not arrive and there is no replayable event history.'
  ),
  complaint(
    'cmp-form-3',
    'SurveyKit',
    'Fixture Survey Ltd',
    'field validation',
    'validation mismatch',
    'Synthetic example: preview validation differs from the published form and blocks real submissions.'
  ),
  complaint(
    'cmp-decision-1',
    'WorkChat',
    'Synthetic Chat Co',
    'decision capture',
    'decision loss',
    'Synthetic example: a key product decision is buried in a long channel and cannot be found later.'
  ),
  complaint(
    'cmp-decision-2',
    'ProjectBoard',
    'Fixture Project Inc',
    'rationale history',
    'missing rationale',
    'Synthetic example: a task records what changed but not why the team chose that direction.'
  ),
  complaint(
    'cmp-decision-3',
    'WorkChat',
    'Synthetic Chat Co',
    'follow-up tracking',
    'unowned follow-up',
    'Synthetic example: decisions have no owner, review date, or link to the work that should follow.'
  )
]

const competitors: Record<string, Competitor[]> = {
  'inbox-relay': [
    {
      name: 'Shared inbox suites',
      type: 'direct',
      positioning: 'Full support and team email platforms',
      strengths: ['Broad channel support', 'Mature routing'],
      weaknesses: ['Complex setup', 'Weak handoff reasoning', 'Expensive for small teams'],
      relatedComplaintCategories: ['handoff loss', 'state drift'],
      featureMatrix: [
        fixtureFeature('Handoff history', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Ownership audit trail', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Cross-shift summary', 'missing', 'Synthetic comparison only.')
      ]
    },
    {
      name: 'Email labels and rules',
      type: 'platform',
      positioning: 'Native organization inside a mail provider',
      strengths: ['Already available', 'Low setup cost'],
      weaknesses: ['No durable ownership history', 'Hard to audit across shifts'],
      relatedComplaintCategories: ['accountability gap'],
      featureMatrix: [
        fixtureFeature('Handoff history', 'missing', 'Synthetic comparison only.'),
        fixtureFeature('Routing rules', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Cross-shift summary', 'missing', 'Synthetic comparison only.')
      ]
    },
    {
      name: 'Shift handoff document',
      type: 'workaround',
      positioning: 'Manual summary maintained by the team',
      strengths: ['Flexible', 'No integration needed'],
      weaknesses: ['Becomes stale', 'Duplicates the inbox', 'Relies on discipline'],
      relatedComplaintCategories: ['handoff loss'],
      featureMatrix: [
        fixtureFeature('Handoff summary', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Live state sync', 'missing', 'Synthetic comparison only.'),
        fixtureFeature('Audit trail', 'missing', 'Synthetic comparison only.')
      ]
    }
  ],
  'receipt-vault': [
    {
      name: 'Expense management platforms',
      type: 'direct',
      positioning: 'Cards, approvals, and receipt capture in one suite',
      strengths: ['Integrated financial controls', 'Established accounting exports'],
      weaknesses: ['Receipt recovery remains manual', 'High switching cost'],
      relatedComplaintCategories: ['missing receipts', 'reconciliation work'],
      featureMatrix: [
        fixtureFeature('Receipt capture', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Transaction matching', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Recovery workflow', 'partial', 'Synthetic comparison only.')
      ]
    },
    {
      name: 'Accounting inbox',
      type: 'adjacent',
      positioning: 'Forward receipts into an accounting workspace',
      strengths: ['Simple behavior', 'Works with existing email'],
      weaknesses: ['Weak transaction matching', 'Poor employee follow-up'],
      relatedComplaintCategories: ['missing receipts'],
      featureMatrix: [
        fixtureFeature('Receipt forwarding', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Transaction matching', 'missing', 'Synthetic comparison only.'),
        fixtureFeature('Follow-up ownership', 'missing', 'Synthetic comparison only.')
      ]
    }
  ],
  'subscription-auditor': [
    {
      name: 'Spend management suites',
      type: 'direct',
      positioning: 'Central spend control and card administration',
      strengths: ['Transaction access', 'Policy controls'],
      weaknesses: ['Weak product usage evidence', 'Owner mapping depends on clean data'],
      relatedComplaintCategories: ['hidden renewals', 'unknown owner'],
      featureMatrix: [
        fixtureFeature('Renewal inventory', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Usage signals', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Owner mapping', 'partial', 'Synthetic comparison only.')
      ]
    },
    {
      name: 'Spreadsheet renewal calendar',
      type: 'workaround',
      positioning: 'Manually tracked renewal dates and owners',
      strengths: ['Cheap', 'Custom'],
      weaknesses: ['Stale quickly', 'Misses shadow subscriptions'],
      relatedComplaintCategories: ['hidden renewals'],
      featureMatrix: [
        fixtureFeature('Renewal calendar', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Shadow subscription detection', 'missing', 'Synthetic comparison only.'),
        fixtureFeature('Reminder automation', 'partial', 'Synthetic comparison only.')
      ]
    }
  ],
  'handoff-memory': [
    {
      name: 'Repository documentation',
      type: 'adjacent',
      positioning: 'Markdown instructions and architecture notes',
      strengths: ['Version controlled', 'Reviewable'],
      weaknesses: ['Hard to keep current', 'Weak retrieval across sessions'],
      relatedComplaintCategories: ['context loss', 'stale handoff'],
      featureMatrix: [
        fixtureFeature('Version history', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Semantic retrieval', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Review workflow', 'missing', 'Synthetic comparison only.')
      ]
    },
    {
      name: 'Agent memory products',
      type: 'direct',
      positioning: 'Persistent memories for long-running assistants',
      strengths: ['Automated recall', 'Cross-session continuity'],
      weaknesses: ['Can store low-quality facts', 'Often lacks repository review workflow'],
      relatedComplaintCategories: ['decision rediscovery'],
      featureMatrix: [
        fixtureFeature('Cross-session recall', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Repository grounding', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Approval workflow', 'missing', 'Synthetic comparison only.')
      ]
    }
  ],
  'form-debugger': [
    {
      name: 'Form builder logs',
      type: 'platform',
      positioning: 'Basic submission and webhook history',
      strengths: ['Close to the source', 'No extra integration'],
      weaknesses: ['Limited traces', 'Weak replay and condition visualization'],
      relatedComplaintCategories: ['invisible failure', 'delivery uncertainty'],
      featureMatrix: [
        fixtureFeature('Submission history', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Delivery trace', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Replay controls', 'missing', 'Synthetic comparison only.')
      ]
    },
    {
      name: 'General observability tools',
      type: 'adjacent',
      positioning: 'Application logs and event tracing',
      strengths: ['Powerful diagnostics', 'Flexible'],
      weaknesses: ['Too technical for form operators', 'Requires custom instrumentation'],
      relatedComplaintCategories: ['delivery uncertainty'],
      featureMatrix: [
        fixtureFeature('Event traces', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Form-specific diagnosis', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('No-code replay', 'missing', 'Synthetic comparison only.')
      ]
    }
  ],
  'decision-ledger': [
    {
      name: 'Project management tools',
      type: 'adjacent',
      positioning: 'Tasks, comments, and project history',
      strengths: ['Already used by teams', 'Links to delivery work'],
      weaknesses: ['Decisions remain mixed with discussion', 'Rationale is inconsistent'],
      relatedComplaintCategories: ['missing rationale', 'unowned follow-up'],
      featureMatrix: [
        fixtureFeature('Task links', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Rationale history', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Decision review cadence', 'missing', 'Synthetic comparison only.')
      ]
    },
    {
      name: 'Architecture decision records',
      type: 'workaround',
      positioning: 'Structured decisions stored in a repository',
      strengths: ['Clear history', 'Version controlled'],
      weaknesses: ['Mostly technical', 'Manual adoption burden'],
      relatedComplaintCategories: ['decision loss'],
      featureMatrix: [
        fixtureFeature('Rationale history', 'supported', 'Synthetic comparison only.'),
        fixtureFeature('Follow-up ownership', 'partial', 'Synthetic comparison only.'),
        fixtureFeature('Nontechnical adoption', 'missing', 'Synthetic comparison only.')
      ]
    }
  ]
}

interface OpportunityInput {
  id: string
  slug: string
  name: string
  oneLine: string
  thesis: string
  audience: string
  firstWedge: string
  complaintCount: number
  complaintIds: string[]
  tags: string[]
  contraryEvidence: string[]
  factors: ScoreFactors
}

function opportunity(input: OpportunityInput): Opportunity {
  return opportunitySchema.parse({
    ...input,
    synthetic: true,
    competitors: competitors[input.slug] ?? [],
    scoreSnapshot: calculateOpportunityScore(input.factors, calculatedAt),
    planFiles: [
      'README.md',
      '01-product-brief.md',
      '02-mvp-scope.md',
      '03-architecture.md',
      '04-task-graph.json',
      '05-validation.md'
    ]
  })
}

export const seedOpportunities: Opportunity[] = [
  opportunity({
    id: 'opp-inbox-relay',
    slug: 'inbox-relay',
    name: 'Inbox Relay',
    oneLine: 'A reliable handoff layer for shared team inboxes.',
    thesis:
      'Small support and operations teams need a clear ownership trail and shift handoff without adopting a large service platform.',
    audience: 'Small support, customer success, and operations teams using shared email.',
    firstWedge:
      'Read-only inbox sync with ownership history, unresolved handoff queue, and shift summary.',
    complaintCount: 482,
    complaintIds: ['cmp-inbox-1', 'cmp-inbox-2', 'cmp-inbox-3', 'cmp-inbox-4'],
    tags: ['team email', 'support operations', 'handoff'],
    contraryEvidence: [
      'Many teams can solve the problem by configuring an existing shared inbox suite.',
      'Email provider APIs and permissions may limit reliable state synchronization.'
    ],
    factors: {
      complaintVolume: 91,
      painSeverity: 86,
      recurrence: 88,
      willingnessToPay: 72,
      competitiveGap: 78,
      buildFeasibility: 80,
      evidenceQuality: 76,
      contraryEvidencePenalty: 25
    }
  }),
  opportunity({
    id: 'opp-receipt-vault',
    slug: 'receipt-vault',
    name: 'Receipt Vault',
    oneLine: 'Automatic receipt recovery and transaction matching for small finance teams.',
    thesis:
      'Finance teams need a narrow recovery layer that finds missing receipts across existing channels and proves the match.',
    audience: 'Bookkeepers, operations leads, and small finance teams.',
    firstWedge: 'Email and upload intake, transaction matching, and an owner follow-up queue.',
    complaintCount: 371,
    complaintIds: ['cmp-receipt-1', 'cmp-receipt-2', 'cmp-receipt-3'],
    tags: ['finance operations', 'receipts', 'reconciliation'],
    contraryEvidence: [
      'Major expense suites are improving automatic receipt collection.',
      'Bank and card data access can increase integration cost.'
    ],
    factors: {
      complaintVolume: 82,
      painSeverity: 84,
      recurrence: 83,
      willingnessToPay: 78,
      competitiveGap: 69,
      buildFeasibility: 72,
      evidenceQuality: 74,
      contraryEvidencePenalty: 30
    }
  }),
  opportunity({
    id: 'opp-subscription-auditor',
    slug: 'subscription-auditor',
    name: 'Subscription Auditor',
    oneLine: 'Find renewals, owners, and cancellation risk before software charges recur.',
    thesis:
      'Smaller companies need a focused subscription inventory that explains ownership and renewal action without a full spend platform.',
    audience: 'Finance and operations teams at small and mid-sized companies.',
    firstWedge:
      'Statement import, recurring charge detection, owner resolution, and renewal calendar.',
    complaintCount: 296,
    complaintIds: ['cmp-subscription-1', 'cmp-subscription-2', 'cmp-subscription-3'],
    tags: ['saas spend', 'renewals', 'finance'],
    contraryEvidence: [
      'The market already contains many spend and subscription tools.',
      'Reliable cancellation still requires vendor-specific processes.'
    ],
    factors: {
      complaintVolume: 76,
      painSeverity: 78,
      recurrence: 80,
      willingnessToPay: 82,
      competitiveGap: 58,
      buildFeasibility: 75,
      evidenceQuality: 70,
      contraryEvidencePenalty: 41
    }
  }),
  opportunity({
    id: 'opp-handoff-memory',
    slug: 'handoff-memory',
    name: 'Handoff Memory',
    oneLine: 'Repository memory and decision recall for long-running coding-agent work.',
    thesis:
      'Coding teams need a reviewable memory layer that keeps current state, decisions, and reusable lessons aligned with the repository.',
    audience: 'Teams using coding agents for multi-session implementation.',
    firstWedge:
      'Markdown memory, local search index, stale-context checks, and structured resume packets.',
    complaintCount: 244,
    complaintIds: ['cmp-memory-1', 'cmp-memory-2', 'cmp-memory-3'],
    tags: ['coding agents', 'memory', 'developer tools'],
    contraryEvidence: [
      'Coding agents and editors are adding native memory features.',
      'Poorly curated memory can increase context noise.'
    ],
    factors: {
      complaintVolume: 70,
      painSeverity: 73,
      recurrence: 82,
      willingnessToPay: 65,
      competitiveGap: 71,
      buildFeasibility: 86,
      evidenceQuality: 68,
      contraryEvidencePenalty: 34
    }
  }),
  opportunity({
    id: 'opp-form-debugger',
    slug: 'form-debugger',
    name: 'Form Debugger',
    oneLine: 'Trace, replay, and explain failures in no-code forms.',
    thesis:
      'Form operators need a human-readable execution trace for conditional logic, validation, and outbound delivery.',
    audience: 'Operations and marketing teams running complex forms without developers.',
    firstWedge:
      'Submission trace, conditional path view, webhook replay, and difference detection between preview and live forms.',
    complaintCount: 203,
    complaintIds: ['cmp-form-1', 'cmp-form-2', 'cmp-form-3'],
    tags: ['forms', 'no-code', 'debugging'],
    contraryEvidence: [
      'Form vendors can add better built-in logs.',
      'Supporting many builders may create a fragmented integration surface.'
    ],
    factors: {
      complaintVolume: 66,
      painSeverity: 75,
      recurrence: 69,
      willingnessToPay: 64,
      competitiveGap: 75,
      buildFeasibility: 68,
      evidenceQuality: 66,
      contraryEvidencePenalty: 37
    }
  }),
  opportunity({
    id: 'opp-decision-ledger',
    slug: 'decision-ledger',
    name: 'Decision Ledger',
    oneLine: 'Capture decisions, reasons, owners, and review dates from team conversations.',
    thesis:
      'Teams need a lightweight decision record that connects chat discussion to delivery work without forcing a separate documentation habit.',
    audience: 'Product, engineering, and operations teams using chat and project tools.',
    firstWedge:
      'Decision capture, rationale template, owner and review date, and links to source discussion and tasks.',
    complaintCount: 187,
    complaintIds: ['cmp-decision-1', 'cmp-decision-2', 'cmp-decision-3'],
    tags: ['team decisions', 'knowledge management', 'collaboration'],
    contraryEvidence: [
      'Teams may resist another documentation workflow.',
      'Chat and project platforms can add native decision objects.'
    ],
    factors: {
      complaintVolume: 61,
      painSeverity: 68,
      recurrence: 76,
      willingnessToPay: 58,
      competitiveGap: 64,
      buildFeasibility: 84,
      evidenceQuality: 63,
      contraryEvidencePenalty: 43
    }
  })
].sort((a, b) => {
  const scoreDifference = b.scoreSnapshot.score - a.scoreSnapshot.score
  if (scoreDifference !== 0) return scoreDifference
  const countDifference = b.complaintCount - a.complaintCount
  if (countDifference !== 0) return countDifference
  return a.slug.localeCompare(b.slug)
})

export function getOpportunity(slug: string): Opportunity | undefined {
  return seedOpportunities.find((entry) => entry.slug === slug)
}

export function getOpportunityComplaints(opportunity: Opportunity): Complaint[] {
  const ids = new Set(opportunity.complaintIds)
  return seedComplaints.filter((entry) => ids.has(entry.id))
}
