# UI and UX design system

## Product character

The interface should feel calm, precise, and useful to a technical founder. Use a warm near-white background, deep ink text, a restrained blue accent, thin borders, generous spacing, and a clear type hierarchy.

Avoid gradients, glass effects, glowing elements, decorative charts, dense admin dashboards, and oversized marketing sections.

## Navigation

The first release uses a minimal header:

- AppSea wordmark
- Leaderboard link

Opportunity sections use plain text tabs for Overview, Complaints, Competitors, and Coding plan.

## Routes

```text
/
/opportunities/{slug}
/opportunities/{slug}/complaints
/opportunities/{slug}/competitors
/opportunities/{slug}/plan
/api/opportunities
```

Research operations, source management, skill management, and internal diagnostics can be added later as private routes. They should not clutter the public leaderboard.

## Leaderboard

The page contains only:

- minimal navigation
- `Leaderboard` heading
- rank
- opportunity name
- complaint count
- score
- a small synthetic-data disclosure when required

The desktop layout is a clean table. The narrow layout preserves the same four fields with tighter spacing.

## Opportunity pages

Each route has one job.

### Overview

Use a large opportunity title, one product sentence, the thesis, audience, first wedge, and a small fact row.

### Complaints

Use a simple vertical list of curated observations. Keep metadata quiet and the complaint readable.

### Competitors

Use a simple list of alternatives with type, positioning, and relevant weaknesses. Put contrary evidence in one restrained block.

### Coding plan

Show package filenames and the first implementation sequence. Detailed exports remain in the generated package.

## Typography and spacing

- Use a readable sans-serif interface family.
- Use a monospaced family only for filenames, identifiers, and code.
- Use strong negative letter spacing only on large display headings.
- Keep body text between 14 and 19 pixels in the reference layouts.
- Prefer whitespace and thin rules over cards and shadows.
- Use one content column or two balanced columns. Avoid side rails.

## Accessibility

- semantic landmarks and headings
- visible keyboard focus
- sufficient contrast
- accessible table headers or equivalent roles
- no hover-only information
- reduced-motion support
- responsive text and spacing
- full keyboard access for links and tabs

## Reference loop

1. Define the one purpose of the screen.
2. Remove content owned by another route.
3. Update the deterministic reference in `scripts/render_references.py`.
4. Render desktop and mobile references.
5. Implement the website using real fixture data.
6. Capture the actual browser page.
7. Compare hierarchy, field count, spacing, alignment, wrapping, focus, and overflow.
8. Iterate until the implementation serves the same focused purpose.

Reference images live under `design/references/`. They are design targets. Actual screenshots are review evidence and should be stored separately.
