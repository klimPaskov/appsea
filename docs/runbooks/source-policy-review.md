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

## Approve a reviewed version

Record the external decision reference and reviewer identity. The function
requires the same immutable policy content hash and activates exactly the
reviewed version; it cannot activate a retired or operator-blocked source.

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
