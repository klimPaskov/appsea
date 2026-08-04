# Production-readiness audit — 2026-08-03

Status: not production-ready. This audit records the current repository
evidence after the MFA key-rotation, CI release-proof, and disabled-by-default
OIDC identity-boundary tranches.

## Surface status

| Requirement                                        | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Remaining gate                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL persistence and migrations              | Implemented as a production-shaped repository slice through migration `0095`; forced-RLS sources, evidence, complaints, clusters, competitors, opportunities, scores, reports, plans, workflow lineage, costs, deletion queues, agent tokens, one-/multi-source cancellation intent, private history pagination, global-auth MFA material/retention, versioned current/previous MFA keys, bounded dormant-account rewrap with identifier-only events, count-only rotation status, session-bound conditional MFA, archived-owner metadata-only purge manifests, OIDC identity rows with service-only security-definer link/unlink/sign-in functions, and the owner-import tables/policy, a narrow service-executable policy decision function, and the consumed-to-deleted state repair are covered by package tests and the hosted integration gate.                          | Role provisioning, restore/backup drills, production credentials, and an approved live key-rotation operation remain unproven.                                                                                                                                                                                                                     |
| Durable workflow engine and idempotent jobs        | Fixture, production collection, analysis, refresh, recomputation, maintenance, multi-source orchestration, and cancellation retry boundaries have deterministic identities, bounded retries, leases, safe terminal states, and local tests. `pnpm verify:worker:recovery` drives a separate-client fixture workflow through real durable-worker process loss during persistence and verifies replacement recovery with single-row/checkpoint/cost/outbox effects and sanitized history.                                                                                                                                                                                                                                                                                                                                                                                       | Authenticated Temporal namespace/task-queue authorization, deployed scheduler ownership, HA/restore drills, and legacy v1 history drain remain open.                                                                                                                                                                                               |
| Approved complaint source connector                | The `manual-owner-import-v1` connector is active under an approved owner-authority policy, with bounded parsing, PII scrubbing, provenance, quotas, deletion tombstones, and private-workspace tests. CFPB is typed, policy-gated, quota-bound, provenance-preserving, and fixture-tested; Stack Exchange is a reviewed candidate only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The manual connector is tenant-private and cannot establish public market coverage. Independent legal/privacy/security/commercial-use/retention approval is required before activating CFPB or Stack Exchange.                                                                                                                                     |
| Complaint analysis and scoring                     | Normalization, deduplication, classification/entity snapshots, clustering, competitor/contrary fields, deterministic versioned scoring, correction invalidation, and bounded recomputation are persisted and tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Live non-fixture research and permitted competitor evidence remain unavailable.                                                                                                                                                                                                                                                                    |
| Reports and coding-agent packages                  | Evidence-backed reports, coverage gaps, approval state, object references, plans, approved export, private routes, and read-only scoped MCP reads are implemented. The shared contract now requires the deterministic six-file production package manifest at new seed/admission/worker boundaries while preserving legacy rows for inspection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Encrypted cloud object storage, workspace/export purge, backup deletion verification, and deployment controls remain open.                                                                                                                                                                                                                         |
| Authentication and private workspaces              | Password sessions, membership/RLS, step-up, session inventory/revocation, TOTP MFA with one-time recovery codes and expiring login challenges, versioned current/previous MFA keys with transactional and bounded dormant-account rewrap, identifier-only rotation events, count-only rotation status, conditional MFA step-up for password-gated high-risk mutations, account closure, invitations/recovery mechanics, archival, owner-issued scoped agent tokens, and a disabled-by-default OIDC identity link/sign-in boundary exist. The OIDC boundary binds explicit issuer/subject identities, verifies state/nonce/PKCE/RS256/claims, uses reviewed endpoint origins and an exact public redirect origin, rejects unsafe production DNS answers before provider requests, binds MFA challenges in PostgreSQL, and emits sign-in telemetry only after session issuance. | Independent OIDC/provider/verified-email policy and operator approval, deployment DNS pinning/egress anti-rebinding, provider delivery/DPA/retention/revocation review, approved live key-rotation rollout/status review, provider-backed step-up, mutation contracts without a password boundary, and production identity operations remain open. |
| Website and desktop boundary                       | Sparse public leaderboard, private opportunity/campaign routes, evidence/source coverage, reports/plans, and private one-/multi-source cancellation UI/API are implemented; the release workflow now runs the full fixture, build, route-smoke, and repository proof with read-only GitHub permissions; the Tauri shell has a compilable Rust/build boundary, restrictive CSP, minimal capability set, deterministic PNG/ICO icons, and passing independent Windows and macOS CI jobs.                                                                                                                                                                                                                                                                                                                                                                                        | Signed Windows/macOS builds, update behavior, platform testing, and release runbook remain open.                                                                                                                                                                                                                                                   |
| Observability, cost limits, security, and recovery | Health/readiness, heartbeat, maintenance leases/metrics, quota/recompute/cost alert inspections, bounded signed alert delivery, exact cost units, actor attribution, source-policy gates, redaction, dependency audit, cancellation recovery, and a process-level worker replacement drill are tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Deployed scheduler ownership, endpoint/provider operations, provider billing, multi-instance/restore drills, and hosted deployment proof remain open.                                                                                                                                                                                              |
| Guidance, memory, skills, and provenance           | Docs, active plan, memory, native skills, source policy, tests, and this audit record fixture-only/review-gated scope and visible coverage gaps. Imported content remains untrusted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Continue guidance checkpoints after each tranche; no completion claim is justified while listed gates remain.                                                                                                                                                                                                                                      |

## Validation evidence

Passing on 2026-08-03:

Additional validation on 2026-08-04:

- The private **Usage** page now exposes exact, currency-separated cost ledger
  totals and bounded source-quota reconciliation cases to workspace members.
  It does not resolve cases, refund quota, or re-fetch sources; page tests cover
  private membership, read-model rendering, and sanitized dependency failures.
- The private owner **Agent access** page now manages the existing scoped
  read-only MCP tokens without expanding the write boundary. It offers
  least-privilege scopes, shows the raw credential only in the immediate
  create response, keeps later lists metadata-only, and routes step-up/MFA
  failures to the existing account-security boundary. The page guard, web
  lint/typecheck, and 168 web tests pass.
- The shared `productionPlanPackagePaths` contract now validates the complete
  six-file production plan manifest at seed creation and analysis admission;
  report generation consumes the same constant. Legacy portable-path rows stay
  readable, while user and worker analysis reads fail closed with a clear
  replacement requirement. Contract, report, database, workflow, and web tests
  cover the boundary.
- `pnpm verify:local-stack` passed the complete local private-workspace path:
  owner signup, durable owner-import consumption, complaint confirmation,
  reviewed/approved opportunity seed, production-analysis workflow completion,
  private opportunity API, and private opportunity/report/plan page readback.
  The smoke keeps the imported row and seed explicitly smoke-only and checks
  the public-market coverage gap. The proof also fixed three integration
  boundaries found by the run: persisted complaint-analysis snapshots now use
  the canonical complaint identity, production opportunity and run links are
  inserted before dependent cluster/competitor memberships, and encoded
  workspace path parameters are decoded at the private opportunity boundary.
- The affected database suite passed 150 tests and the worker suite passed 124
  tests; the local-stack script tests passed. The seed form now defaults to the
  six supported production plan paths required by deterministic package
  generation. This remains a local/fixture-backed production-shaped proof, not
  activation of a public source or evidence of real market demand.
- The production Temporal preflight now requires the exact reviewed
  `APPSEA_TEMPORAL_TASK_QUEUE=appsea-research-v1` declaration. A release-boundary
  test rejects a missing or changed queue, and the worker preflight suite keeps
  the failure fixed-code and secret-free. This narrows the deployment ACL
  contract; it does not prove the remote namespace/task-queue ACL.
- The affected worker suite passed 124 tests and typecheck; the release-boundary
  script passed five tests and `pnpm verify:release -- --static` passed.

- GitHub Actions run `30893053945` passed for commit `b67a51b`, including the
  release-boundary verifier, full verification/security, fresh PostgreSQL and
  Temporal checks, worker replacement, local-stack and container smoke, and
  independent Windows/macOS desktop boundary jobs.
- GitHub Actions run `30887742764` passed for commit `b833a69`, including the
  loopback private-stack smoke, fresh PostgreSQL and Temporal checks, worker
  replacement, container builds, full verification, and independent Windows and
  macOS desktop boundary jobs.
- GitHub Actions run `30888245800` passed for the follow-up documentation
  commit `8ffe554`, confirming the same full matrix after the evidence update.

- GitHub Actions run `30882513772` passed for commit `7a763ba`, including
  the fresh PostgreSQL migration/owner-import integration, fresh Temporal and
  worker-replacement checks, container smoke/builds, full verification, and
  the Windows desktop boundary.

- `pnpm verify` — all package lint, typecheck, test, build, fixture, sample,
  smoke, and repository checks passed.
- GitHub Actions run `30824653661` passed for commit `98ef62e`, including the
  Windows desktop boundary/Rust compile job, full verification, fresh
  PostgreSQL and Temporal checks, Compose validation, and both container image
  builds.
- GitHub Actions run `30810550754` passed the updated full `pnpm verify` job,
  fresh PostgreSQL persistence, and fresh Temporal workflow checks for commit
  `54a045e`. The workflow grants only `contents: read`, cancels stale runs per
  ref, and bounds each job with a 30-minute timeout. GitHub emitted a
  non-failing Node.js 20 action-runtime deprecation annotation; action-runtime
  upgrades remain a maintenance follow-up.
- The MFA key-rotation tranche passed `pnpm --filter @appsea/contracts test`
  (94), `pnpm --filter @appsea/db test` (143), and
  `pnpm --filter @appsea/worker test` (118), plus affected package
  typechecks. Migration `0086` defaults existing ciphertext to version 1;
  migration `0087` adds identifier-only rewrap events; the status and bounded
  rewrap commands expose no key material. The latest release-proof run
  is GitHub Actions `30816541495` for commit `8b9b19a`.
- MFA-focused contract, PostgreSQL repository/migration, web-route, worker
  preflight, and retention tests pass; the conditional-MFA route scenario
  passed in GitHub Actions run `30786965857` for commit `b9cb95e`.
- GitHub Actions run `30786965857` passed the aggregate verify, fresh
  PostgreSQL persistence, and fresh Temporal workflow jobs before the purge
  manifest tranche.
- `pnpm --filter @appsea/contracts test` — 89 passed.
- `pnpm --filter @appsea/db test` — 135 passed.
- `pnpm --filter @appsea/workflows test` — 29 passed.
- `pnpm --filter @appsea/worker test` — 105 passed, including signed
  operational alert delivery and preflight coverage.
- `pnpm --filter @appsea/web test` — 144 passed.
- Affected package typechecks and lints, `git diff --check`, and the
  migration catalog check passed.
- The OIDC identity-boundary tranche passed focused web, database, worker, and
  contract tests, affected typechecks/lints, and `pnpm security:audit` with no
  known dependency vulnerabilities. The provider remains disabled by default;
  no live provider or source activation is claimed.
- GitHub Actions run `30838396204` passed on commit `90f0cf2`, including the
  aggregate verify/security audit, fresh PostgreSQL migration `0088` install
  and populated upgrade, fresh Temporal checks, container smoke, and the
  Windows desktop boundary. GitHub emitted only the known non-failing Node.js
  20 action-runtime deprecation annotation.
- The worker-replacement implementation passed worker tests/typecheck/lint,
  workflow typecheck, script syntax, and documentation validation. Its
  Docker-backed execution was attempted locally but stopped before services
  started because this host's Docker Desktop Linux engine pipe is unavailable;
  hosted GitHub Actions run `30841762532` then passed the drill with
  `completed:completed:2`, `1:1:7:1:2` durable rows, and two distinct outbox
  event types (`research.run.completed`, `workflow.job.completed`).

Attempted but unavailable on this host:

- `pnpm verify:persistence:fresh`
- `pnpm verify:workflows:fresh`

Both stop before execution because the Docker Desktop Linux engine pipe is
unavailable on this host. The hosted CI proof above covers the fresh
PostgreSQL/Temporal checks; no additional local rerun claim is made.

## Deliberate simplifications

- The only complete research path remains synthetic fixture mode.
- No third-party public source is activated by the repository or an autonomous
  worker; the manual owner-import path is intentionally active only for
  tenant-private, authority-attested data.
- One-/multi-source cancellation is implemented as a repository/API/UI and
  retry boundary; deployed Temporal cancellation and hosted crash/restore
  evidence are not simulated.
- Alert scans remain read-only and do not block admission, repair work, or
  perform billing; alert/incomplete/failure outcomes use a bounded signed
  delivery attempt and clear outcomes remain local observations.
- Purge readiness and cancellation are control/readiness boundaries, not
  authorization to delete research, exports, objects, or backups.
- Production identity, cloud retention/purge, provider billing, incident
  endpoint operation, infrastructure provisioning, and signed desktop release are not
  simulated as complete.

## Additional validation on 2026-08-04

- Private workspace page boundaries now decode encoded identifiers exactly once
  through `apps/web/src/server/path-params.ts` before schema validation. The
  focused tests cover encoded, double-encoded, and malformed segments.
- `pnpm verify:local-stack` now reads every private workspace page (sources,
  seed reviews, campaigns, imports, members, collection, analysis, workflow,
  and campaign runs) with encoded identifiers. The smoke remains tenant-private
  and fixture/owner-import content remains explicitly non-market evidence.
- Migration `0095_workspace_purge_readiness_lease_grant.sql` repairs the
  authenticated members readiness projection with a least-privilege two-column
  lease read; direct lease lifecycle access remains unavailable to the runtime.
- Fresh PostgreSQL persistence now passes 49 integration tests across 95
  migrations. Session revocation and seed-review approval timestamps tolerate
  application/database clock skew without violating timestamp checks; the
  operational-alert fixture uses an explicitly due timestamp for deterministic
  claim/retry proof.
- The isolated `pnpm verify:backup-restore` drill now creates a temporary
  loopback dump, restores it into `appsea_backup_restore_check`, and verifies
  the complete 95-migration prefix, forced workspace RLS, runtime outbox
  denial, and maintenance alert-claim privilege. It rejects production and
  caller-selected database URLs, cleans up the restored database/dump, and is
  not provider backup, HA, or production restore evidence.
- No image asset was required for this server/page-boundary tranche. Existing
  UI assets remain unchanged; image generation is reserved for visual assets,
  not native route or database code.
- Hosted GitHub Actions run `30917740935` for `b99ffd7` and implementation run
  `30919346892` for `f86ca22` failed before any job steps in every matrix job
  because of the account payment/spending-limit gate; local proof above is
  therefore not being presented as hosted proof.

## Exact next actions

1. Obtain independent source approvals for CFPB and a separate
   competitor/contrary-evidence source.
2. Provision role-separated PostgreSQL and authenticated Temporal; run fresh
   migration, restore, cancellation crash/retry, hosted worker replacement,
   and legacy-history drills.
3. Approve OIDC/verified identity and delivery providers, DPA/retention,
   the live MFA key-rotation rollout/status review,
   provider-backed step-up, mutation contracts without a password boundary,
   and recovery/invitation monitoring.
4. Deploy encrypted object storage with lifecycle/versioning, export/workspace
   purge, backup deletion verification, provider pricing, and the configured
   alert endpoint with rotation and incident-routing evidence.
5. Complete signed Windows/macOS Tauri release validation.

This is completion proof for the audit only; it is not a claim that AppSea is
production-ready or that real market research is available.
