# UI reference loop

1. Read `design/references/REFERENCE_BRIEF.md`.
2. Update the deterministic reference source in `scripts/render_references.py`.
3. Run `pnpm ui:references`.
4. Implement the same information hierarchy in the website.
5. Capture the actual website with the browser available in the development environment.
6. Compare spacing, type scale, borders, field count, responsive behavior, and accessibility.
7. Iterate until the implemented page serves the same single purpose as the reference.

The reference is a target, not evidence that the implementation matches. Actual browser captures belong in review artifacts, not in the source reference folder.
