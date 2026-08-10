# Coding-agent planning packages

## Purpose

A planning package lets a coding agent begin implementation without inventing the product, evidence, scope, architecture, or acceptance rules.

The package must remain useful outside AppSea.

## Package layout

```text
<opportunity_slug>_plan_package/
  README.md
  manifest.json
  executive_summary.md
  evidence/
    evidence_ledger.md
    complaints.csv
    complaint_clusters.json
    source_coverage.json
  research/
    problem_definition.md
    users_and_jobs.md
    competitor_landscape.md
    feature_matrix.csv
    contrary_evidence.md
    opportunity_score.json
  product/
    product_brief.md
    prd.md
    mvp_scope.md
    non_goals.md
    user_flows.md
    ui_direction.md
    data_and_integrations.md
    security_privacy.md
    monetization_distribution.md
  delivery/
    architecture.md
    data_model.md
    api_contract.md
    backlog.md
    task_graph.json
    acceptance_criteria.md
    test_plan.md
    risks_open_questions.md
    agent_instructions.md
  machine/
    opportunity.json
    plan.json
    tasks.json
    evidence_refs.json
    skill_requirements.json
    evaluation_requirements.json
```

## Manifest

The manifest records:

- package version
- opportunity identifier
- working name
- generated time
- evidence snapshot
- report version
- scoring version
- schema versions
- required files
- hashes
- source-coverage summary
- confidence
- approval state
- license and retention notes

## Version history and export representations

Plan package versions are immutable rows linked to their opportunity and
report. Private workspace routes expose up to 50 active versions per page and
return an opaque, workspace/opportunity/family-bound `planCursor` when older
metadata exists. A compatibility `truncated: true` is derived from either
family's next cursor; the UI exposes an older-page link. A comparison is metadata-only: sorted
portable paths, `added`/`removed`/`changed`/`unchanged` status, SHA-256 content
hashes, and UTF-8 byte counts. It never returns a second file body merely to
show a diff.

Approved JSON export remains the machine envelope. Approved Markdown export is
rendered on demand from the validated, redacted package and emits one ordered
Markdown bundle containing the six supported files, including the existing
`04-task-graph.json` as inert text. Approved `format=zip` export is the bounded
`appsea-export-bundle-v1`: a deterministic stored ZIP containing `README.md`,
`manifest.json`, `plan.json`, `plan.md`, and the six validated files under
`plan/`. Imported evidence and generated instructions remain file data and
cannot modify repository controls. This is not the complete 08_spec directory
layout; the richer evidence, research, product, and machine sections remain
visible package gaps. Production analysis report Markdown is persisted
separately as a `report-markdown` object for retention/deletion lineage; plan
Markdown and ZIP remain on-demand representations, not second persisted plan
objects.

## Product brief

The brief answers:

- who the first user is
- what job they are trying to complete
- what repeated failure exists
- what evidence supports it
- why current options fail
- what the proposed product does
- what makes the first version narrow
- what the product will not do
- what must be validated before investment grows

## PRD requirements

The PRD includes:

- goals
- non-goals
- user roles
- user journeys
- functional requirements
- non-functional requirements
- permissions
- failure states
- data lifecycle
- analytics events
- accessibility
- internationalization needs
- security and privacy
- acceptance criteria

Requirements use stable identifiers such as `FR-001`.

## Task graph

The machine task graph is a directed acyclic graph where possible.

Each task includes:

- task identifier
- title
- purpose
- requirements covered
- dependencies
- inputs
- outputs
- files or modules expected
- required skill identifiers
- permissions
- risk level
- tests
- acceptance criteria
- review type
- rollback notes

Example:

```json
{
  "task_id": "WEB-004",
  "title": "Build opportunity leaderboard query and table",
  "depends_on": ["DB-003", "API-005", "UI-002"],
  "requirements": ["FR-010"],
  "outputs": ["leaderboard route", "filter state", "table tests"],
  "risk_level": "medium",
  "review": "human_ui_review"
}
```

## Agent instructions

The package-specific `agent_instructions.md` tells the coding agent:

- what source specs to read
- what evidence is reliable
- which assumptions remain open
- what not to widen
- which integrations are approved
- which data sources are unavailable
- which UI reference to follow
- which tests must pass
- how to report gaps

It must not allow the agent to replace evidence-backed scope with a generic application template.

## Build readiness

A plan receives one of these readiness states:

| State            | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| Research only    | Evidence is useful, but product boundaries remain unclear                    |
| Validation ready | Experiments and interviews can begin                                         |
| Prototype ready  | A narrow non-production prototype can be built                               |
| MVP ready        | Core requirements, architecture, risks, and acceptance criteria are complete |
| Restricted       | Access, legal, trust, safety, or data issues block implementation            |

## Coding-agent interfaces

### Downloaded package

Best for repository initialization and offline review.

### REST API

Best for dashboards, automations, and CI integrations.

### MCP

Best for agents that need to browse opportunities, read artifacts, and request approved exports.

### CLI

Best for reproducible local workflows.

Suggested commands:

```text
appsea opportunities list
appsea opportunities show <id>
appsea reports export <id>
appsea plans export <id>
appsea plans validate <path>
appsea skills required <id>
```

## Machine contract rules

- JSON must validate against versioned schemas.
- Human and machine artifacts must refer to the same identifiers.
- Evidence references must resolve.
- Every task must map to requirements.
- Every requirement must map to acceptance criteria.
- Open questions must not be silently converted into facts.
- Restricted integrations must remain marked as blocked.
- A package update creates a new version.

## Planning quality gate

A plan is not MVP ready unless it includes:

- a narrow first user
- a clear core loop
- explicit non-goals
- full source and data dependencies
- competitor and substitute analysis
- user flows
- architecture and data model
- security and privacy requirements
- failure and recovery states
- complete acceptance criteria
- test plan
- task graph
- cost and operations considerations
- open questions and stop conditions
- source and evidence references

## Handoff to later app-building capability

A future AppSea build system can consume the same package.

That system should create a new execution layer rather than changing the research evidence. Build artifacts, code, screenshots, test results, and deployment records should link back to the immutable plan version that authorized them.
