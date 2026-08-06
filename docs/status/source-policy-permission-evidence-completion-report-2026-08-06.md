# Source-policy permission evidence completion report — 2026-08-06

## Outcome

Source-policy approvals now retain external permission or commercial-exception
evidence in a dedicated immutable field. The policy contract can declare
`permissionEvidenceRequired`; the disabled Stack Exchange draft declares that
requirement, and its approval command requires
`APPSEA_POLICY_PERMISSION_EVIDENCE_REFERENCE`.

The database activation function, review trigger, and runtime policy reads fail
closed when a policy requiring permission has no non-empty reference. Legacy
review rows remain intact and nullable for audit compatibility. No source was
registered, enabled, fetched, or activated by this tranche.

## Changed boundary

- `sourcePolicySchema` adds optional `permissionEvidenceRequired` metadata.
- `sourcePolicyApprovalInputSchema` adds nullable, bounded
  `permissionEvidenceReference` evidence.
- Migration `0111_source_policy_permission_evidence.sql` adds the immutable
  `source_policy_reviews.permission_evidence_reference` column and replaces the
  operator approval function with a signature that requires the evidence value.
- Stack Exchange policy metadata and runbook require a durable written-consent
  or commercial-exception reference; free-form notes do not satisfy the gate.
- Source collectibility, collection persistence, analysis lineage, campaign
  readiness, and competitive-evidence reads all require the evidence reference
  when the policy flag is true.

## Validation

Passed: contracts (112 tests), connectors (33), database unit tests (181),
worker tests (137), backup/restore helper tests, `pnpm verify` (56 Turbo tasks),
`pnpm security:audit`, memory/docs/format checks, fixture/plan/analysis/quality
generation, web smoke, and static release checks.

Docker-backed fresh/upgrade PostgreSQL execution remains an environment blocker
because the local Docker Desktop Linux engine pipe is unavailable. The
forward-only migration still needs the existing integration and backup/restore
suites in a working PostgreSQL environment; both commands were attempted and
stopped before database startup.

## Remaining blockers

Stack Exchange remains disabled because the first-party AUP permission question
still needs an actual independent legal/privacy/security decision and evidence.
CFPB remains disabled pending its separate review. Production provisioning,
hosted restore/failover, external object-store purge, provider operations, and
signed desktop release evidence remain outside this tranche.
