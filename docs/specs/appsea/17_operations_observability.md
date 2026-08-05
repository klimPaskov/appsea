# Operations and observability

## Operating goal

AppSea should run continuously with visible health, bounded cost, recoverable workflows, and clear source freshness.

## Service objectives

Initial targets after production stabilization:

| Surface                        | Target                                                 |
| ------------------------------ | ------------------------------------------------------ |
| Read API availability          | 99.9% monthly                                          |
| Leaderboard cached view        | 95% under 1 second at normal load                      |
| Opportunity detail             | 95% under 2 seconds excluding large evidence pages     |
| Workflow start acknowledgement | 99% under 2 seconds                                    |
| Deletion workflow start        | within 15 minutes of received event or batch detection |
| Critical connector alert       | within 10 minutes                                      |
| Audit event durability         | 99.99%                                                 |

Connector freshness has source-specific objectives. Do not apply one global freshness promise.

## Core dashboards

### Product health

- API requests and errors
- page performance
- auth failures
- active tenants
- campaign starts and completions
- report and plan generation

### Workflow health

- workflows by state
- activity retries
- oldest running workflow
- review wait time
- dead-letter or terminal failures
- cancellation and timeout rate

### Connector health

- status by source
- last successful collection
- source-specific freshness state and latest retained observation age
- requests and records
- quota remaining
- auth expiry
- rate-limit responses
- schema changes
- deletion backlog
- cost

The first private source-registry implementation exposes a bounded read-only
subset of this dashboard: connector state, last attempt/success, retained
observation age, reviewed freshness interval/delay when configured, active
records, deletion backlog, fixed failure code, cost, and the shared
current-minute quota limit/used/remaining projection added by migration `0107`.
Legacy policies remain freshness-unknown, and on-demand sources do not receive
a scheduled SLA. Provider-auth expiry, alert delivery, and deployment SLO
ownership remain operational follow-up work; shared headroom is not a
per-workspace billing ledger, and stale or missing observations are never
treated as proof of absent complaints.

### Research quality

- complaint actionability rate
- classifier confidence
- entity ambiguity
- cluster churn
- source mix
- duplicate ratio
- contrary-evidence coverage
- report citation coverage
- plan schema pass rate

### Agent and model health

- calls by task and model
- schema failures
- refusals
- latency
- token use
- cost
- fallback use
- prompt-injection flags
- evaluation drift

### Skill health

- runs by skill version
- failure rate
- evaluation score
- canary traffic
- rollback count
- permission-denied events

### Security and privacy

- suspicious fetches
- blocked network targets
- authorization failures
- cross-tenant test alarms
- secret-scan alerts
- deletion completion
- sensitive-data flags
- export events

## Alert levels

### Critical

- tenant data isolation risk
- source credential compromise
- uncontrolled external spend
- deletion system failure beyond policy limit
- invalid desktop update signature
- production agent permission escalation
- evidence integrity failure

### High

- major API outage
- Temporal unavailable
- database primary failure
- several core connectors failing
- report publication with missing provenance
- model route producing widespread schema failures

### Medium

- one connector degraded
- quota close to limit
- source freshness missed
- unusual duplicate spike
- ranking drift
- skill canary regression

### Low

- optional source stale
- non-critical export failure
- documentation or policy review due

## Runbooks

Required runbooks:

- connector authentication failure
- connector schema change
- source rate-limit exhaustion
- source terms or policy change
- source deletion backlog
- model provider outage
- model quality regression
- prompt-injection incident
- runaway model or API cost
- duplicate explosion
- entity-resolution regression
- cluster instability
- ranking anomaly
- report provenance failure
- skill rollback
- database failover
- object-store outage
- Temporal outage
- webhook signing issue
- desktop update rollback

Each runbook contains detection, containment, diagnosis, repair, validation, rollback, communication, and follow-up.

## Backups

- PostgreSQL point-in-time recovery
- daily backup verification
- object-store versioning
- configuration and source-policy backups
- skill and schema repository backups
- secrets backed up through the secrets platform’s approved mechanism

Do not back up unnecessary raw source content beyond retention.

## Restore testing

At least quarterly in mature production:

1. restore database to isolated environment
2. restore object manifests
3. replay deletion tombstones
4. verify tenant isolation
5. verify report hashes
6. verify workflows can resume or be safely reconciled
7. record recovery time and gaps

## Disaster recovery

Define:

- recovery point objective
- recovery time objective
- regional dependencies
- source credential recovery
- workflow reconciliation
- desktop and web status communication

The first production version can use one primary region with tested backups. Multi-region complexity should follow a business need.

## On-call and ownership

Every component has an owner:

- web and API
- workflow platform
- connectors
- model gateway
- source policy
- security
- data and deletion
- skills and evaluations
- desktop releases

Automated agents can assist diagnosis and containment. A human owner is accountable for material incidents.

## Cost operations

Track cost by:

- tenant
- campaign
- run
- source
- model task
- opportunity
- report
- plan

Alerts:

- rate higher than forecast
- cost per useful evidence item rising
- repeated deep research on rejected candidates
- model fallback increasing cost
- duplicate data processed repeatedly
- source credits near exhaustion

## Source freshness

Each source defines:

- expected collection interval
- allowed delay
- last successful cursor
- last observed source time
- last policy review
- stale threshold
- user-facing coverage message

An opportunity’s freshness uses the weakest important source and the age of its evidence snapshot.

## Maintenance windows

Prefer rolling changes.

For connector or scoring changes that can alter research meaning:

- freeze publication
- run shadow or replay evaluation
- compare outputs
- publish a version note
- resume with a new version
