# Owner-authorized private import policy

AppSea’s first usable non-fixture intake is `manual-owner-import`. It is a tenant-private source for a workspace owner’s own CSV or JSON export (for example, support tickets, surveys, or an export from an application the workspace controls). The owner must attest that the workspace is authorized to analyze the records before each batch is staged.

This policy is not approval of CFPB, Stack Exchange, social media, review sites, or any other third-party source. It does not create public market coverage, prevalence, or market-size evidence. A report generated from an owner import must keep that limitation visible.

## Boundary

- Only an authenticated workspace owner may stage or delete a batch. Workspace members may inspect private batch metadata according to their workspace membership.
- Accepted formats are bounded CSV and JSON. The upload is capped at 2 MiB and 5,000 normalized records.
- AppSea maps a fixed set of fields (`source_record_id`, locator, capture/published times, query, product, company, feature, category, text, and language). Unknown fields are ignored.
- Text-like fields are whitespace-normalized and scrub common email, phone, payment-number, and secret/token patterns before persistence. Raw upload bytes are not retained.
- HTTP(S) locators may be retained for attribution and inspection, but AppSea never fetches a URL from an import.
- The route reserves the workspace-scoped production workflow admission before persisting normalized rows; rejected rate/concurrency attempts do not write staged payloads. If bounded staging fails, only a newly admitted still-reserved row is released through the authenticated actor-bound function. Replayed, consumed, or expired reservations are never released optimistically; a reservation whose Temporal start outcome is uncertain expires through the server-owned five-minute TTL.
- Temporal receives only an identifier-only `manualImportBatchId`; complaint payloads remain in the private PostgreSQL staging boundary.
- The private workspace screen at `/workspace/{workspaceId}/imports` exposes the same owner staging and deletion boundary without displaying raw staged rows; members can inspect batch metadata and follow completed collection runs.

The current source policy is versioned as `manual-owner-import-v2`, uses excerpt display mode, has a 30-day staging retention expectation, supports tombstone propagation, and is operationally on demand rather than a collection schedule. A leased source-maintenance pass now automatically clears staged or consumed batches after that policy window, records a fixed retention-expiry audit event, and queues downstream tombstones before deletion propagation. Its legacy policy payload does not declare a freshness SLA, so the registry keeps freshness `unknown` until a new reviewed policy version adds one. Version `v1` remains immutable for historical batches but is no longer the current collection snapshot. Owner-requested deletion still clears staged payloads immediately; both paths let the existing deletion worker redact downstream source/evidence/report/plan projections.

Version `v2` additionally permits the private purposes `competitor-research` and
`contrary-evidence`. Those purposes do not turn an owner export into public
market research: each observation must point to retained evidence and remains
unreviewed until an editor or owner confirms or rejects the bounded claim.
Only a confirmed, non-synthetic observation from the current collection
lineage can enter a later explicit production-analysis rerun. That rerun
copies the observation and evidence hashes into an append-only analysis lineage
record and exposes the claim in the private report and coding plan. Rejected,
deleted, stale, or policy-mismatched observations stay out of outputs and are
shown as coverage gaps; review does not trigger an autonomous rerun.

## Coverage and evidence

Every normalized complaint keeps the owner-provided record identifier, capture time, query route, policy version, redaction state, and allowed representation. The collection result adds explicit gaps: it covers only the supplied export and query route, is not a statistical sample, and has not by itself run clustering, competitor research, contrary-evidence review, deterministic scoring, report generation, or plan packaging.

Operators must review the authority and privacy basis for the workspace’s export. AppSea does not infer authority from a filename, URL, or text inside the imported content, and imported content cannot modify code, skills, instructions, permissions, or repository memory.
