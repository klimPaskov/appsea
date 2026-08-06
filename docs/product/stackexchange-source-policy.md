# Stack Exchange source policy draft

Status: disabled and not registered for production collection. The current
first-party Acceptable Use Policy is a blocking review item for AppSea's
intended automated competitor/contrary research; no collection is permitted
without documented express prior written consent or an applicable commercial
exception.

This is an engineering policy draft for the bounded
`stackexchange-stackoverflow` connector. It is not legal advice or an
activation record. The connector must remain disabled until an independent
legal/privacy/security review records a canonical reviewer identity, permitted
commercial purpose, retention decision, and attribution approval in the source
registry. The immutable draft also declares `permissionEvidenceRequired: true`;
an approval must therefore carry a non-empty
`source_policy_reviews.permission_evidence_reference` pointing to the written
consent or commercial-exception record. Free-form notes do not satisfy that
gate.

## Access and purpose

- Access uses only the official Stack Exchange API v2.3
  [`search/advanced`](https://api.stackexchange.com/docs/advanced-search) and
  exact question routes. AppSea does not scrape Stack Overflow pages.
- The engineering draft models bounded `competitor-research` or
  `contrary-evidence` requests (plus development/test purposes), but the
  connector must remain disabled until the Network AUP blocker is cleared.
- `site=stackoverflow` is fixed by code. The caller cannot select another
  network site through this connector.
- An optional API key is supplied from runtime configuration and is never
  persisted, logged, or placed in fixtures. Production use requires the
  durable source-quota ledger.

The official API documentation describes API access and throttling, but it does
not grant permission for every purpose. The [Network Acceptable Use
Policy](https://stackoverflow.com/legal/acceptable-use-policy) currently
restricts automated systems that collect Network content for building a similar
or competitive product/service or for generative-AI work unless express prior
written consent is obtained. AppSea's intended use is close enough to that
language that the source stays blocked pending a written permission or
commercial-license record reviewed by legal and security. This is a policy
constraint, not a legal conclusion.

## Commercial, attribution, and storage boundary

Stack Exchange's [API Terms of Use](https://engineering.stackexchange.com/legal/api-terms-of-use)
require visible attribution to the Stack Exchange Network. Public
contributions are distributed under the time-dependent
[CC BY-SA terms documented by Stack Overflow](https://stackoverflow.com/help/licensing).
Because the AUP permission question is unresolved, the policy records
commercial use as `unknown`, not `restricted` or `allowed`. CC BY-SA and API
attribution alone are not treated as permission to run AppSea's automated
collection route.

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
- Freshness is modeled as a 24-hour expected interval plus a 48-hour allowed
  delay for the private read projection; this is an engineering threshold, not
  an API guarantee or activation approval.
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

1. Legal obtains and records express prior written consent or an applicable
   commercial exception for AppSea's automated collection purpose; the
   consent/exception reference must be retained in the immutable
   `source_policy_reviews.permission_evidence_reference` field.
2. Legal confirms the commercial CC BY-SA/share-alike and attribution path.
3. Privacy confirms the excerpt, profile exclusion, retention, and deletion
   treatment.
4. Security confirms API-key handling, outbound-origin pinning, response
   minimization, HTML stripping, and log redaction.
5. An independent reviewer records the policy hash, canonical identity, role,
   and attestation through the source-policy review boundary.
6. A reviewed source registry entry supplies the approved purpose,
   display mode, quotas, expiry, and deletion duties.
7. Production deployment proves the durable quota ledger, retention worker,
   attribution UI, and failure/rollback monitoring before enabling the source.

The operator-only `pnpm worker:source:policy:stackexchange` command can register
the disabled draft or record an independent approval using
the same migration-owner review boundary as CFPB. The production collection
activity and scheduled refresh worker select the Stack Exchange connector only
when that database snapshot is active, current, unexpired, and independently
approved; neither the CLI nor the worker bypasses the review gate.

Until every item passes, Stack Exchange remains a fixture-backed connector
test surface only and cannot create non-synthetic production evidence. A
source-policy approval without the written-consent/exception record is not
sufficient for activation.
