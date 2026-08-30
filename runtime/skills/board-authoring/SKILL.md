---
name: board-authoring
description: How to write a board — the document and its metadata, positioning on the canvas, the built-in component classes (card, panel, sticky, callout, kpi, table, chip, connectors), markdown, maths, Mermaid, embeds, custom components of your own, and `data-edit` for declaring which text the user may retype. Read before answering on a board or building one with anything beyond cards and text.
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
embeds, diagrams, charts, or constrained panels.

Increase the board dimensions if content would otherwise clip.

## Component metadata

Every user-editable board component must:

- be a direct child of `<body>`
- have a meaningful, stable `data-id`
- have its own position and width

For example:

```html
<section class="card" data-id="project-goal" style="left: 48px; top: 144px; width: 400px">
	...
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
- `panel`
- `sticky`
- `callout`
- `kpi`
- `table`
- `chip`

Use these when useful, but they are not a schema or a limit on what may appear on a
board.

Callouts can use:

```html
data-tone="warn"
data-tone="danger"
data-tone="ok"
```

Omitting the tone uses the default accent treatment.

## Connectors

An `svg.link` draws an arrow between two components by id, routed from the nearest facing
sides and redrawn whenever either end moves:

```html
<svg class="link" data-id="goal-approach" data-from="goal" data-to="approach" data-label="how"></svg>
```

No `style` is needed — a connector covers the whole board and takes clicks only on its
own line. `data-tone="accent"` is available.

## Markdown and maths

A component with `data-md` is rendered as markdown:

```html
<div class="panel" data-id="notes" style="left: 48px; top: 144px; width: 520px" data-md>
	Markdown content here.
</div>
```

Markdown supports inline and display maths using `$…$` and `$$…$$`.

Indent the content to match the surrounding HTML; the common indent is stripped before
parsing.

Use markdown for content that benefits from markdown rendering rather than merely as a
shortcut for ordinary editable text.

## Mermaid diagrams

Use `data-mermaid` for Mermaid diagrams:

```html
<div class="panel"
     data-id="flow"
     style="left: 48px; top: 144px; width: 600px; height: 400px"
     data-mermaid>
	...
</div>
```

Give Mermaid components an explicit height so the diagram has a known rendering area.

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
classes are insufficient.

Put board-specific CSS in a `<style>` block inside the board document. Never modify
`lib/board.css` — it belongs to the application and is rewritten from the running build
whenever the deck is opened, so an edit there is reverted without warning.

To keep a custom component editable:

- make its outer element a direct child of `<body>`
- give that outer element a `data-id`
- keep user-editable wording in static HTML
- place each independently editable string in its own leaf element

For example, prefer separate `<span>` elements for separate labels or values rather than
combining unrelated editable strings into one complex element.

Do not place editable text in CSS `content`, generated JavaScript strings, or attributes
when it can live in normal markup.

Custom CSS should target the custom class itself rather than depend on the current box
class, because the user may change a card into a panel or callout. Keep a box class
alongside your own — `class="card phases"` — so the component keeps the class switch and
the tone the inspector offers.

```html
<section class="card phases" data-id="rollout" style="left: 48px; top: 168px; width: 420px">
	<h3 data-edit>Rollout</h3>
	<div class="phase"><span class="when" data-edit>week 1</span><span data-edit>Lock behind a flag</span></div>
	<div class="phase"><span class="when" data-edit>week 2</span><span data-edit>Ramp to 10%</span></div>
</section>
```

## `data-edit` — declaring what the user may retype

Editability is otherwise inferred: a leaf element whose text is in the file can be
retyped in place. That inference cannot tell an editable label from a computed number, so
say which is which.

```html
<span data-edit>Ramp to 10%</span>              <!-- yours to retype -->
<span data-edit="false">2,455</span>            <!-- computed; leave it alone -->
```

**`data-edit`** marks a string as an intended field. It is a declaration, not a
mechanism: it does not make anything editable that was not already, and it does not
override either rule below. What it buys is the affordance — the app underlines a
declared field under the cursor, so the user can see where to type instead of
double-clicking around to find out.

**`data-edit="false"`** seals an element and everything inside it. Use it for a value a
script computes, a label that has to stay in step with a chart's axis, a legend, or any
line the board rewrites on mount — all of which look exactly like editable text to the
leaf rule. Both the app and the server refuse a retype there, so the seal holds however
the edit arrives.

Put `data-edit` on the leaf that holds the string, not on the container: a seal inherits
down the tree, but a declaration describes one field.

Two rules `data-edit` cannot lift, because they are properties of how an edit is applied
rather than policy:

- **A run must be a leaf.** An element with element children inside it — `<p>See <a
  href="…">the doc</a></p>` — cannot be retyped as plain text, because that would throw
  the markup away. The link's own text is a leaf and is editable; the paragraph is not.
- **`[data-md]`, `[data-mermaid]`, `[data-embed]` and `<svg>` hold rendered content.**
  What is on screen is not the shape the file has, so no path into one resolves. Use them
  when rendered or external content matters more than inline editing.

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
file and cannot be retyped, so seal it with `data-edit="false"` rather than leaving the
user a field whose edit the next mount discards.

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
- components fit within the canvas without clipping
- positioning is reasonably aligned and spaced
- custom components remain editable
- editable strings are marked `data-edit`, and computed or script-written ones
  `data-edit="false"`
- board-specific CSS stays inside the board
- colors use board tokens
- embeds and diagrams have sufficient dimensions
- the board contains enough context to be understood on its own
