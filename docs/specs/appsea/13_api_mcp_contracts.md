# API, MCP, CLI, and webhook contracts

## API principles

- version every public contract
- use stable identifiers
- validate requests and responses
- use cursor pagination
- support idempotency for workflow-start and export operations
- return coverage and confidence with research data
- separate read permission from workflow permission
- never return source content beyond policy and user permission

## Authentication and authorization

Use OIDC for human and service identities.

Roles can include:

- viewer
- researcher
- decision maker
- operator
- source administrator
- skill administrator
- billing administrator
- service account

Permissions are resource and action based.

MCP and CLI tokens should be short-lived or scoped service credentials.

## REST resources

### Opportunities

```text
GET    /v1/opportunities
GET    /v1/opportunities/{opportunity_id}
GET    /v1/opportunities/{opportunity_id}/scores
GET    /v1/opportunities/{opportunity_id}/evidence
GET    /v1/opportunities/{opportunity_id}/clusters
GET    /v1/opportunities/{opportunity_id}/competitors
GET    /v1/opportunities/{opportunity_id}/reports
GET    /v1/opportunities/{opportunity_id}/plans
POST   /v1/opportunities/{opportunity_id}/decisions
POST   /v1/opportunities/{opportunity_id}/refresh
POST   /v1/opportunities/{opportunity_id}/reports
POST   /v1/opportunities/{opportunity_id}/plans
```

### Leaderboard

```text
GET /v1/leaderboard
GET /v1/leaderboard/profiles
POST /v1/leaderboard/compare
```

Common query parameters:

- `profile`
- `query`
- `category`
- `segment`
- `source`
- `confidence_min`
- `risk_max`
- `state`
- `freshness`
- `sort`
- `cursor`
- `limit`

### Campaigns and runs

```text
POST   /v1/campaigns
GET    /v1/campaigns
GET    /v1/campaigns/{campaign_id}
PATCH  /v1/campaigns/{campaign_id}
POST   /v1/campaigns/{campaign_id}/runs
GET    /v1/runs/{run_id}
POST   /v1/runs/{run_id}/pause
POST   /v1/runs/{run_id}/resume
POST   /v1/runs/{run_id}/cancel
GET    /v1/runs/{run_id}/events
GET    /v1/runs/{run_id}/cost
```

### Evidence review

```text
GET   /v1/evidence/{evidence_id}
POST  /v1/complaints/{complaint_id}/review
POST  /v1/entity-links/{link_id}/review
POST  /v1/clusters/{cluster_id}/merge
POST  /v1/clusters/{cluster_id}/split
POST  /v1/clusters/{cluster_id}/membership
```

### Sources

```text
GET   /v1/sources
GET   /v1/sources/{source_id}
GET   /v1/sources/{source_id}/policies
POST  /v1/sources/{source_id}/health-check
POST  /v1/connectors/{connector_config_id}/pause
POST  /v1/connectors/{connector_config_id}/resume
```

Activation and credential operations belong to administrator-only endpoints and require stronger confirmation.

### Skills

```text
GET   /v1/skills
GET   /v1/skills/{skill_id}
GET   /v1/skills/{skill_id}/versions
POST  /v1/skills/proposals
POST  /v1/skills/{skill_id}/evaluations
POST  /v1/skills/{skill_id}/canary
POST  /v1/skills/{skill_id}/rollback
```

### Exports

```text
POST /v1/exports
GET  /v1/exports/{export_id}
GET  /v1/exports/{export_id}/download
```

## Response envelope

```json
{
  "data": {},
  "meta": {
    "request_id": "req_123",
    "schema_version": "1.0.0",
    "coverage": null,
    "warnings": []
  }
}
```

Errors:

```json
{
  "error": {
    "code": "SOURCE_POLICY_BLOCKED",
    "message": "The selected source is not approved for this campaign purpose.",
    "details": {
      "source_id": "reddit_public",
      "policy_version": "3"
    },
    "request_id": "req_123"
  }
}
```

## Idempotency

Require `Idempotency-Key` for:

- campaign-run creation
- report generation
- plan generation
- exports
- decisions
- skill evaluation
- rollback

The key is scoped to tenant and endpoint.

## Pagination

Use opaque cursors.

A response includes:

```json
{
  "next_cursor": "opaque",
  "has_more": true
}
```

## MCP server

### Resources

```text
appsea://leaderboard?profile=balanced
appsea://opportunities/{id}
appsea://opportunities/{id}/evidence
appsea://opportunities/{id}/report/{version}
appsea://opportunities/{id}/plan/{version}
appsea://sources/coverage
appsea://skills/{name}/{version}
```

Resources are read-only views.

### Read tools

- `appsea.search_opportunities`
- `appsea.get_opportunity`
- `appsea.get_score_explanation`
- `appsea.get_complaint_clusters`
- `appsea.get_evidence_refs`
- `appsea.get_competitor_map`
- `appsea.get_report`
- `appsea.get_plan_package`
- `appsea.list_required_skills`
- `appsea.validate_plan_package`

### Workflow tools

- `appsea.start_research_campaign`
- `appsea.refresh_opportunity`
- `appsea.generate_report`
- `appsea.generate_plan_package`
- `appsea.export_plan_package`

Workflow tools require explicit scopes and return a run identifier. They do not wait inside one long tool call.

### Restricted tools

Connector activation, skill activation, policy changes, production deletion, and deployment should not be general MCP tools in the MVP.

### MCP prompts

- `research_an_opportunity`
- `compare_opportunities`
- `prepare_build_handoff`
- `review_evidence_quality`
- `challenge_opportunity_assumptions`

Prompts reference resources and do not embed private data by default.

## CLI

Suggested commands:

```text
appsea auth login
appsea leaderboard list
appsea opportunity show <id>
appsea opportunity compare <id...>
appsea campaign create --file campaign.json
appsea run watch <id>
appsea report export <id> --format markdown
appsea plan export <id> --output ./plan
appsea plan validate ./plan
appsea sources status
appsea skills list
```

The CLI prints machine-readable JSON with `--json`.

## Webhooks

Optional tenant webhooks:

- opportunity.created
- opportunity.rank_changed
- opportunity.researched
- report.published
- plan.published
- campaign.completed
- connector.degraded
- source.policy_changed

Webhook delivery needs signing, retries, replay protection, and a dead-letter view.

## Rate limits

Rate limits depend on role and endpoint.

Workflow-start endpoints also enforce campaign and cost budgets.

The API returns limit and retry metadata. It never converts an upstream source quota into an unbounded queue.
