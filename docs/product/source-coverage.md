# Source coverage

AppSea does not promise universal social media coverage.

A source record tracks:

- source name and type
- access method
- permitted purpose
- commercial-use state
- credentials boundary
- quota and cost budget
- retention and deletion rules
- attribution and display rules
- known gaps
- connector health

A blocked source remains visible as a gap. Missing data must never be described as proof that complaints do not exist.

Private members can inspect the read-only source registry at
`/workspace/:workspaceId/sources` or
`GET /api/workspaces/:workspaceId/sources`. The registry exposes source and
policy identifiers, lifecycle/readiness, permitted purposes, access method,
quota, retention/deletion duties, expiry, and coverage notes. It derives
`collectible` from the active current policy plus an independent approval
review; it never trusts a draft payload flag. Policy payloads, content hashes,
reviewer identities, and activation controls remain outside the read model.
Fixture sources are labeled synthetic and are never collectible production
sources. The route is private, membership-authorized, no-store, and read-only.

The `manual-owner-import-v1` policy is the reviewed internal owner-authorized
exception. It accepts a bounded CSV/JSON export only after an owner attestation,
stores normalized PII-scrubbed rows in the private workspace, and never fetches
imported URLs. Its evidence is tenant-private and must not be described as
public market coverage; deletion clears staged payloads and emits tombstones.

Approved-source collection checkpoints expose the recorded source policy,
observation counts, coverage gaps, and policy-allowed evidence only inside the
authenticated workspace route. The public leaderboard remains fixture-only
until the non-synthetic research/report pipeline is durably persisted, reviewed,
and approved. A test-only offline composition sample exists for contract and
package validation, but it cannot establish market coverage or activate a
source.

Each retained complaint now also exposes a versioned derived-analysis snapshot:
classification type, severity, recurrence and switching signals, entity
confidence, and unresolved competitor/substitute dimensions. These values are
inference with explicit confidence and review state; they do not replace
provenance or turn missing source access into a market conclusion.

Competitive claims use a separate provenance boundary. A non-synthetic
competitor or contrary-signal observation must reference an active source item
and matching retained evidence collected under an approved `competitor-research`
purpose. Editors or owners confirm or reject the bounded paraphrase; only a
confirmed observation can contribute to source-backed competitive status. The
observation record retains identifiers, capture/observation times, display
representation, and review state, not a copied raw source payload. If no
approved source supplies that purpose, the private page keeps the gap visible.

The Stack Exchange connector is a disabled source candidate for those
purposes. It uses only the official Stack Exchange API, retains sanitized
bounded question excerpts with an HTTPS attribution locator, and emits no
deletion tombstones because filtered search cannot establish absence. Its
draft policy is `restricted` commercial use with a 14-day retention window;
independent legal/privacy/security review and source-registry approval are
still required.
