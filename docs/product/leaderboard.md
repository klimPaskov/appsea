# Leaderboard contract

The leaderboard has one job: show the ranked opportunity list.

Visible fields:

- rank
- opportunity name
- complaint count
- opportunity score

The opportunity name links to its detail route. The page may show a small disclosure when data is synthetic.

The page must not contain dashboard metrics, charts, research status cards, source summaries, selected-row previews, competitor panels, activity feeds, or product marketing sections.

Sorting is descending by the latest accepted score snapshot. Ties use complaint count, then stable slug order. The scoring version remains available through the API and opportunity detail, but it does not need to clutter the leaderboard.
