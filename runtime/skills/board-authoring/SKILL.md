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
  ~1200px wide (matching viewport) to avoid downscaling. Use `stage.fit(path)` post-render to take
  the content's height; the width is left as it is, and `stage.resize(path, { w, h })` sets a size
  directly.
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
- **Charts, 3D and animation: import from the head's import map.** Every new board carries one,
  naming `d3`, `three` (with `three/addons/`), `gsap` and `chart.js` pinned on jsDelivr. Edit it for
  anything else, and reach for a library with `const d3 = await import("d3")` where you draw, on
  `board:ready` if the layout has to be settled. Import inside the code path that needs it rather
  than at the top of a module, so a board that never gets there pays nothing.
- **A plot says what its axes are.** Draw both axes, and give each of them a tick value and a title
  saying what it counts and in what unit ("visits per month, count", not "value"). A chart without
  them shows a shape and makes no claim. Unsure of an API? Download the file the map names and read
  it: `curl -s <url>` works, and `cdn.jsdelivr.net/npm/<package>@<version>/` serves the whole package.
- **Copy: plain words and short sentences, no em dashes.** A board is read once, by somebody deciding
  something, so a sentence they have to read twice is a sentence that did not earn its place.
- **Code is coloured, and the fence or the file says what it is.** A fenced block that names its
  language (\`\`\`ts), and a source file an embed draws (the language comes from the extension, or
  from `data-lang="sql"` when the name says nothing useful), are highlighted by the runtime with
  nothing added to the board. The colours are the `--b-code-*` tokens, so a code block is light and
  dark with the rest of the board. A fence with no language is drawn plain, because the runtime never
  guesses, and so is a language outside the bundle's common set. Inline `<code>` in a sentence is
  never coloured. A `pre` is not retypeable in place: its spacing is content. Change code by editing
  the file, or as the source of a markdown panel.

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
