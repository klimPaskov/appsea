# Research pipeline

## Purpose

The research pipeline turns source material into a reviewed opportunity without confusing volume with demand or negative sentiment with a buildable problem.

## Pipeline stages

### 1. Campaign design

A campaign defines the research question before collection begins.

Required fields:

- campaign goal
- seed entities or problem phrases
- user segments
- category boundaries
- geography and language scope
- time range
- source allowlist
- source and model budgets
- exclusions
- refresh policy
- minimum evidence gate
- stop conditions

The query planner expands seeds into:

- app names and aliases
- competitor names
- workflow terms
- complaint phrases
- feature-request phrases
- switching phrases
- workaround phrases
- error and failure phrases
- pricing and billing phrases
- integration phrases
- accessibility phrases
- performance phrases
- privacy and trust phrases
- desired outcome phrases

Queries must be source-specific. A query that works on web search may perform poorly on a firehose, issue tracker, or comment API.

### 2. Source eligibility check

Before a connector runs, the orchestrator checks:

- connector status
- allowed purpose
- tenant permission
- credential state
- region restrictions
- quota
- retention policy
- deletion duties
- campaign compatibility
- current source-policy version

The run stops for that source when any check fails. Other eligible sources may continue.

### 3. Discovery and collection

Collection has two modes.

#### Seeded collection

Starts from named apps, companies, categories, or URLs.

#### Exploratory collection

Scans permitted public streams, issue trackers, or search results for software-problem language, then resolves candidate entities.

Every collected item receives an immutable source envelope before analysis.

### 4. Raw evidence handling

Raw source records live in a restricted evidence vault.

The vault stores only what the source policy permits. A source may require link-only storage, short excerpts, expiry, deletion synchronization, or no long-term raw content.

The raw item is never inserted directly into a model prompt. It first passes content-type validation, malware controls for files, HTML cleaning, Unicode normalization, and prompt-injection isolation.

### 5. Normalization

Normalization creates a safe analysis record:

- normalized text
- original language
- detected language
- optional translated text
- timestamps
- source context
- engagement values when permitted
- author pseudonym or hashed source identity when allowed
- content hashes
- extracted URLs
- code or log blocks
- PII flags
- policy labels

### 6. Deduplication

Use several layers:

1. exact source identifier
2. exact content hash
3. normalized text hash
4. quoted or reposted-content match
5. near-duplicate embedding match
6. same-author same-thread repetition
7. campaign overlap match

Retain the relationship between duplicates. A widely copied post is not the same as many independent complaints.

### 7. Complaint classification

The classifier first decides whether the content contains a software or workflow problem.

Then it extracts:

- complaint type
- target entity
- feature or workflow area
- user context
- trigger
- expected behavior
- observed behavior
- consequence
- severity
- recurrence language
- workaround
- desired outcome
- switching intent
- payment signal
- business-impact signal
- environment details
- manipulation or spam indicators

The classifier must allow “unknown” and “not enough context.”

### 8. Entity resolution

Resolution uses:

- exact names
- aliases
- domains
- app-store identifiers
- repository identifiers
- vendor pages
- common abbreviations
- context from related posts
- feature names
- integrations
- category membership

A confidence threshold controls automatic linking. Ambiguous names such as “Teams,” “Notion,” or “Pages” require contextual evidence.

### 9. Complaint clustering

The clusterer groups evidence by the actual unmet outcome.

It should avoid these common errors:

- grouping all negative comments about one app together
- merging a bug with a missing feature
- merging consumer and enterprise needs
- merging price sensitivity with billing failure
- merging platform-specific problems that require different products
- merging complaints caused by temporary outages with stable unmet needs
- splitting identical problems because users use different words

Clustering uses lexical, semantic, entity, user, workflow, environment, and time features.

### 10. Cluster review and evidence grading

Each cluster receives an evidence grade based on:

- directness
- specificity
- independent author count
- source diversity
- recency
- time stability
- context completeness
- manipulation risk
- entity confidence
- policy integrity

Low-grade clusters remain searchable but cannot lead the default leaderboard without a visible confidence penalty.

### 11. Competitor and substitute research

The research system expands from the cluster’s job and target users, not only from named apps.

It looks for:

- products claiming to solve the job
- adjacent products
- platform features
- agencies or services
- manual workflows
- templates and spreadsheets
- open-source projects
- discontinued products
- recently launched features

The system then searches complaint evidence for those competitors.

### 12. Opportunity synthesis

The opportunity agent creates product concepts from one or more coherent clusters.

A concept is rejected when:

- the problem is an isolated outage
- a competitor already solves it well and users can switch easily
- the solution depends on unavailable data or prohibited automation
- the pain lacks a reachable user segment
- the complaint is severe but rare and non-repeatable
- the required trust, safety, or regulatory burden overwhelms the proposed value
- the concept is only a feature with no credible product boundary
- the evidence comes mainly from copied or coordinated content

### 13. Scoring and ranking

The scoring engine uses the model in `06_opportunity_scoring.md`.

The score is created from a frozen evidence snapshot. New evidence creates a new score snapshot.

### 14. Deep research

Only candidates that pass a threshold receive full research.

Deep research adds:

- broader competitor search
- product and pricing verification
- release-note review
- source-gap review
- user and job segmentation
- contrary evidence
- data and integration feasibility
- distribution paths
- monetization hypotheses
- security and compliance review
- build-scope estimate

### 15. Planning package

The plan generator creates human and machine artifacts from the same structured research object.

A validator checks that every major claim maps to evidence or is marked as an assumption.

### 16. Refresh and decay

Refresh jobs detect:

- new complaint velocity
- changed sentiment distribution
- new competitors
- competitor feature releases
- discontinued products
- pricing changes
- source access changes
- deleted evidence
- reduced source coverage
- plan staleness

An opportunity can move up, down, or into archive.

## Workflow orchestration

Long-running research should use durable workflows with explicit activities.

Suggested workflow hierarchy:

```text
CampaignWorkflow
  SourceEligibilityActivity
  QueryPlanWorkflow
  ConnectorWorkflow per source
  NormalizeWorkflow
  ClassifyWorkflow
  EntityResolutionWorkflow
  ClusterWorkflow
  CompetitorResearchWorkflow
  OpportunitySynthesisWorkflow
  ScoreWorkflow
  ReportWorkflow when requested
  PlanPackageWorkflow when requested
```

Each activity must be idempotent and carry a run identifier, tenant identifier, campaign identifier, policy version, skill version, model version, and cost ledger identifier.

## Research budgets

Every campaign has hard limits for:

- source requests
- paid API credits
- search-provider calls
- model input tokens
- model output tokens
- embeddings
- stored raw bytes
- deep-research candidates
- report generations
- runtime retries

When a budget is reached, the workflow pauses or completes with a visible partial-coverage result. It never silently exceeds the budget.

## Human review points

Mandatory review points for the MVP:

- ambiguous entity mappings
- high-impact clusters with low confidence
- opportunity concepts above the publish threshold
- source-policy changes
- plan approval
- skill activation above low risk

## Research quality gates

A candidate cannot become `Researched` unless:

- the complaint cluster is coherent
- evidence provenance is complete
- copied-content influence is measured
- unique author estimate is available
- at least one contrary-evidence search was run
- competitor categories include substitutes
- source gaps are shown
- policy risks are scored
- the research snapshot is reproducible
