---
name: board-authoring
description: How to write a board. One format: a one-screen page you design, whose root-level blocks are placed where they say they go. Covers the board.css vocabulary, diagrams, embeds and links. Read before building anything beyond a title, a visual and a few words.
---

# Board authoring

**One screen**

- A board is read in about ten seconds. One idea, the title is the finding as a sentence, one main
  visual (diagram, chart, table, or two to four large numbers), about 120 words, five blocks at most.
- No section headings (Summary, Method, Next), no background, no recap. About 1000 by 700 or smaller.
  What does not fit is cut; a real second idea is a second board, linked with `<a href="other.html">`.
- Body text 17px or larger, nothing under 14px, the title on one or two full-width lines.
- Say each thing once. The title carries the finding and its number, so the body does not restate them: it shows what stands behind them. If the title already has the headline number, the large figures under it are other numbers. A caption never repeats a label, and a detail view never repeats the row that opened it. Write for a smart reader from outside the project. The first time a term of art, an abbreviation or an internal name appears (a KV cache, a t value, a file or variable name, an arm of an experiment), either replace it with plain words or say in a few words what it is. A statistic says how to read it, for example "t 2.3, where above 2 is unlikely to be chance". Before you finish, reread the board as someone who has never seen this project or paper: every name that came from its files (an arm, a scheme, a clause, a metric, a model's nickname, a statistic) is either replaced by what it does or explained once. The cheapest way costs no space: give the term a dotted underline and put its meaning in a hover or tap note, `<abbr title="what it means, in plain words">term</abbr>` with `abbr { text-decoration: underline dotted; cursor: help }`. A chart labels both axes with their units and says in its own title what to see in it; small multiples each carry their scale.
- Plain words, no em dashes. Every axis, column and number says what it measures, with its unit.

**Depth behind a click**

- Depth goes behind a click, not below the fold.
  At rest the board shows the finding and its one visual.
  What a reader may want next (the numbers behind a bar, the method, the runner-up, a definition, the second paper) is one click or hover away on the same screen: tabs, a row that opens its detail in a fixed panel, a toggle between two views, a value on hover, a filter on a table. Swap content in place rather than appending it, so an opened board is still one screen, and give each hidden view about the same word budget as the resting one. Controls are real <button> or <details> elements, look pressable, work offline, and the board makes sense before anything is pressed. Never hide the finding itself. If the person asked for several parts (say the claim, the method, the result and why it matters), none is dropped: the finding is what shows at rest and each other part is a view one click away. A <details> or a panel that opens must open into space the board already reserves, or over the content, so opening it does not make the board taller than one screen.
- A pattern that works: a table whose rows are buttons, and one detail panel of fixed height beside
  or under it that shows the chosen row. Another: two or three tabs over one chart area.
- When the person asks for something to use as it stands (a message to send, a section of a protocol, a full list, code), the board holds that thing in full and nothing else. The one-screen rule limits what you add, not what they asked for.

**One format: a page you design, with placed blocks**

- `stage.newBoard({ title, at: { x1, y1 } })` writes `<body class="board">` with `../lib/board.css`, a `<style>`
  block and one block: `<div class="doc" data-id="doc">`. Write your own CSS; inside a block, lay
  out with flexbox or grid.
- **Root-level blocks are out of the page's flow.** `board.css` puts every direct child of
  `<body>` in absolute position, so put your content inside one block rather than stacking
  several. `.doc` covers the board and is as tall as its content, which is what makes it read as
  a document. A block that states a `left` and a `top` of its own is placed at that point, on an
  8px grid, and is the thing a person can drag. One file holds both; there is no second format.
- The height is measured, so a board cannot clip. Leave `h` out of `<meta name="board">`; a height
  you do write is a floor the content can raise, which is how you keep room under the last block.
- `board.css` brings the tokens, light and dark: `--b-fg --b-muted --b-faint --b-bg --b-bg-deep
  --b-bg-layer --b-border --b-border-strong --b-accent --b-accent-soft --b-ok --b-warn --b-danger
  --b-radius --b-font --b-mono`. Never hardcode a colour the tokens cover.
- Every root-level block gets a stable, meaningful `data-id`. `board.js` stays last.
- Patterns that work: a highlighted row in a comparison table; before and after side by side; a
  sequence diagram with three lifelines; a row of large numbers with a one-line label each; one
  chart with a labelled axis and the winning series in the accent colour.
- Then `stage.show(path)` and `stage.fit(path)`. `fit` reports the height, the word count, the
  smallest type and any content wider than the board. Fix what it says is over; when it says
  "One screen", stop.

**The one other format, when asked for**

- `format: "slides"`: a `.slides.html` reveal deck, one `<section>` per slide, 960 by 540.

**Placed blocks: the rules**

- **Direct Children & IDs:** Every movable widget must be a direct child of `<body>`, styled with
  inline coordinates (`left`, `top`, `width` on an 8px grid), and assigned a semantic, stable
  `data-id` (e.g., `data-id="auth-flow"`). A block with no coordinates of its own sits at the
  origin, which is what the document block relies on.
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
- **Title: the finding, not the topic.** The title comes from `stage.newBoard({ title })`. Write it
  as a statement ("Returning customer share fell after the second tab shipped"), never a question.
- **A plot says what it shows, and what its axes are.** Give it a title of its own, both axes, a tick
  value on each, and a title on each saying what it counts and in what unit ("share of visits,
  percent"). A chart without them shows a shape and makes no claim. Unsure of an API? Download the
  file the map names and read it: `curl -s <url>` works, and `cdn.jsdelivr.net/npm/<package>@<version>/`
  serves the whole package.
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
- **Links: a board link opens a board, anything else opens a tab.** Write a link to another board as
  a path relative to this one, the way an embed is written: `<a href="risks.html">the risks
  board</a>`. Clicking it puts that board on the canvas beside the board that linked to it. Every
  other link opens in a new tab of its own, never in the board the reader is on, so a claim can cite
  its source with `href="https://…"` or point at a file outside `boards/` with
  `href="../papers/oauth.pdf"`. Two uses worth reaching for: a claim gets a link to where it came
  from rather than a restatement, and a board that needs more room gets a second board and a link to
  it rather than a second finding squeezed into the first.

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
