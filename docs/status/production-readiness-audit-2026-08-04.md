# Production-readiness audit — 2026-08-04

Status: not production-ready. This audit supersedes the 2026-08-03 audit and
records the runtime-skill persistence, research-quality benchmark, and
score-factor provenance tranches.

## Surface status

| Requirement                                 | Evidence in this repository                                                                                                                                                                                                                                                                                                              | Remaining gate                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL persistence and migrations       | Ninety-nine checksummed migrations, forced-RLS repositories, source/evidence/complaint/cluster/competitor/opportunity/score/report/plan/workflow lineage, MFA/OIDC/auth, audit history, purge readiness, and operator-only runtime-skill persistence/audit. Fresh local persistence and backup/restore checks pass through `0099`.       | Provider role provisioning, encrypted backups, HA/PITR, restore/failover drills, production credentials, and approved live key rotation.                                     |
| Durable workflows and idempotent jobs       | Fixture, collection, analysis, refresh, recomputation, maintenance, cancellation, leases, bounded retries, replacement recovery, sanitized identifier-only v2 histories, and worker shutdown/recovery boundaries are implemented and locally/CI tested.                                                                                  | Authenticated Temporal namespace/task-queue ACLs, deployed scheduler ownership, HA/restore drills, and legacy v1 history archive/retention operation.                        |
| Approved complaint sources                  | `manual-owner-import-v1` is active only for tenant-private owner-attested CSV/JSON. CFPB and Stack Exchange connectors have typed policy metadata, quotas, provenance, deletion handling, fixtures, and operator review gates, but remain disabled/unregistered.                                                                         | Independent legal/privacy/security/commercial-use/retention approval and activation evidence for a public source. No public market coverage is claimed.                      |
| Complaint analysis and scoring              | Deterministic normalization, deduplication, classification/entity snapshots, narrow clustering, competitor/contrary fields, versioned v0.2/v1 scoring, correction invalidation, recomputation, factor-level source/reviewed-seed provenance checks, and the synthetic/redacted `research-quality-v1.0.0` benchmark are covered by tests. | Semantic near-duplicate/entity/author handling, live calibration, source-backed competitor/contrary research, and permitted non-fixture observations.                        |
| Reports and coding-agent packages           | Provenance-aware reports, visible coverage gaps, approval/export governance, object references, six-file plan manifest, private reads, and optional quality snapshots in artifacts/reports are implemented.                                                                                                                              | Encrypted cloud object storage, lifecycle/versioning, export/workspace purge, backup deletion verification, and deployed controls.                                           |
| Authentication and private workspaces       | Password sessions, membership/RLS, step-up, TOTP/recovery-code MFA, account/session controls, invitations/recovery kill switches, archival, scoped read-only MCP access, governance approvals, and disabled-by-default OIDC boundary are implemented.                                                                                    | Provider identity/delivery/DPA/retention/revocation approval, DNS/egress enforcement, provider-backed step-up, live key-rotation review, and production identity operations. |
| Website and desktop boundary                | Sparse fixture-disclosed leaderboard, private opportunity/research/report/plan routes, source coverage/evidence views, Tauri web boundary, restrictive CSP/capabilities, and independent Windows/macOS build checks exist.                                                                                                               | Signed installers, updater trust, notarization, hosted-origin review, platform installation tests, and release runbook.                                                      |
| Observability, cost, security, and recovery | Health/readiness, leases/metrics, quota/recompute/cost alerts, signed bounded delivery, security audit, retention/tombstone flows, backup/restore drill, and worker replacement proof are implemented.                                                                                                                                   | Deployed scheduler/alert endpoint ownership, provider billing/recovery/incident routing, multi-instance drills, hosted deployment proof, and CI billing gate.                |
| Guidance, memory, and provenance            | `AGENTS.md`, docs, active plan, memory, native skills, source policies, tests, and this audit record synthetic disclosure, visible coverage gaps, and untrusted imported content.                                                                                                                                                        | Continue guidance checkpoints; no completion claim is justified while external gates remain.                                                                                 |

## Validation evidence

Passing locally for this tranche:

- `pnpm --filter @appsea/contracts test` — 99 tests.
- `pnpm --filter @appsea/research test` — 13 tests.
- `pnpm --filter @appsea/scoring test` — 9 tests.
- `pnpm --filter @appsea/reports test` — 8 tests.
- Affected package lint and typecheck.
- Snapshot replay produces stable benchmark/content hashes for a fixed
  evaluator timestamp; schema tests reject imported/non-fixture cases and
  source-derived benchmark provenance.
- Balanced v1 score tests reject missing/unknown factor bindings and production
  analysis tests accept retained-evidence bindings while rejecting unrelated
  source IDs.

The repository-wide local proof remains `pnpm verify`, `pnpm security:audit`,
`pnpm verify:local-stack`, and `pnpm verify:backup-restore` as recorded in the
previous audit. Hosted runs `30941916282` for commit `1f20e39`, `30944900421`
for commit `34c4a4c`, `30947627304` for commit `e3f28d7`, `30947761415` for
commit `c6ffa66`, and latest `30949355268` for commit `e276876` failed before
repository steps because the GitHub account payment/spending-limit gate is
unresolved; this is not presented as a code assertion failure.

## Deliberate simplifications

- The benchmark corpus is intentionally small, synthetic, redacted, and
  checked in only to detect deterministic pipeline drift.
- Quality metrics do not infer market demand, source coverage, unique authors,
  semantic similarity, live calibration, or source-backed competitor claims;
  reviewed score-factor provenance is explicit but does not make reviewed seed
  values market evidence.
- No third-party connector was activated, no production provider was
  provisioned, and no cloud/backup purge or signed desktop release was
  simulated.

## Exact next actions

1. Obtain independent policy approval and activation evidence for CFPB plus a
   separately reviewed competitor/contrary-evidence source.
2. Provision role-separated PostgreSQL, authenticated Temporal, encrypted
   object storage, backups, scheduler ownership, alert routing, and incident
   operations; run restore/failover/cancellation/replacement drills.
3. Review OIDC/delivery/verified identity, MFA rotation, provider-backed
   step-up, edge limits, secret storage, billing, and deployment controls.
4. Use the new factor bindings with approved retained observations only after
   permitted non-fixture sources and independent review exist; add live
   calibration then.
5. Complete signed Windows/macOS packaging, updater, notarization, and install
   validation.

This audit is completion evidence for the tranche only. It is not a claim that
AppSea is production-ready or that real market research is available.
