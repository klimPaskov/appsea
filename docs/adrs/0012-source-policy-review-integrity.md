# ADR 0012: Bind source-policy activation to independent review identity

- Status: accepted
- Date: 2026-08-01
- Scope: migration `0054_source_policy_review_integrity.sql`, source-policy
  repository, and operator approval command

## Context

Migration `0027` made source activation operator-only and preserved immutable
review records, but its `reviewer` field was an unchecked display string. The
database could not distinguish a canonical reviewer identity from arbitrary
text or prove that the reviewer was independent of the policy owner.

## Decision

New approved source-policy reviews must carry a lowercase stable reviewer
identity, one of the allowed legal/privacy/security/independent-operator roles,
and an explicit independence attestation. A database trigger rejects
unattested approvals and exact policy-owner self-approval. The approval function
accepts the same fields and remains executable only by `appsea_migrator`.

Historical approvals are retained as immutable audit evidence but are returned
to `pending_review` and their non-fixture source is disabled unless an
integrity-attested review exists. Runtime collection and policy reads require
an attested approved review. This is a security boundary, not legal approval;
the CFPB connector remains disabled.

## Consequences

- Approval provenance is replayable without treating free-form reviewer text as
  authorization.
- Existing approved policies require an explicit re-review after migration
  `0054`; this is a conservative compatibility change.
- Provider, legal, privacy, security, deployment, and alerting review remain
  external prerequisites for enabling a source.
- External source requests and provider effects remain outside PostgreSQL
  atomicity and still require their own idempotency and recovery controls.
