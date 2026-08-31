---
name: board-authoring
description: How to write a board — the document and its metadata, positioning on the canvas, the built-in component classes (text, card, sticky, callout, kpi, table, chip), markdown, maths, Mermaid, embeds, diagrams you draw yourself, custom components of your own, and `data-edit`, which every run of words the user may retype has to carry. Read before answering on a board or building one with anything beyond cards and text.
---

# Board authoring

A board is a fixed-size HTML canvas made of absolutely positioned components. It does
not scroll or reflow, so the author is responsible for placement and sizing.

Use boards for answers, designs, reports, diagrams, or other visual work where the user
should be able to inspect and rearrange the result.

## Create the board

Start with:

```ts
stage.newBoard({ title, kind })
```

A board document should include:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Board title</title>
		<meta name="board" content='{"w":1600,"h":1000,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<!-- components -->
		<script src="../lib/board.js"></script>
	</body>
</html>
```

The board metadata supports:

- `w` and `h` for canvas dimensions
- `bg`: `"grid"`, `"dots"`, or omitted
- `theme`: `"light"` or `"dark"` when a fixed theme is required

An optional poster can be declared with:

```html
<meta name="poster" content="assets/poster.png">
```

Show a completed board when useful with:

```ts
await stage.show("boards/example.html")
```

## Positioning

Board components are positioned with inline styles:

```html
style="left: 48px; top: 144px; width: 400px"
```

Use an 8px positioning grid where practical.

Keep reasonable margins and gutters, and reuse a small number of column positions rather
than scattering components arbitrarily.

Prefer sizing from content. Set explicit heights only where needed, particularly for
embeds, diagrams, charts, or constrained boxes.

Increase the board dimensions if content would otherwise clip.

## Component metadata

Every user-editable board component must:

- be a direct child of `<body>`
- have a meaningful, stable `data-id`
- have its own position and width
- carry a `data-edit` on every run of words the user should be able to retype

For example:

```html
<section class="card" data-id="project-goal" style="left: 48px; top: 144px; width: 400px">
	<h3 data-edit="project-goal-title">Goal</h3>
	<p data-edit="project-goal-body">One session, one refresh.</p>
</section>
```

Use semantic IDs such as `goal`, `recommendation`, `timeline`, or `risk-auth`, not
positional names such as `box-3`.

The user may rename, restyle, move, duplicate, or delete components. Do not assume a
component still has the class or ID you originally gave it if the board has since been
edited. You are told when they change one, in the same line that reports any other edit
they made; read the board rather than writing it again from memory.

## Built-in component classes

The board stylesheet provides common visual containers including:

- `text`
- `card`
- `sticky`
- `callout`
- `kpi`
- `table`
- `chip`

The first four are interchangeable box classes: they all mean "a box with prose in it",
and the user's inspector can swap any of them for any other. `kpi`, `table` and `chip`
style their children, so they are not in that switch.

Use these when useful, but they are not a schema or a limit on what may appear on a
board.

Callouts can use:

```html
data-tone="warn"
data-tone="danger"
data-tone="ok"
```

Omitting the tone uses the default accent treatment.

## `data-edit` — the address of every retypeable run

A run of words is editable when, and only when, it carries a `data-edit`. The name is
the whole address: the user double-clicks the words, the app sends
`data-edit="goal-title"` and the new text, and the server splices that element's byte
range in the file.

```html
<h3 data-edit="goal-title">Goal</h3>
```

- **Required.** There is no inference and no fallback. A run with no `data-edit` cannot
  be retyped, and a board written without them has no retypeable text at all.
- **Unique within the board.** Two runs with one name make a retype of either ambiguous,
  and it is refused rather than guessed at. Name them after the component they belong to
  — `goal-title`, `goal-body`, `rollout-when-1`.
- **On the leaf that holds the string**, not on a container. Three labelled numbers are
  three named spans, not one named row containing them.
- **`data-edit="false"` is not a name, and is refused** by both the app and the server.
  Nothing needs sealing: leaving the attribute off is how you say text is not the user's
  to retype. Use it for a computed value, a legend, a label that has to stay in step
  with a chart's axis, or any line a script rewrites on mount.

A named run earns an affordance as well as an address: the app underlines it under the
cursor, so the user can see where to type instead of double-clicking around to find out.

Two rules `data-edit` cannot lift, because they are properties of applying an edit as a
byte splice rather than policy:

- **A run must be a leaf.** An element with element children inside it — `<p>See <a
  href="…">the doc</a></p>` — cannot be retyped as plain text, because that would throw
  the markup away. Name the link's own text, or the paragraph's own `<span>`, instead.
- **`[data-embed]` and `<svg>` content has no path into the file.** An embed shows
  somebody else's file, so what there is to edit is the path, which the inspector
  offers. A `<text>` inside a drawing is placed by the drawing's coordinates and is
  never retypeable. `[data-md]` and `[data-mermaid]` are the exception and have their
  own rule below.

## Markdown and maths

A component with `data-md` is rendered as markdown:

```html
<div class="card" data-id="notes" data-md data-edit="notes-md" style="left: 48px; top: 144px; width: 520px">
	Markdown content here.
</div>
```

Markdown supports inline and display maths using `$…$` and `$$…$$`.

Indent the content to match the surrounding HTML; the common indent is stripped before
parsing.

**The `data-edit` goes on the component, once, and the whole source is the editable
unit.** A double-click opens the source in a monospace editor over the component, and a
commit re-renders that one component. Do not name the blocks inside one: a rendered
`<h2>` came from `## …` and has no byte range of its own in the file. Two consequences —
a source containing raw HTML is refused, because the app only ever had the element's
text with the tags already dropped; and the editor shows the source dedented, so keep
the block's indentation regular and it comes back exactly as it was.

Use markdown for content that benefits from markdown rendering rather than merely as a
shortcut for ordinary editable text.

## Mermaid diagrams

Use `data-mermaid` for Mermaid diagrams:

```html
<div class="card"
     data-id="flow"
     data-mermaid
     data-edit="flow-src"
     style="left: 48px; top: 144px; width: 600px; height: 400px">
	flowchart TD
		A["tab A: 401"] --> L{"lock free?"}
		L -- yes --> R["refresh"]
</div>
```

Give Mermaid components an explicit height so the diagram has a known rendering area.
The `data-edit` works as it does for markdown: one name on the component, and the whole
source is what opens.

Mermaid is the right answer for a flowchart whose shape you do not want to own. Draw the
diagram yourself when the positions mean something.

## Diagrams you draw

**There is no connector between two components.** A line whose ends are resolved at
mount time is a line the file does not state: you could not tell from the source where
it went, and the user had nothing to drag. A diagram is therefore a component that owns
both its boxes and its arrows, with every coordinate in the file.

Put the drawing inside a normal box component, never directly in `<body>`. A `<div>` or
`<section>` is what the user drags and resizes; a top-level `<svg>` gets neither, because
the editor's geometry is `HTMLElement`'s and an `SVGElement` has none of it. Give the
`<svg>` a `viewBox` and `width="100%"` so it scales with the box it sits in.

```html
<style>
	/* Keyed on `.claim`, never on `.card .claim` — the user may make it a callout. */
	.claim .box { fill: var(--b-bg-deep); stroke: var(--b-border-strong); stroke-width: 1.5; }
	.claim .flow { fill: none; stroke: var(--b-border-strong); stroke-width: 1.5; }
	/* A marker's head is a path inside a `.flow`, and the rule above gave that
	   `fill: none` — a declaration beats the attribute, so the head needs its own rule. */
	.claim marker > path { fill: var(--b-border-strong); stroke: none; }
	.claim text { fill: var(--b-fg); font-family: var(--b-font); font-size: 12px; }
</style>

<section class="card claim" data-id="claim" style="left: 1140px; top: 604px; width: 412px; height: 232px">
	<h3 data-edit="claim-title">One claim, two tabs</h3>
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
	</svg>
</section>
```

`example/decks/boards/plan.html` and `risks.html` are both built this way — a flow and a
timeline. Read them before writing your first one.

In the order these go wrong:

- **Lay it out on a grid you decide first.** Pick the box size and the gaps and derive
  every coordinate from them. Numbers chosen one at a time do not line up.
- **Elbows beat curves.** `M 97 23 H 118 V 79 H 134` is five numbers a reader can check
  against the boxes it joins; a cubic Bézier's control points are not.
- **Leave room for the arrowhead.** End the path a few units short of the box it points
  at, or the head lands inside the border.
- **Tokens, not hexes**, through CSS in the board's own `<head>`, keyed on your class. An
  SVG defaults to `fill: black; stroke: none`, so say what you mean for every shape:
  `fill: none` on a path, and an explicit `fill` on every `<text>`.
- **`role="img"` and an `aria-label`** saying what the picture says. It is the only text
  a screen reader gets, and the words in a drawing are never retypeable.

## Embeds

Use `data-embed` to place files on a board:

```html
<div class="embed"
     data-id="reference"
     data-embed="../docs/reference.md"
     style="left: 48px; top: 144px; width: 520px; height: 560px"></div>
```

Embed paths are relative to the board file.

Supported content includes documents, PDFs, HTML, images, source files, JSON, CSV, and
other text-like formats. PDFs may specify page ranges with `data-pages`. Anything
unrecognised becomes a chip naming the file, its size and its kind.

Embeds should normally have an explicit height.

Files must live under a root permitted by the deck configuration. A
`data-embed="../assets/…"` you did not write is probably a file the user dragged onto the
board.

## Custom components

Boards are ordinary HTML, so custom components may be created whenever the built-in
classes are insufficient. `board.js` looks at only three things — `[data-md]`,
`[data-mermaid]` and `[data-embed]` — and leaves every other element exactly as written.

Put board-specific CSS in a `<style>` block inside the board document. Never modify
`lib/board.css` — it belongs to the application and is rewritten from the running build
whenever the deck is opened, so an edit there is reverted without warning.

To keep a custom component editable:

- make its outer element a direct child of `<body>`
- give that outer element a `data-id`
- keep user-editable wording in static HTML
- place each independently editable string in its own leaf element, and give each one a
  `data-edit` nothing else on the board has

Do not place editable text in CSS `content`, generated JavaScript strings, or attributes:
a patch splices the board's source, so text that is not in the file has nowhere for an
edit to land.

Custom CSS should target the custom class itself rather than depend on the current box
class, because the user may change a card into a sticky or a callout. Keep a box class
alongside your own — `class="card phases"` — so the component keeps the class switch and
the tone the inspector offers.

```html
<section class="card phases" data-id="rollout" style="left: 48px; top: 168px; width: 420px">
	<h3 data-edit="rollout-title">Rollout</h3>
	<div class="phase"><span class="when" data-edit="rollout-when-1">week 1</span><span data-edit="rollout-what-1">Lock behind a flag</span></div>
	<div class="phase"><span class="when" data-edit="rollout-when-2">week 2</span><span data-edit="rollout-what-2">Ramp to 10%</span></div>
	<span class="computed" data-edit="false">2,455 so far</span>
</section>
```

Every named run in it is a leaf, so the user can retype any of the five; the computed
figure carries the reserved value, so it is left alone.

## Libraries and scripts

Board-specific JavaScript may be added when necessary.

D3 is available locally and can be loaded with:

```html
<script src="../lib/d3.min.js"></script>
```

For scripts that depend on the board layout being ready, initialize them after:

```js
document.addEventListener("board:ready", () => {
	// render or initialize
})
```

Only load extra libraries on boards that need them. Text a script writes is not in the
file and cannot be retyped, so leave it unnamed rather than giving the user a field whose
edit the next mount would discard. Reach for a script where the *data* is the point — a
scale, a layout of forty nodes — and not to avoid choosing where four boxes go.

## Theme tokens

Use board CSS variables instead of hard-coded colors so components work across themes.

Available tokens include:

`--b-bg`, `--b-bg-deep`, `--b-bg-layer`, `--b-fg`, `--b-muted`, `--b-faint`,
`--b-border`, `--b-border-strong`, `--b-accent`, `--b-accent-soft`, `--b-sticky`,
`--b-ok`, `--b-warn`, `--b-danger`, `--b-radius`, `--b-unit`, `--b-font`, and `--b-mono`.

Scripts and charts should read these tokens from computed styles rather than duplicating
color values.

## Before finishing

Check that:

- every component has a meaningful `data-id`
- every run of words the user may retype carries a `data-edit` nothing else on the board
  has, including the source of every `[data-md]` and `[data-mermaid]` component
- every named run is a leaf element, and nothing is named `false`
- components fit within the canvas without clipping
- positioning is reasonably aligned and spaced
- custom components keep a box class alongside their own
- board-specific CSS stays inside the board
- colors use board tokens
- a drawing sits inside a box component rather than in a bare `<svg>`
- embeds and diagrams have sufficient dimensions
- the board contains enough context to be understood on its own
