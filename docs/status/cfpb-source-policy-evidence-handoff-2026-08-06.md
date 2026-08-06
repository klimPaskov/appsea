# CFPB source-policy evidence handoff - 2026-08-06

Status: engineering evidence packet prepared; no policy approval or source
activation is claimed. The connector remains disabled with `pending_review`.

## Purpose

This packet gives an independent legal, privacy, and security reviewer a
reproducible view of the CFPB connector contract and the first-party materials
checked on 2026-08-06. It is not legal advice, a commercial-use opinion, or a
database approval record. The activation boundary remains the reviewed
`appsea.approve_source_policy` function; the policy owner cannot approve its
own policy.

Generate the same secret-free JSON handoff locally with:

```powershell
$env:APPSEA_CFPB_POLICY_VERSION = 'cfpb-2026-07-v1'
pnpm worker:source:policy:cfpb:manifest
```

The manifest includes the immutable engineering policy content hash, bounded
quotas, retention/deletion rules, coverage gaps, first-party references, and
the required independent-review fields. It never contacts CFPB, changes the
source registry, or includes complaint content or credentials.

## First-party evidence reviewed

- [CFPB Open Tech Consumer Complaint Database API docs](https://cfpb.github.io/api/ccdb/api.html): describes the public API and its intended developer use.
- [CFPB OpenAPI documentation](https://cfpb.github.io/ccdb5-api/documentation/): exposes search and complaint-by-ID routes and displays the API license notice.
- [CFPB Consumer Complaint Program](https://www.consumerfinance.gov/compliance/consumer-complaint-program/): describes publication timing and the opt-in, scrubbed treatment of public narratives.
- [Narrative Scrubbing Standard](https://files.consumerfinance.gov/f/documents/201503_cfpb_Narrative-Scrubbing-Standard.pdf): describes screening, removal of personal information, withdrawal handling, and the limits of recalling already downloaded copies.
- [Publication of Consumer Response Complaint Narratives privacy impact assessment](https://files.consumerfinance.gov/f/documents/06022023_Publication-of-Consumer-Response-Complaint-Narratives.pdf): describes opt-in publication, de-identification, public downloadability, and residual re-identification risk.

These references support the engineering assumptions that public narratives
must be treated as consented and scrubbed excerpts, that withdrawal can create
deletion obligations, and that missing or withheld narratives are coverage
gaps. They do not by themselves establish that AppSea's intended commercial
deployment is approved.

## Review checklist

An independent reviewer must record a new immutable review for the exact
content hash and policy version. The review must include:

- a canonical lowercase reviewer identity;
- an independent `legal`, `privacy`, or `security` role (or a separately
  approved independent-operator role where the database permits it);
- an explicit independence attestation;
- a durable approval reference and review/expiry timestamps;
- confirmation of intended commercial use, display as bounded excerpts,
  30-day retention, attribution, deletion propagation, and CFPB change
  monitoring;
- confirmation that source-backed opportunity or competitor claims will keep
  CFPB's non-statistical coverage limits visible.

Until that review exists, the worker must fail closed before any external
request. The public leaderboard remains fixture-disclosed and synthetic.

## Open decisions and gaps

- The engineering policy records `commercialUse: allowed` as a provisional
  reading of first-party public-data materials; counsel must confirm the
  intended product and jurisdiction before activation.
- The API has no deletion webhook or tombstone feed in the reviewed route.
  Filtered pages cannot prove absence; only the separate bounded,
  identifier-only full-snapshot reconciliation can enqueue deletion tombstones.
- CFPB data is not a statistical sample of consumer experience. Missing,
  withheld, delayed, malformed, or non-narrative records remain visible
  coverage gaps and cannot be converted into absence claims.
- Provider scheduling, quota monitoring, production PostgreSQL/Temporal,
  object/backup purge, incident response, and deployment identity remain
  external release gates.
