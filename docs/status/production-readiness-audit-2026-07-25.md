# Production-readiness audit — 2026-07-25

> Historical baseline. This audit is superseded by the
> [production-shaped analysis checkpoint report](production-analysis-completion-report-2026-07-26.md),
> which records the later migration 0030/0031 analysis and plan-governance
> work. The deployment and policy blockers below remain current.

## Decision

AppSea is not yet production-ready. The repository now has a validated,
fixture-backed product foundation and production-shaped persistence, workflow,
source-policy, approved-source collection, private-workspace, report,
maintenance, and account-recovery slices.
Production activation still requires external policy approval, infrastructure
provisioning, and deployment evidence listed below.

## Surface status

| Surface                        | Status                                                      | Evidence or gap                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and persistence      | Implemented in repository                                   | Twenty-nine checksummed migrations, normalized research/auth records, RLS, provenance, deletion lineage, score/report/plan lineage, narrow recovery/invitation functions, owner-safe account closure, operator-only source-policy review evidence, production collection job/checkpoint projections, and policy-derived retention tombstone enqueue. Fresh and upgrade integration gates are blocked here because Docker is unavailable. |
| Collection and source policy   | Approved-source checkpoint implemented; live source blocked | The CFPB connector has typed policy, quota, timeout, provenance, narrative, malformed/partial, and deletion fixtures. The policy registry now requires an operator approval record, and the collection repository/private route plus Temporal boundary persist and inspect non-synthetic evidence only after activation; no source is enabled in this repository.                                                                        |
| Complaint analysis and scoring | Fixture-complete                                            | Normalization, deduplication, clustering, competitor/contrary-evidence fields, deterministic versioned scoring, and reproducible fixture artifacts are implemented. Market claims cannot be inferred from synthetic data.                                                                                                                                                                                                                |
| Reports and coding plans       | Fixture-complete/private                                    | Evidence-backed report composition, source coverage, plan packages, private reads, approval transitions, and approved JSON export are implemented. General non-fixture curation, object storage, report/plan retention propagation, and export purge remain open.                                                                                                                                                                        |
| Website and API                | Implemented                                                 | The public leaderboard remains sparse and synthetic; opportunity detail, evidence, coverage, reports, plans, auth, recovery, private invitation acceptance, and approved-source collection evidence are on separate/private routes. The future Tauri shell has no duplicate product logic.                                                                                                                                               |
| Workspaces and identity        | First private slice implemented                             | Signup/sign-in, hashed sessions, membership authorization, step-up, session inventory/revocation, owner member administration, existing-account invitations, and owner-safe account closure are implemented. Verified identity/recovery provider approval, invitation delivery, MFA/OIDC, and production identity operations remain open. Closure retains shared workspace research by design.                                           |
| Durable jobs and workflows     | Local/CI proof implemented                                  | Temporal fixture and production-collection workflow boundaries, PostgreSQL checkpoints, retries, cancellation, budget rejection, hashed idempotency, actor attribution, maintenance runners, and bounded recovery outbox worker are package-tested. Production Temporal topology, authenticated deployment, scheduling, alerting, DB/workflow integration, and crash/failure drills are absent.                                          |
| Security and operations        | Repository controls implemented; deployment proof missing   | Source gates, redaction, RLS, least-privilege grants, rate limits, retention, fixed-code worker events, and recovery kill switches exist. Production secrets, TLS roles, HA/backups, monitoring, cost accounting, key rotation, and incident evidence require deployment review.                                                                                                                                                         |
| Guidance and memory            | Aligned                                                     | `AGENTS.md`, generated catalogs, docs, project memory, the active plan, and the source-policy/collection runbooks agree with the current repository state.                                                                                                                                                                                                                                                                               |

## Validation evidence

Passing checks on 2026-07-25:

- `pnpm verify` — 52 package tasks plus fixture generation, plan-package
  generation, web smoke, and repository validation.
- `pnpm docs:check`, `pnpm memory:check`, and `pnpm repo:check --docs-only`.
- Focused contracts/connectors/db/workflows/worker/web suites: 50 / 13 / 27 / 18 / 30 / 32 tests passed.

The following were attempted but could not start because this host has no
Docker Desktop Linux engine at `//./pipe/dockerDesktopLinuxEngine`:

- `pnpm verify:persistence`
- `pnpm verify:workflows`

Those gates must pass on a host with Docker before PostgreSQL role/RLS,
migration-upgrade, Temporal restart, and workflow integration claims are
closed.
The new retention function currently has static migration assertions only;
candidate selection, workspace authorization, tombstone idempotency, and
propagation still need the Docker-backed integration suite.

## Explicit simplifications

- The only complete research path remains synthetic fixture mode.
- The approved-source path currently ends at a policy-bound collection
  checkpoint; it does not yet recompute clusters/opportunities or produce
  non-fixture reports/plans.
- The CFPB connector is a reviewed-shaped, disabled boundary rather than an
  approved live commercial source.
- Password recovery persists and processes a secure outbox, but external
  delivery is provider/identity kill-switched until policy, DPA/retention,
  verified-domain, secret-rotation, monitoring, and failure-drill evidence are
  approved.
- Recovery and invitation workers are bounded scheduler commands; deployment
  must provide durable scheduling and supervision.
- Workspace invitations persist hash-only tokens and encrypted delivery rows,
  require owner step-up, accept only existing accounts with matching email, and
  remain delivery-kill-switched until verified identity/provider policy is
  approved. New-account creation and email verification are intentionally out of
  scope for this tranche.
- Account closure is owner-safe and profile-focused: it revokes authentication
  material and anonymizes the profile but retains shared workspace research and
  does not purge object stores, exports, or backups.
- Deletion propagation does not yet recompute complaint/cluster/opportunity
  aggregates or purge non-fixture object storage/backups/exports.
- A bounded retention enqueue now derives source tombstones from each stored
  policy and reuses deletion propagation; `redact` and `tombstone` currently
  have the same propagation semantics, while field-level redaction and
  external object-store/backups purge and complaint/cluster recomputation
  remain open. A settled quota reservation without a
  committed collection result requires operator reconciliation, and the
  production workflow has no Docker-backed repository/activity integration
  proof. The policy snapshot is revalidated before persistence, but a live
  source still needs a revocation lease across the external fetch; direct
  Temporal actor claims likewise require namespace/gateway authorization.
  Requested timestamps remain caller-controlled for replay, so collection
  snapshot/run timestamps are not yet a server-observed freshness proof. CFPB
  cost is currently fixed at zero by policy.
- Windows/macOS Tauri signing, updates, and platform release tests are staged,
  not shipped.

## Required next actions

1. Provision and validate production PostgreSQL and Temporal with TLS, role
   separation, HA/backups, retention, secrets, monitoring, and restore/failure
   drills.
2. Complete legal/privacy/security review for the CFPB policy, close the
   policy-revocation/fetch race, and activate it only through the source
   registry after approval.
3. Approve a verified identity and delivery provider contract, then run the
   recovery/invitation/provider identity security review before enabling the
   recovery kill switch.
4. Implement deletion recomputation, non-fixture evidence/report storage,
   object-store/backups retention and purge, export purge, and provider-level
   billing/operational controls. Add production ingress body/rate/concurrency
   limits for workflow starts.
5. Complete Tauri signing, updates, platform testing, and release runbooks.
