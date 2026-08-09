# AppSea production-readiness audit — 2026-08-09

Status: **incomplete; do not promote as a production market-research service**.

This audit compares the active product goal and plan with the checked-in
implementation, current tests, generated artifacts, and external operating
dependencies. Fixture output and the tenant-private owner-import path are not
presented as public market research.

## Surface status

| Surface                       | Current evidence                                                                                                                                                                                                                                                | Status                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and persistence     | 121 ordered/checksummed PostgreSQL migrations; repositories and RLS for sources, evidence, complaints, clusters, competitors, opportunities, score snapshots, reports, plans, audit, cost, lineage, and purge queues. `pnpm test` passes all 15 package suites. | Implemented in repository; fresh/upgrade database proof pending.                                                                             |
| Durable workflows             | Fixture, collection, analysis, maintenance, alert, cancellation, retry, admission, and worker-drain boundaries are covered by unit/integration-shaped tests and deterministic identifiers.                                                                      | Implemented locally; hosted Temporal, HA, replacement, and namespace ACL evidence pending.                                                   |
| Approved collection           | `manual-owner-import-v2` is active, owner-attested, tenant-private, bounded, PII-scrubbed, quota-gated, tombstone-aware, and fixture-backed. CFPB and Stack Exchange have typed policy/connector boundaries and handoff manifests but remain disabled.          | Private connector usable; no public source activation is authorized.                                                                         |
| Research pipeline             | Normalization, deduplication, classification, clustering, entity resolution, competitor/contrary observations, deep-research gates, deterministic v0.2/v1 scoring, provenance, quality snapshots, and correction invalidation are implemented.                  | Implemented with visible synthetic/coverage limits; live-source calibration remains open.                                                    |
| Reports and plans             | Private evidence inspection, approvals, cursor-bounded history, selected-version reads, JSON/Markdown export, plan comparison, deterministic report Markdown persistence, and report-Markdown purge lineage are implemented.                                    | Implemented locally; ZIP packaging and provider-side export/object/backup purge remain follow-up work.                                       |
| Authentication and workspaces | Scrypt sessions, membership/RLS, MFA, step-up, session inventory/revocation, owner archival/purge readiness, invitations/recovery mechanics, optional OIDC, and private routes are implemented and tested.                                                      | Repository boundary implemented; verified identity, delivery, retention, provider-backed step-up, and deployment operations remain external. |
| Website and desktop boundary  | Sparse public leaderboard and separate opportunity detail routes; private route captures cover 20 public and 36 private screenshots across four viewports with no runtime/main/overflow failures. Tauri boundary checks pass.                                   | UI contract is locally verified; signed desktop releases and hosted-origin review remain open.                                               |
| Operations and security       | Worker/alert loops, budgets, cost ledgers, leases, failure recovery, preflight, and dependency audit are implemented. `pnpm security:audit`, `pnpm memory:check`, and `pnpm docs:check` pass.                                                                   | Local controls pass; production scheduler, endpoint, billing, incident, secret, provider, and backup operations remain open.                 |

## Validation evidence

- `pnpm test` — passed: 15 packages; current run includes 118 contract, 189
  database, 146 worker, and 237 web tests among the package totals.
- `pnpm test:backup-restore` — passed the local helper tests; the verifier now
  targets migration `0121`.
- `pnpm security:audit` — passed with no known production vulnerabilities.
- `pnpm memory:check` — passed with 152 indexed chunks.
- `pnpm docs:check` — passed on the prior checkpoint; rerun after this report.
- `artifacts/ui-reference-loop/2026-08-06/public-capture-manifest.json` — 20
  captures pass title/main/runtime/overflow checks.
- `artifacts/ui-reference-loop/2026-08-06/private-capture-manifest.json` — 36
  authenticated captures pass the same scalar checks.
- `pnpm ui:capture` — passed a fresh local run on 2026-08-09 with 20 public
  captures at 1280, 1024, 768, and 480 pixels; representative leaderboard and
  opportunity screenshots were visually inspected. The 480-pixel pass uses a
  narrow desktop layout (`mobile: false`), not a mobile-emulation desktop
  capture.
- `pnpm verify:backup-restore` — blocked in this environment because Docker
  Desktop's `dockerDesktopLinuxEngine` pipe is unavailable; this is not fresh
  migration or restore evidence.
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
3. The report/plan export slice deliberately provides deterministic JSON and
   Markdown plus metadata-only comparison; a ZIP/08_spec directory bundle and
   provider-side destructive purge are not silently represented as complete.
4. The public website remains fixture-disclosed and database-free; private
   research requires the local authenticated stack. This preserves the sparse
   leaderboard contract instead of presenting synthetic rankings as demand.

## Next actions

- Restore Docker Desktop and rerun fresh/upgrade PostgreSQL, backup/restore,
  worker replacement, and local-stack proofs against migration `0121`.
- Obtain and record independent source-policy approvals before enabling a public
  connector; keep coverage gaps visible until then.
- Provision and verify hosted PostgreSQL/Temporal/object storage, identity and
  delivery, scheduler/alert ownership, retention/purge, billing, and incident
  controls.
- Complete signed Windows/macOS Tauri release and hosted-origin review.

This report is evidence of current state, not a completion claim.
