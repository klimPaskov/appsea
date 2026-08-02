# Research campaign lifecycle completion report

Date: 2026-08-02

## Delivered

- Added migration `0057_research_campaign_lifecycle.sql`, which permits the
  `archived` campaign state and grants only the editable campaign columns to
  the runtime role.
- Added a strict full-replacement update contract and authenticated owner/editor
  PATCH route for draft campaign intent.
- Added idempotent repository update receipts with identifier-only audit and
  outbox metadata. A changed validated campaign returns to `draft`.
- Added same-origin DELETE as a soft archive transition. Queued, running, and
  paused campaigns are protected; run/evidence/audit lineage is never deleted.
- Guarded fixture and production worker state transitions so a late completion
  or retry cannot resurrect an archived campaign.
- Added private campaign-page edit/archive controls without changing the sparse
  public leaderboard.

## Validation

Targeted contract, database, and web route tests cover strict update input,
permission and source validation boundaries, idempotent updates, active-run
archive rejection, lineage preservation, and private same-origin routes.
Full repository validation remains required before release. PostgreSQL fresh
and upgrade integration proof is still blocked by the unavailable Docker
Desktop Linux engine in this environment.

## Scope and remaining gaps

This tranche deliberately does not add automatic refresh scheduling, pagination,
multi-source orchestration, a source picker, or connector activation. Archive
is the safe substitute for destructive deletion; historical rows remain
addressable. The CFPB connector remains disabled until independent
legal/privacy/security approval and production provisioning are complete.
