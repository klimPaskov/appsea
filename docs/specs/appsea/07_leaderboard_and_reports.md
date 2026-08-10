# Leaderboard, opportunity pages, and reports

## Leaderboard purpose

The leaderboard is a fast ranking surface for the user. It does not attempt to expose the research system on the same page.

## Leaderboard fields

| Field       | Meaning                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| Rank        | Stable position for the accepted score snapshot                            |
| Opportunity | Working product concept, linked to its detail route                        |
| Complaints  | Deduplicated complaint count represented by the accepted research snapshot |
| Score       | Deterministic opportunity score                                            |

A small disclosure identifies fixture or synthetic data. No other data appears on the leaderboard.

## Excluded leaderboard content

Do not place these on the leaderboard:

- score cards
- charts
- source coverage panels
- research status
- selected-opportunity previews
- competitor summaries
- recent activity
- comparison drawers
- promotional product copy

These belong on separate routes when needed.

## Opportunity routes

### Overview

Shows the product thesis, audience, first wedge, complaint count, score, and evidence mode.

### Complaints

Shows curated observations with product and problem category. Live versions add provenance and policy-aware source links.

### Competitors

Shows direct competitors, adjacent products, platform features, workarounds, strengths, weaknesses, related complaint clusters, and contrary evidence.

### Coding plan

Shows the generated package files, dependency-aware first build sequence, validation plan, and export controls.

## Deep research report

The full report is an artifact, not a dashboard page. It contains:

1. Executive decision brief
2. Research scope and source coverage
3. Problem definition
4. Complaint clusters
5. Evidence ledger
6. Users and jobs
7. Competitors and workarounds
8. Contrary evidence
9. Market gap and first wedge
10. Versioned scoring
11. Product plan
12. Risks, assumptions, and invalidation conditions
13. Coding-agent package manifest

The report must separate evidence, inference, and recommendation. Every material claim needs traceable support or a clear uncertainty label.

Private report versions are governed separately from the public leaderboard:
owners and editors may review a draft, only owners may approve or withdraw, and
each transition is auditable. Export is available only for an approved report
and contains the validated report read model plus its manifest hash; it does not
expose raw source payloads or turn fixture data into market evidence. The
private report route provides a bounded, policy-filtered selector for the 50
newest active versions. Withdrawn versions can remain visible as metadata-only
history entries but cannot be selected for content or export. `format=json` is
the machine representation; `format=markdown` is a deterministic on-demand
render of the same redacted read model, with the manifest hash in a response
header. `format=zip` is the approved, deterministic `appsea-export-bundle-v1`
download containing a README, manifest, report JSON, and report Markdown; it
also returns the source manifest hash and archive hash in response headers. It
is generated on demand and never exposes raw object URIs or source payloads.
Production analysis additionally retains a content-addressed `report-markdown`
object for deletion/retention workflows; that object is not an export
authorization or a public leaderboard surface. The public leaderboard remains
latest-ranked and contains no history or comparison UI.

Plan history follows the same membership, current-policy, and deletion
boundaries. Active draft and reviewed versions remain available to authenticated
workspace members for private review; plan export and agent-facing MCP reads
still require readiness plus owner approval. A plan comparison returns sorted file paths, status, SHA-256
hashes, and UTF-8 byte counts; it never republishes a second source copy. The
Markdown plan export is one ordered human-readable bundle of the existing six
files. `format=zip` adds the bounded `appsea-export-bundle-v1` archive with
README, manifest, plan JSON/Markdown, the six validated files under `plan/`,
and the complete 08_spec-compatible directory under `package/`. It is
deterministic and generated on demand, not a new persisted object. Missing
live dimensions remain explicit coverage gaps in the package.
