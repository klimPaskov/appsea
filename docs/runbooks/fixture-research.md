# Fixture research runbook

Run:

```bash
pnpm worker:fixture
```

Expected output:

```text
artifacts/research/seed-research-artifact.json
```

The artifact must validate through shared contracts, identify fixture mode, include a source policy, preserve synthetic complaint provenance, contain one versioned complaint-analysis snapshot per complaint, contain complaint clusters, and include a versioned deterministic score. Analysis may resolve a substitute or competitor only when fixture text explicitly labels a bounded source-context name; these references remain synthetic complaint-level mentions, and the artifact must keep any missing dimensions unresolved. Fixture content must never become market evidence or source-backed competitive coverage.

Generate a coding-agent package with:

```bash
pnpm plan:sample
```

Expected folder:

```text
artifacts/plans/inbox-relay/
```
