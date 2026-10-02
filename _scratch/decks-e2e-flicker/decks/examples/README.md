# The examples

Nine worked boards this app copies into every deck's `examples/` on restart. They are
reference material, not templates: a new board is always blank, and an agent that wants to
know what a finished board can be reads one of these and borrows its structure, its
interactions and its axis choices.

Each one is a standalone HTML board that renders against the deck's own `lib/` (the
`../lib/` links work because this directory sits beside `lib/` inside the deck). Open one
in a browser, or embed it in a board with `data-embed`.

## Coding

- `architecture-map.html` — a d3 force graph of services and dependencies. Click a node to
  focus its reach; drag to rearrange; hover for who it is.
- `build-dashboard.html` — a release dashboard with chart.js and gsap. The four numbers
  count up on load; the line chart separates wall time from queue wait.
- `incident-timeline.html` — a postmortem as a replayable timeline (gsap). Impact table,
  the alert gap, a one-line fix shown as a hand-coloured diff.

## Research

- `ab-reading.html` — an A/B result read properly: d3 bars with confidence intervals,
  sample sizes, and a verdict callout that prices the lower bound.
- `sample-space.html` — a 3D embedding of 240 respondents (three with OrbitControls). Hover
  for the respondent, drag to turn the space, and the third axis is flagged as a confound.
- `experiment-grid.html` — a design matrix as a d3 heatmap, with a sortable table beneath
  that cannot disagree with it, and a condition level diagnosis.

## Business

- `cohort-retention.html` — cohort retention as a d3 heatmap with KPIs that match the grid.
  Hover for the exact share; click a cohort to hold its row against the rest.
- `decision-priced.html` — a supplier decision weighted by sliders; d3 bars rescore as the
  weights move, and the recommendation callout restates the winner.
- `market-map.html` — a category bubble map: price against quality, sized by revenue share,
  with named quadrants, a pin-on-click, and a legend that reads like an axis.

## The rules they share

- Every plot has a title of its own, an axis for each direction, a tick value on each, and
  an axis title naming the unit, so a reader has a shape and a claim.
- Interaction is the point: hover for the detail, click to focus, drag to rearrange. A
  board is explored, not read.
- The copy is plain and has no em dashes, and the numbers within one board agree with each
  other (the KPI row is computed from the same data the chart draws).
- Libraries come from the import map in each file's head and are imported where they draw,
  so a board that never reaches a chart never downloads one.