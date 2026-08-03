# Production-readiness audit — 2026-08-03

Status: not production-ready. This audit records the current repository
evidence after the global-auth TOTP MFA and agent-token step-up tranches.

## Surface status

| Requirement                                        | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                | Remaining gate                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL persistence and migrations              | Implemented as a production-shaped repository slice through migration `0081`; forced-RLS sources, evidence, complaints, clusters, competitors, opportunities, scores, reports, plans, workflow lineage, costs, deletion queues, agent tokens, one-/multi-source cancellation intent, private history pagination, global-auth MFA material/retention, and the session-bound agent-token MFA marker are covered by package tests. | Fresh PostgreSQL execution, role provisioning, restore/backup drills, and production credentials remain unproven.                                                                           |
| Durable workflow engine and idempotent jobs        | Fixture, production collection, analysis, refresh, recomputation, maintenance, multi-source orchestration, and cancellation retry boundaries have deterministic identities, bounded retries, leases, safe terminal states, and local tests.                                                                                                                                                                                     | Authenticated Temporal namespace/task-queue authorization, deployed scheduler ownership, HA, crash drills, and legacy v1 history drain remain open.                                         |
| Approved complaint source connector                | CFPB is typed, policy-gated, quota-bound, provenance-preserving, and fixture-tested; Stack Exchange is a reviewed candidate only.                                                                                                                                                                                                                                                                                               | Independent legal/privacy/security/commercial-use/retention approval is required before activation. No source is enabled.                                                                   |
| Complaint analysis and scoring                     | Normalization, deduplication, classification/entity snapshots, clustering, competitor/contrary fields, deterministic versioned scoring, correction invalidation, and bounded recomputation are persisted and tested.                                                                                                                                                                                                            | Live non-fixture research and permitted competitor evidence remain unavailable.                                                                                                             |
| Reports and coding-agent packages                  | Evidence-backed reports, coverage gaps, approval state, object references, plans, approved export, private routes, and read-only scoped MCP reads are implemented.                                                                                                                                                                                                                                                              | Encrypted cloud object storage, workspace/export purge, backup deletion verification, and deployment controls remain open.                                                                  |
| Authentication and private workspaces              | Password sessions, membership/RLS, step-up, session inventory/revocation, TOTP MFA with one-time recovery codes and expiring login challenges, conditional MFA step-up for agent-token issue/revoke, account closure, invitations/recovery mechanics, archival, and owner-issued scoped agent tokens exist.                                                                                                                     | OIDC/verified identity, delivery/provider/DPA review, MFA/key rotation, provider-backed step-up, enforcement for other high-risk mutations, and production identity operations remain open. |
| Website and desktop boundary                       | Sparse public leaderboard, private opportunity/campaign routes, evidence/source coverage, reports/plans, and private one-/multi-source cancellation UI/API are implemented; desktop remains a staged Tauri boundary.                                                                                                                                                                                                            | Signed Windows/macOS builds, update behavior, platform testing, and release runbook remain open.                                                                                            |
| Observability, cost limits, security, and recovery | Health/readiness, heartbeat, maintenance leases/metrics, quota/recompute/cost alert inspections, bounded signed alert delivery, exact cost units, actor attribution, source-policy gates, redaction, and cancellation recovery are tested.                                                                                                                                                                                      | Deployed scheduler ownership, endpoint/provider operations, provider billing, multi-instance failure drills, and Docker-backed proof remain open.                                           |
| Guidance, memory, skills, and provenance           | Docs, active plan, memory, native skills, source policy, tests, and this audit record fixture-only/review-gated scope and visible coverage gaps. Imported content remains untrusted.                                                                                                                                                                                                                                            | Continue guidance checkpoints after each tranche; no completion claim is justified while listed gates remain.                                                                               |

## Validation evidence

Passing on 2026-08-03:

- `pnpm verify` — all package lint, typecheck, test, build, fixture, sample,
  smoke, and repository checks passed.
- MFA-focused contract, PostgreSQL repository/migration, web-route, worker
  preflight, and retention tests pass; the MFA integration scenario passed in
  GitHub Actions run `30784131943` for commit `13a3744`.
- GitHub Actions run `30784131943` passed the aggregate verify, fresh
  PostgreSQL persistence, and fresh Temporal workflow jobs.
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
3. Approve OIDC/verified identity and delivery providers, DPA/retention, MFA
   key rotation, provider-backed step-up, enforcement for high-risk mutations
   outside agent-token issue/revoke, and
   recovery/invitation monitoring.
4. Deploy encrypted object storage with lifecycle/versioning, export/workspace
   purge, backup deletion verification, provider pricing, and the configured
   alert endpoint with rotation and incident-routing evidence.
5. Complete signed Windows/macOS Tauri release validation.

This is completion proof for the audit only; it is not a claim that AppSea is
production-ready or that real market research is available.
