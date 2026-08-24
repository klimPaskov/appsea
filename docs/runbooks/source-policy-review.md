# Source policy review and activation

This runbook is an operator procedure, not legal advice. It keeps the CFPB
connector disabled until the intended deployment has an assigned legal,
privacy, and security review owner.

## Register the engineering draft

Use a migration-operator database URL. The runtime `appsea_service` role is
deliberately rejected by the registration function.

```powershell
$env:APPSEA_SOURCE_POLICY_ACTION = 'draft'
$env:APPSEA_CFPB_POLICY_VERSION = 'cfpb-2026-07-v1'
$env:APPSEA_POLICY_DATABASE_URL = '<migration-role-url>'
$env:APPSEA_POLICY_RECORDED_AT = '2026-07-25T00:00:00.000Z'
pnpm worker:source:policy:cfpb
```

Registration creates or reuses a disabled `pending_review` policy row. It does
not activate the connector. Review the policy document, intended purpose,
commercial use, display representation, retention, attribution, quotas, and
deletion behavior before continuing.

Every production connector, including the active tenant-private
`manual-owner-import` path, must receive the durable PostgreSQL quota ledger at
runtime. The connector's in-memory quota bookkeeping is a test-only fallback;
it is bounded and must never be used as production cost or rate enforcement.

The Stack Exchange candidate uses the same operator boundary with its own
review CLI and version variable. Registering a draft does not make the API
permitted for AppSea's intended use; the current Network Acceptable Use Policy
requires an express prior written consent or commercial exception for the
automated similar/competitive or generative-AI collection purpose.

```powershell
$env:APPSEA_SOURCE_POLICY_ACTION = 'draft'
$env:APPSEA_STACKEXCHANGE_POLICY_VERSION = 'stackexchange-2026-08-v1'
$env:APPSEA_POLICY_DATABASE_URL = '<migration-role-url>'
$env:APPSEA_POLICY_RECORDED_AT = '2026-08-02T00:00:00.000Z'
pnpm worker:source:policy:stackexchange
```

Do not approve that candidate until legal has recorded the written consent or
commercial-exception reference. If that gate is cleared, set
`APPSEA_SOURCE_POLICY_ACTION=approve`, keep the same
`APPSEA_STACKEXCHANGE_POLICY_VERSION`, provide all reviewer/attestation
variables shown below plus
`APPSEA_POLICY_PERMISSION_EVIDENCE_REFERENCE` pointing to the durable consent
or commercial-exception record, and run
`pnpm worker:source:policy:stackexchange`. The database stores that reference
on the immutable review row and rejects activation when it is missing; free-form
notes do not satisfy this gate.
Approval remains an external legal/privacy/security decision; the engineering
draft is not an activation claim.

## Approve a reviewed version

Record the external decision reference and reviewer identity. The function
requires the same immutable policy content hash and activates exactly the
reviewed version; it cannot activate a retired or operator-blocked source.

The reviewer role must be one of the roles declared by the immutable policy
payload, and every declared role must approve the same policy hash. CFPB and
Stack Exchange drafts require all three independent roles: `legal`, `privacy`,
and `security`. Migrations `0114` and `0115` reject an
`independent_operator` approval for either draft and keep the source disabled
until all three approvals exist. Run the approval command once per reviewer
role with a distinct review ID and canonical identity. The legacy owner-import
policies intentionally omit the field and retain their
`independent_operator` approval boundary. Migration `0116` also rejects one
reviewer identity approving multiple roles for the same immutable policy hash
and fails closed for pre-existing duplicate-identity activations. A reviewer
cannot substitute a different role through the CLI or by writing directly to
the review table.

Before recording the next approval, operators can inspect the scalar progress
projection. It is migration/maintenance-role-only and returns required,
approved, and missing roles plus permission-evidence and collectibility flags;
it never returns reviewer identities, notes, or approval references.

```powershell
$env:APPSEA_POLICY_DATABASE_URL = '<migration-or-maintenance-role-url>'
$env:APPSEA_POLICY_SOURCE_ID = 'cfpb-consumer-complaints'
$env:APPSEA_POLICY_VERSION = 'cfpb-2026-07-v1'
pnpm worker:source:policy:status
```

Migration `0117` keeps this read separate from `approve_source_policy`; forward
migration `0118` also prevents direct activation, stale lease/reconciliation
replay, and production-lineage writes when the review set is incomplete.
Progress inspection cannot activate a source. The `complete` flag requires
every declared role, same-hash independent evidence, distinct identities, and
required permission evidence; `collectible` additionally requires the active,
current, approved, unexpired non-fixture source state.

The authenticated source registry uses a separate service-role-only projection
from migration `0123`. It exposes only bounded role names, permission-evidence
presence, and completion, so private members can see missing review gaps without
seeing reviewer identities, notes, approval references, hashes, or policy
payloads. An unregistered source is shown as unavailable rather than causing a
registry read failure; review and activation remain operator-only actions.

```powershell
$env:APPSEA_SOURCE_POLICY_ACTION = 'approve'
$env:APPSEA_CFPB_POLICY_VERSION = 'cfpb-2026-07-v1'
$env:APPSEA_POLICY_DATABASE_URL = '<migration-role-url>'
$env:APPSEA_POLICY_REVIEW_ID = 'review:cfpb:2026-07'
$env:APPSEA_POLICY_REVIEWER = 'Privacy review queue'
$env:APPSEA_POLICY_REVIEWER_IDENTITY = 'privacy-reviewer@example.invalid'
$env:APPSEA_POLICY_REVIEWER_ROLE = 'privacy'
$env:APPSEA_POLICY_INDEPENDENCE_ATTESTED = 'true'
$env:APPSEA_POLICY_APPROVAL_REFERENCE = 'ticket-or-record-reference'
$env:APPSEA_POLICY_REVIEWED_AT = '2026-07-25T00:00:00.000Z'
$env:APPSEA_POLICY_EXPIRES_AT = '2026-10-25T00:00:00.000Z'
$env:APPSEA_POLICY_RECORDED_AT = '2026-07-25T00:00:00.000Z'
pnpm worker:source:policy:cfpb
```

Do not put credentials, complaint text, or provider responses in review notes.
The reviewer identity must be a lowercase stable identifier, the role must be
`legal`, `privacy`, `security`, or `independent_operator`, and the reviewer
must attest that they are independent of the policy owner. The database rejects
self-approval and retains pre-0054 approvals as audit history without treating
them as collectible. If terms, API behavior, or deletion semantics change,
register a new version and leave the old version disabled or expired.
