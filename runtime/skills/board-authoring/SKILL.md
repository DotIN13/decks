---
name: board-authoring
description: How to write a board — its format and lifecycle, the rules for components and in-place editing, visuals, diagrams and embeds, and the design-system tokens to style with. Read before answering on a board or building one with anything beyond cards and text.
---

# Board authoring

**Board Formats & Lifecycle**

- **Single HTML File:** Boards are standalone documents declaring their format via the `<body>`
  class: `class="board"` (absolute positioned boxes), `class="board flow"` (single reflowing document
  via `.doc`), or `class="reveal"` (slides named `*.slides.html`).
- **Creation & Sizing:** Initialize via `stage.newBoard({ title, kind, format })`. Keep boards under
  ~1200px wide (matching viewport) to avoid downscaling. Use `stage.fit(path)` post-render to
  shrinkwrap canvas boundaries, or `stage.resize(path, { w, h })` to set dimensions directly.
- **Layout Order:** Match DOM order strictly to visual reading order (top-to-bottom, left-to-right).
  Standardize section headings using `<h3 class="text">` with approved tags: *Summary, Overview,
  Problem, Research question, Method, Result, Todos, Next*.

**Component Rules & In-Place Editing**

- **Direct Children & IDs:** Every movable widget must be a direct child of `<body>`, styled with
  inline coordinates (`left`, `top`, `width` on an 8px grid), and assigned a semantic, stable
  `data-id` (e.g., `data-id="auth-flow"`).
- **Editable Word Runs:** Any continuous run of text and phrasing marks (`<b>`, `<a>`, `<span>`)
  forms a single double-click editable field. Place strings that should be edited independently into
  separate leaf elements. Never put editable copy in CSS, scripts, or attributes.
- **Core Primitives:** Interchangeable box containers include `.card`, `.sticky`, `.text`, and
  `.callout[data-tone="warn|danger|ok"]`. Specialized layout widgets include `.kpi`, `.table`, and
  `.chip`.
- **Markdown & Mermaid:** Add `data-md` (supports KaTeX via `$..$` / `$$..$$`) or `data-mermaid`
  (always set explicit `width` and `height`). Double-clicking these opens raw source code in an
  overlay editor.

**Visuals, Diagrams, & Embeds**

- **Custom SVG Diagrams:** Never mount raw `<svg>` elements directly under `<body>`. Wrap them inside
  a standard box (`.card`, `.callout`) with `viewBox` and `width="100%"`. Use grid-derived
  coordinates, orthogonal elbow paths (`M... H... V...`), explicit arrowhead offsets, and CSS variable
  styling.
- **Embed External Media:** Embed local files via
  `<div class="embed" data-embed="../path" style="...">`. For interactive HTML embeds, include
  `<script src="../lib/embed-guest.js"></script>` to forward canvas scroll and pinch gestures.
- **Charting and animation — load the library from a CDN.** A `<script>` or `<link>` with an
  absolute `https://` URL is the normal way and needs no setup; boards are same-origin and carry no
  CSP. Pin the version (`d3@7.9.0`, never `@latest`) so the file's bytes still say what it shows.
  The deck's `lib/` keeps a few copies for offline work — a fallback, not the default. Execute
  rendering inside the `board:ready` event listener:

```js
document.addEventListener("board:ready", () => { /* chart render logic */ });
```

**Styling & Design System Tokens**

- **Scoped Styling:** Place custom styles in a `<style>` block in the board's `<head>`. Target custom
  class names directly rather than tying them to container classes (e.g., `.phases .phase`, not
  `.card .phase`). Never touch `lib/board.css`.
- **Theme Variables:** Always use platform tokens instead of hardcoded hex colors:
  - *Surfaces & Borders:* `--b-bg`, `--b-bg-deep`, `--b-bg-layer`, `--b-border`, `--b-border-strong`,
    `--b-radius`.
  - *Typography & Accents:* `--b-fg`, `--b-muted`, `--b-faint`, `--b-font`, `--b-mono`, `--b-accent`,
    `--b-accent-soft`.
  - *Status Tones:* `--b-ok`, `--b-warn`, `--b-danger`, `--b-sticky`.
