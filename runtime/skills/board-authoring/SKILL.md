---
name: board-authoring
description: How to say something on a board — the three shapes that carry an answer, a design and a finished piece of work — plus the components that come with the board (cards, stickies, callouts, KPIs, tables, markdown, maths, mermaid, embeds), how to draw a diagram with your own coordinates, how to invent a component the board does not have, and the layout rules that keep a board readable. Read before answering on a board or building one with anything beyond cards and text.
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
  `box-3`. The user can rename one from their inspector, and can turn a card into a
  panel or a callout the same way, so a name or a class you wrote may have changed since
  you wrote it. You are told when it does, in the same line that reports any other edit
  they made; if a component you expected is not there under the name you remember, read
  the board rather than writing it again.

## Components

Every one of these takes `style="left: …; top: …; width: …"` and a `data-id`.

This is what the board comes with, not the set of things a board may contain. When the
content wants a shape that is not here — a timeline, a diff, a scorecard, a legend — build
it, and read "Inventing a component" below for the one obligation that comes with it.

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

### Diagrams: you draw them, and you choose the coordinates

**There is no connector between two components.** There was one — an `svg.link` naming a
`data-from` and a `data-to`, routed at mount time — and it is gone. The reason is worth
having in mind while you draw, because it decides everything below: a line whose position
is computed when the page loads is a line the *file does not state*. You could not tell
from the source where it went, so you could not reason about your own board without
screenshotting it; and the user could not drag it, because there was nothing to drag.

So a diagram is a component that owns both its boxes and the arrows between them, with
every number in the file. Two ways to write one, and the first is the ordinary one.

**A box with an `<svg>` in it.** Put the drawing inside a normal component, not directly
in the `<body>`: a `<div>` or `<section>` is what the user drags and resizes, and a
top-level `<svg>` gets neither (an `SVGElement` has no `offsetLeft` for the editor to
measure). Give the `<svg>` a `viewBox` and `width="100%"` and the drawing scales with the
box it is in instead of breaking when the box changes.

```html
<style>
	/* Keyed on `.claim`, never on `.card .claim` — the user may make it a panel. */
	.claim .box { fill: var(--b-bg-deep); stroke: var(--b-border-strong); stroke-width: 1.5; }
	.claim .flow { fill: none; stroke: var(--b-border-strong); stroke-width: 1.5; }
	/* A marker's head is a path inside a `.flow`, and the rule above gave that
	   `fill: none` — a declaration beats the attribute, so the head needs its own rule. */
	.claim marker > path { fill: var(--b-border-strong); stroke: none; }
	.claim text { fill: var(--b-fg); font-family: var(--b-font); font-size: 12px; }
	.claim text.aside { fill: var(--b-muted); font-size: 11px; }
</style>

<section class="card claim" data-id="claim" style="left: 1140px; top: 604px; width: 412px; height: 232px">
	<h3>One claim, two tabs</h3>
	<svg viewBox="0 0 380 160" width="100%" height="160" role="img" aria-label="Both tabs ask; the lock admits one; the loser retries with its answer.">
		<defs>
			<marker id="claim-tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
				<path d="M 0 0 L 10 5 L 0 10 z" />
			</marker>
		</defs>

		<rect class="box" x="1" y="6" width="96" height="34" rx="6" />
		<text x="49" y="28" text-anchor="middle">tab A</text>
		<rect class="box" x="1" y="118" width="96" height="34" rx="6" />
		<text x="49" y="140" text-anchor="middle">tab B</text>
		<rect class="box" x="138" y="62" width="84" height="34" rx="6" />
		<text x="180" y="84" text-anchor="middle">the lock</text>

		<!-- Elbows, not curves: two segments you can read off the file. -->
		<path class="flow" d="M 97 23 H 118 V 79 H 134" marker-end="url(#claim-tip)" />
		<path class="flow" d="M 97 135 H 118 V 79 H 134" marker-end="url(#claim-tip)" />
		<text class="aside" x="110" y="76" text-anchor="end">both see 401</text>
	</svg>
</section>
```

`example/decks/boards/plan.html` and `risks.html` are both built this way — a flow and a
timeline. Read them before writing your first one.

What makes such a diagram good, in order of how often it goes wrong:

- **Lay it out on a grid you decide first.** Pick the box size and the gaps (34-high
  boxes 56 apart, say) and derive every coordinate from them. Numbers chosen one at a
  time do not line up, and nothing here will line them up for you.
- **Elbows beat curves.** `M 97 23 H 118 V 79 H 134` is five numbers a reader can check
  against the boxes it joins; a cubic Bézier's control points are not.
- **Leave room for the arrowhead.** End the path a few units short of the box it points
  at (`H 134` into a box whose left edge is 138), or the head lands inside the border.
- **Tokens, not hexes** — through CSS in the board's own `<head>`, keyed on your class.
  An SVG defaults to `fill: black; stroke: none`, so say what you mean for every shape:
  `fill: none` on a path, and an explicit `fill` on every `<text>`.
- **`role="img"` and an `aria-label`** saying what the picture says. It is the only text a
  screen reader gets, and it is also the sentence that tells you whether the drawing was
  worth making.

**A chart, or a graph too big to place by hand: d3.** It is vendored beside the board and
the section below shows it. Everything above still applies — d3 computes the coordinates,
and it does so at mount time, so use it where the *data* is the point (a scale, a layout
of forty nodes) and not to avoid choosing where four boxes go.

**Mermaid is still there**, and is the right answer for a flowchart whose shape you do not
want to own. It is a `[data-mermaid]` box (below); the difference from a diagram you draw
is exactly the one this section is about, so reach for it when the picture is disposable
and draw it yourself when the positions mean something.

### Markdown, maths, mermaid

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
  `.html` in a sandboxed frame, images as images, and `.txt`/`.csv`/`.json`/`.py`/`.ts`
  and friends as escaped preformatted text, truncated at 256 KB. Anything else becomes a
  chip naming the file, its size and its kind, which opens or downloads it.
- Files the user drags onto a board are copied into `assets/` and embedded from there, so
  a `data-embed="../assets/…"` you did not write is probably one of theirs.
- Outside the deck, the file must sit under a root declared in `deck.json`.
- Embeds want an explicit `height`: they have no content of their own to size to.

## Inventing a component

Nothing stops you. A board is an HTML file you write with your ordinary tools; no schema
validates it, and `board.js` only ever looks at three things — `[data-md]`,
`[data-mermaid]` and `[data-embed]`. Every other element in the body it leaves exactly as
you wrote it, including every `<svg>` you draw. So a shape the catalogue does not have is a shape you can build, and you
should, rather than forcing a timeline into three stickies.

**Your CSS goes in the board**, in a `<style>` in its own `<head>`:

```html
<style>
	.phase { display: grid; grid-template-columns: 88px 1fr; gap: var(--b-unit); }
	.phase > .when { color: var(--b-faint); font-family: var(--b-mono); }
</style>
```

Never in `lib/board.css`. That directory belongs to the application and is rewritten from
the running build every time the deck is opened, so an edit there is reverted without
warning — and it would change every board in the deck, not the one you are writing.

### The one obligation: leave it editable

The user edits boards by hand, and they can only edit what they can reach. A component you
invent is as editable as you make it, and the rules are mechanical:

- **`data-id` on the outer element, and make that element a direct child of `<body>`.**
  That alone earns selecting, dragging, resizing, renaming, duplicating, deleting and
  reordering. A `data-id` nested inside another component is not a component — the card
  around it is.
- **Keep a box class beside your own**: `class="card phases"`, not `class="phases"`. With
  one of `text` `sticky` `card` `panel` `callout` present, the user's inspector also offers
  the class switch and the tone; without one it can only offer the name and the order. A
  swap replaces just the box class and leaves your token alone, so key your CSS on `.phases`
  and never on `.card .phases` — the card may be a panel by the time anyone reads it.
- **One editable string per leaf element.** A run of text is retypeable in place only if
  its element has no element children: `<h3>Goal</h3>` yes, `<p>See <a>the doc</a></p>` no
  (the paragraph is refused, though the link's own text is a leaf and is fine). Three
  labelled numbers want three spans, not one span with three numbers in it.
- **Keep the words in the file.** A patch splices the board's source, so text that lives in
  an attribute, in a CSS `content:`, or in a string your `<script>` writes at runtime has
  nowhere for an edit to land. Static markup wherever it can be static.
- **`data-md`, `data-mermaid` and `data-embed` are not retypeable, by design.**
  `board.js` replaces what is inside them, so the file's shape is not the shape on screen
  and an edit is refused with a reason. Reach for markdown when the content really is
  prose you own; do not wrap a component in `data-md` for the convenience of writing it.
- **A top-level `<svg>` is a component the editor cannot measure.** Every gesture in it
  reads `offsetLeft`/`offsetWidth`, which an `SVGElement` does not have, so such a
  component can be selected, renamed, copied and deleted but not dragged, resized or
  retyped. Put the drawing inside a box, as the diagram section does, and all of it works.

A component that follows those rules, and is worth the two lines of CSS above:

```html
<section class="card phases" data-id="rollout" style="left: 48px; top: 168px; width: 420px">
	<h3>Rollout</h3>
	<div class="phase"><span class="when">week 1</span><span>Lock behind a flag</span></div>
	<div class="phase"><span class="when">week 2</span><span>Ramp to 10%</span></div>
</section>
```

Every string in it is its own leaf, so the user can retype any of the four; it is a `card`,
so they can make it a panel or a callout; and it has a name, so you can find it again.

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

One caution, which is the diagram section's caution again: what a `<script>` writes at
mount time is not in the file. Nothing can retype a bar's label, and neither you nor the
user can see the layout without running the page. That is a fair price for a scale over
forty points and a bad one for four boxes — draw those.

## Checklist before you say a board is done

- Does every component have a meaningful `data-id`?
- Is the board big enough that nothing clips? (Screenshot it — board-debug skill.)
- Are positions on the 8px grid, with two or three x values reused rather than a new one
  per component?
- Are colours tokens, not hexes?
- If you invented a component: is every string in it its own leaf element, does it carry a
  box class beside your own, and is its CSS in the board rather than in `lib/`?
- If you drew a diagram: is it inside a box component rather than a bare `<svg>`, are its
  coordinates on a grid you chose, and does its `aria-label` say what it says?
- Does it say one thing?
- **Could the user understand this without reading the chat?** That is the test that
  matters. If the board needs a sentence you only said in the column, the sentence belongs
  on the board.
