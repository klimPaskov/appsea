import {
  opportunityReportSchema,
  planPackageSchema,
  type OpportunityReport,
  type PlanPackage
} from '@appsea/contracts'
import { hashPlanPackageFileContent } from './plan-comparison'

/**
 * Encode source-derived values as JSON data before placing them in Markdown.
 *
 * Report and plan payloads can contain hostile text (for example a complaint
 * that begins with a Markdown heading or contains a link). JSON escaping keeps
 * newlines and delimiters on the data side of the document while retaining a
 * deterministic, inspectable representation for reviewers.
 */
function inertValue(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) return 'null'
  return encoded
    .replaceAll('`', '\\`')
    .replaceAll('*', '\\*')
    .replaceAll('_', '\\_')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('<', '\\<')
    .replaceAll('>', '\\>')
}

function markdownFence(content: string): string {
  let longestRun = 0
  let currentRun = 0
  for (const character of content) {
    if (character === '`') {
      currentRun += 1
      longestRun = Math.max(longestRun, currentRun)
    } else {
      currentRun = 0
    }
  }
  return '`'.repeat(Math.max(3, longestRun + 1))
}

function representationDisclosure(report: OpportunityReport): string[] {
  const lines = [
    '## Disclosure',
    `- Synthetic fixture: ${report.synthetic ? 'yes' : 'no'}`,
    `- Test-only analysis: ${report.testOnly ? 'yes' : 'no'}`
  ]
  if (report.transport !== null) lines.push(`- Transport: ${inertValue(report.transport)}`)
  if (report.synthetic) {
    lines.push(
      '- Fixture data is synthetic and proves package shape only; it is not market evidence.'
    )
  }
  if (report.testOnly) {
    lines.push(
      '- This report came from a test-only analysis path and cannot support market claims.'
    )
  }
  return lines
}

/**
 * Render a validated opportunity report as deterministic Markdown.
 *
 * Dynamic values are emitted as escaped JSON data. In particular, an imported
 * excerpt never becomes a heading, link, list item, or executable instruction.
 * Excerpts are included only when the source policy permits `excerpt` or
 * `fixture` representation.
 */
export function renderOpportunityReportMarkdown(reportInput: OpportunityReport): string {
  const report = opportunityReportSchema.parse(reportInput)
  const lines = [
    '# Opportunity report',
    `- Report ID: ${inertValue(report.artifactId)}`,
    `- Schema version: ${inertValue(report.schemaVersion)}`,
    `- Generated at: ${inertValue(report.generatedAt)}`,
    ...representationDisclosure(report),
    '',
    '## Opportunity',
    `- Name: ${inertValue(report.opportunity.name)}`,
    `- Slug: ${inertValue(report.opportunity.slug)}`,
    `- Thesis: ${inertValue(report.opportunity.thesis)}`,
    `- Audience: ${inertValue(report.opportunity.audience)}`,
    `- First wedge: ${inertValue(report.opportunity.firstWedge)}`,
    '',
    '## Evidence',
    `- Retained observations: ${report.evidence.complaintCount}`,
    `- Complaint clusters: ${report.evidence.clusterCount}`,
    `- Observation records rendered: ${report.evidence.observations.length}`,
    ''
  ]

  if (report.evidence.observations.length > 0) {
    lines.push('### Observations')
    report.evidence.observations.forEach((observation, index) => {
      lines.push(
        `#### Observation ${index + 1}`,
        `- Evidence ID: ${inertValue(observation.evidenceId)}`,
        `- Source ID: ${inertValue(observation.sourceId)}`,
        `- Source record: ${inertValue(observation.sourceRecordId)}`,
        `- Query: ${inertValue(observation.query)}`,
        `- Representation: ${inertValue(observation.allowedRepresentation)}`,
        `- Redacted: ${observation.redacted ? 'yes' : 'no'}`,
        `- Captured at: ${inertValue(observation.capturedAt)}`,
        `- Published at: ${inertValue(observation.publishedAt)}`,
        `- Synthetic: ${observation.synthetic ? 'yes' : 'no'}`,
        `- Product: ${inertValue(observation.product)}`,
        `- Feature: ${inertValue(observation.feature)}`,
        `- Category: ${inertValue(observation.category)}`
      )
      if (observation.analysis !== null) {
        lines.push(`- Analysis: ${inertValue(observation.analysis)}`)
      }
      if (
        observation.excerpt !== null &&
        (observation.allowedRepresentation === 'excerpt' ||
          observation.allowedRepresentation === 'fixture')
      ) {
        lines.push(`- Allowed excerpt: ${inertValue(observation.excerpt)}`)
      } else {
        lines.push('- Allowed excerpt: not displayed under the source representation policy')
      }
      if (observation.canonicalLocator !== null) {
        lines.push(`- Canonical locator: ${inertValue(observation.canonicalLocator)}`)
      }
      lines.push('')
    })
  }

  if (report.evidence.clusters.length > 0) {
    lines.push('### Complaint clusters')
    report.evidence.clusters.forEach((cluster) => {
      lines.push(
        `- ${inertValue(cluster.id)}: ${inertValue(cluster.title)} — ${inertValue(cluster.summary)} (confidence ${cluster.confidence.toFixed(2)})`
      )
    })
    lines.push('')
  }

  if (report.evidence.clusters.length > 0) {
    for (const cluster of report.evidence.clusters) {
      lines.push(`  - Complaint IDs: ${inertValue(cluster.complaintIds)}`)
    }
  }

  if (report.evidence.deduplication.length > 0) {
    lines.push('### Deduplication decisions')
    for (const decision of report.evidence.deduplication) {
      lines.push(
        `- ${inertValue(decision.complaintId)} → ${inertValue(decision.canonicalComplaintId)}; relation=${inertValue(decision.relation)}; decision=${inertValue(decision.decision)}; similarity=${decision.similarity.toFixed(2)}; review=${decision.reviewRequired ? 'required' : 'not required'}; reason=${inertValue(decision.reason)}`
      )
    }
    lines.push('')
  }

  lines.push(
    '## Inference',
    `- Confidence: ${inertValue(report.inference.confidence)}`,
    `- Score snapshot: ${inertValue(report.inference.scoreSnapshot)}`,
    '- Rationale:'
  )
  for (const rationale of report.inference.rationale) lines.push(`  - ${inertValue(rationale)}`)
  lines.push('- Contrary evidence:')
  if (report.inference.contraryEvidence.length === 0) {
    lines.push('  - None recorded.')
  } else {
    for (const item of report.inference.contraryEvidence) lines.push(`  - ${inertValue(item)}`)
  }

  lines.push(
    '',
    '## Recommendation',
    `- Decision: ${inertValue(report.recommendation.decision)}`,
    `- First wedge: ${inertValue(report.recommendation.firstWedge)}`,
    '- Next steps:'
  )
  for (const nextStep of report.recommendation.nextSteps) lines.push(`  - ${inertValue(nextStep)}`)

  if (report.competitiveResearch) {
    lines.push('', '## Competitive research', '- Coverage gaps:')
    if (report.competitiveResearch.coverageGaps.length === 0) {
      lines.push('  - None recorded.')
    } else {
      for (const gap of report.competitiveResearch.coverageGaps) {
        lines.push(`  - ${inertValue(gap)}`)
      }
    }
    if (report.competitiveResearch.observations.length > 0) {
      lines.push('- Observations:')
      for (const observation of report.competitiveResearch.observations) {
        lines.push(
          `  - ${inertValue(observation.observationId)}; competitor=${inertValue(observation.competitorName)}; type=${inertValue(observation.competitorType)}; claim type=${inertValue(observation.claimType)}; representation=${inertValue(observation.allowedRepresentation)}; confidence=${observation.confidence.toFixed(2)}`
        )
        if (
          observation.allowedRepresentation === 'excerpt' ||
          (observation.allowedRepresentation as string) === 'fixture'
        ) {
          lines.push(`    - Allowed claim: ${inertValue(observation.claim)}`)
        } else {
          lines.push('    - Allowed claim: not displayed under the source representation policy')
        }
        lines.push(
          `    - Source: ${inertValue(observation.sourceId)}; record=${inertValue(observation.sourceRecordId)}; evidence=${inertValue(observation.evidenceId)}; captured=${inertValue(observation.capturedAt)}; published=${inertValue(observation.publishedAt)}`
        )
        if (observation.canonicalLocator !== null) {
          lines.push(`    - Canonical locator: ${inertValue(observation.canonicalLocator)}`)
        }
      }
    }
  }

  lines.push('', '## Coverage', '- Gaps:')
  if (report.coverage.gaps.length === 0) {
    lines.push('  - None recorded.')
  } else {
    for (const gap of report.coverage.gaps) lines.push(`  - ${inertValue(gap)}`)
  }
  for (const source of report.coverage.sources) {
    lines.push(
      `- Source ${inertValue(source.sourceId)}: ${inertValue(source.displayName)}; policy=${inertValue(source.policyState)}; display=${inertValue(source.displayMode)}; observations=${source.observationCount}; synthetic=${source.synthetic ? 'yes' : 'no'}`
    )
    for (const note of source.coverageNotes) lines.push(`  - Coverage note: ${inertValue(note)}`)
  }

  if (report.qualitySnapshot || report.inference.qualitySnapshot) {
    lines.push(
      '',
      '## Quality evidence',
      `- Snapshot: ${inertValue(report.qualitySnapshot ?? report.inference.qualitySnapshot)}`
    )
  }

  if (report.warnings.length > 0) {
    lines.push('', '## Warnings')
    for (const warning of report.warnings) lines.push(`- ${inertValue(warning)}`)
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}

function sortedFiles(planPackage: PlanPackage): PlanPackage['files'] {
  return [...planPackage.files].sort((left, right) =>
    left.path === right.path ? 0 : left.path < right.path ? -1 : 1
  )
}

/**
 * Render every plan file in a deterministic, policy-neutral Markdown envelope.
 * File bodies stay inside a dynamically-sized code fence so imported content
 * cannot alter the surrounding Markdown structure.
 */
export function renderPlanPackageMarkdown(planPackageInput: PlanPackage): string {
  const planPackage = planPackageSchema.parse(planPackageInput)
  const lines = [
    '# Coding-agent plan package',
    `- Opportunity slug: ${inertValue(planPackage.opportunitySlug)}`,
    `- Generated at: ${inertValue(planPackage.generatedAt)}`,
    `- Files: ${planPackage.files.length}`,
    '',
    '## Files'
  ]

  for (const file of sortedFiles(planPackage)) {
    const fence = markdownFence(file.content)
    const bytes = new TextEncoder().encode(file.content).byteLength
    lines.push(
      '',
      `### ${inertValue(file.path)}`,
      `- UTF-8 bytes: ${bytes}`,
      `- SHA-256: ${hashPlanPackageFileContent(file.content)}`,
      `- Content is rendered as inert source data:`,
      `${fence}text`,
      // Keep every imported line indented even inside the fence. This makes
      // the safety property obvious to simple Markdown consumers that inspect
      // lines without implementing full fenced-code parsing.
      file.content
        .split('\n')
        .map((line) => ` ${line}`)
        .join('\n'),
      fence
    )
  }

  return `${lines.join('\n').trimEnd()}\n`
}
