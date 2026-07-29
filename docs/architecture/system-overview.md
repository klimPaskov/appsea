# System overview

The starter uses a TypeScript monorepo.

```text
workflow client ──► Temporal durable workflow ──► worker activities
                         │                         │
                         │                         ├─ fixture/source policy gate
                         │                         ├─ normalization and clustering
                         │                         ├─ deterministic scoring/reports
                         │                         └─ PostgreSQL transaction
                         │                                  │
                         └─ sanitized status/query        ▼
                                      PostgreSQL job state, provenance,
                                      immutable run lineage, source quota
                                      reservations, deletion projections,
                                      and outbox
                                                          │
                                                          ▼
                                                website and API routes
```

The fixture path now writes the same normalized provenance and immutable run
lineage into PostgreSQL through `packages/db`. Temporal owns scheduling, retry,
cancellation, and recovery while PostgreSQL owns the workspace-scoped
projection and invariants. Workflow history contains only sanitized identifiers,
hashes, budgets, and fixed summaries. PostgreSQL and Temporal are verified in
loopback local environments and CI, with separate database roles plus forced
workspace RLS.

Non-fixture report, plan, and production-analysis artifact blobs cross the
`packages/object-store` content-addressed reference seam. Its in-memory and
local filesystem adapters prove workspace isolation, immutable replay, tombstone
reads, and retention-aware purge. Report and plan serializers validate their
payloads before storage, and production analysis persists policy-review and
evidence/source-item lineage in migration `0030`; migration `0031` keeps report
and plan approval/export governance separate; migration `0032` adds an
editor/owner complaint-review boundary before downstream analysis. Complaint
IDs are never used as evidence IDs.
Migration `0033` adds an immutable workspace seed-review registry with
editor/owner approval transitions; analysis start and persistence both resolve
and verify approved seed content by ID, version, and hash.
Migration `0034` adds a deterministic, approved-seed-bound handoff queue written
with collection completion; the worker claims stale-recoverable rows and starts
the existing analysis workflow only after rebuilding active evidence lineage.

Production evolution still requires authenticated/TLS-protected Temporal,
production identity/recovery policy and scheduled/distributed validation of the
new login/source maintenance jobs, approved live connectors, production
database provisioning, encrypted cloud object storage and backup purge,
complaint/cluster deletion recomputation,
and operational controls. The local
fixture workflow is not a production deployment or market-research claim.
