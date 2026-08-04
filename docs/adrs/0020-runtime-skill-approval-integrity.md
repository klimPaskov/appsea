# ADR 0020: Runtime skill approval integrity

## Status

Accepted for the future runtime skill boundary. No autonomous production
runtime is activated by this decision.

## Decision

Runtime skills move through registry-owned transitions:

`proposed -> evaluated -> approved -> active`

The registry records a canonical proposer, distinct evaluator identities, and
an independent approver. Evaluation and approval records carry HMAC evidence
over the immutable skill identity, requested permissions, and the preceding
review chain. Persisted records must be hydrated through the registry before
activation; plain or tampered objects fail closed. Permission changes require
a new proposal and new review chain.

The registry signing secret is an operator-owned secret. It is not stored in a
skill record, workflow history, imported content, or generated report.

## Rationale

The earlier record shape trusted `status`, `approvedBy`, and `evaluationIds`
from the caller. That allowed a forged object to appear approved and request
privileged permissions such as source activation, migrations, credentials, or
retention changes. In-process branding prevents accidental construction, while
the persisted HMAC evidence prevents a modified approved record from being
hydrated and activated under the wrong registry secret.

## Consequences

- Runtime agents still cannot autonomously approve or activate skills.
- An approval service must provide the signing secret and retain review
  identity/audit records outside the skill payload.
- A future database adapter must persist the immutable evidence fields and
  rehydrate through `SkillRegistry.hydrate`.
- This does not grant any production permission or activate a source; those
  remain separately reviewed deployment and policy operations.
