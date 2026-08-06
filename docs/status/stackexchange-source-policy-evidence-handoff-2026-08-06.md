# Stack Exchange source-policy evidence handoff - 2026-08-06

Status: engineering evidence packet prepared; no policy approval or source
activation is claimed. The connector remains disabled and unregistered.

## Purpose

This packet gives an independent legal, privacy, and security reviewer a
reproducible view of the bounded Stack Exchange connector contract and the
first-party materials checked on 2026-08-06. It is not legal advice, a
commercial-use opinion, or a database approval record. The activation boundary
remains the reviewed `appsea.approve_source_policy` function.

Generate the same secret-free JSON handoff locally with:

```powershell
$env:APPSEA_STACKEXCHANGE_POLICY_VERSION = 'stackexchange-2026-08-v1'
pnpm worker:source:policy:stackexchange:manifest
```

The manifest includes the immutable engineering policy content hash, bounded
quotas, retention/deletion rules, coverage gaps, first-party references, and
the required independent-review fields. It never contacts Stack Exchange,
changes the source registry, or includes complaint content, API keys, or other
credentials.

## First-party evidence reviewed

- [Stack Exchange API advanced search](https://api.stackexchange.com/docs/advanced-search): the bounded official API route used by the connector.
- [Stack Exchange API Terms of Use](https://engineering.stackexchange.com/legal/api-terms-of-use): attribution duties and the requirement to request attribution exceptions in advance.
- [Stack Exchange Network Acceptable Use Policy](https://stackoverflow.com/legal/acceptable-use-policy): restrictions on automated collection for similar/competitive products and generative-AI work, with written consent or a commercial-license exception as the stated exemption.
- [Public Network Terms](https://stackoverflow.com/legal/terms-of-service/public): API-term routing and restrictions on copying other Network content.
- [Stack Overflow licensing](https://stackoverflow.com/help/licensing): time-dependent CC BY-SA terms for public user contributions.

These references support the engineering decision to keep the connector
blocked. They do not grant AppSea permission to collect, resolve the intended
commercial use, or replace independent legal/privacy/security review.

## Review checklist

An independent reviewer must record a new immutable review for the exact
content hash and policy version. The review must include:

- a canonical lowercase reviewer identity;
- an independent `legal`, `privacy`, or `security` role (or a separately
  approved independent-operator role where the database permits it);
- an explicit independence attestation;
- a durable approval reference and review/expiry timestamps;
- a non-empty `permission_evidence_reference` pointing to express prior
  written consent or an applicable commercial exception for this automated
  collection purpose;
- confirmation of attribution, CC BY-SA treatment, bounded excerpts,
  14-day retention, deletion handling, API-key handling, and outbound-origin
  pinning;
- confirmation that filtered Stack Overflow search is not a census and that
  missing/deleted questions remain visible coverage gaps.

Until every item passes, the production worker and scheduled refresh paths
must fail closed before any Stack Exchange request. The public leaderboard
remains fixture-disclosed and synthetic.

## Open decisions and gaps

- The AUP's written-consent/commercial-exception requirement is unresolved;
  attribution and CC BY-SA terms alone are not permission to activate the
  connector.
- The API has no deletion webhook or tombstone feed in the reviewed route;
  filtered search cannot prove deletion absence.
- Coverage is limited to bounded Stack Overflow question searches and cannot
  establish total developer experience, competitor demand, or market size.
- Provider quotas, API-key rotation, production PostgreSQL/Temporal,
  retention/object purge, incident response, and deployment identity remain
  external release gates.
