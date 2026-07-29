# Security and privacy

## Security goals

- protect tenant data and source credentials
- prevent untrusted source content from controlling agents
- limit every agent and connector
- preserve evidence integrity
- support deletion and retention duties
- keep reports from exposing unnecessary personal data
- make autonomous behavior observable and reversible

## Main threats

### Prompt injection in source content

Posts, comments, issues, web pages, profiles, imported files, and documents may contain instructions aimed at the model or agent.

Controls:

- mark all source content as untrusted data
- separate system instructions from evidence
- strip active HTML and scripts
- delimit content in structured fields
- never expose general tools during extraction
- use narrow extraction schemas
- run injection detectors
- ignore requests for secrets, policy changes, tool calls, or external actions
- validate output against source spans when possible
- adversarial fixtures in CI

### Server-side request forgery

User-submitted URLs and source links can target internal services.

Controls:

- URL parser and canonicalization
- deny private and link-local IP ranges
- DNS rebinding protection
- approved protocols only
- redirect limits
- response size and time limits
- content-type validation
- network egress proxy
- source-specific host allowlists

### Credential theft

Controls:

- managed secrets store
- short-lived credentials where supported
- tenant or connector isolation
- no secrets in prompts, logs, exports, or desktop bundles
- rotation and revocation
- least-privilege scopes
- access audit

### Cross-tenant data leakage

Controls:

- tenant identifier on every owned record
- authorization at service and query layer
- PostgreSQL row-level security as defense in depth
- tenant-aware cache keys
- object-store prefixes and policies
- cross-tenant tests
- no shared model context containing private tenant data

### Evidence tampering

Controls:

- source identifiers
- hashes
- immutable source envelopes
- signed or hashed export manifests
- audit events
- versioned transformations
- object versioning
- restricted correction workflow

### Model output injection into the product

Controls:

- treat model output as untrusted until schema validation
- sanitize Markdown and HTML
- block unsafe links
- prohibit executable code paths from report text
- separate display content from commands
- require typed task objects

### Skill and dependency supply chain

Controls:

- signed or reviewed origin
- hashes
- permission manifest
- license scan
- dependency scan
- sandbox
- evaluation fixtures
- canary
- rollback
- no install scripts without review

### Cost abuse

Controls:

- authenticated workflow starts
- per-tenant quotas
- hard campaign budgets
- rate limits
- model and source circuit breakers
- anomaly detection
- idempotency
- abuse review

### Data poisoning and manipulation

Controls:

- duplicate detection
- author independence estimates
- bot and coordinated-content signals
- source diversity
- contrary evidence
- manual review for high-impact clusters
- source caps
- score sensitivity tests

## Identity and access

Use OIDC with multi-factor support through the identity provider.

Recommended roles:

- viewer
- researcher
- decision maker
- operator
- source administrator
- skill administrator
- organization administrator

High-risk actions require reauthentication or step-up authentication.

Service accounts use narrow scopes and expiration.

## Data classification

| Class                | Examples                                         | Default handling                             |
| -------------------- | ------------------------------------------------ | -------------------------------------------- |
| Public reference     | Public product pages, permitted source links     | Normal access with provenance                |
| Licensed source data | Social or app data under contract                | Contract-specific access and retention       |
| Tenant confidential  | Support tickets, calls, surveys, private imports | Tenant-only, strict retention                |
| Sensitive personal   | Health, finance, minors, identifiers             | Redact, restrict, or reject based on purpose |
| Secret               | API keys, tokens, signing keys                   | Secrets manager only                         |

## Privacy by design

- collect only fields needed for the research purpose
- use pseudonymous author keys
- avoid public username display by default
- store short excerpts instead of full content when possible
- separate raw evidence from derived findings
- define retention per source and tenant
- support access and deletion requests
- do not train global models on private tenant content without explicit opt-in
- document model-provider retention and training settings

## Model gateway controls

Before a request:

- check source model-use permission
- redact secrets and PII
- attach tenant and purpose metadata
- enforce task model allowlist
- enforce token and cost limit

After a response:

- validate schema
- scan for leaked secrets or unsupported instructions
- record model and prompt version
- record cost
- store only policy-approved response data

## Content safety

Some complaints can contain harassment, sexual content, self-harm, malware, or illegal activity.

AppSea should classify and restrict such content. It should not turn harmful requests into app plans.

Research access to sensitive evidence should be role controlled.

## Deletion and retention

Deletion is a workflow with an audit trail.

It must cover raw objects, normalized data, embeddings, indexes, caches, report excerpts, and controlled exports.

Backups follow a documented expiry window. Restores must replay deletion tombstones before serving data.

## Logging

Logs include identifiers and state, not raw sensitive content.

Do not log:

- tokens
- passwords
- full private messages
- full support tickets
- payment data
- model prompts containing restricted evidence

Use correlation identifiers to trace a run without copying content.

## Encryption

- TLS in transit
- managed encryption at rest
- separate key policy for object storage and database
- tenant-specific keys later for enterprise needs
- signed desktop updates
- signed webhooks

## Secure development

- branch protection
- reviewed migrations
- secret scanning
- dependency scanning
- static analysis
- container scanning
- infrastructure policy checks
- signed build provenance when available
- isolated CI credentials

## Security testing

Required tests:

- prompt injection
- SSRF
- authorization bypass
- tenant isolation
- object-store path isolation
- webhook forgery
- idempotency replay
- rate-limit abuse
- malicious ZIP and file import
- unsafe Markdown
- skill permission escalation
- secret leakage
- deletion propagation
- desktop deep-link abuse
- update signature failure

## Incident response

An incident record contains:

- detection
- affected tenants and sources
- containment
- evidence preservation
- credential actions
- data impact
- notification duties
- repair
- recovery
- root cause
- follow-up controls

The maintenance agent may contain an incident within approved kill switches. Human incident ownership remains required.
