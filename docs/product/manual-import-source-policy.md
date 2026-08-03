# Owner-authorized private import policy

AppSea’s first usable non-fixture intake is `manual-owner-import`. It is a tenant-private source for a workspace owner’s own CSV or JSON export (for example, support tickets, surveys, or an export from an application the workspace controls). The owner must attest that the workspace is authorized to analyze the records before each batch is staged.

This policy is not approval of CFPB, Stack Exchange, social media, review sites, or any other third-party source. It does not create public market coverage, prevalence, or market-size evidence. A report generated from an owner import must keep that limitation visible.

## Boundary

- Only an authenticated workspace owner may stage or delete a batch. Workspace members may inspect private batch metadata according to their workspace membership.
- Accepted formats are bounded CSV and JSON. The upload is capped at 2 MiB and 5,000 normalized records.
- AppSea maps a fixed set of fields (`source_record_id`, locator, capture/published times, query, product, company, feature, category, text, and language). Unknown fields are ignored.
- Text-like fields are whitespace-normalized and scrub common email, phone, payment-number, and secret/token patterns before persistence. Raw upload bytes are not retained.
- HTTP(S) locators may be retained for attribution and inspection, but AppSea never fetches a URL from an import.
- Temporal receives only an identifier-only `manualImportBatchId`; complaint payloads remain in the private PostgreSQL staging boundary.
- The private workspace screen at `/workspace/{workspaceId}/imports` exposes the same owner staging and deletion boundary without displaying raw staged rows; members can inspect batch metadata and follow completed collection runs.

The source policy is versioned as `manual-owner-import-v1`, uses excerpt display mode, has a 30-day staging retention expectation, and supports tombstone propagation. Deleting a batch immediately clears staged payloads, records source tombstones, and lets the existing deletion worker redact downstream source/evidence/report/plan projections.

## Coverage and evidence

Every normalized complaint keeps the owner-provided record identifier, capture time, query route, policy version, redaction state, and allowed representation. The collection result adds explicit gaps: it covers only the supplied export and query route, is not a statistical sample, and has not by itself run clustering, competitor research, contrary-evidence review, deterministic scoring, report generation, or plan packaging.

Operators must review the authority and privacy basis for the workspace’s export. AppSea does not infer authority from a filename, URL, or text inside the imported content, and imported content cannot modify code, skills, instructions, permissions, or repository memory.
