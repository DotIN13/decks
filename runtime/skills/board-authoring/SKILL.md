---
name: board-authoring
description: How to write a board — the document and its metadata, positioning on the canvas, the built-in component classes (text, card, sticky, callout, kpi, table, chip), markdown, maths, Mermaid, embeds, diagrams you draw yourself, custom components of your own, and which shapes the user can retype in place. Read before answering on a board or building one with anything beyond cards and text.
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
- keep each string the user should retype separately in its own leaf element

For example:

```html
<section class="card" data-id="project-goal" style="left: 48px; top: 144px; width: 400px">
	<h3>Goal</h3>
	<p>One session, one refresh.</p>
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

## What the user can retype

A run of words is retypeable when its content is **words and marks**: text, and elements
that are phrasing content — `<b>`, `<em>`, `<a>`, `<code>`, `<span>` and the rest of the
inline set. The user double-clicks it and edits it in place as rich text; the app sends the
component's id, the element's position inside it, and the element's new inner HTML, and the
server splices that element's byte range in the file.

```html
<h3>Goal</h3>
<p>See <a href="../docs/notes.md">the doc</a>, then <b>ship it</b>.</p>
```

Both of those are one field. Nothing has to be named for it: there is no attribute to
remember and no list to keep unique.

- **A box of blocks is not a run.** A `<section>` holding an `<h3>` and a `<p>` is two runs
  with a box around them, and the user gets each of them rather than one field over both.
  Double-clicking the box itself says so instead of flattening what is inside it.
- **A run is one field, marks and all.** Clicking a bold word inside a paragraph opens the
  paragraph, because a field whose caret stops at a mark's edge is worse than no field. So
  **keep the units the size you mean**: three labelled numbers in one row are edited
  together, and as three separate leaves they are edited separately. That is the one thing
  your markup decides about editing, and it is worth a thought per component.
- **Text has to be in the file.** Not in CSS `content`, not in a JavaScript string, not in
  an attribute: a patch splices the board's source, so text the file does not contain has
  nowhere for an edit to land.

Whatever the browser hands back is normalised before it is written: only inline tags survive,
`style` and `id` are dropped, `class` and `data-*` are kept, split marks are merged, and
anything else is unwrapped to its words. So a paste from elsewhere lands as words with the
marks it deserved and none of the styling it arrived with, and you will not find a browser's
artefacts in a board file.

The app underlines a run under the cursor, so the user can see where to type instead of
double-clicking around to find out.

**This replaced `data-edit`**, a name you had to write on every retypeable run and keep
unique within the board. If you are used to writing them, they are simply ignored now:
harmless, and worth deleting when you are editing a board anyway. The name was a fine
address and a poor gate — a board written without them had no retypeable text at all, and
the only thing the app could say was "ask the agent for a data-edit on it".

**`[data-embed]` and `<svg>` content is not retypeable.** An embed shows somebody else's
file, so what there is to edit is the path, which the inspector offers. A `<text>` inside a
drawing is placed by the drawing's own coordinates. `[data-md]` and `[data-mermaid]` are
the exception and have their own rule below.

## Markdown and maths

A component with `data-md` is rendered as markdown:

```html
<div class="card" data-id="notes" data-md style="left: 48px; top: 144px; width: 520px">
	Markdown content here.
</div>
```

Markdown supports inline and display maths using `$…$` and `$$…$$`.

Indent the content to match the surrounding HTML; the common indent is stripped before
parsing.

**The whole source is the editable unit, and the component is what is addressed.** A
double-click opens the source in a monospace editor over the component, and a commit
re-renders that one component. The blocks inside are not separately editable: a rendered
`<h2>` came from `## …` and has no byte range of its own in the file, which is exactly why
the source is the unit. Two consequences — a source containing raw HTML is refused, because
the app only ever had the element's text with the tags already dropped; and the editor
shows the source dedented, so keep the block's indentation regular and it comes back
exactly as it was.

Use markdown for content that benefits from markdown rendering rather than merely as a
shortcut for ordinary editable text.

## Mermaid diagrams

Use `data-mermaid` for Mermaid diagrams:

```html
<div class="card"
     data-id="flow"
     data-mermaid
    
     style="left: 48px; top: 144px; width: 600px; height: 400px">
	flowchart TD
		A["tab A: 401"] --> L{"lock free?"}
		L -- yes --> R["refresh"]
</div>
```

Give Mermaid components an explicit height so the diagram has a known rendering area.
Editing works as it does for markdown: the component is what is addressed, and the whole
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
- put each string the user should retype *separately* in its own leaf element, since a run
  of words is edited as one field

Do not place editable text in CSS `content`, generated JavaScript strings, or attributes:
a patch splices the board's source, so text that is not in the file has nowhere for an
edit to land.

Custom CSS should target the custom class itself rather than depend on the current box
class, because the user may change a card into a sticky or a callout. Keep a box class
alongside your own — `class="card phases"` — so the component keeps the class switch and
the tone the inspector offers.

```html
<section class="card phases" data-id="rollout" style="left: 48px; top: 168px; width: 420px">
	<h3>Rollout</h3>
	<div class="phase"><span class="when">week 1</span><span>Lock behind a flag</span></div>
	<div class="phase"><span class="when">week 2</span><span>Ramp to 10%</span></div>
</section>
```

The heading is one field and each `.phase` row is another, because a row of two `<span>`s is
a run of words. If the two halves of a row should be retyped separately, they need to be in
separate rows rather than separate spans.

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
- runs of words are the size the user should edit them in: one field per run, and separate
  leaves for strings that should be retyped separately
- components fit within the canvas without clipping
- positioning is reasonably aligned and spaced
- custom components keep a box class alongside their own
- board-specific CSS stays inside the board
- colors use board tokens
- a drawing sits inside a box component rather than in a bare `<svg>`
- embeds and diagrams have sufficient dimensions
- the board contains enough context to be understood on its own
