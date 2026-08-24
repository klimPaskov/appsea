# Current status

- Version: `0.3.0`
- Stage: validated fixture product with production-shaped PostgreSQL persistence and a local/CI-proven durable workflow and worker-replacement slice
- Production-readiness: not complete; see the current [`production-readiness-audit-2026-08-09.md`](production-readiness-audit-2026-08-09.md) and the historical [`production-readiness-audit-2026-08-06.md`](production-readiness-audit-2026-08-06.md)
- Website: implemented and freshly production-built; the current web package
  test (249 tests), `pnpm --filter @appsea/web build`, and `pnpm smoke:web`
  pass. The public route now renders only the required `Leaderboard` heading,
  rank/opportunity/complaint/score fields, and synthetic disclosure; private
  research detail remains on opportunity routes. The current full `pnpm test`
  suite passes, and the full `pnpm verify` repository proof now passes while
  preserving the intentionally empty, user-owned root `AGENTS.md` through
  catalog synchronization; deployment-only production gates remain open.
  Prior hosted/local Docker baselines passed on 2026-08-06,
  but current Docker-backed reruns are pending. The header uses the generated, non-text
  `appsea-mark-generated.png` asset; the private evidence coverage panel also
  uses the imagegen-generated decorative `appsea-evidence-icon-generated.png`,
  while the private report evidence and competitive sections use the
  imagegen-generated `appsea-source-coverage-icon-generated.png` and
  `appsea-market-signals-icon-generated.png`; the public and private coding-plan
  routes also use the generated
  `appsea-plan-icon-generated.png`, and the private report route uses the
  generated `appsea-report-icon-generated.png`. These are website-only visual touches and
  do not alter the staged Tauri icon pair or any research semantics.
- Local private-workspace stack: `pnpm dev:local` starts loopback PostgreSQL,
  Temporal, and disposable MinIO, initializes the `appsea-local` bucket, applies
  migrations with the dedicated local migrator, and runs the durable worker,
  lease-backed maintenance/alert supervisors, and web process through the signed
  S3-compatible adapter; it is a development workflow and never activates a
  third-party source.
- Local stack smoke: `pnpm verify:local-stack` now exercises loopback dependency
  readiness, migrations, worker/maintenance/alert/web startup, authenticated private-workspace
  signup, owner-authorized manual intake through durable consumption, complaint
  confirmation, reviewed/approved opportunity seed input, production-analysis
  completion, private opportunity/report/plan readback, every private
  workspace page with encoded identifiers, auth pages, sparse fixture
  disclosure, visible public-market coverage gaps, and container cleanup; it
  now submits a reviewed balanced v1 score envelope and asserts raw,
  risk-adjusted, ranking, and confidence fields survive durable analysis and
  private readback. A PostgreSQL `42803` regression in the source-coverage
  aggregate was caught by this smoke and fixed by grouping every policy
  eligibility column; the corrected path now passes again. GitHub CI runs it on
  every change. The intake row and seed are smoke-only and never market
  evidence.
- Local UI proof: the persisted public capture in
  `artifacts/ui-reference-loop/2026-08-24/` passes the scalar browser audit;
  `pnpm ui:capture:private` now runs the same audit on
  all nine authenticated routes at desktop 1280/1024/768 and responsive 480
  widths. It fails on an explicit runtime-error page, missing title/`<main>`, or
  horizontal overflow; the checked-in manifest records only those scalar
  results and placeholder routes.
- The database-free `pnpm ui:capture -- --persist` path runs the same audit on
  the five public routes and writes a secret-free public capture manifest.
- Release boundary: `pnpm verify:release` checks the provider-neutral Compose
  topology, non-root/read-only image defaults, secret-free production example,
  disabled identity/delivery defaults, and fail-closed production preflight;
  the dynamic verifier runs in a separate hosted CI job.
- Hosted validation: GitHub Actions run `30893053945` passed for commit
  `b67a51b`, including verification/security, fresh PostgreSQL and Temporal,
  worker replacement, release-boundary verification, the loopback private-stack
  smoke, container smoke, and independent Windows and macOS desktop checks;
  hosted runs `30917740935`, `30919346892`, `30923658050`, `30929883317`, and
  `30932224043`, `30939424669` for commit `3d864dd`, feature run `30941697155`
  for commit `a3ad40d`, follow-up docs run `30941804877` for commit
  `24ed3d5`, run `30941916282` for commit `1f20e39`, and latest run
  `30944735291` for commit `337bb66`, `30944900421` for commit `34c4a4c`, and
  latest `30947627304` for commit `e3f28d7`, `30947761415` for commit
  `c6ffa66`, `30949355268` for the website brand-mark commit `e276876`,
  `30949551146` for the follow-up docs commit `13d3913`, and latest
  `30951694916` for `ff65ee7`, and latest `30981506584` for `6eb88e0`
  all failed before repository job steps because of the account
  payment/spending-limit gate, not because of a repository assertion.
- Complaint analysis: the versioned `deduplication` artifact/report field now
  preserves source-native duplicate decisions and retains high-similarity
  cross-record candidates for human review. Manual-import v3 now retains only
  workspace-scoped opaque author fingerprints when an authorized export
  provides them; private reports show available/partial/unavailable author
  coverage, while fixture and third-party paths remain explicit gaps. Analysis
  v0.5.0 also resolves only explicitly labeled, bounded source-context
  substitute/competitor names; these complaint-level mentions never become
  source-backed competitive coverage without the reviewed observation gate.
- Complaint analysis safety: `complaint-analysis-v0.5.0` marks bounded
  instruction-like source text with deterministic `manipulationRisk` and
  `policyFlags`, keeps evidence/provenance retained, labels flagged rows for
  human review in private reads, and exposes a production coverage gap. The
  deterministic analyzer also retains explicitly framed outcomes,
  consequences, workarounds, user hints, and bounded weak-demand/contrary-context
  market-signal hints. These hints remain separate from reviewed competitive
  coverage and do not affect ranking. The
  provider-neutral model gateway now runs inside production analysis with fixed
  trust-tagged segments, redaction, allowlists, budgets, replay protection, and
  bounded non-sensitive summaries; deterministic/human-corrected analysis
  remains authoritative. External providers stay disabled, and this does not
  claim semantic model quality or malware coverage.
- Weak-market handoff: deterministic source-context hints now remain visible in
  report Markdown, the coding-agent product brief, and private evidence pages
  with complaint/evidence provenance. The surfaces explicitly label them as
  unreviewed inference that is not market evidence and never affects ranking;
  narrative redaction clears the hints.
- Model gateway boundary: `@appsea/model-gateway` is fixture/fallback-only and
  fail-closed for external providers. Production artifacts carry a
  `model-gateway-v1` summary with hashes, fixed safety findings, and cost
  counters, never raw prompts or complaint text. Source model-use permission,
  file-malware scanning, provider DPA/retention/egress controls, durable model
  cost settlement, and calibration remain release blockers.
- Research maturity: production analysis now persists and reads as `candidate`
  until an explicit deep-research gate records source-backed competitor and
  contrary-evidence coverage. Migration `0100` repairs legacy non-synthetic
  `researched` rows; migration `0101` persists the owner-reviewed gate with
  compact provenance, audit/outbox receipts, and stale-snapshot detection;
  fixture rows remain synthetic. Coverage gaps stay visible after a valid pass.
  The private competitors route now provides the governed checklist interaction:
  editors can submit a review, owners can attempt promotion, and owners can
  withdraw a passed gate. Client controls never bypass the server-side
  evidence, snapshot, membership, or step-up checks.
- Private workspace website/API: implemented and production-built; reads are membership-authorized and cache-disabled. Encoded workspace and detail identifiers are decoded exactly once at the page boundary before schema validation. Completed collection reads now expose the bounded private `analysisHandoff` status when an approved-seed handoff exists; the collection page shows queued/dispatching/started states without a duplicate manual start and reserves explicit approved-seed retry for failed handoffs. Owner settings expose a read-only purge-readiness inventory, an expiring owner-confirmed metadata-only purge manifest, and a step-up-protected, durable non-destructive purge intent; these snapshot PostgreSQL references/readiness without authorizing deletion and keep cloud/export/backup requirements visible.
- Private opportunity navigation: the Overview, Evidence, Competitors, Report, and Plan routes now share one keyboard-accessible tab component with a single `aria-current="page"` marker, so detail pages remain directly navigable without duplicating route markup.
- Opportunity lifecycle governance: migration `0105` adds a forced-RLS, append-only decision record with identifier-only evidence snapshots, idempotency, stale-state checks, owner-only approval gates, and audit/outbox receipts. The private Overview route renders the current decision history and step-up-protected approve/watch/reject/archive controls; fixture opportunities stay read-only and explicitly synthetic. MCP remains read-only by design.
- Complaint-cluster curation: migration `0106` adds a forced-RLS, append-only review ledger with stale input hashes, idempotent editor/owner transitions, split/merge lineage identifiers, membership-state updates, and identifier-only snapshots. The private Evidence route exposes bounded cluster labels, membership IDs, review history, and a step-up-protected review form; fixture clusters remain read-only. The deep-research gate now blocks until every current non-synthetic cluster is reviewed or confirmed.
- Auth ingress hardening: all JSON auth mutations now use the shared streaming 32 KiB body reader, reject oversized declared or chunked bodies with `413`, and parse only after the byte cap; route tests cover public login/signup plus recovery and MFA boundaries.
- Private audit inspection: `GET /api/workspaces/:workspaceId/audit-events` exposes a membership-authorized, no-store, cursor-paginated projection of immutable audit receipts. It returns bounded identifiers and scalar metadata only; nested values, raw source payloads, and dependency errors remain hidden. This is an API/agent-visible inspection boundary, not an export or purge operation.
- Private activity inspection: `/workspace/:workspaceId/activity` now renders that same bounded audit projection for private members with cursor pagination and no mutation controls. Desktop and mobile production-build review covered the leaderboard, opportunity, complaints, and competitor routes; the public leaderboard remains sparse and now follows the dark navy/violet/cyan reference system.
- Approved export accountability: successful report and plan JSON, deterministic on-demand Markdown, or bounded deterministic ZIP exports now write one representation-specific, identifier-only `report.exported` or `plan.exported` audit receipt per workspace/artifact version/actor after object hydration and redaction. ZIP responses include the source manifest hash and archive hash; the archive is generated on demand and is not persisted. Plan ZIPs retain the six compatibility files and add the complete 08_spec-compatible `package/` directory; missing source/report dimensions remain explicit coverage gaps. Production analysis also persists the deterministic Markdown as a content-addressed `report-markdown` object; migrations `0120` and `0121` carry its complete reference through invalidated-output purge queueing, source-deletion clearing, and the owner-confirmed workspace purge gate. The private Activity projection exposes the manifest hash and representation without exposing content or object URIs. Private report/plan routes expose cursor-paginated, up-to-50 active, current-policy-visible version summaries, selected-version reads, and metadata-only plan comparison; selected private payloads and exports now also require any linked production analysis to be `completed`, active, and currently collectible, and plan exports require a linked report to be approved when one is present. Withdrawn versions remain history metadata only, and the compatibility `truncated` field is derived from the next family cursor. Provider retention/destructive export/backup purge remains external.
- MCP history resources: the authenticated read-only boundary exposes workspace/opportunity-scoped `report-history` and `plan-history` resources with the same independent opaque cursors and 1..50 bound, plus selected report/plan version resources addressed by the returned IDs. History returns metadata summaries only; private web selected reads keep active draft/reviewed content available for member review under completed-analysis, current-policy, deletion, hydration, and redaction gates, while MCP selected report content requires approval and selected plan content requires readiness plus approval. The public leaderboard is unchanged.
- Owner-authorized intake: migrations `0089`, `0102`, `0103`, and `0122` provide immutable `manual-owner-import-v1`/v2 history plus the current reviewed `manual-owner-import-v3` policy, bounded CSV/JSON parsing, PII scrubbing, workspace-scoped opaque author fingerprints, private staging/list/delete APIs, a private workspace import screen, identifier-only Temporal handoff, same-transaction batch consumption, and tombstone propagation. V3 retains tenant-private `competitor-research` and `contrary-evidence` purposes; the Competitors route can submit evidence-linked observations that start unreviewed and require editor/owner review. Migration `0122` never stores raw author keys, exposes report-level unique-author coverage with partial/unavailable gaps, and clears fingerprints on source deletion or explicit author-field redaction. Migration `0103` extends the existing provenance trigger to accept either explicit private research purpose while preserving policy/evidence checks. Migration `0104` carries the confirmed snapshot into the next explicit production-analysis report and six-file plan, stores observation/evidence hashes in forced-RLS lineage, masks restricted claim text, and invalidates active analysis/opportunity reads when a consumed observation is rejected. Production connector construction now fails closed unless the durable PostgreSQL quota ledger and reviewed policy snapshot are supplied; the worker now forwards that reviewed snapshot into the active manual-import connector. The in-memory run-key ledger is bounded and test-only. The local-stack smoke now signs up a disposable owner, creates a private manual-import campaign, stages a smoke-only row, waits for durable workflow consumption, confirms the retained complaint, creates/reviews/approves a smoke-only opportunity seed, runs production-shaped analysis, and reads the private opportunity/report/plan pages back. This makes tenant-private research usable without presenting it as public market research; URL fetching and all third-party public connectors remain disabled or deferred. Fresh PostgreSQL, backup/restore, worker-replacement, and local-stack proofs passed on 2026-08-06; hosted CI remains payment-gated.
- Manual-import ingress hardening: the authenticated owner route now commits the existing workspace-scoped production workflow admission before persisting normalized batch rows, so rate/concurrency-rejected requests cannot fill staged storage. Newly admitted still-reserved rows are released when bounded staging fails; replayed, consumed, and expired rows are not released optimistically, and a server-owned five-minute reservation TTL still bounds uncertain Temporal starts. The route test asserts fail-closed ordering.
- Read-only agent access: migrations `0069`, `0081`, and `0097`, owner token lifecycle APIs, the private owner **Agent access** page, `POST /api/auth/mfa/step-up`, and `POST /api/mcp` are implemented and tested. Tokens are hash-only, expiring, membership-bound, and scope-filtered; issuing/revoking them requires recent password step-up plus a fresh MFA proof when MFA is enabled. Each authenticated MCP request also passes a PostgreSQL 60-per-60-second token window, four-lease concurrency cap, and 30-second stale-lease recovery; denial is fixed `429`/`Retry-After`. The page shows least-privilege scope choices and the raw credential only in the immediate create response; later lists remain metadata-only. Private members can also inspect exact cost totals and settled quota-reconciliation cases on the **Usage** page; maintenance resolution remains outside the browser. The same conditional proof now protects password-gated account, session, membership, invitation, archival, purge-intent, evidence-redaction, report/plan approval, seed review, complaint curation, and competitor observation mutations. Evidence policy, coverage gaps, synthetic disclosure, and report/plan approval gates remain visible. Deployment HTTPS/edge limits, secret storage/monitoring, provider-backed identity operations, and unrelated high-impact mutations without a password-step-up boundary remain open.
- Cancellation: migrations `0070`/`0071` provide owner/editor durable intent for multi-source and one-source production runs, private same-origin APIs/UI, Temporal best-effort cancellation, and lease-backed worker retry/reconciliation. Deployed Temporal/scheduler proof remains open.
- Fixture worker: implemented and tested
- Plan package generator: implemented and tested
- Evidence/report package: deterministic fixture report composer, a
  production-shaped offline analysis composer with policy/evidence provenance,
  reviewed seed registry and distinct analysis-run contracts, versioned report
  persistence, source-policy coverage metadata, private report rendering,
  approval governance, approved JSON/Markdown export, cursor-paginated
  report/plan history, and metadata-only plan comparison, a content-addressed
  object-storage seam with filesystem and signed S3-compatible adapters, with the
  private local stack now exercising the signed adapter against disposable MinIO,
  and an explicit reviewed-evidence analysis-start route implemented. Production
  private opportunity reads also
  carry the linked report and plan approval states from PostgreSQL governance
  projections instead of inferring draft defaults from object payloads. The
  private report and plan pages now expose those transitions to editors and
  owners through a small responsive governance panel; viewers remain
  read-only, plan readiness is visible, and the API/database still own every
  permission and linked-report conflict.
- Opportunity scoring: legacy fixture and historical `opportunity-score-v0.2.0`
  snapshots remain replayable; reviewed production seeds may now carry the
  additive balanced `opportunity-score-v1.0.0` envelope with raw,
  risk-adjusted, ranking, confidence, uncertainty, coverage, freshness, and
  component explanations. Every v1 factor now carries an explicit
  `source-evidence` or `reviewed-seed` binding; source bindings are checked
  against retained complaint evidence at analysis validation and reviewed-seed
  bindings retain the immutable seed-review prefix. This is a reviewed-input/
  profile checkpoint, not calibration evidence or a live market claim. The deterministic
  `research-quality-v1.0.0` benchmark now records synthetic classifier/entity,
  deduplication, clustering, stability, ranking, and calibration metrics in
  optional artifact/report snapshots; it is regression evidence only and never
  derives source coverage or market evidence. The versioned
  `research-quality-gate-v1.0.0` worker check enforces explicit synthetic floors,
  and private report detail shows its pass/fail status. Score-factor provenance is now
  explicit in the v1 envelope, with retained-evidence checks for source-backed
  bindings and seed-review checks for reviewed assumptions. See the
  [`research-quality-regression-gate-completion-report-2026-08-05.md`](research-quality-regression-gate-completion-report-2026-08-05.md).
- PostgreSQL persistence: one hundred twenty-three forward, checksummed migrations plus least-privilege repositories and the existing auth, RLS, provenance, workflow, source-policy, quota, retention, analysis, reporting, and maintenance boundaries. Migrations `0114` and `0115` reject undeclared or incomplete reviewer roles; `0116` rejects reviewer-identity reuse and centralizes the complete-review collectibility gate; `0117` adds an operator-only scalar approval-progress read; `0118` closes direct activation, lease replay/assertion, reconciliation-claim, and production-lineage gates on that invariant; `0119` adds bounded policy-impact expiry, pointer repair, durable receipts, and current-policy read/export gates; `0120` persists report-Markdown references and extends invalidation/deletion lineage; `0121` keeps the direct owner purge function aligned with that full output set; `0122` adds the reviewed owner-import author-fingerprint boundary and clears it on deletion/redaction; `0123` projects identity-free source-policy approval roles and permission-evidence gaps to private source coverage. These migrations neither activate a third-party source nor grant the worker skill access.
- Policy-change impact is now implemented as a non-destructive, fenced maintenance projection. Completed production analyses whose current source policy is no longer collectible move to `expired`; a valid active completed output can repoint the opportunity, otherwise the opportunity is invalidated and its pointers cleared. Private analysis, opportunity, report, plan, and export reads fail closed before maintenance runs. Immutable lineage and retained objects remain available for review; a later source deletion still drives the existing destructive invalidation/object-purge path, and reapproval does not auto-reactivate an expired output.
- Production coding-package manifest: the shared contracts define the six
  deterministic package paths. New seed writes, user admission, worker handoff,
  and production artifacts reject missing, duplicate, or unsupported paths;
  legacy portable-path rows remain readable for inspection but cannot start
  analysis until replaced.
- Database verification: PostgreSQL 18 fresh-install and populated-upgrade lifecycle is covered by local/CI gates; the 2026-08-06 local persistence, Temporal restart, and worker replacement runs target all one hundred nineteen migrations. The runtime-skill integration covers HMAC hydration, idempotent replay, operator activation, immutable history, and service/maintenance denial. `pnpm verify:backup-restore` now targets the checked-in one hundred twenty-three-migration head (`0123`) and verifies forced workspace RLS plus least-privilege runtime/maintenance checks. The release static verifier now independently requires exactly 123 valid, unique, contiguous SQL migrations ending at `0123`; this catches checked-in migration drift without contacting PostgreSQL. Migrations `0120` through `0123` have repository/unit and migration-contract coverage, but the Docker-backed fresh/upgrade rerun is still pending; the last successful backup/restore proof remains historical through `0119`. This is not provider backup, HA, retention, or production restore evidence; hosted full proof remains an appropriate rerun when the GitHub account payment gate is cleared.
  The persistence verification listed above is through migration `0119`.
  Migrations `0120` through `0123` have repository/unit coverage but still need a
  Docker-backed fresh/upgrade rerun.
- The 2026-08-06 local rerun of `pnpm verify:persistence:fresh`,
  `pnpm verify:backup-restore`, `pnpm verify:worker:recovery`, and
  `pnpm verify:local-stack` passed against real disposable PostgreSQL,
  Temporal, and MinIO services. The smoke-only import and opportunity seed are
  not market evidence.
- Campaign admission repair: migration `0092_campaign_source_read_privileges.sql` explicitly grants the runtime service role the `sources`, source-policy snapshot, and policy-review reads required by private campaign validation after hosted smoke exposed a missing `sources` privilege.
- Campaign date-window enforcement: validated `dateRange` bounds now survive
  web admission, scheduled multi-source/refresh dispatch, sanitized Temporal
  input, and immutable collection snapshots. CFPB, Stack Exchange, fixture,
  and owner-import connectors apply source-appropriate inclusive windows and
  emit bounded coverage warnings; exact tombstone re-collection says when the
  campaign window is not applied. The private completed-collection read model
  and evidence-inspection page now show the query and normalized window beside
  coverage gaps. Existing snapshots without the additive field remain
  replayable.
- Dependency security: Next.js `16.2.12` and patched transitive PostCSS, `fast-uri`, `nanoid` `3.3.18`, and sharp versions are locked; the 2026-08-21 `pnpm security:audit` reports zero production vulnerabilities and runs in the GitHub verify job. Historical GitHub run `30819616149` passed the audit, full verification, fresh PostgreSQL persistence, and fresh Temporal workflow checks for commit `1cc781c`; later push runs were payment-gated before startup, which remains an external CI gate rather than a repository assertion failure. See [`dependency-security-hardening-completion-report-2026-08-21.md`](dependency-security-hardening-completion-report-2026-08-21.md).
- Production configuration preflight: `pnpm production:preflight` now validates secret-free role-separated database, authenticated Temporal, the exact reviewed `appsea-research-v1` task queue declaration, signed object storage, scheduler, bounded `APPSEA_WORKER_DRAIN_TIMEOUT_SECONDS` (30–900 seconds), public-origin, delivery-switch, proxy, explicit cost-alert threshold configuration, enabled HTTPS operational alert routing, and reviewed/explicit OIDC configuration when enabled before startup; it does not connect, migrate, activate a source, or replace readiness checks. Remote namespace/task-queue ACL and worker identity evidence remain deployment-owned.
- Production runtime packaging: `Dockerfile.web` produces the Next standalone web image, `Dockerfile.worker` packages the durable worker/preflight/migration/maintenance/alert-loop entry points, and `infra/production/compose.yaml` gates startup on preflight with non-root, read-only, capability-dropped services. The worker maps the reviewed drain window to Compose `stop_grace_period`; the long-lived `alerts` service supervises six lease-owned alert/delivery/status commands in a bounded sequential loop; `pnpm verify:release -- --static` checks both topology boundaries. See the [alert-supervisor completion report](alert-maintenance-loop-completion-report-2026-08-06.md). GitHub Actions run `30827192223` passed the prior Compose validation, both image builds, web liveness/health smoke, and fail-closed worker preflight; external provider provisioning and source activation remain open.
- Quota reconciliation alert inspection: `pnpm worker:source:quota:alert` now performs a lease-owned, read-only bounded scan across active workspaces, emits fixed alert/incomplete/clear events and durable scheduler counters, and keeps truncated coverage visible; alert/incomplete/failure payloads are persisted to the scalar operational-alert outbox before signed delivery, while clear results remain local observations; `pnpm worker:alerts:deliver` drains stale/retryable claims and `pnpm worker:alerts:status` exposes bounded pending/sending/exhausted/age/truncation state without returning payloads or mutating rows; deployment scheduler ownership, endpoint operation, and provider recovery remain open
- Production-analysis recomputation alert inspection: `pnpm worker:production:analysis:recompute:alert` performs a lease-owned, read-only bounded scan of deletion- and correction-triggered repairs through a maintenance-only projection; it emits fixed alert/incomplete/clear events and bounded failure/block/stale counters, and signed-delivery attempts without dispatching or retrying repairs
- Source-health alert inspection: `pnpm worker:source:health:alert` performs a lease-owned, read-only bounded scan of reviewed non-fixture source health, freshness, and quota signals through the maintenance-only scalar projection from migrations `0108` and `0109`. It emits fixed alert/incomplete/clear events and bounded counters; stale, exhausted, or aged-degraded sources alert, while capped coverage remains incomplete and never clears. The command never fetches, activates, retries, or changes source state.
- Operational-alert outbox status: migration `0110` and `pnpm worker:alerts:status` add a separately leased, bounded scalar projection of pending, sending, exhausted, stale, and truncated delivery state. It is enabled explicitly in production, cannot return payloads or mutate the outbox, and never routes incidents or calls a provider.
- Workspace cost-threshold inspection: `pnpm worker:workspace:cost:alert` performs a lease-owned, read-only bounded scan of exact ledger aggregates for one configured currency and separate actual/estimated thresholds; unsupported currencies and truncation keep a non-alerting scan incomplete, and bounded alert/incomplete/failure events can be signed-delivered; the command never blocks work or performs billing
- Native Codex skills: 21 synchronized skills
- Codex helper agents: 11 bounded agents
- Runtime skill governance: the dormant registry now records proposer,
  independent evaluation/approval identities, HMAC evidence over the immutable
  permission set and review chain, and separately signed active/retired
  transition evidence. Plain, tampered, copied, unknown-state, altered
  timestamp/actor, and wrong-secret records fail closed during hydration/
  activation. Migration `0099` and the operator-only repository persist these
  records with immutable events, expected-hash concurrency, and operator-only
  privileged activation. It is still not imported by the worker.
- Project memory: implemented and validated
- Documentation system: implemented and linked
- UI references: deterministic sparse desktop/mobile reference sources now include
  the private owner-import and activity screens and share the dark navy/violet/
  cyan palette used by the reviewed PNG references. The canonical `/leaderboard`
  route and root alias share one database-free view. `pnpm ui:capture` covers the
  public leaderboard at 1280/1024/768/480 pixels plus the overview, complaints,
  competitors, and coding-plan routes; the 480 capture fixed a clipped sign-in
  action, while desktop captures retain the desktop layout. Public and
  authenticated private captures are checked in under
  `artifacts/ui-reference-loop/2026-08-06/`; the private command uses an
  isolated owner session on the disposable local stack and found/fixed the
  account-security read-only lock mismatch plus the mobile password step-up
  grid. See the [UI reference-loop report](ui-reference-loop-completion-report-2026-08-06.md).
- Third-party source connectors: CFPB connector boundary and policy metadata implemented, disabled pending legal/privacy/security approval; migrations `0027` and `0054` add operator-only draft/approval evidence with canonical reviewer identity and independence attestation, `0111` adds durable permission evidence, `0114`/`0115` enforce declared complete roles, `0116` enforces distinct identities and shared runtime collectibility, `0117` provides scalar operator progress, `0118` blocks direct activation/replay and stale lineage paths, and `0123` projects identity-free approval roles/evidence gaps into private source coverage. The only active non-fixture path is the reviewed `manual-owner-import-v3` policy, which is tenant-private owner-attested intake rather than public market coverage; v1/v2 remain historical, and v3 author coverage is opaque/fingerprint-only.
- CFPB policy handoff: `pnpm worker:source:policy:cfpb:manifest` emits a deterministic, secret-free manifest with the current policy content hash and first-party API/privacy evidence observed on 2026-08-06. It is a reviewer handoff only; the connector remains disabled and no commercial-use or source-activation decision is inferred.
- Stack Exchange policy handoff: `pnpm worker:source:policy:stackexchange:manifest` emits a deterministic, secret-free manifest with first-party API, AUP, attribution, licensing, and written-permission evidence observed on 2026-08-06. It is a reviewer handoff only; the candidate remains unregistered and disabled.
- Connector policy handoff: the source-policy repository now carries the immutable reviewed JSON payload alongside the database-owned activation snapshot. CFPB, Stack Exchange, and owner-import constructors compare immutable purpose, quota, retention, deletion, attribution, display, and coverage fields before a request; production construction fails closed without the reviewed payload. The Stack Exchange draft additionally carries the AUP/written-consent blocker in its coverage notes and remains disabled. This prevents in-memory policy drift but does not approve or activate a source.
- Source freshness observability: the private source registry now carries optional reviewed scheduled/on-demand freshness metadata. The read-only health projection derives bounded fresh, stale, unknown, on-demand, or blocked state from retained observation timestamps, shows the reviewed interval/delay and observation age, and preserves legacy policy hashes when freshness is absent. It does not schedule or retry work, activate a connector, or interpret stale/missing coverage as evidence of no demand.
- Source quota headroom observability: migration `0107` adds a read-only,
  security-definer projection of the shared current-minute source quota window.
  The private registry shows bounded requests used/remaining and the window
  boundary without exposing reservation IDs, workspace rows, or mutation
  capability. Pending, expired, and non-collectible policies remain blocked or
  unknown; reservation and settlement stay on the existing worker-owned
  functions.
- Source-health alert observability: migrations `0108` and `0109` add a
  maintenance-role-only scalar source-health read and forward the operational
  scheduler/outbox allowlist. Migration `0116` makes its collectibility flag
  use the complete reviewer-set helper; `0117` adds a separate operator-only
  approval-progress read; `0123` adds a separate service-role-only private
  approval summary containing bounded roles and permission-evidence booleans.
  The alert worker sees only source ID, bounded
  health/freshness/quota states, timestamps, and counters; source policy JSON,
  complaint text, provider payloads, and activation capabilities remain outside
  the boundary. Fresh local SQL integration now passes through migration
  `0119`; hosted/provider execution remains a separate gate.
- Production database deployment: not provisioned; the schema, repository, migrations, roles, RLS, operational-alert outbox, local/CI proof, and isolated local backup/restore verification are implemented, while provider backup/HA/restore evidence remains open
- Authentication: private workspace signup/sign-in, password-gated TOTP MFA with one-time recovery codes and expiring login challenges, versioned current/previous MFA-key rotation with transactional and bounded dormant-account rewrap, identifier-only rotation events, and count-only status, session-bound MFA step-up for password-gated high-risk mutations, research-governance step-up for report/plan/seed/complaint/competitor decisions, hashed/revocable sessions with authenticated inventory and per-session revocation, durable login/signup/reauthentication/recovery/invitation/account-closure/MFA throttling, bounded retention, 15-minute password step-up for high-risk mutations, owner-scoped member role administration and existing-account invitations, membership authorization, private research read routes, single-use reset/invitation outbox mechanics, owner-safe account closure, owner-only non-destructive workspace archival, and an archived-owner, metadata-only purge manifest implemented; optional OIDC identity linking/sign-in now has strict issuer/subject binding, state/nonce/PKCE and ID-token verification, endpoint-origin allowlisting, explicit step-up-protected link/unlink, MFA-aware challenge handoff, and a production DNS-resolution preflight that rejects unsafe answers, but remains disabled by default; linked identities follow an explicit active-account lifetime rule until unlink/closure review; owner-only purge-readiness inspection and manifest preparation are read-only/non-destructive and do not perform workspace/object/export/backup deletion; recovery and invitation delivery are kill-switched pending provider/identity review, while verified-email policy, provider-backed delivery, identity retention/revocation, DNS pinning/egress enforcement, provider-backed step-up, approved live rotation review, and external identity operations remain
- Durable workflow engine: fixture, production-collection, and post-collection production-analysis Temporal workflow/client boundaries, an approved-seed handoff queue with skip-locked stale-claim recovery, a deletion/correction-triggered recomputation queue with server-clock stale dispatch recovery and bounded exhausted-claim failure, a private collection read model for handoff state, PostgreSQL job/checkpoint/lineage projections, bounded retries, budget rejection, terminal reconciliation, authenticated private-workspace start/status routes, user/service attribution, and database-serialized per-workspace production start/admission gates are implemented and locally tested. Production analysis starts now use identifier-only workflow version `v2`; the worker reconstructs the artifact inside the activity so complaint text is not recorded in new Temporal histories, and new starts carry a strict version memo. The bounded visibility-only history checker and reviewed manifest fail closed before a v1 worker is removed. The long-lived worker now handles SIGINT/SIGTERM idempotently, drains dispatch scans and heartbeat work, requests Temporal shutdown, and closes PostgreSQL/Temporal connections; GitHub Actions run `30882513772` also proves a real worker process replacement during fixture persistence with idempotent output. Production preflight now requires the exact reviewed task queue declaration; remote Temporal provisioning, namespace/task-queue ACL evidence, HA, supervisor drain/restore drills, and the external archive/retention operation remain open.
- Source maintenance: bounded, schema-validated all-workspace PostgreSQL quota expiry/purge, production workflow admission and source-collection-lease purge, policy-derived retention tombstone enqueue, fenced migration `0113` owner-import staging retention cleanup, undeclared-role rejection in `0114`, complete reviewer-set activation in `0115`, shared identity/collectibility enforcement in `0116`, scalar operator approval progress in `0117`, forward runtime/replay/lineage guards in `0118`, and bounded policy-impact expiry/pointer repair in `0119`, plus identifier-only full-snapshot reconciliation with durable page checkpoints, authenticated editor admission, explicit worker-principal service admission, a bounded one-per-workspace maintenance resume budget, multi-source campaign child claim/dispatch/reconciliation, one-source cancellation retry, and a private targeted resume command, skip-locked deletion propagation with server-clock stale-claim recovery, bounded retry and exhausted terminalization, retention-aware invalidated analysis output-object purge, opportunity availability invalidation/de-ranking, stable scheduler job IDs, migration `0046` server-clock acquire/renew/release ownership with per-acquisition tokens and a dedicated `appsea_maintenance` role, migration `0052` server-clock transaction fencing for selected SQL mutations, independent quota/snapshot/retention/orchestration/cancellation budgets, secret-free structured counters, migration `0047` durable maintenance-run metrics with bounded retention, migration `0048` cost-ledger summary indexing, migration `0049` quota-reconciliation case discovery and maintenance-only resolution, private member inspection, retryable password-recovery/workspace-invitation delivery workers, and lease-owned bounded alert inspections with a scalar operational-alert outbox, signed delivery, stale-claim recovery, bounded retry/exhaustion, retention purge, and a separate read-only bounded outbox status projection; the repository now also exposes supervised `maintenance:loop` and `alerts:loop` commands with bounded interval/backoff, fixed failure events, fixed child order, continue-after-one-child-failure behavior, and signal-safe shutdown; the long-lived worker now emits a bounded 30-second heartbeat, handles termination signals idempotently, and drains its scans before closing dependencies; the web service exposes fail-closed liveness/readiness probes; local Docker/MinIO proof now passes, while provider operations, hosted signed S3-compatible object-storage configuration, cloud encryption/versioning/backup controls, deployed process-supervisor ownership, endpoint ownership/rotation, and hosted provider evidence remain
- Docker proof note: the source-maintenance summary above records the
  historical local Docker/MinIO proof through migration `0119`; the current
  Docker-backed head rerun remains pending and is not implied by that older
  summary.
- Desktop shell boundary: the Tauri build hook, minimal capability set,
  restrictive local CSP, deterministic PNG/ICO icons, and Windows/macOS CI
  compile checks are implemented; bundling remains disabled and signed
  Windows/macOS release evidence is still open.

The current leaderboard is synthetic. It validates ranking, navigation, planning-package generation, and the simple interface contract.

Migration `0053_complaint_analysis_snapshots.sql` now persists one validated,
deterministic complaint-analysis snapshot per retained complaint. Fixture and
production-shaped artifacts carry classification, severity, recurrence,
switching signals, entity confidence, and explicit unresolved competitor and
substitute dimensions into private evidence views and generated reports. The
rules are a reproducible checkpoint, not a live model or market claim.

Migration `0061_complaint_analysis_corrections.sql` adds an editor/owner,
derived-only correction history. Corrections hash-chain the prior and next
snapshots, leave source evidence/provenance immutable, invalidate stale active
analysis/opportunity projections, and hide stale report/plan reads until a new
reviewed analysis is produced. The next analysis input carries the corrected
snapshot instead of reclassifying source text. Migration `0062` extends the
same durable recomputation queue with a deferred correction trigger: each
affected opportunity receives one idempotent repair request, while an absent or
unapproved seed remains visibly blocked.

Migration `0067_field_level_evidence_redaction.sql` adds the reviewed privacy
projection boundary. Owner/editor members with a recent step-up can mask
selected text, entity candidates, or canonical locators for one run-bound
evidence item. Immutable source identity, capture/policy lineage, content
hashes, and analysis snapshots remain retained; private collection,
opportunity/leaderboard, analysis, report, and coding-plan mappers apply
read-time masks. Text masking requires the raw source
object reference to have already been cleared by the source-policy deletion
path. Cloud/backup purge and automatic recomputation remain separate gaps.

Private campaign create/edit forms now select source IDs from the authenticated
read-only source registry and keep pending-policy states visible. This is a
planning aid only; the existing approval, purpose, quota, display, and
admission gates still control collection. Migration `0068` adds the reviewed
multi-source parent/child queue and private history/detail reads; it remains
non-operational until deployed scheduler/Temporal ownership, crash/retry
drills, and live source-policy approval exist.

Migration `0054_source_policy_review_integrity.sql` now requires canonical
reviewer identity, independent review role, and explicit attestation for new
source approvals. Pre-0054 approvals remain audit history but do not make a
non-fixture source collectible until re-reviewed; legal/privacy/security and
deployment approval are still external blockers.

Private opportunity detail now includes a validated competitive-research
coverage record and a separate competitors/contrary-signals route. Fixture
records are marked synthetic/unresolved; production reviewed seed assumptions
are marked `reviewed-seed-only` with seed-review provenance and an explicit gap
until a permitted competitor source supplies retained evidence. Migration
`0059` adds bounded per-claim observations with source-item/evidence
provenance and editor/owner review; source-backed status now requires a
confirmed non-synthetic observation, and this slice does not activate a source.
Complaint/source-item contracts now retain an HTTPS canonical locator, and
private evidence/competitor views expose it for attribution when the source
provides one. Migration `0060` adds a database-level HTTP(S) host/path check
for the persisted locator. Migration `0063` adds a bounded JSONB feature matrix
to normalized competitor rows. Fixture entries are explicitly synthetic;
production seeds accept reviewed-seed assumptions only, while source-backed
entries must carry retained competitive observation identifiers. The public
and private competitor routes render the matrix without raw provider payloads;
approved competitor-purpose source coverage remains an external blocker.

Private campaign configuration is now available at
`/workspace/:workspaceId/campaigns` with authenticated list/create/read/update/
archive APIs, and owners/editors can start a bounded one-source run through the page or
`POST /api/workspaces/:workspaceId/campaigns/:campaignId/run`. New writes use a
strict `campaign-v1` JSONB contract, resolve source registry and policy
readiness metadata, reject unknown or purpose-incompatible sources, and
persist only draft campaigns with identifier-only audit/outbox receipts. The
run route accepts only an idempotency envelope, derives query/source/limit/
budget from the stored campaign, rechecks policy/display mode/expiry and any
approved seed review, and commits the existing admission ledger before
Temporal. Legacy fixture/workflow campaign rows remain readable. Archive is a
soft lifecycle transition that preserves run/evidence lineage. The CFPB and
Stack Exchange connectors remain disabled; Stack Exchange also requires a
first-party AUP permission/exception record before an approval can be
considered. Migration
`0058_campaign_refresh_scheduler.sql` adds due timestamps, durable claims,
pending request lineage, retry/failure state, and narrow service updates; the
existing lease-backed source-maintenance pass now dispatches only approved,
supported production refreshes. Deployment-level scheduler ownership,
Temporal availability, and external CFPB approval remain open.

The private workspace now also exposes a read-only source registry at
`/workspace/:workspaceId/sources` and
`GET /api/workspaces/:workspaceId/sources`. It projects existing policy rows
without a migration, derives enabled/collectible state from the database
approval gate, and keeps quotas, deletion duties, and coverage notes visible.
It now also derives a bounded connector-health projection from workspace-local
collection jobs, retained source items, and open deletion tombstones, exposing
fixed health state, timestamps, counters, and failure codes without raw error
text. Policy payloads, hashes, reviewer identities, and activation controls
remain outside the contract; fixture sources stay explicitly synthetic and
health remains observational/read-only.

The campaign page and private API expose bounded, cursor-paginated production
run projections with safe state/checkpoint/counter/timestamp fields. The
private campaign history page traverses older one-source and multi-source
pages using a stable request-time/identifier cursor; idempotency hashes and raw
source payloads remain excluded.

The collection page now exposes a reviewed-seed-only analysis start action for
owner/editor members. The private analysis-status page and API project only
safe Temporal/PostgreSQL state, checkpoint, bounded attempts, availability,
failure summary, identifiers, and timestamps. Workflow-prefix validation and
strict contracts prevent hashes, object references, source payloads, and seed
content from crossing the read boundary. Migration `0055` persists the
highest observed activity attempt on the production-analysis run, while
migration `0056` adds a bounded server-clock history with stage heartbeats,
terminal fixed failure codes, and duration. The attempt data remains outside
the idempotency hash. Signed alert delivery now covers bounded alert outcomes;
production Temporal availability, endpoint operation, and deployed scheduler
ownership remain operational follow-up;
the repository-level refresh claim/dispatch path is implemented.

`pnpm analysis:sample` produces a visibly `testOnly` production-shaped CFPB
artifact, report, deterministic score, and generic coding package under
`artifacts/analysis-sample/`. It does not activate a connector, call the
network, persist analysis, or establish market facts.

The persistence slice stores normalized fixture and reviewed production source/evidence lineage, complaints with explicit curation state, immutable workspace seed reviews, clusters, competitors, opportunities, immutable score snapshots, deterministic evidence-backed report versions linked to plan packages, content-addressed analysis output references, audit events, costs, deletion tombstones, outbox events, workflow checkpoints, recomputation dispatch state, and run lineage. Migration `0035` prevents a source-deleted production opportunity projection from remaining rankable; migration `0036` permits reactivation only after a new active analysis output has been linked, and migrations `0037`/`0062` queue bounded deletion- or correction-triggered active-evidence repairs with an approved-seed gate. The workflow proof covers retries, budgets, cancellation, duplicate starts, raw-history leakage, local Temporal replay, and hosted worker replacement; fresh PostgreSQL migration/read/deletion integration is covered by GitHub Actions run `30882513772`, while production deployment, restore/backup, and service-role operations remain open. It does not turn the fixture into market evidence, activate a source, or provide production Temporal/cloud-storage security.

New production-analysis v2 starts exclude raw evidence from Temporal history and
carry a non-sensitive version memo. The bounded visibility-only checker and
reviewed manifest account for legacy v1 histories without decoding them, but
the authenticated deployment must still complete the external archive/
retention operation. Cloud/backup object deletion verification and
deployment-level service-role/secret rotation for the direct source CLI remain
open security and operations work. Migration
`0043` queues invalidated output objects and the configured adapter handles
orphaned-body retries. Migration `0044` makes deletion propagation failures retryable
with bounded server-clock scheduling; destructive workspace-closure and export
purge remain separate boundaries from the new archival lifecycle.
The analysis activity now anchors retention to server-observed time, rejects
materially future timestamps, and finalizes only against an active/current/
unexpired policy with allowed or restricted commercial use and confirmed or corrected,
redacted evidence. Production collection initialization now fails closed when
its database admission reservation is absent or already consumed. Manual
analysis admission/rate limits and initiator actor attribution are now
implemented by migration `0042`; deployed scheduler ownership, Temporal
authorization, and deployment-level concurrency proof remain open. The reviewed
route reserves a digest/input hash before Temporal, binds an immutable user
actor, and consumes/releases that reservation with run persistence; duplicate
consumed/released digests replay without another slot.
Production connectors now invoke a worker-owned source-lease preflight
immediately before each CFPB or Stack Exchange request. A denied preflight
fails closed without HTTP and releases its durable quota reservation; the
runner/reconciliation path turns the denial into a terminal policy result and
releases the source lease. Persistence still locks and rechecks the lease in the
same transaction as the collection write; the preflight and provider socket
call cannot be one atomic database transaction, so deployment-level revocation
drills remain open. The settled source-request cost now travels from the quota
reservation through the immutable collection snapshot/result, workflow
checkpoint, and audit/outbox metadata; the reviewed CFPB policy still declares
zero request cost. A known policy-cost overage is rejected before source lease
acquisition and returns a bounded workflow budget rejection.
The identifier-only CFPB reconciliation path now persists warning-bearing page
checkpoints in migrations `0040`/`0041`, resumes queued or stale jobs without
the raw caller key, and finalizes missing active source items atomically only
after a warning-free short page. The source remains disabled and deployed
scheduler ownership, endpoint operation, and deployment-level reconciliation
proof remain open; the local worker-replacement and stack smoke now pass.

Migration `0050` now supports an explicit private re-collection after a
completed deletion tombstone. The request is limited to one source-native
record; the gateway, Temporal input, worker, and persistence transaction carry
the same immutable lineage; the CFPB connector uses its exact complaint route;
and the deleted predecessor remains historical. Maintenance, quota
reconciliation, and retries never trigger this path automatically. The source
is still disabled pending legal/privacy/security approval, and downstream
analysis/report/plan generation remains a separate explicit action.

Migration `0048` adds the workspace/time index used by the private
`GET /api/workspaces/:workspaceId/costs` read. The route repeats membership
authorization inside a read-only RLS transaction and returns exact bounded
micro-unit aggregates by currency and cost type; it does not provide billing,
provider pricing, or endpoint operation. Migration `0049` adds the private
`GET /api/workspaces/:workspaceId/research/quota-reconciliation` inspection
route and the maintenance-role-only linked/voided resolution boundary; it does
not change quota history or enable automatic re-fetch.
