# ADR 0024: Step-up for research governance mutations

- Status: accepted
- Date: 2026-08-04

## Context

ADR 0015 applies conditional MFA to mutations that already had the reviewed
fifteen-minute password step-up. Research governance and curation routes also
change durable evidence-derived state, but their role and same-origin checks
previously did not require a session-bound password proof. That left report,
plan, seed, complaint, and competitor-review decisions at a weaker boundary
than the evidence they govern.

## Decision

Use one server-side `requireRecentMutationStepUp` gate immediately before the
mutation repository call for these private mutations:

- report approval at `PATCH /api/workspaces/:workspaceId/reports/:reportId`
- coding-plan approval at `PATCH /api/workspaces/:workspaceId/plans/:planPackageId`
- opportunity-seed review transitions at
  `PATCH /api/workspaces/:workspaceId/seed-reviews/:seedReviewId`
- production complaint review/correction at
  `PATCH /api/workspaces/:workspaceId/research/production/:runId/complaints/:complaintId`
- competitor observation creation and review at the corresponding private
  `POST` and `PATCH` observation routes
- evidence redaction at the complaint evidence `POST` route, preserving its
  existing policy and authorization checks

The gate reads the current HttpOnly session token, requires the existing
fifteen-minute password marker, and then requires the session-bound MFA marker
when the account has MFA enabled. It returns the existing bounded `401` or
`428` responses and never accepts a client-supplied proof or imported content.
Accounts without enabled MFA retain the repository's reviewed password-only
compatibility behavior.

## Consequences

- Governance decisions and curation corrections have a consistent, auditable
  proof boundary across the private website and future desktop shell.
- Invalid, stale, or missing proof cannot reach a report, plan, evidence,
  complaint, seed, or competitor repository mutation.
- Campaign starts, source-policy changes, identity operations, and other
  mutations that never had a password-step-up contract remain separate reviewed
  work; this ADR does not silently broaden their authorization.
- Tests cover the shared gate itself and each affected route's password/MFA
  rejection path. Production deployment, provider-backed identity, and external
  MFA operations remain open gates.
