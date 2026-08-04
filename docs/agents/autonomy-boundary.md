# Autonomy boundary

Continuous operation means monitored jobs, durable workflows, bounded retries, scheduled research, health checks, skill proposals, sandbox evaluation, and clear handoffs.

It does not mean unrestricted self-modification.

The system can propose a skill, test it against fixtures, record evaluation results, and prepare an activation request. A reviewed approval is required before production activation. The same rule applies to new connectors, dependencies, migrations, permissions, retention changes, and deployments.

The dormant `packages/skill-registry` implementation records the proposer,
independent evaluation chain, approver, and signed permission-bound evidence.
Persisted records must be hydrated through that registry before activation;
the worker does not import it and no runtime permission is granted by this
boundary alone. Migration `0099` adds an operator-only immutable persistence
and audit adapter with expected-hash concurrency; it does not change the
requirement for explicit operator activation. See ADR 0020 and ADR 0025 for
the review-integrity and persistence contracts.
