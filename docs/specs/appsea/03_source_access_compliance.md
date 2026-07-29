# Source access and compliance

## Purpose

Source access is a product capability and a product constraint. AppSea must treat platform permission, commercial purpose, retention, deletion, rate limits, geographic restrictions, and data licensing as first-class data.

This file is an engineering policy, not legal advice.

## Source tiers

### Tier A: General commercial API or open protocol

Potential examples include paid X API access, YouTube Data API, Bluesky, GitHub, Stack Exchange, and permitted Mastodon endpoints.

A Tier A connector still needs terms review, quotas, attribution rules, deletion behavior, and credential controls.

### Tier B: Reviewed or restricted platform access

Examples include Meta Page public content access and platform programs that require app review.

The connector remains disabled until approval is documented.

### Tier C: Research-only access

Examples include broad Meta Content Library research access and TikTok Research Tools.

A commercial AppSea tenant must not use a research-only credential outside its approved purpose.

### Tier D: Commercial license or written approval required

Reddit public-content use for a commercial product belongs here unless written approval or a data-license agreement covers the use.

### Tier E: Owner-authorized data

Examples include a customer’s own App Store Connect reviews, Google Play Developer reviews, support tickets, surveys, community exports, and CRM records.

The product must verify that the tenant has authority to connect the account or upload the data.

### Tier F: Licensed data provider

A third-party provider may supply app reviews, social listening data, market data, or archived content under contract.

The provider contract must be represented in the source registry, including downstream-display and model-use rights.

### Tier G: Link and search evidence

A permitted search provider can return public links and snippets. AppSea may use the result as a discovery pointer under the provider’s terms.

The system should prefer storing derived facts, short necessary excerpts, and the source pointer over copying full pages.

### Tier H: User-submitted URL

A user can provide a public URL for analysis. The fetcher still applies robots, authentication, paywall, content, copyright, privacy, and SSRF controls.

## Current access implications

### Meta and Facebook

Page public content can require a specific Meta feature and app review. Broad Meta Content Library access is aimed at eligible research organizations and public-interest research.

The MVP should not promise general Facebook user complaint search.

Permitted starting paths include:

- approved public Page data
- content supplied by a user with authority
- licensed social-listening data
- public web links that a permitted search provider exposes

### TikTok

TikTok Research Tools are limited to approved research uses and state that commercial users are not eligible for that research access.

The MVP should keep general TikTok complaint collection disabled unless a separate approved commercial or partner path covers it.

### Reddit

Reddit states that commercial use of its data needs explicit written approval. A commercial complaint-mining product should not assume ordinary free API access is sufficient.

Use one of these paths:

- written commercial approval
- data licensing
- a permitted partner feed
- user-submitted links with limited link-based evidence handling
- authorized data provided by the user

### X

The X API provides recent-post search and uses paid usage. AppSea must require a configured budget, store endpoint and pricing-policy metadata, and stop at the tenant’s limit.

### YouTube

The YouTube Data API exposes comment threads and uses quota units. The connector must track daily quota and handle disabled comments.

### Bluesky

Bluesky and AT Protocol provide public stream primitives that can support monitoring. The connector must still respect protocol changes, moderation labels, deletion events, and storage policy.

### Mastodon

Mastodon access is federated. Search availability differs by server and can depend on authentication and server configuration.

The connector should treat each instance as a separate source authority and avoid implying complete network coverage.

### App stores

Official Apple and Google review APIs are designed around a developer’s own apps and authorized accounts.

Competitor review collection should use a licensed app-intelligence provider or another approved path. It should not assume the owner APIs expose competitor reviews.

## Source policy record

Every connector needs this record:

```yaml
source_id: youtube_comments
policy_version: 1
status: active
owner: data-platform
allowed_purposes:
  - commercial_opportunity_research
access_mode: official_api
credential_scope: tenant_or_platform
regions:
  - global_subject_to_api
content_storage:
  raw_allowed: true
  raw_retention_days: 30
  excerpt_allowed: true
  derived_features_allowed: true
  embedding_allowed: reviewed
  cross_tenant_training_allowed: false
deletion:
  supported: true
  polling_or_event: polling
  maximum_completion_hours: 72
attribution:
  source_link_required: true
quotas:
  tracked: true
  hard_stop: true
review:
  legal_review_date: YYYY-MM-DD
  next_review_date: YYYY-MM-DD
  reviewer: name_or_team
```

The exact values depend on the source and contract.

## Connector activation gate

A connector cannot become active until all items pass:

- source terms reviewed
- commercial purpose confirmed
- allowed fields listed
- credential owner defined
- quota logic tested
- retention defined
- deletion or expiry handling defined
- attribution defined
- user-facing coverage statement written
- privacy assessment complete
- security threat model complete
- fixtures and replay tests pass
- kill switch tested
- owner and review date assigned

## Retention model

Use the least-retentive source rule when evidence combines several sources.

Possible storage modes:

- source identifier and link only
- derived labels only
- short excerpt with link
- normalized content with expiry
- full raw content in restricted vault
- tenant-private content with contract retention

Deletion must cascade to:

- raw evidence
- normalized text when required
- embeddings when required
- cached excerpts
- report quotations
- generated screenshots when any exist
- search indexes
- downstream exports when the product controls them

A tombstone may retain the source identifier, deletion time, and reason when permitted, so the item is not re-collected.

## Copyright and presentation

AppSea should not republish large bodies of source content.

The UI and reports should use:

- short necessary excerpts when permitted
- paraphrased findings
- source links
- counts and derived statistics
- source and date labels

Do not create a substitute archive for the source platform.

## Private and sensitive data

Private messages, closed groups, support tickets, calls, surveys, and CRM data require explicit tenant authorization and a data-processing agreement where applicable.

Sensitive data handling includes:

- purpose limitation
- tenant isolation
- strict retention
- redaction
- access logging
- model-vendor controls
- deletion tools
- no cross-tenant learning by default

## Coverage language

Use precise labels such as:

- 4 of 7 configured sources active
- Reddit commercial access pending
- TikTok general comments unavailable under current access
- Meta coverage limited to approved public Pages
- competitor app reviews supplied by licensed provider
- Mastodon coverage includes 12 configured instances

Do not use “all social media” or “complete internet coverage.”

## Policy-change response

When a platform changes terms, endpoints, quotas, or deletion duties:

1. pause affected workflows if risk is material
2. record the policy event
3. identify affected evidence and reports
4. update connector policy
5. run regression and deletion tests
6. obtain required approval
7. reactivate by version
8. display any historical coverage break
