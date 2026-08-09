# Private report and plan history

This runbook covers the version selector and export/comparison paths in a
private workspace. It is an inspection and review workflow; it never activates
a source, changes a report, or authorizes deletion.

## Read history

1. Sign in to the target workspace and open an opportunity's Report or Plan
   route.
2. The page requests
   `GET /api/workspaces/{workspaceId}/opportunities/{slug}/history`.
3. The response contains at most 50 active rows per artifact family. Follow
   `nextReportCursor` or `nextPlanCursor` with the matching `reportCursor` or
   `planCursor` query parameter to traverse older pages. `truncated` is a
   compatibility indicator derived from those cursors; do not describe a page
   with a next cursor as a complete audit history.
4. Withdrawn rows may appear as metadata (`id`, version, timestamp, state, and
   manifest hash), but selected content reads and exports reject them. Deleted
   rows and rows whose current production policy is no longer collectible are
   absent.

## Inspect a version

Selected report and plan reads are membership-authorized and use the same
current-policy, deletion, object-store hydration, and field-level redaction
gates as the current opportunity read. Draft/reviewed content is private to
workspace members; approved status is still required for export.

## Export

Use the JSON representation for machine ingestion:

```text
GET /api/workspaces/{workspaceId}/reports/{reportId}/export?format=json
GET /api/workspaces/{workspaceId}/plans/{planPackageId}/export?format=json
```

Use Markdown for a deterministic human/agent review document:

```text
GET /api/workspaces/{workspaceId}/reports/{reportId}/export?format=markdown
GET /api/workspaces/{workspaceId}/plans/{planPackageId}/export?format=markdown
```

The format parameter must occur once and be `json` or `markdown`. Both forms
require approval and return `X-AppSea-Manifest-Hash`; both hydrate and redact
before rendering. Export audit rows contain only the workspace/artifact
identity, manifest hash, actor binding, and representation. Provider download
retention and destructive purge remain deployment responsibilities.

Production analysis now also stores the same deterministic Markdown as a
content-addressed `report-markdown` object. Migration `0120` keeps the complete
object reference on the report and analysis-run rows, extends the invalidated-
analysis purge queue, and clears the report projection during source deletion.
The web export still renders the approved, redacted projection on demand so
historical exports do not bypass governance. ZIP/download-directory packaging
and provider-side backup/export purge remain deployment follow-up.

## Compare plan versions

```text
GET /api/workspaces/{workspaceId}/opportunities/{slug}/plans/compare?from={planId}&to={planId}
```

The route resolves both IDs under the same workspace and opportunity, then
returns sorted file status plus SHA-256 and UTF-8 byte metadata. It never
returns file bodies. The UI renders a small table; it is not a ZIP/directory
export and does not replace the approved package. The authenticated MCP
boundary exposes report/plan history metadata with the same cursor contract;
it does not hydrate historical bodies through the history resource.

## Local verification

Run the focused route and package checks before reviewing a change:

```text
pnpm --filter @appsea/reports test
pnpm --filter @appsea/db test -- src/auth-repository.test.ts
pnpm --filter @appsea/web test -- src/app/workspace-report-routes.test.ts src/app/workspace-plan-routes.test.ts src/app/workspace-artifact-history-routes.test.ts
pnpm --filter @appsea/web typecheck
```

For an actual local page, use the disposable stack and the repository capture
script (`pnpm ui:capture:private`). Do not debug or depend on a user's browser
session when validating this boundary.
