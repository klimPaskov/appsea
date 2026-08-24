# AppSea production-readiness audit — 2026-08-09 (refreshed 2026-08-22)

Status: **incomplete; do not promote as a production market-research service**.

This audit compares the active product goal and plan with the checked-in
implementation, current tests, generated artifacts, and external operating
dependencies. Fixture output and the tenant-private owner-import path are not
presented as public market research.

## Surface status

| Surface                       | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and persistence     | 123 ordered/checksummed PostgreSQL migrations; repositories and RLS for sources, evidence, complaints, clusters, competitors, opportunities, score snapshots, reports, plans, audit, cost, lineage, and purge queues. `pnpm test` passes all 15 package suites.                                                                                                                                                                                                        | Implemented in repository; fresh/upgrade database proof pending.                                                                             |
| Durable workflows             | Fixture, collection, analysis, maintenance, alert, cancellation, retry, admission, and worker-drain boundaries are covered by unit/integration-shaped tests and deterministic identifiers.                                                                                                                                                                                                                                                                             | Implemented locally; hosted Temporal, HA, replacement, and namespace ACL evidence pending.                                                   |
| Approved collection           | `manual-owner-import-v3` is active, owner-attested, tenant-private, bounded, PII-scrubbed, quota-gated, tombstone-aware, and fixture-backed. Optional author keys become workspace-scoped opaque fingerprints; deletion and author-field redaction clear them. Private source coverage now exposes identity-free reviewer-role and permission-evidence gaps. CFPB and Stack Exchange have typed policy/connector boundaries and handoff manifests but remain disabled. | Private connector usable; no public source activation is authorized.                                                                         |
| Research pipeline             | Normalization, deduplication, classification, clustering, entity resolution, competitor/contrary observations, deep-research gates, deterministic v0.2/v1 scoring, provenance, quality snapshots, and correction invalidation are implemented.                                                                                                                                                                                                                         | Implemented with visible synthetic/coverage limits; live-source calibration remains open.                                                    |
| Reports and plans             | Private evidence inspection, approvals, cursor-bounded history, selected-version reads, JSON/Markdown/ZIP export, plan comparison, deterministic report Markdown persistence, report-Markdown purge lineage, and an on-demand complete 08_spec-compatible plan directory under `package/` are implemented.                                                                                                                                                             | Implemented locally; provider-side export/object/backup purge and fresh hosted verification remain follow-up work.                           |
| Authentication and workspaces | Scrypt sessions, membership/RLS, MFA, step-up, session inventory/revocation, owner archival/purge readiness, invitations/recovery mechanics, optional OIDC, and private routes are implemented and tested.                                                                                                                                                                                                                                                             | Repository boundary implemented; verified identity, delivery, retention, provider-backed step-up, and deployment operations remain external. |
| Website and desktop boundary  | Sparse public leaderboard and separate opportunity detail routes; the private collection page exposes queued/dispatching/started durable analysis handoffs without duplicate starts and keeps failed retry explicit. The 2026-08-22 public capture set covers 20 screenshots across four viewports with no runtime/main/overflow failures; the earlier authenticated set covers 36 private screenshots. Tauri boundary checks pass.                                    | UI contract is locally verified; signed desktop releases and hosted-origin review remain open.                                               |
| Operations and security       | Worker/alert loops, budgets, cost ledgers, leases, failure recovery, preflight, and dependency audit are implemented. `pnpm security:audit`, `pnpm memory:check`, and `pnpm docs:check` pass.                                                                                                                                                                                                                                                                          | Local controls pass; production scheduler, endpoint, billing, incident, secret, provider, and backup operations remain open.                 |

## Validation evidence

- `pnpm test` — passed on 2026-08-22: 15 packages; current run includes 119
  contract, 195 database, 146 worker, and 249 web tests among the package totals.
  The selected
  version security review confirms active draft/reviewed private reads remain
  member-scoped, while withdrawn/deleted/incomplete/stale rows are excluded and
  export/MCP agent gates remain approval-aware.
- PostgreSQL integration coverage now includes an actual linked `running`
  analysis-output case for report/plan selected reads and history exclusion.
  It is authored but not executed in this environment because Docker Desktop's
  `dockerDesktopLinuxEngine` pipe is unavailable; fresh/upgrade/RLS execution
  evidence therefore remains open.
- `pnpm test:backup-restore` — passed the local helper tests; the verifier now
  targets migration `0123`.
- `pnpm verify:release -- --static` and
  `node --test scripts/verify_release.test.mjs` — passed the release-boundary
  migration-inventory guard. It requires exactly 123 valid, unique,
  contiguous SQL migrations ending at `0123`; it is static repository proof
  only and does not replace Docker-backed fresh/upgrade or backup/restore
  execution.
- `pnpm worker:fixture` — passed and wrote the deterministic synthetic artifact
  (4 complaints, 3 clusters, score `80.3`).
- `pnpm plan:sample` — passed and wrote the six-file synthetic coding-agent
  package. `pnpm smoke:web` also passed the leaderboard, opportunity routes,
  and fixture API.
- `pnpm security:audit` — passed with no known production vulnerabilities.
- `pnpm memory:check` — passed with 167 indexed chunks; `pnpm docs:check` —
  passed with 21 skills and 11 bounded subagents. The report remains
  incomplete because deployment-owned gates are still open.
- The post-handoff `pnpm test` run passed all 15 workspace packages, including
  195 database, 146 worker, 249 web, and 31 workflow tests;
  repository-wide `pnpm typecheck`, `pnpm lint`, and `pnpm build` also passed
  (30 build tasks, including the optimized Next production build).
- `pnpm security:audit` passed with `No known vulnerabilities found` after the
  workspace override moved `nanoid` to `3.3.18`; the release static verifier,
  Prettier, and `git diff --check` also pass. The hardening commits are
  `b456188` and `5b2c22d`.
- The 2026-08-10 export-bundle tranche adds deterministic replay and hostile-data
  tests for `appsea-export-bundle-v1`, approval/current-policy/redaction-gated
  report and plan repository methods, ZIP route headers/body tests, and a
  readiness fail-closed regression for all plan export representations, the
  expanded 08_spec-compatible plan directory, and linked-report approval gate.
  The current web production build, smoke test, release static verifier, security
  audit, full test suite, typecheck, lint, and format checks pass.
- `artifacts/ui-reference-loop/2026-08-06/public-capture-manifest.json` — 20
  captures pass title/main/runtime/overflow checks.
- `artifacts/ui-reference-loop/2026-08-06/private-capture-manifest.json` — 36
  authenticated captures pass the same scalar checks.
- `pnpm ui:capture` — passed a fresh local run on 2026-08-09 with 20 public
  captures at 1280, 1024, 768, and 480 pixels; representative leaderboard and
  opportunity and coding-plan screenshots were visually inspected. The
  imagegen-backed plan icon is visible on the public coding-plan route; the
  generated report icon is used on the private report route. The
  480-pixel pass uses a
  narrow desktop layout (`mobile: false`), not a mobile-emulation desktop
  capture.
- `pnpm ui:capture -- --persist` — passed a fresh local run on 2026-08-10 with
  the same 20 public routes and scalar overflow/runtime checks. Authenticated
  private captures remain intentionally unclaimed because the local
  PostgreSQL/Temporal stack is unavailable.
- `node scripts/capture_ui_reference.mjs --persist` — passed a fresh local run
  on 2026-08-22 and persisted 20 public captures under
  `artifacts/ui-reference-loop/2026-08-22/`; desktop captures keep
  `mobile: false`, while the 480-pixel pass remains a separate responsive
  viewport. The inspected leaderboard and opportunity captures retain the
  sparse dark reference layout.
- `pnpm --filter @appsea/web exec vitest run --maxWorkers=1` — passed the
  post-tranche web suite: 64 files and 249 tests, including durable
  analysis-handoff and source-policy approval presentation helpers.
- `pnpm verify:backup-restore` and a direct `docker version` probe remain
  blocked in this environment because the Docker Desktop
  `dockerDesktopLinuxEngine` pipe is unavailable; this is not fresh migration,
  restore, or local-stack evidence.
- `pnpm verify` — blocked before repository checks because the user-owned empty
  root `AGENTS.md` is missing the generated catalog block. It remains untouched.

## Release blockers and simplifications

1. No independent legal/privacy/security/commercial-use approval has been
   recorded for a public third-party connector. No public market coverage is
   claimed; activating CFPB or Stack Exchange would require a reviewed policy
   row and external evidence.
2. Production PostgreSQL, Temporal, object storage, scheduler, alert endpoint,
   identity/delivery, billing, backup/restore, incident, and retention
   operations are deployment-owned and not proven by this repository.
3. The report/plan export slice now provides deterministic JSON, Markdown, and
   a bounded on-demand ZIP v1 plus metadata-only comparison. The plan ZIP now
   includes the complete 08_spec-compatible directory under `package/` while
   preserving explicit coverage gaps; provider-side destructive purge is not
   silently represented as complete.
4. The public website remains fixture-disclosed and database-free; private
   research requires the local authenticated stack. This preserves the sparse
   leaderboard contract instead of presenting synthetic rankings as demand.

## Next actions

- Restore Docker Desktop and rerun fresh/upgrade PostgreSQL, backup/restore,
  worker replacement, and local-stack proofs against migration `0123`.
- Obtain and record independent source-policy approvals before enabling a public
  connector; keep coverage gaps visible until then.
- Provision and verify hosted PostgreSQL/Temporal/object storage, identity and
  delivery, scheduler/alert ownership, retention/purge, billing, and incident
  controls.
- Complete signed Windows/macOS Tauri release and hosted-origin review.

This report is evidence of current state, not a completion claim.
