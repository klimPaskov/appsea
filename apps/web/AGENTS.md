# Website instructions

Read the root `AGENTS.md`, `design/references/REFERENCE_BRIEF.md`, and `appsea-ui-reference-loop` before UI changes.

The leaderboard route shows the leaderboard only. Keep deep content on separate opportunity routes. Use semantic HTML, visible focus states, responsive layouts, and server components unless client state is necessary. Shared product data and contracts belong in workspace packages, not duplicated inside the app.

Private routes must read the HttpOnly session through `src/server/auth-session.ts` and authorize a workspace through the database repository; never set or trust a workspace ID from a request without membership validation. Keep the public fixture leaderboard database-free so it remains available without production credentials.
