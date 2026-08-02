# Stack Exchange source policy draft

Status: disabled and not registered for production collection.

This is an engineering policy draft for the bounded
`stackexchange-stackoverflow` connector. It is not legal advice or an
activation record. The connector must remain disabled until an independent
legal/privacy/security review records a canonical reviewer identity, permitted
commercial purpose, retention decision, and attribution approval in the source
registry.

## Access and purpose

- Access uses only the official Stack Exchange API v2.3
  [`search/advanced`](https://api.stackexchange.com/docs/advanced-search) and
  exact question routes. AppSea does not scrape Stack Overflow pages.
- The connector accepts only bounded `competitor-research` or
  `contrary-evidence` collection requests (plus development/test purposes).
- `site=stackoverflow` is fixed by code. The caller cannot select another
  network site through this connector.
- An optional API key is supplied from runtime configuration and is never
  persisted, logged, or placed in fixtures. Production use requires the
  durable source-quota ledger.

## Commercial, attribution, and storage boundary

Stack Exchange's [API Terms of Use](https://engineering.stackexchange.com/legal/api-terms-of-use)
require visible attribution to the Stack Exchange Network. Public
contributions are distributed under the time-dependent
[CC BY-SA terms documented by Stack Overflow](https://stackoverflow.com/help/licensing).
The policy therefore treats commercial use as `restricted` until review
confirms the exact attribution, share-alike, and downstream-report treatment.

The connector stores only a bounded, sanitized question title/body excerpt,
stable question identifier, capture/publication times, and an HTTPS source
locator. It does not collect answers, comments, user profiles, avatars, or
private data. React-rendered evidence remains escaped text, and the source
locator is the attribution link shown in private evidence and competitor
views.

## Quotas and retention

- 30 requests per minute, 100 records per request, and 1,000 records per run.
- The API request cost is currently modeled as zero; a later policy revision
  must update the quota and cost ledger before activation.
- Excerpts are retained for 14 days under the draft policy and must follow the
  existing source-retention/redaction worker. Deletion is required, but the
  API provides no tombstone feed. Filtered search never proves that a missing
  question was deleted.
- The connector emits no deletion tombstones. Source absence remains a visible
  coverage gap; retention expiry and an approved deletion mechanism are separate
  duties.

## Coverage and failure behavior

Coverage is limited to questions matching the explicit query on Stack Overflow;
it is not a sample of all developers, products, or competitors. The connector
fails closed for disabled/pending/expired policies, non-HTTPS or non-official
API origins, empty searches, quota overages, oversized responses, malformed
records, API throttling, and missing required public fields. It records bounded
warnings for filtered-search deletion limits and skipped malformed records.

Exact question re-collection uses the official question-by-ID route and still
emits no tombstone. A source-native `stackoverflow:<question_id>` identifier
and the verified question URL remain in provenance so an operator can inspect
and attribute the claim.

## Review checklist before activation

1. Legal confirms the commercial CC BY-SA/share-alike and attribution path.
2. Privacy confirms the excerpt, profile exclusion, retention, and deletion
   treatment.
3. Security confirms API-key handling, outbound-origin pinning, response
   minimization, HTML stripping, and log redaction.
4. An independent reviewer records the policy hash, canonical identity, role,
   and attestation through the source-policy review boundary.
5. A reviewed source registry entry supplies the approved purpose,
   display mode, quotas, expiry, and deletion duties.
6. Production deployment proves the durable quota ledger, retention worker,
   attribution UI, and failure/rollback monitoring before enabling the source.

Until every item passes, Stack Exchange remains a fixture-backed connector
test surface only and cannot create non-synthetic production evidence.
