---
name: appsea-source-connector
description: Use when creating, reviewing, enabling, or modifying an AppSea complaint source connector.
---

# AppSea source connector

Source connectors live in `packages/connectors` or a future dedicated integration package.

## Required policy

Before implementation, document:

- permitted purpose
- access method
- commercial-use status
- authentication and credential boundary
- quota and cost budget
- retention period
- deletion and user-rights duties
- attribution requirements
- allowed display mode
- known coverage gaps
- policy review date and owner

## Procedure

1. Verify the source terms and official API documentation.
2. Create or update a validated `SourcePolicy`.
3. Keep the connector disabled until policy review is complete.
4. Map raw records into the shared complaint contract.
5. Preserve stable source identifiers and timestamps when permitted.
6. Add pagination, rate limiting, idempotency, retry limits, and deletion identifiers.
7. Redact or minimize personal data.
8. Add fixtures that never contain real private content.
9. Test disabled, quota, malformed, deletion, and partial-failure paths.

Never scrape around an access restriction. Never claim coverage beyond the implemented collection route.

## Completion

The connector fails closed, preserves provenance, obeys policy, has deterministic fixtures, and exposes its coverage limits.
