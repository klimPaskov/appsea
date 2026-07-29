# Evidence and report slice completion report

- Date: 2026-07-24
- Scope: private evidence inspection, source-policy coverage, deterministic
  fixture report generation, report approval governance, and approved export
- Status: fixture report operations implemented; live source activation and
  non-fixture object storage remain blocked

## Implemented

- `packages/contracts/src/index.ts` defines strict report and source-coverage
  contracts. Evidence, inference, recommendation, warnings, and coverage gaps
  are separate fields.
- `packages/reports/src/index.ts` generates an evidence-backed report from a
  validated fixture artifact. Observations retain evidence/source identifiers;
  inference copies the deterministic score snapshot and contrary evidence; the
  recommendation is a bounded rule-based next-step list.
- `packages/db/src/fixture-repository.ts` persists a content-hashed
  `report_versions` row and links the plan package to that report. Replay keeps
  the same immutable report identity.
- `packages/db/src/auth-repository.ts` exposes fixture source-policy coverage and
  filters private evidence to active source/evidence rows with an allowed
  representation and redaction state.
- The private evidence and report routes render coverage metadata, fixture
  disclosure, retained observations, deterministic inference, contrary evidence,
  recommendation, and visible coverage gaps. The public leaderboard is unchanged.
- Migration `0022_report_approval_governance.sql` enforces the reviewed report
  lifecycle in PostgreSQL and emits identifier-only audit/outbox receipts.
  Private owners/editors can review through the authenticated API, owners can
  approve or withdraw, and the export route serves only approved, validated
  report JSON.

## Validation

- `pnpm --filter @appsea/contracts test` — 42 tests passed.
- `pnpm --filter @appsea/reports test` — 4 tests passed, including report schema
  and evidence/inference separation.
- `pnpm --filter @appsea/db test` — 20 tests passed.
- `pnpm --filter @appsea/web test` — 14 tests passed, including approval and
  approved-export route coverage.
- The focused contract suite now has 44 passing tests; the original fixture
  count above is retained as historical context.
- `pnpm check` — formatting, lint, typecheck, package tests, and repository
  validation passed.
- The PostgreSQL integration assertion now proves report persistence, plan/report
  linkage, report schema version, membership-authorized private report/source
  coverage reads, approval transitions, audit receipts, and approved export when
  Docker-backed integration is available.

## Boundaries and remaining gaps

- The report composer is deterministic and fixture-only. It makes no claim about
  market size, momentum, or live source coverage.
- Non-fixture report payloads still require reviewed object-storage, export
  retention, and deletion boundaries; no live source is enabled.
- Evidence curation, complaint/cluster/opportunity recomputation after deletion,
  general non-fixture composition, and object-store/backup export purge remain
  follow-up work.
- Fresh PostgreSQL proof for this change is blocked in the current environment by
  the unavailable Docker Desktop Linux engine.
