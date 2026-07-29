# Coding-agent operating model

The main agent reads root guidance, active memory, docs, and relevant skills. It inspects the repository, chooses a complete vertical slice, implements it, validates it, and finishes with a guidance checkpoint.

Subagents are bounded helpers. They may explore, research, review, document, curate memory, maintain skills, or audit completion. The main agent owns integration and the final claim.

Long work should leave a resume packet under `memory/sessions/` with the exact current state, changed files, checks, next actions, and unresolved risks.
