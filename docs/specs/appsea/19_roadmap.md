# Roadmap and staged delivery

## Roadmap rule

Build the narrow evidence-to-leaderboard loop before broad source coverage or autonomous maintenance.

Each milestone has a working vertical slice and a gate.

## Milestone 0: Repository and contracts

### Deliver

- monorepo
- local development environment
- shared schemas
- PostgreSQL migrations
- object storage
- Temporal development setup
- OIDC development auth
- audit and cost primitives
- source-policy registry
- CI validation

### Gate

- schemas generate types
- one workflow runs and resumes after worker restart
- tenant isolation tests pass
- audit and cost entries are visible
- disabled source cannot run

## Milestone 1: Evidence foundation

### Deliver

- campaign creation
- user URL and CSV or JSON import
- YouTube connector
- GitHub connector
- Bluesky connector
- source envelopes
- raw and normalized evidence
- PII redaction
- injection isolation
- duplicate detection
- connector health UI

### Gate

- four ingestion paths work with fixtures and real approved credentials where available
- quota and policy errors are visible
- duplicate replay is idempotent
- deletion test removes controlled derivatives

## Milestone 2: Complaint intelligence

### Deliver

- complaint ontology
- structured classifier
- actionability review queue
- app entity model
- alias resolution
- complaint clustering
- evidence grading
- cluster review UI

### Gate

- benchmark precision meets the chosen MVP threshold
- ambiguous entities abstain or enter review
- cluster split and merge history works
- source and unique-author counts differ correctly for copied evidence

## Milestone 3: Opportunity leaderboard

### Deliver

- opportunity synthesis
- scoring library
- score snapshots
- balanced and fast-MVP profiles
- leaderboard API
- leaderboard UI
- opportunity overview
- evidence table
- score explanation
- saved filters and comparison

### Gate

- fixed snapshot scores reproduce exactly
- source-ablation and duplicate tests pass
- uncertainty and missing coverage are visible
- UI accessibility and screenshot checks pass

## Milestone 4: Competitor and deep research

### Deliver

- competitor entity graph
- direct, adjacent, native, substitute, and historical relationships
- product-page and documentation research through approved search or fetch paths
- competitor complaint comparison
- contrary-evidence workflow
- deep research report

### Gate

- reviewed benchmark opportunities meet competitor coverage goals
- every competitor fact has a source and date
- substitutes appear in every complete report
- unsupported claims block publication

## Milestone 5: Coding-agent plan packages

### Deliver

- PRD generator
- architecture and data plan
- task graph
- acceptance criteria
- Markdown and JSON package
- package validator
- download export
- read-only MCP resources and tools
- CLI export

### Gate

- sample package validates against schemas
- every requirement maps to tasks and acceptance criteria
- coding agent can initialize a repository from the package without chat context
- open questions remain visible

## Milestone 6: Operations and safe skills

### Deliver

- skill registry
- skill versioning
- evaluation fixtures
- proposal workflow
- low-risk sandbox
- rollback
- operations dashboards
- source freshness
- cost circuit breakers
- incident runbooks

### Gate

- skill cannot add its own permission
- failed canary rolls back
- cost cap pauses a workflow
- policy change can pause a connector
- recovery exercise succeeds

## Milestone 7: Desktop

### Deliver

- Tauri Windows and macOS applications
- shared UI
- secure OIDC login
- deep links
- notifications
- signed updates
- file imports and exports

### Gate

- signing and update validation pass
- no unnecessary native permissions
- deep-link security passes
- primary web workflows work on both platforms

## Milestone 8: Source expansion

Only after access is approved or licensed:

- X paid connector
- Reddit commercial connector or licensed feed
- approved Meta Page connector
- licensed app-review provider
- owner-authorized App Store Connect and Google Play connectors
- support and CRM integrations
- permitted Mastodon instance set

TikTok broad complaint access remains blocked unless an approved commercial route exists.

### Gate

Each connector passes the full source gate in `18_testing_evaluation.md`.

## Milestone 9: Outcome learning

### Deliver

- opportunity decision outcomes
- plan edit analytics
- accepted and rejected benchmark data
- scoring calibration workbench
- controlled prompt and skill proposals
- shadow evaluation
- low-risk canary

### Gate

- private tenant data stays isolated by default
- learning proposal explains the signal and expected improvement
- rollback works
- no model or skill change bypasses evaluation

## MVP definition

Milestones 0 through 5 form the core MVP.

Milestone 6 is required before broad unattended use.

Desktop and restricted source expansion follow a stable web product.

## First implementation sequence

The coding agent should begin with:

1. schemas and contracts
2. source-policy registry
3. campaign and workflow skeleton
4. file import connector
5. one live approved connector
6. normalization and evidence list
7. complaint classifier with fixtures
8. entity model and review
9. clustering
10. score library
11. leaderboard
12. report and plan export

Do not begin with self-writing skills, every source connector, or desktop packaging.
