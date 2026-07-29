# Product requirements

## Goals

AppSea must turn scattered, noisy complaint evidence into a transparent and useful opportunity decision.

The product must support humans who inspect the research and coding agents that consume the result.

## User jobs

### Explore

- Find app ideas with current evidence
- Filter by category, user segment, platform, geography, language, build size, business model, and risk
- Compare several opportunities without opening every report

### Investigate

- Inspect complaint clusters and their source mix
- See which apps are affected
- Separate bugs, feature requests, pricing complaints, workflow gaps, support failures, and non-actionable anger
- Review representative evidence and contrary evidence
- Understand competitor gaps

### Decide

- Change scoring profile and weights
- Add human notes
- approve, watch, reject, or archive an opportunity
- record why a decision was made

### Plan

- Generate a deep report
- Generate a product plan
- Generate a coding-agent task graph
- export the package in Markdown and JSON
- version and compare plan changes

### Operate

- Configure sources and budgets
- see quotas and access status
- monitor research runs
- handle deletion events
- review skill proposals
- roll back models, prompts, or skills

## Functional requirements

### FR-001 Research campaigns

A user can create a campaign from one or more of these seeds:

- app name
- company or product family
- software category
- user segment
- workflow or job
- problem phrase
- competitor set
- source URL list
- imported evidence file

A campaign includes:

- languages
- geography when known
- time range
- source allowlist
- source budget
- model budget
- maximum evidence count
- refresh schedule
- exclusion terms
- sensitive-topic policy

### FR-002 Source registry

Each connector has a visible status:

- active
- approved but unconfigured
- pending approval
- licensed partner required
- owner-authorized import only
- technically unavailable
- policy blocked
- paused
- retired

The registry shows the reason and the last review date.

### FR-003 Ingestion

Connectors must support idempotent collection, cursors, retries, rate limits, deletion or expiry handling, source metadata, and cost accounting.

No item may enter analysis without a source-policy version.

### FR-004 Complaint detection

The system classifies whether an item contains a software-related problem.

Output must include:

- actionable problem probability
- target app or workflow
- complaint type
- severity
- user consequence
- requested outcome
- workaround
- switching intent
- payment or business-impact signal
- spam or manipulation risk
- model confidence
- evidence span offsets when content retention permits

### FR-005 Entity resolution

The system links evidence to canonical app, company, feature, integration, platform, and category entities.

Aliases, renamed products, acquired products, editions, web and mobile variants, and common misspellings must be supported.

Low-confidence mappings enter a review queue.

### FR-006 Complaint clustering

The system groups similar complaints without erasing meaningful differences by user segment, platform, environment, region, language, or workflow stage.

Each cluster has:

- canonical problem statement
- affected users
- affected apps
- dates
- sources
- unique author estimate
- severity distribution
- frequency and velocity
- workarounds
- desired outcomes
- representative evidence
- contrary evidence
- confidence

### FR-007 Competitor graph

For each candidate opportunity, the system identifies:

- direct competitors
- adjacent competitors
- platform-native features
- manual substitutes
- service businesses
- open-source alternatives
- spreadsheet or no-code workarounds
- discontinued products that reveal demand or access risk

Every competitor claim needs a source and observation date.

### FR-008 Opportunity synthesis

The system can propose one or more product concepts from a complaint cluster.

A proposal must state:

- the target user
- the job
- the unresolved problem
- the solution mechanism
- why existing options fail
- the narrowest useful MVP
- required data or platform dependencies
- likely monetization
- acquisition path
- major risks
- evidence confidence

### FR-009 Scoring

The system calculates and displays:

- raw score
- risk penalty
- risk-adjusted score
- confidence
- source coverage
- freshness
- score-model version
- input snapshot identifier

A user can inspect every component and apply saved scoring profiles.

### FR-010 Leaderboard

The leaderboard supports:

- full-text and semantic search
- sortable columns
- saved filters
- category and platform facets
- score-profile selection
- trend view
- confidence filter
- source-coverage filter
- risk filter
- build-size filter
- comparison selection
- pinned opportunities
- watchlists

### FR-011 Opportunity workspace

The detail page includes:

- executive summary
- score explanation
- research coverage
- complaint clusters
- evidence list
- app and competitor graph
- user and job map
- solution concept
- report versions
- plan versions
- workflow runs
- decision history
- export controls

### FR-012 Report generation

Reports follow `07_leaderboard_and_reports.md` and `08_coding_agent_plan_packages.md`.

Every report must be reproducible from an evidence snapshot and versioned configuration.

### FR-013 Coding-agent access

Coding agents can access approved artifacts through:

- REST API
- MCP resources and tools
- CLI export
- downloadable package

Read access is the default. Workflow-start tools require explicit permissions.

### FR-014 Human review

Users can:

- correct app mappings
- merge or split complaint clusters
- exclude spam
- mark an item as not actionable
- change opportunity status
- annotate assumptions
- add competitor evidence
- approve or reject a plan

Corrections are logged and can enter evaluation datasets subject to tenant policy.

### FR-015 Refresh and decay

Opportunities refresh on schedule or when signal changes.

The system must lower freshness and confidence when:

- sources stop updating
- connector access fails
- key evidence is deleted
- a competitor ships the missing feature
- complaint velocity falls
- a platform policy changes

### FR-016 Skill registry

The system stores skills, versions, permissions, evaluations, activation state, owner, and rollback target.

### FR-017 Operations

Operators can inspect:

- workflow health
- connector health
- quotas
- cost
- model errors
- drift
- deletion backlog
- skill failures
- source-policy review dates
- audit events

## Non-functional requirements

### Reliability

- Ingestion and workflow steps are idempotent.
- Long research jobs resume after process or network failure.
- Every run has a durable state and retry history.
- Duplicate delivery does not create duplicate evidence.

### Explainability

- Scores show inputs and weights.
- Model classifications show confidence and evidence links.
- Reports distinguish evidence, inference, assumption, and recommendation.

### Security

- Tenant data is isolated.
- Secrets do not enter prompts or logs.
- External content is isolated as untrusted data.
- Dangerous tools require narrowly scoped permissions.

### Privacy

- Store the minimum content needed.
- Redact direct identifiers where they are not needed.
- Honor deletion and retention policies.
- Private connected data never enters cross-tenant learning without explicit opt-in.

### Accessibility

- Target WCAG 2.2 AA for the web application.
- All major actions work by keyboard.
- Tables have accessible alternatives on narrow screens.
- Score colors always have text labels.

### Performance

- The leaderboard should return common filtered views from indexed snapshots.
- Long research runs are asynchronous and do not block interactive requests.
- Evidence pages use pagination and server-side filtering.

### Portability

- Human-facing plans use Markdown.
- Machine-facing plans use versioned JSON Schemas.
- Exports do not depend on the AppSea UI.

## MVP acceptance

The MVP is acceptable when a user can:

1. Configure at least three approved source connectors and import a file.
2. Run a campaign around a software category or seed app.
3. Review complaint classifications and entity mappings.
4. See clustered problems with provenance.
5. See direct competitors and substitutes with evidence.
6. View a leaderboard with explainable scores and confidence.
7. Open an opportunity and inspect its evidence list.
8. Generate a complete report and coding-agent plan package.
9. Export the package as Markdown and JSON.
10. Read the package through an authenticated MCP server.
11. Review workflow, cost, source, and audit history.
12. Demonstrate that a prompt-injection test item cannot change agent behavior.
13. Demonstrate that a disabled connector cannot run.
14. Demonstrate rollback of a skill or scoring version.
