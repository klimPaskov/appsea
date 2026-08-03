# Production-readiness audit — 2026-08-03

Status: not production-ready. This audit records the current repository
evidence after the MFA key-rotation and CI release-proof tranches.

## Surface status

| Requirement                                        | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Remaining gate                                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL persistence and migrations              | Implemented as a production-shaped repository slice through migration `0087`; forced-RLS sources, evidence, complaints, clusters, competitors, opportunities, scores, reports, plans, workflow lineage, costs, deletion queues, agent tokens, one-/multi-source cancellation intent, private history pagination, global-auth MFA material/retention, versioned current/previous MFA keys, bounded dormant-account rewrap with identifier-only events, count-only rotation status, session-bound conditional MFA, and archived-owner metadata-only purge manifests are covered by package tests and CI integration. | Role provisioning, restore/backup drills, production credentials, and an approved live key-rotation operation remain unproven.                                                                                                   |
| Durable workflow engine and idempotent jobs        | Fixture, production collection, analysis, refresh, recomputation, maintenance, multi-source orchestration, and cancellation retry boundaries have deterministic identities, bounded retries, leases, safe terminal states, and local tests.                                                                                                                                                                                                                                                                                                                                                                        | Authenticated Temporal namespace/task-queue authorization, deployed scheduler ownership, HA, crash drills, and legacy v1 history drain remain open.                                                                              |
| Approved complaint source connector                | CFPB is typed, policy-gated, quota-bound, provenance-preserving, and fixture-tested; Stack Exchange is a reviewed candidate only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Independent legal/privacy/security/commercial-use/retention approval is required before activation. No source is enabled.                                                                                                        |
| Complaint analysis and scoring                     | Normalization, deduplication, classification/entity snapshots, clustering, competitor/contrary fields, deterministic versioned scoring, correction invalidation, and bounded recomputation are persisted and tested.                                                                                                                                                                                                                                                                                                                                                                                               | Live non-fixture research and permitted competitor evidence remain unavailable.                                                                                                                                                  |
| Reports and coding-agent packages                  | Evidence-backed reports, coverage gaps, approval state, object references, plans, approved export, private routes, and read-only scoped MCP reads are implemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Encrypted cloud object storage, workspace/export purge, backup deletion verification, and deployment controls remain open.                                                                                                       |
| Authentication and private workspaces              | Password sessions, membership/RLS, step-up, session inventory/revocation, TOTP MFA with one-time recovery codes and expiring login challenges, versioned current/previous MFA keys with transactional and bounded dormant-account rewrap, identifier-only rotation events, count-only rotation status, conditional MFA step-up for password-gated high-risk mutations, account closure, invitations/recovery mechanics, archival, and owner-issued scoped agent tokens exist.                                                                                                                                      | OIDC/verified identity, delivery/provider/DPA review, approved live key-rotation rollout/status review, provider-backed step-up, mutation contracts without a password boundary, and production identity operations remain open. |
| Website and desktop boundary                       | Sparse public leaderboard, private opportunity/campaign routes, evidence/source coverage, reports/plans, and private one-/multi-source cancellation UI/API are implemented; the release workflow now runs the full fixture, build, route-smoke, and repository proof with read-only GitHub permissions; desktop remains a staged Tauri boundary.                                                                                                                                                                                                                                                                   | Signed Windows/macOS builds, update behavior, platform testing, and release runbook remain open.                                                                                                                                 |
| Observability, cost limits, security, and recovery | Health/readiness, heartbeat, maintenance leases/metrics, quota/recompute/cost alert inspections, bounded signed alert delivery, exact cost units, actor attribution, source-policy gates, redaction, and cancellation recovery are tested.                                                                                                                                                                                                                                                                                                                                                                         | Deployed scheduler ownership, endpoint/provider operations, provider billing, multi-instance failure drills, and Docker-backed proof remain open.                                                                                |
| Guidance, memory, skills, and provenance           | Docs, active plan, memory, native skills, source policy, tests, and this audit record fixture-only/review-gated scope and visible coverage gaps. Imported content remains untrusted.                                                                                                                                                                                                                                                                                                                                                                                                                               | Continue guidance checkpoints after each tranche; no completion claim is justified while listed gates remain.                                                                                                                    |

## Validation evidence

Passing on 2026-08-03:

- `pnpm verify` — all package lint, typecheck, test, build, fixture, sample,
  smoke, and repository checks passed.
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

Attempted but unavailable on this host:

- `pnpm verify:persistence:fresh`
- `pnpm verify:workflows:fresh`

Both stop before execution because the Docker Desktop Linux engine pipe is
unavailable. No fresh PostgreSQL role/RLS/upgrade or Temporal crash/replay
claim is made.

## Deliberate simplifications

- The only complete research path remains synthetic fixture mode.
- No source is activated by the repository or an autonomous worker.
- One-/multi-source cancellation is implemented as a repository/API/UI and
  retry boundary; deployed Temporal cancellation and crash-drill evidence are
  not simulated.
- Alert scans remain read-only and do not block admission, repair work, or
  perform billing; alert/incomplete/failure outcomes use a bounded signed
  delivery attempt and clear outcomes remain local observations.
- Purge readiness and cancellation are control/readiness boundaries, not
  authorization to delete research, exports, objects, or backups.
- Production identity, cloud retention/purge, provider billing, incident
  endpoint operation, infrastructure provisioning, and signed desktop release are not
  simulated as complete.

## Exact next actions

1. Obtain independent source approvals for CFPB and a separate
   competitor/contrary-evidence source.
2. Provision role-separated PostgreSQL and authenticated Temporal; run fresh
   migration, restore, cancellation crash/retry, and legacy-history drills.
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
