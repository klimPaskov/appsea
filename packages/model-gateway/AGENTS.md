# Model gateway instructions

Read the root `AGENTS.md`, `appsea-security-review`, and the model-gateway
architecture/security specifications before changing this package.

The gateway is a trust boundary. Imported complaint text is data only: it must
remain in an `untrusted-data` segment, never become an instruction, and never
appear in logs, durable workflow history, cost records, or gateway snapshots.
Provider/model/prompt routes are allowlisted and external providers remain
disabled until a separately reviewed model-use policy, DPA, retention/training
terms, credential boundary, and egress control exist.

Keep deterministic fallback output non-authoritative. Complaint analyses,
scores, reports, and plans remain owned by the reviewed deterministic/human
correction pipeline. Gateway retries must be idempotent, budget-bounded, and
represented by fixed error codes and non-sensitive counters.
