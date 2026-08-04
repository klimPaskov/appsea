# Runtime skill registry instructions

This package governs future AppSea runtime skills. It does not manage Codex project skills under `.agents/skills`.

Generated skills begin as proposals. Evaluation evidence, permission review, and explicit approval are required before activation. A skill cannot approve itself or increase its own permissions.

Persistence is a separate reviewed boundary: records must be hydrated with the
registry before storage, transition events are immutable, and only an explicit
operator path may persist or activate privileged skills. The worker must not
import this package until a later reviewed activation contract exists.
