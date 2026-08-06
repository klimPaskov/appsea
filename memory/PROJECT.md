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
- `scripts/run_db_backup_restore.mjs` provides a local 119-migration dump/restore drill with forced RLS and least-privilege checks; it is not provider HA or production restore evidence.
- `packages/workflows` owns Temporal/client hashing; `apps/worker` owns
  activities/startup; `packages/db` owns RLS persistence. Local proof passes
  through `0119`; workflow security, HA, object-store purge, and deployment
  remain external.
- Campaign cancellation is a durable control boundary: migrations `0070`/`0071` store owner/editor intent before Temporal for multi-source and one-source runs; the worker retries external cancellation, while each workflow owns safe reconciliation.
- Private campaign history uses strict bounded cursor pages ordered by request timestamp plus stable identifier; only the validated boundary crosses private APIs. The public leaderboard is unaffected.
- Public `/leaderboard` and `/` share a database-free view. `pnpm ui:capture`
  audits 1280/1024/768/480; `pnpm ui:capture:private` captures nine
  routes with an owner session and layout checks.
  PNGs are local synthetic/owner content, not public market coverage.
- Migration `0068` and `PostgresResearchCampaignOrchestrationRepository` own the durable multi-source campaign parent/child queue. The existing service admission and one-source Temporal workflow remain the child execution boundary; the lease-backed maintenance worker rechecks approved policy and reconciles child projections into private parent/campaign state. The slice is production-shaped but live source activation, deployed scheduler/Temporal ownership, and crash/retry proof remain external.
- Migrations `0069` and `0081` plus `PostgresAgentAccessTokenRepository` own expiring, hash-only, forced-RLS agent tokens. `/api/mcp` is read-only, workspace-bound, scope-filtered, and reuses private projections; non-synthetic reports/plans require approval. Password-gated mutations require recent password step-up plus a fresh MFA marker when MFA is enabled; provider identity, secret/rate-limit deployment, and mutations without step-up remain external. Migration `0080` owns browser TOTP.
- The post-collection production analysis workflow is `production-analysis-v2`: Temporal carries only identifiers and immutable digests, and `apps/worker` reconstructs the reviewed artifact from workspace-bound rows inside the persistence activity. New starts carry a strict history-safety memo; `apps/worker` provides a visibility-only checker and reviewed manifest for legacy v1 histories, while archive/retention remains deployment-owned.
- Migration `0055` persists the highest bounded Temporal activity attempt on each production-analysis run through a monotonic trigger and a narrow runtime update grant; the attempt remains outside the research input hash.
- Migration `0056` adds forced-RLS, secret-free production-analysis activity history with server-clock start/finish/duration, bounded stage heartbeats, fixed failure codes, and immutable lineage; the private status projection exposes at most ten rows.
- Migration `0059` adds forced-RLS competitor observations with source/evidence lineage, purpose gating, bounded claims, and owner/editor review; only confirmed non-synthetic rows become source-backed. Complaint locators are HTTPS-constrained by migration `0060`. Production collection and refresh select connectors only from matching approved snapshots; Stack Exchange remains a disabled candidate with an AUP/written-consent blocker and operator-only review CLI.
- Migration `0061` adds forced-RLS immutable complaint-analysis correction history and an editor/owner security-definer boundary. Corrections change only derived snapshots, preserve source/provenance, invalidate stale active analysis/opportunity projections, and are passed into the next reviewed production artifact. Migration `0062` extends the existing forced-RLS recomputation queue with a deferred correction trigger that creates one deterministic repair per affected opportunity; missing or unapproved seeds remain blocked and inspectable.
- Migration `0067` adds forced-RLS immutable evidence-redaction receipts and a security-definer owner/editor function. Redaction masks only selected current display fields and is applied by private collection, opportunity/leaderboard, analysis, report, coding-plan, and export readers; source identity, policy/capture lineage, hashes, and immutable analysis snapshots remain. Text masks require raw-object deletion to have already followed the approved source policy.
- Migration `0073` adds a forced-RLS workspace purge-intent ledger. Owner step-up plus exact confirmation snapshots a `database_ready` inventory into an idempotent `awaiting_external_controls` request with identifier-only audit/outbox receipts; cancellation is explicit, and no provider or database deletion is authorized by the intent.
- Migration `0105` adds forced-RLS append-only opportunity decisions with
  identifier-only snapshots, owner approval, idempotency, step-up, and read-only
  MCP. Migration `0106` adds append-only cluster review events, stale hashes,
  split/merge lineage, membership updates, redaction-aware reads, and a gate
  blocker for unreviewed current clusters.
- Migration `0083` adds a forced-RLS workspace purge-manifest ledger; `0084` repairs PostgreSQL 18 archival qualification, `0085` keeps private reads read-only, `0086` versions MFA ciphertext, and `0087` adds identifier-only dormant-account rewrap events. An archived owner can prepare a deduplicated 24-hour inventory of workspace-bound object references after password+MFA step-up; the private manifest never authorizes deletion. MFA rotation uses a reviewed current/previous-key window, bounded rewrap, and count-only status; previous-key removal remains operator-controlled.
- `packages/db` migrations 0008-0039 own auth/session/RLS, source quotas/tombstones, report approval, collection leases, actor attribution, and immutable policy-review evidence. The web boundary uses an HttpOnly session cookie and authorizes membership before RLS; recovery/invitation delivery remain provider-gated.
- `packages/reports` owns the deterministic fixture opportunity report contract and composer; fixture persistence stores its content-hashed report version and links the plan package. Private report reads keep evidence, inference, recommendation, contrary evidence, and source coverage separate.
- `apps/worker` maintenance commands use `packages/contracts`-validated pure runners with bounded counters, sorted workspace enumeration, independent quota expiry/purge budgets, and scheduler correlation IDs; PostgreSQL idempotency remains the rerun boundary. The `maintenance:loop` entrypoint supervises one lease-backed pass at a time with bounded interval/backoff and signal-safe child shutdown; deployment process ownership and alerting remain external.
- Migrations `0046`-`0052` own server-clock maintenance leases/fencing, scheduler metrics, cost/quota inspection, explicit tombstone-bound re-collection, and the direct-CFPB worker admission branch. The original lease boundary is allowlisted to four scheduler names and callable only through `appsea_maintenance`; later forward migrations extend that allowlist for source-health, delivery, and operational-alert status inspection without changing released history. Re-collection is never automatic. External source/provider/object-store effects, deployed scheduler ownership, alert routing, billing, and lock/recovery proof remain external.
- The private source registry includes bounded connector health from jobs, active items, and deletion tombstones; raw failures and mutation controls stay outside the read boundary.
- Migration `0107` adds a workspace-context-required, security-definer source
  quota headroom projection. It reports only shared current-minute limit/used/
  remaining capacity and window timestamps; direct runtime access to global
  quota windows and reservation rows remains denied.
- Migrations `0108` and `0109` add a maintenance-only scalar source-health
  projection and scheduler/outbox allowlist for `source:health:alert`; it
  returns no source payloads, policy JSON, complaint text, or activation
  capability and capped coverage remains incomplete. Migrations `0116` and
  `0117` add shared complete-review collectibility and an operator-only scalar
  approval-progress read; `0118` closes direct activation, lease/reconciliation
  replay, and production-lineage gates; `0119` adds policy-impact expiry and
  current-policy private read/export gates.
- The source-policy repository returns the hash-verified immutable policy JSON
  alongside the effective activation snapshot. Production connector
  constructors compare immutable purpose/quota/retention/deletion/display
  metadata and fail closed when the reviewed payload is absent; activation
  fields remain database-owned. Migration `0111` adds optional
  `permissionEvidenceRequired` policy metadata and stores a required external
  permission/exception reference on immutable approval rows when declared.
- `apps/worker` provides deterministic, secret-free source-policy review
  manifests for CFPB and Stack Exchange. The Stack Exchange packet records
  first-party API/AUP/attribution/licensing evidence and the written-consent or
  commercial-exception gate; neither manifest contacts or activates a source.
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
