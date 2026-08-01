# Current status

- Version: `0.3.0`
- Stage: validated fixture product with production-shaped PostgreSQL persistence and a local/CI-proven durable workflow slice
- Production-readiness: not complete; see [`production-readiness-audit-2026-07-25.md`](production-readiness-audit-2026-07-25.md)
- Website: implemented; the previous production-build proof exists, while a
  fresh local rebuild is blocked by the incomplete `protobufjs` install
- Private workspace website/API: implemented and production-built; reads are membership-authorized and cache-disabled. Completed collection reads now expose the bounded private `analysisHandoff` status when an approved-seed handoff exists.
- Fixture worker: implemented and tested
- Plan package generator: implemented and tested
- Evidence/report package: deterministic fixture report composer, a
  production-shaped offline analysis composer with policy/evidence provenance,
  reviewed seed registry and distinct analysis-run contracts, versioned report
  persistence, source-policy coverage metadata, private report rendering,
  approval governance, approved JSON export, a content-addressed
  object-storage seam/test adapter, and an explicit confirmed-evidence
  analysis-start route implemented
- PostgreSQL persistence: thirty-nine forward, checksummed migrations plus least-privilege repositories, durable auth controls, owner-scoped member administration and existing-account invitations with session step-up, owner-safe account closure, complaint review plus immutable seed-review and report/plan approval guards, source quota reservations, policy-derived retention tombstones, deletion lineage, monotonic source/evidence/tombstone guards, migration-owner source-policy review/activation evidence, a migration-owner maintenance enumerator, fixture and production-collection workflow checkpoints with principal attribution, deterministic analysis handoff and deletion-triggered recomputation queues, durable production-analysis lineage/object references, source-deletion invalidation, mutable opportunity availability repair, same-run active-evidence re-analysis recovery, and database-serialized production ingress admissions through migrations `0036`–`0039`, plus policy-bound source collection leases with stable observed timestamps
- Database verification: PostgreSQL 18 fresh-install and populated-upgrade lifecycle is covered by local/CI gates; this environment currently lacks Docker for a fresh rerun
- Native Codex skills: 21 synchronized skills
- Codex helper agents: 11 bounded agents
- Project memory: implemented and validated
- Documentation system: implemented and linked
- UI references: fourteen sparse desktop/mobile references; the seed-review
  route currently has deterministic SVG sources while raster export awaits the
  local `cairosvg` dependency
- Real source connectors: CFPB connector boundary and policy metadata implemented, disabled pending legal/privacy/security approval; migration `0027` adds operator-only draft/approval evidence, and the production collection checkpoint persists policy-bound non-synthetic source/evidence/complaint lineage when a reviewed version is explicitly activated; no source is activated in this repository
- Production database deployment: not provisioned; the schema, repository, migrations, roles, RLS, and local/CI proof are implemented
- Authentication: private workspace signup/sign-in, hashed/revocable sessions with authenticated inventory and per-session revocation, durable login/signup/reauthentication/recovery/invitation/account-closure throttling, bounded retention, 15-minute password step-up for high-risk mutations, owner-scoped member role administration and existing-account invitations, membership authorization, private research read routes, single-use reset/invitation outbox mechanics, and owner-safe account closure implemented; recovery and invitation delivery are kill-switched pending provider/identity review, while MFA/OIDC and external identity policy remain
- Durable workflow engine: fixture, production-collection, and post-collection production-analysis Temporal workflow/client boundaries, an approved-seed handoff queue with skip-locked stale-claim recovery, a private collection read model for handoff state, PostgreSQL job/checkpoint/lineage projections, bounded retries, budget rejection, terminal reconciliation, authenticated private-workspace start/status routes, user/service attribution, and a database-serialized per-workspace production start rate/concurrency gate with idempotent reservations are implemented and locally tested. Production analysis starts now use identifier-only workflow version `v2`; the worker reconstructs the artifact inside the activity so complaint text is not recorded in new Temporal histories. Production Temporal provisioning, TLS/authentication, HA, crash/failure drills, and a controlled drain plan for legacy v1 histories remain unimplemented.
- Source maintenance: bounded, schema-validated all-workspace PostgreSQL quota expiry/purge, production workflow admission and source-collection-lease purge, policy-derived retention tombstone enqueue, and skip-locked deletion propagation with stale-claim recovery, opportunity availability invalidation/de-ranking, stable scheduler job IDs, independent quota/retention budgets, secret-free structured counters, and retryable password-recovery and workspace-invitation delivery workers implemented through narrow migration-owner security-definer boundaries; provider operations, object-store purge, production scheduling, and fresh Docker proof remain
- Windows and macOS release: not implemented

The current leaderboard is synthetic. It validates ranking, navigation, planning-package generation, and the simple interface contract.

`pnpm analysis:sample` produces a visibly `testOnly` production-shaped CFPB
artifact, report, deterministic score, and generic coding package under
`artifacts/analysis-sample/`. It does not activate a connector, call the
network, persist analysis, or establish market facts.

The persistence slice stores normalized fixture and reviewed production source/evidence lineage, complaints with explicit curation state, immutable workspace seed reviews, clusters, competitors, opportunities, immutable score snapshots, deterministic evidence-backed report versions linked to plan packages, content-addressed analysis output references, audit events, costs, deletion tombstones, outbox events, workflow checkpoints, recomputation dispatch state, and run lineage. Migration `0035` prevents a source-deleted production opportunity projection from remaining rankable; migration `0036` permits reactivation only after a new active analysis output has been linked, and migration `0037` queues a bounded active-evidence repair with an approved-seed gate. The workflow proof covers retries, budgets, cancellation, duplicate starts, raw-history leakage, and local Temporal replay; PostgreSQL migration/read/deletion integration remains unproven until Docker and a secured deployment are available. It does not turn the fixture into market evidence, activate a source, or provide production Temporal/cloud-storage security.

New production-analysis v2 starts exclude raw evidence from Temporal history, but
legacy v1 histories may already contain artifact payloads and require controlled
worker draining/retention. Object-store purge/race handling,
lease assert-to-persist atomicity, stale recompute-claim recovery, terminal
tombstone retry, and authenticated admission for the direct source CLI remain
open security and operations work.
The analysis activity now anchors retention to server-observed time, rejects
materially future timestamps, and finalizes only against an active/current/
unexpired policy with allowed or restricted commercial use and confirmed,
redacted evidence. Production collection initialization now fails closed when
its database admission reservation is absent or already consumed. Manual
analysis admission/rate limits and initiator actor attribution remain open.
