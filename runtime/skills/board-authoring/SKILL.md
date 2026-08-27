---
name: board-authoring
description: How to say something on a board — the three shapes that carry an answer, a design and a finished piece of work — plus the full catalogue of components (cards, stickies, callouts, KPIs, tables, connectors, markdown, maths, diagrams, embeds) and the layout rules that keep a board readable. Read before answering on a board or building one with anything beyond cards and text.
---

# Writing a board

A board is a fixed-size canvas of absolutely-positioned components. It does not
scroll, reflow, or adapt: you choose where everything goes, the way you would in a
design tool. That is the trade — you do the layout, and in exchange the user can
drag your boxes around and the result is a file you can both edit.

## The three shapes

Boards are how you talk here, so most boards you write are one of three things. Start each
with `stage.newBoard({ title, kind })` — that writes the document, and you write the
content.

### An answer

The question is the heading, so the board says what it is from across the canvas. The
answer comes first and fits one screen; the evidence sits beside it, not above it.

```html
<div class="text" data-id="question" style="left: 48px; top: 40px; width: 900px">
	<h1>Why does the second tab get logged out?</h1>
</div>

<section class="card" data-id="answer" style="left: 48px; top: 152px; width: 480px">
	<p>
		Both tabs refresh with the same token. The first spends it; the second arrives
		~240ms later holding something already used, and the family is flagged as replayed.
	</p>
</section>

<section class="panel" data-id="evidence" style="left: 560px; top: 152px; width: 420px" data-md>
	## Where this shows

	- `auth.ts:88` — refresh has no single-flight guard
	- 2,455 failures in the worst week, 517 users
</section>

<div class="callout" data-id="so-what" data-tone="warn" style="left: 48px; top: 420px; width: 932px">
	<strong>So the fix is not "retry".</strong> A retry spends another token; the loser has
	to wait for the winner's answer instead.
</div>
```

If a later question is about the same thing, **add a section to this board** rather than
starting a third one — newest at the top, and move the older sections down.

### A design

Options as columns of the same width and top, so they can be compared by eye. The
recommendation is said plainly, in a callout, not implied by ordering.

```html
<section class="card" data-id="option-lock" style="left: 48px; top: 168px; width: 380px">
	<h3>Server lock per family</h3>
	<p>First claim wins; losers wait for its answer.</p>
	<ul><li>Fixes two processes</li><li>One write, one RTT for losers</li></ul>
</section>

<section class="card" data-id="option-client" style="left: 476px; top: 168px; width: 380px">
	<h3>Client single-flight</h3>
	<p>One promise per tab group.</p>
	<ul><li>Free</li><li>Does not fix two tabs</li></ul>
</section>

<div class="callout" data-id="recommendation" style="left: 48px; top: 520px; width: 808px">
	<strong>Take the lock.</strong> The client guard is free but solves the case that was
	never broken.
</div>
```

### A report, when the work is done

Not a log — a presentation. Method briefly, the result with the number that matters, and
what is left. This is what the user reads instead of the chat, so it has to stand alone.

```html
<section class="panel" data-id="method" style="left: 48px; top: 168px; width: 420px">
	<h4>Method</h4>
	<ol>
		<li>Reproduced with two clients and one token</li>
		<li>Added a lock keyed by token family, 5s TTL</li>
		<li>Re-ran the repro 200 times</li>
	</ol>
</section>

<section class="card" data-id="result" style="left: 512px; top: 168px; width: 420px">
	<h4>Result</h4>
	<p>No replay flags. Losers wait a single round trip.</p>
</section>

<div class="kpi" data-id="headline" style="left: 984px; top: 168px; width: 220px">
	<span class="value">0</span>
	<span class="label">replays in 200 runs</span>
</div>

<div class="callout" data-id="left" data-tone="warn" style="left: 48px; top: 420px; width: 1160px">
	<strong>Left to do.</strong> The TTL is a guess; it wants a number from production.
</div>
```

Show what you have made when it is worth looking at:

```ts
await stage.show("boards/refresh-race.html");
```

## The document

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Auth refresh — the plan</title>
		<meta name="board" content='{"w":1600,"h":1000,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<!-- components -->
		<script src="../lib/board.js"></script>
	</body>
</html>
```

`<meta name="board">` takes `w`, `h`, `bg` (`"grid"`, `"dots"`, or omit for plain) and
`theme` (`"light"` / `"dark"` — omit it, and the board follows the app).
`<meta name="poster" content="assets/x.png">` is optional; see the board-debug skill.

## Layout rules

- **8px grid.** Positions and sizes in multiples of 8. Gutters of 24–48px between
  components, 48px margins at the board edge.
- **Columns, not scatter.** Pick two or three x positions and reuse them. A board
  where every box starts at a different x reads as noise.
- **Size to content, then check.** Height is usually best left to the content; set it
  only on embeds and panels that must be a certain size. If you set a height, verify
  with a screenshot that nothing is clipped.
- **A board is one idea.** Two ideas are two boards, side by side on the canvas.
- **`data-id` on everything.** Stable, meaningful names — `goal`, `risk-refresh` — not
  `box-3`.

## Components

Every one of these takes `style="left: …; top: …; width: …"` and a `data-id`.

### Text and structure

```html
<div class="text" data-id="heading" style="left: 48px; top: 40px; width: 720px">
	<h1>One refresh, two tabs</h1>
	<p style="color: var(--b-muted)">A subtitle, in the muted token.</p>
</div>

<section class="card" data-id="goal" style="left: 48px; top: 168px; width: 380px">
	<h3>Goal</h3>
	<p>Cards are the default container: a border, a shadow, and padding.</p>
</section>

<section class="panel" data-id="detail" style="left: 480px; top: 168px; width: 380px">
	<h3>Panel</h3>
	<p>Flatter than a card — a background, no shadow. Use for supporting detail.</p>
</section>

<div class="sticky" data-id="note" style="left: 900px; top: 168px; width: 220px">
	A sticky is for a remark, a doubt, or something the user should answer.
</div>

<span class="chip" data-id="status" style="left: 1360px; top: 52px">draft</span>
```

### Emphasis

```html
<div class="callout" data-id="decision" data-tone="warn" style="left: 48px; top: 452px; width: 852px">
	<strong>Open question.</strong> Tones: omit for accent, or "warn", "danger", "ok".
</div>

<div class="kpi" data-id="failed" style="left: 992px; top: 452px; width: 220px">
	<span class="value">2,455</span>
	<span class="label">failed refreshes · worst week</span>
</div>

<div class="table" data-id="costs" style="left: 720px; top: 140px; width: 620px">
	<table>
		<thead><tr><th>Fix</th><th>Cost</th></tr></thead>
		<tbody><tr><td>Server lock</td><td>1 write</td></tr></tbody>
	</table>
</div>
```

### Connectors

An `svg.link` draws an arrow between two components by id, routed automatically from
the nearest facing sides and redrawn whenever the layout moves.

```html
<svg class="link" data-id="goal-approach" data-from="goal" data-to="approach" data-label="how"></svg>
<svg class="link" data-id="a-b" data-from="a" data-to="b" data-tone="accent"></svg>
```

No `style` needed — a connector covers the whole board and takes no clicks.

### Markdown, maths, diagrams

```html
<div class="panel" data-id="sequence" style="left: 48px; top: 604px; width: 620px" data-md>
	## The sequence

	1. Both tabs see a 401.
	2. The lock admits one.

	Cost per refresh stays $O(1)$ — inline maths in `$…$`, display in `$$…$$`.
</div>

<div class="panel" data-id="flow" style="left: 48px; top: 140px; width: 620px; height: 420px" data-mermaid>
	flowchart TD
		A["tab A: 401"] --> L{"lock free?"}
		L -- yes --> R["refresh"]
</div>
```

Indent the content to match the surrounding HTML — the common indent is stripped
before parsing. A `[data-mermaid]` box needs a height; the diagram scales to fit it.

### Embeds — the user's real files

```html
<div class="embed" data-id="notes" data-embed="../docs/notes.md"
     style="left: 48px; top: 140px; width: 520px; height: 560px"></div>

<div class="embed" data-id="paper" data-embed="../papers/oauth.pdf" data-pages="1-2"
     style="left: 608px; top: 140px; width: 460px; height: 680px"></div>

<div class="embed" data-id="report" data-embed="../../shared/report.html"
     style="left: 1108px; top: 140px; width: 440px; height: 420px"></div>

<div class="embed" data-id="fig" data-embed="../assets/sketch.svg"
     style="left: 1108px; top: 600px; width: 440px; height: 260px"></div>
```

- Paths are relative **to the board**, as in an `<img src>`.
- `.md` renders as markdown, `.pdf` through pdf.js (`data-pages="3-5"` or `"1,4-6"`),
  `.html` in a sandboxed frame, images as images, anything else as a file card.
- Outside the deck, the file must sit under a root declared in `deck.json`.
- Embeds want an explicit `height`: they have no content of their own to size to.

## Tokens

Use the variables, never raw colours, so a board works in light and dark:

`--b-bg`, `--b-bg-deep`, `--b-bg-layer`, `--b-fg`, `--b-muted`, `--b-faint`,
`--b-border`, `--b-border-strong`, `--b-accent`, `--b-accent-soft`, `--b-sticky`,
`--b-ok`, `--b-warn`, `--b-danger`, `--b-radius`, `--b-unit` (8px), `--b-font`,
`--b-mono`.

```html
<p style="color: var(--b-muted)">Secondary text.</p>
```

## d3, when a chart is the point

`d3` is vendored beside the board. Load it only on a board that uses it:

```html
<div class="card" data-id="chart" style="left: 48px; top: 140px; width: 600px; height: 360px">
	<svg id="plot" width="568" height="300"></svg>
</div>
<script src="../lib/d3.min.js"></script>
<script>
	// Runs after board.js has laid the board out.
	document.addEventListener("board:ready", () => {
		const data = [1, 3, 2, 5, 4];
		d3.select("#plot").selectAll("rect").data(data).join("rect")
			.attr("x", (d, i) => i * 110).attr("y", (d) => 300 - d * 55)
			.attr("width", 90).attr("height", (d) => d * 55)
			.attr("fill", getComputedStyle(document.body).getPropertyValue("--b-accent"));
	});
</script>
```

Read the palette from the tokens rather than hard-coding hexes, and the chart follows
the theme like everything else.

## Checklist before you say a board is done

- Does every component have a meaningful `data-id`?
- Is the board big enough that nothing clips? (Screenshot it — board-debug skill.)
- Are positions on the 8px grid, with two or three x values reused rather than a new one
  per component?
- Are colours tokens, not hexes?
- Does it say one thing?
- **Could the user understand this without reading the chat?** That is the test that
  matters. If the board needs a sentence you only said in the column, the sentence belongs
  on the board.
