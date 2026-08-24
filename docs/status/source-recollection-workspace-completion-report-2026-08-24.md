# Private source re-collection workspace slice — 2026-08-24

## Outcome

The existing tombstone-bound source re-collection API and worker path now have a
private workspace read surface. Members can inspect completed, identifier-only
deletion lineage on the campaigns page. Owners and editors can submit an
explicit one-record request only when a non-synthetic campaign has a current
approved policy matching the tombstone source and display mode.

The action reuses the existing authenticated production workflow endpoint. It
does not activate a connector, restore the deleted row, bypass quota/admission
or policy checks, expose raw source payloads, or start analysis automatically.
Manual-owner-import campaigns are not offered because a staged batch is the
required ingress for that source and is intentionally incompatible with
tombstone re-collection.

## Proof

- `productionCollectionRecollectionTargetSchema` is strict, bounded, and
  identifier-only; raw payload fields are rejected. It also exposes only the
  active source link and active workflow identifier needed to prevent duplicate
  requests.
- `PostgresProductionCollectionRepository.listRecollectionTargetsForUser` uses
  an authenticated read-only workspace transaction and a maximum 100-row
  result. The API rejects a different in-flight workflow for the same tombstone
  while allowing the deterministic idempotent replay of that workflow.
- Repository tests cover completed lineage, active-link/workflow state, source
  filtering, and bounded SQL reads.
- Web tests cover request construction, active-workflow rejection, and
  approved-policy campaign filtering.
- Contracts, DB, and web typechecks/lints pass; focused contract, DB, and web
  test suites pass.

## Boundaries

The CFPB, Stack Exchange, and other public connectors remain disabled until
independent legal, privacy, security, and commercial review approves them.
The page therefore reports an unavailable or empty lineage state honestly and
does not present a successful request as public market research.
