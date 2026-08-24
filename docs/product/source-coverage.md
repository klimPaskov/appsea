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
- reviewed freshness expectation (scheduled or on-demand)

A blocked source remains visible as a gap. Missing data must never be described as proof that complaints do not exist.

Private members can inspect the read-only source registry at
`/workspace/:workspaceId/sources` or
`GET /api/workspaces/:workspaceId/sources`. The registry exposes source and
policy identifiers, lifecycle/readiness, permitted purposes, access method,
quota, retention/deletion duties, expiry, coverage notes, and a bounded health
projection. Health shows fixed state (`healthy`, `degraded`, `blocked`, or
`unknown`), last attempt/success timestamps, active-record and open-deletion
counts, the last fixed failure code, and a safe explanatory note. It is derived
from workspace-local collection workflow, retained source-item, and tombstone
projections; it does not expose raw error text or source payloads.
`collectible` remains derived from the active current policy plus an independent
approval review; it never trusts a draft payload flag. Policy payloads, content
hashes, reviewer identities, and activation controls remain outside the read
model. Fixture sources are labeled synthetic and are never collectible
production sources. The route is private, membership-authorized, no-store, and
read-only; health cannot start or retry collection.

Migration `0123` adds a service-role-only approval summary to this projection.
Private members can see whether the summary is available, the bounded required,
approved, and missing reviewer roles, permission-evidence requirement/presence,
and review completion. Missing roles and permission evidence are rendered as
coverage gaps; reviewer identities, notes, approval references, hashes, and
policy payloads never cross the authenticated boundary. A source without a
current policy remains visible as an unavailable approval summary rather than
failing the registry read.

The private health projection also reports freshness separately from connector
health. A reviewed `scheduled` policy produces `fresh` or `stale` from the
latest retained source observation and its expected interval plus allowed
delay. A reviewed `on_demand` policy is labeled `on_demand`, while legacy or
unconfigured policies remain `unknown`; a blocked policy is never presented as
fresh. The age, threshold, and fixed note are bounded read metadata, not a
claim that missing observations imply missing complaints. Freshness metadata is
an additive optional field in the validated policy JSONB payload, so legacy
immutable policy hashes remain readable without a SQL backfill; changing a
reviewed policy still requires a new policy version and approval.

The same private health projection reports current quota headroom when the
approved policy and shared source window are available. It shows only the
bounded requests-per-minute limit, requests used, requests remaining, and the
current minute boundary. Source quota windows are intentionally shared across
workspaces, so this is an operational capacity indicator rather than a
workspace usage ledger; reservation IDs, other workspace rows, and settlement
controls never cross the read boundary. Pending, expired, or non-collectible
policies remain blocked or unknown, and the projection cannot reserve, settle,
release, refund, or retry a request.

The `manual-owner-import-v3` policy is the reviewed internal owner-authorized
exception. It accepts a bounded CSV/JSON export only after an owner attestation,
stores normalized PII-scrubbed rows in the private workspace, and never fetches
imported URLs. Its `competitor-research` and `contrary-evidence` purposes feed
only private, separately reviewed observations. Its evidence is tenant-private
and must not be described as public market coverage; deletion clears staged
payloads and emits tombstones. Optional source author keys become only
workspace-scoped opaque fingerprints, and report author coverage is marked
available/partial/unavailable rather than inferred from complaint volume. The
`v1` and `v2` snapshots remain immutable for history.

Approved-source collection checkpoints expose the recorded source policy,
observation counts, coverage gaps, and policy-allowed evidence only inside the
authenticated workspace route. The public leaderboard remains fixture-only
until the non-synthetic research/report pipeline is durably persisted, reviewed,
and approved. A test-only offline composition sample exists for contract and
package validation, but it cannot establish market coverage or activate a
source.

Each retained complaint now also exposes a versioned derived-analysis snapshot:
classification type, severity, recurrence and switching signals, entity
confidence, and unresolved competitor/substitute dimensions. A bounded
source-context extractor can resolve a substitute or competitor name only when
the complaint explicitly labels it (for example, a quoted alternative or
delimiter-bound `competitor:` value); ordinary prose and safety-flagged text
remain unresolved. These values are inference with explicit confidence and
review state; they do not replace provenance or make a complaint-level mention
source-backed competitive coverage.

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
draft policy records `unknown` commercial use with a 14-day retention window:
the current Network Acceptable Use Policy separately restricts automated
collection for similar/competitive products or generative-AI work unless
express prior written consent or a commercial exception is documented.
Independent legal/privacy/security review, that permission record, and
source-registry approval are still required.
