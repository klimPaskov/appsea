# Policy-selected production connector runner

Date: 2026-08-02
Status: implemented; no source activated

## Delivered

- The production collection activity now selects the connector from the
  database's approved, active, unexpired source-policy snapshot instead of
  hard-coding CFPB. The request source ID must match the returned policy, and
  only the explicit CFPB and Stack Exchange connector identities are allowed.
- The scheduled campaign-refresh worker uses the same allowlist and can build a
  Stack Exchange request only for a single source whose approved policy permits
  the campaign purpose and display mode.
- The existing CFPB direct command remains an explicit CFPB-only wrapper with
  its worker-principal admission boundary; the generic workflow path is used
  for policy-selected sources.
- Added an operator-only `source:policy:stackexchange` CLI that registers a
  disabled draft or records approval through the existing migration-owner
  source-policy review functions. It cannot bypass policy review or activate a
  source by itself.
- Added worker and refresh tests proving connector selection, source/policy
  identity matching, Stack Exchange refresh routing, and existing CFPB lease,
  quota, admission, replay, recollection, and failure behavior.

## Security and provenance boundary

The worker receives only the validated policy snapshot and passes the durable
quota capability plus the server-observed lease timestamp into the selected
connector. Imported source content remains minimized and policy-bound; the
Stack Exchange connector still strips HTML, retains only bounded excerpts, and
emits no deletion tombstones for filtered search. No model, source, or worker
can self-approve or self-activate a connector.

## Validation

- Worker typecheck, lint, and tests pass; the worker suite covers 75 tests.
- Connector tests remain green with 23 tests covering the policy allowlist and
  origin boundary.
- Repository-wide `pnpm verify` passed after the final documentation and memory
  checkpoint.

## Blockers and simplifications

- CFPB and Stack Exchange remain disabled or unregistered in this repository;
  independent legal/privacy/security review, policy approval, deployment
  credentials, retention/deletion operations, and production monitoring are
  still required before non-synthetic collection.
- The Stack Exchange candidate is reachable through the generic workflow only
  after an operator has registered and independently approved its policy; this
  tranche does not create that database row or claim legal approval.
- Snapshot reconciliation remains CFPB-specific because Stack Exchange has no
  deletion tombstone feed. Filtered search cannot establish absence of
  complaints or deletion.
- Production Temporal/PostgreSQL deployment and Docker-backed integration proof
  remain environmental/deployment blockers.

This tranche closes the hard-coded worker boundary but does not complete the
broader AppSea production-readiness goal.
