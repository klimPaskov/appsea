# UI reference loop

1. Read `design/references/REFERENCE_BRIEF.md`.
2. Update the deterministic reference source in `scripts/render_references.py`.
3. Run `pnpm ui:references`.
4. Implement the same information hierarchy in the website.
5. Capture the actual website with the browser available in the development environment.
6. Compare spacing, type scale, borders, field count, responsive behavior, and accessibility.
7. Iterate until the implemented page serves the same single purpose as the reference.

The reference is a target, not evidence that the implementation matches. Actual browser captures belong in review artifacts, not in the source reference folder.

## Local capture command

The public reference route is `/leaderboard`; `/` remains a backwards-compatible
alias and renders the same shared leaderboard view. After building the web app,
run the repository-local headless capture command:

```bash
pnpm --filter @appsea/web build
pnpm ui:capture
```

The command starts a loopback Next.js server on `127.0.0.1:4313`, captures the
public leaderboard and opportunity routes at 1280, 1024, 768, and 480 pixels,
and writes disposable PNGs under `.appsea/ui-reference-loop/`. Set
`APPSEA_CHROME_PATH` when Chrome is not installed in the standard location; use
`pnpm ui:capture -- --persist` to write review artifacts under
`artifacts/ui-reference-loop/<date>/`.

The 480-pixel captures intentionally use the responsive layout. Desktop
captures never use the mobile layout. The public command remains database-free.
For authenticated workspace evidence, start the disposable local stack and
run:

```bash
pnpm dev:local
pnpm ui:capture:private
```

The private command creates a random local owner in PostgreSQL, injects only
that short-lived session into an isolated headless Chrome profile, and captures
the nine private workspace/account routes at the same four viewport sizes. It
never uses the user's browser, writes session identifiers or cookies to the
manifest, or treats owner-import content as public market research. The Next
development indicator is disabled for the capture window so review PNGs contain
only the AppSea surface. Each capture also runs a scalar-only browser audit that
fails on an explicit Next/runtime error page, missing title or `<main>` content,
or horizontal overflow; it records only the viewport and pass/fail metrics. Run it
only against the disposable local stack, never against production. The
checked-in evidence lives under
`artifacts/ui-reference-loop/<date>/`; `pnpm verify:local-stack` remains the
authenticated HTTP and workflow proof.
