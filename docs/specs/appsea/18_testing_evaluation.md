# Testing, evaluation, and quality gates

## Testing layers

### Unit tests

- schema transformations
- scoring functions
- source-policy decisions
- URL validation
- PII redaction
- duplicate hashing
- permission checks
- report renderers

### Contract tests

- connector responses
- API request and response schemas
- MCP tools and resources
- workflow activity inputs and outputs
- object-store manifests
- desktop native commands

### Integration tests

- campaign to evidence
- evidence to complaints
- complaints to clusters
- clusters to opportunity
- opportunity to score
- score to leaderboard
- report and plan generation
- deletion propagation
- source pause and resume
- skill rollback

### End-to-end tests

- create campaign
- run approved connectors with fixtures
- review ambiguous evidence
- publish opportunity
- open leaderboard
- inspect evidence
- generate report
- export plan
- read plan through MCP

### Resilience tests

- worker crash
- API retry
- duplicate source delivery
- quota reset
- provider timeout
- database failover
- object-store failure
- model provider outage
- workflow cancellation

### Security tests

Defined in `16_security_privacy.md`.

## Evaluation datasets

### Complaint classification set

Balanced examples of:

- true complaints
- feature requests
- bugs
- pricing problems
- workflow gaps
- vague sentiment
- satire
- spam
- copied content
- outages
- harmful requests
- multilingual evidence

### Entity resolution set

Includes:

- app aliases
- common names
- renamed products
- company and product confusion
- integrations
- repositories
- app variants
- ambiguous acronyms

### Clustering set

Includes gold cluster memberships, allowed overlaps, expected splits, and hard negatives.

### Competitor set

For selected opportunities, reviewers define direct, adjacent, native, substitute, and historical competitors.

### Ranking set

A panel ranks opportunity snapshots and records reasons. Include low-volume high-value B2B cases and high-volume weak consumer cases.

### Plan quality set

Reviewers score generated plans for specificity, evidence use, scope, architecture, security, tests, task coverage, and coding-agent usefulness.

### Adversarial set

Includes prompt injection, hidden instructions, malicious HTML, fake citations, review bombing, copied posts, identity ambiguity, and source-policy conflicts.

## Metrics

### Complaint classification

- precision
- recall
- F1
- calibration error
- high-severity false-positive rate
- actionability precision

MVP target direction:

- prioritize precision for leaderboard evidence
- route uncertain cases to review
- measure each language and source separately

### Entity resolution

- top-1 precision
- top-k recall
- abstention quality
- alias coverage
- high-impact wrong-link rate

### Clustering

- pairwise precision and recall
- cluster purity
- reviewer split and merge rate
- stability across model versions
- segment preservation

### Competitor research

- direct-competitor recall
- substitute recall
- unsupported-claim rate
- source freshness
- feature-matrix completeness

### Ranking

- top-k precision against reviewed choices
- rank correlation
- duplicate-injection stability
- source-ablation stability
- one-source dominance
- confidence calibration

### Report and plan

- claim provenance coverage
- schema validation
- requirement-to-task coverage
- acceptance-criteria coverage
- unsupported-fact rate
- human edit distance by category
- reviewer acceptance

### UI

- accessibility violations
- visual diff
- keyboard completion
- responsive overflow
- table performance
- error-state coverage

## Golden artifacts

Keep versioned golden outputs for:

- score explanation
- research report
- plan manifest
- task graph
- leaderboard response
- MCP resource
- deletion impact report

A change to a golden artifact needs review when meaning changes.

## Model change gate

Before a model route changes:

1. run offline evaluation
2. compare cost and latency
3. compare schema success
4. inspect high-impact disagreements
5. run adversarial suite
6. run shadow traffic when allowed
7. canary
8. monitor
9. retain rollback

## Skill change gate

- metadata complete
- permissions unchanged or approved
- fixtures pass
- benchmark non-regression
- security scan pass
- cost within limit
- canary when production-facing
- rollback target

## Source connector gate

- policy approved
- API contract tests pass
- quota handling passes
- deletion handling passes
- duplicate replay passes
- malformed content passes
- schema-change detection passes
- network allowlist passes
- coverage statement reviewed

## Report gate

A report fails when:

- provenance coverage is below the configured threshold
- a material competitor claim has no source
- contrary evidence is missing
- score version is missing
- source coverage is hidden
- unsupported quotations appear
- structured artifact fails schema validation
- restricted evidence is exposed

## Plan gate

A plan fails when:

- requirements are generic
- tasks do not cover requirements
- acceptance criteria are not testable
- data or platform dependencies are hidden
- security and privacy are absent
- non-goals are absent
- open questions are presented as decisions
- source access is assumed without approval

## UI reference gate

- reference exists
- screenshot exists
- visual comparison recorded
- accessibility checks pass
- keyboard path passes
- narrow viewport passes
- approved differences documented

## Release gate

A release report lists:

- requirements delivered
- tests and evaluations
- migrations
- source-policy changes
- model and skill changes
- security review
- cost effect
- screenshots
- known gaps
- rollback
