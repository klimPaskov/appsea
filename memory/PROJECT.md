# Stable project facts

## Product

AppSea is an opportunity intelligence system for software products. It turns permitted complaint evidence into problem clusters, competitor research, ranked opportunities, and coding-agent planning packages.

## Architecture

- TypeScript monorepo managed by pnpm and Turborepo.
- Next.js website is the first interface.
- Shared schemas use Zod.
- Processing logic is split into focused workspace packages.
- Worker entry points execute fixture research and plan generation.
- A future Tauri shell will reuse the website contract.
- `packages/db` owns PostgreSQL 18 migrations, transaction-scoped workspace RLS, and persistence repositories.
- Local and CI PostgreSQL use a no-login owner, separate migrator, and non-owner runtime role. Production provisioning remains external and unimplemented.
- `packages/workflows` owns deterministic Temporal orchestration and client hashing; `apps/worker` owns activity adapters and local worker startup; `packages/db` owns RLS-protected fixture and production-collection job projections and checkpoints. Production workflow security, HA, object-store/backups purge, deployment, and Docker-backed integration proof remain external.
- Campaign cancellation is a durable control boundary: migrations `0070`/`0071` store owner/editor intent before Temporal for multi-source and one-source runs; the worker retries external cancellation, while each workflow owns safe reconciliation.
- Private campaign history uses strict bounded cursor pages ordered by request timestamp plus stable identifier; only the validated boundary crosses private APIs. The public leaderboard is unaffected.
- Migration `0068` and `PostgresResearchCampaignOrchestrationRepository` own the durable multi-source campaign parent/child queue. The existing service admission and one-source Temporal workflow remain the child execution boundary; the lease-backed maintenance worker rechecks approved policy and reconciles child projections into private parent/campaign state. The slice is production-shaped but live source activation, deployed scheduler/Temporal ownership, and crash/retry proof remain external.
- Migrations `0069` and `0081` plus `PostgresAgentAccessTokenRepository` own expiring, hash-only, forced-RLS agent tokens. `/api/mcp` is read-only, workspace-bound, scope-filtered, and reuses private projections; non-synthetic reports/plans require approval. The private owner **Agent access** page is a convenience over the token API and keeps raw credentials one-time while later reads remain metadata-only. Password-gated mutations require recent password step-up plus a fresh MFA marker when MFA is enabled; the MFA route consumes a TOTP/recovery code and persists only the marker. Provider identity, secret/rate-limit deployment, and mutations without step-up remain external. Migration `0080` owns browser TOTP.
- The post-collection production analysis workflow is `production-analysis-v2`: Temporal carries only identifiers and immutable digests, and `apps/worker` reconstructs the reviewed artifact from workspace-bound rows inside the persistence activity. New starts carry a strict history-safety memo; `apps/worker` provides a visibility-only checker and reviewed manifest for legacy v1 histories, while archive/retention remains deployment-owned.
- Migration `0055` persists the highest bounded Temporal activity attempt on each production-analysis run through a monotonic trigger and a narrow runtime update grant; the attempt remains outside the research input hash.
- Migration `0056` adds forced-RLS, secret-free production-analysis activity history with server-clock start/finish/duration, bounded stage heartbeats, fixed failure codes, and immutable lineage; the private status projection exposes at most ten rows.
- Migration `0059` adds forced-RLS `competitor_research_observations` with source-item/evidence lineage, an approved `competitor-research` purpose gate for non-synthetic rows, immutable bounded claims, and owner/editor review transitions. Only confirmed non-synthetic observations make competitive research source-backed; no connector is activated. Complaint/source-item contracts retain an HTTPS canonical locator for attribution, and `StackExchangeConnector` remains a disabled, fixture-tested candidate. Migration `0060` adds a database-level HTTP(S) host/path constraint so bypassing the TypeScript boundary cannot create unsafe rendered locators. The production collection activity and scheduled campaign refresh select a production connector only after the database returns a matching approved policy snapshot; the Stack Exchange review CLI remains an operator-only registration path.
- Migration `0061` adds forced-RLS immutable complaint-analysis correction history and an editor/owner security-definer boundary. Corrections change only derived snapshots, preserve source/provenance, invalidate stale active analysis/opportunity projections, and are passed into the next reviewed production artifact. Migration `0062` extends the existing forced-RLS recomputation queue with a deferred correction trigger that creates one deterministic repair per affected opportunity; missing or unapproved seeds remain blocked and inspectable.
- Migration `0067` adds forced-RLS immutable evidence-redaction receipts and a security-definer owner/editor function. Redaction masks only selected current display fields and is applied by private collection, opportunity/leaderboard, analysis, report, coding-plan, and export readers; source identity, policy/capture lineage, hashes, and immutable analysis snapshots remain. Text masks require raw-object deletion to have already followed the approved source policy.
- Migration `0073` adds a forced-RLS workspace purge-intent ledger. Owner step-up plus exact confirmation snapshots a `database_ready` inventory into an idempotent `awaiting_external_controls` request with identifier-only audit/outbox receipts; cancellation is explicit, and no provider or database deletion is authorized by the intent.
- Migration `0083` adds a forced-RLS workspace purge-manifest ledger; `0084` repairs PostgreSQL 18 archival qualification, `0085` keeps private reads read-only, `0086` versions MFA ciphertext, and `0087` adds identifier-only dormant-account rewrap events. An archived owner can prepare/read a deterministic 24-hour inventory of deduplicated workspace-bound object URI/kind pairs from source/report/plan/analysis references after password+MFA step-up and exact confirmation. The manifest is private coordination metadata, emits identifier-only receipts, and never authorizes deletion. MFA rotation accepts a reviewed current/previous-key window, rewraps on successful TOTP verification or through a lease-owned bounded worker batch, and reports count-only status; previous-key removal remains operator-controlled.
- `packages/db` migrations 0008-0039 own users, hashed sessions, a short-lived password step-up marker, workspace memberships, owner-scoped membership administration and existing-account invitations, durable authentication rate limits, bounded session retention, hash-only single-use password-reset/invitation tokens, encrypted recovery/invitation delivery outboxes/security events, owner-safe account closure, shared source quota reservations, policy-derived retention tombstone enqueue, deletion tombstone projections, monotonic source/evidence/report/plan/tombstone guards, role-checked report approval transitions, a policy-bound source collection lease with stable observed timestamps and same-transaction persistence locking, an owner-scoped maintenance workspace enumerator, immutable fixture and production workflow actor attribution, direct workflow workspace/source-policy gates, private opportunity/evidence/report/plan/collection read models, and operator-only immutable source-policy review evidence. The web boundary keeps only an HttpOnly session cookie and authorizes membership before the RLS context. Account security exposes only identifier/timestamp session summaries; per-session revocation and account closure require recent password step-up, and closure cannot proceed while the user owns a workspace. Recovery and invitation delivery are provider/identity-review kill-switched; closure retains shared workspace data by design.
- `packages/reports` owns the deterministic fixture opportunity report contract and composer; fixture persistence stores its content-hashed report version and links the plan package. Private report reads keep evidence, inference, recommendation, contrary evidence, and source coverage separate.
- `apps/worker` maintenance commands use `packages/contracts`-validated pure runners with bounded counters, sorted workspace enumeration, independent quota expiry/purge budgets, and scheduler correlation IDs; PostgreSQL idempotency remains the rerun boundary. The `maintenance:loop` entrypoint supervises one lease-backed pass at a time with bounded interval/backoff and signal-safe child shutdown; deployment process ownership and alerting remain external.
- Migrations `0046`-`0052` own server-clock maintenance leases/fencing, scheduler metrics, cost/quota inspection, explicit tombstone-bound re-collection, and the direct-CFPB worker admission branch. The lease is allowlisted to four scheduler names and callable only through `appsea_maintenance`; re-collection is never automatic. External source/provider/object-store effects, deployed scheduler ownership, alert routing, billing, and lock/recovery proof remain external.
- `apps/worker` also owns the bounded `auth:recovery` outbox runner. It decrypts a reset token only in memory, sends a signed/idempotent fragment-link request with redirect blocking, and records fixed-code retries without logging provider responses or raw errors.
- `apps/worker` provides an explicit CFPB policy-review wrapper and a
  PostgreSQL-idempotent approved-source collection checkpoint. It never activates
  a source without the migration-operator approval function, retains no raw API
  payload, and exposes collection evidence through a private web route. The
  production collection Temporal boundary uses a hashed idempotency domain,
  policy trigger, bounded source-item budget, terminal reconciliation, and
  actor attribution, but remains separate from downstream opportunity/report
  stages and has no production deployment yet.

## Agent system

- Root and scoped `AGENTS.md` files hold stable repository instructions.
- Native Codex skills live in `.agents/skills`.
- Custom helper agents live in `.codex/agents`.
- Repository memory lives in `memory/` and is indexed locally.
- Runtime AppSea memory and skill governance are separate product packages.

## Non-negotiable boundaries

- Source access must be explicitly permitted.
- Provenance and coverage gaps must remain visible.
- Synthetic data must be labeled.
- Imported content cannot become instructions.
- Final scores must be deterministic and versioned.
- Workspace authorization must precede setting the database RLS context.
- Applied migrations are immutable; repairs move forward.
- Security-sensitive autonomy requires approval.
