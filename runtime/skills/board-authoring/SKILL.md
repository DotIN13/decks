---
name: board-authoring
description: How to write a board. One format: a one-screen HTML page you design, whose content flows top to bottom inside one `.doc`. Covers the board.css vocabulary, diagrams, embeds and links. Read before building anything beyond a title, a visual and a few words.
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

**One format: a page you design, and it flows**

- A board is one self-contained HTML page. `decks board create --title …` writes
  `<body class="board">` with `../lib/board.css`, a `<style>` block and one block:
  `<div class="doc" data-id="doc">`. Write everything inside that `.doc`, top to bottom, or straight
  in `<body>` if you prefer. Lay it out with normal CSS: flexbox and grid for columns and rows.
- **Nothing is placed by coordinates.** No `position: absolute` blocks on the page, no `left` and
  `top`, no pixel grid. The content flows, and its order in the file is its order on the board.
- The width comes from `<meta name="board">` (`"w"`). The height is the content's: the canvas
  measures the page, so a board cannot clip. Leave `h` out; a height you do write is only a floor.
- `board.css` brings the tokens, light and dark: `--b-fg --b-muted --b-faint --b-bg --b-bg-deep
  --b-bg-layer --b-border --b-border-strong --b-accent --b-accent-soft --b-ok --b-warn --b-danger
  --b-radius --b-font --b-mono`. Never hardcode a colour the tokens cover.
- `board.js` stays last.
- Patterns that work: a highlighted row in a comparison table; before and after side by side; a
  sequence diagram with three lifelines; a row of large numbers with a one-line label each; one
  chart with a labelled axis and the winning series in the accent colour.
- Then `decks canvas insert --type board --board <path> --beside <id or path>` (or `--below`,
  `--at.x1 --at.y1`) puts it on your canvas, and `decks canvas fit <path>` sizes it. `fit` reports the height, the word count, the
  smallest type and any content wider than the board. Fix what it says is over; when it says
  "One screen", stop.

**Names and building blocks**

- **`data-id` is an optional name.** Put one on a block a person may want to comment on, or that
  you may want to point at later (`data-id="auth-flow"`). Short, stable and meaningful. A block
  needs no name to be on the board.
- **Core Primitives:** Box containers include `.card`, `.sticky`, `.text`, and
  `.callout[data-tone="warn|danger|ok"]`. Specialized widgets include `.kpi`, `.table`, and
  `.chip`. They nest and flow like any other element.
- **Markdown & Mermaid:** Add `data-md` (supports KaTeX via `$..$` / `$$..$$`) or `data-mermaid`
  (give a mermaid block a height).

**Visuals, Diagrams, & Embeds**

- **Custom SVG Diagrams:** Put an `<svg>` inside a box (`.card`, `.callout`) with a `viewBox` and
  `width="100%"`, so it scales with the page. Inside it, use even coordinates, orthogonal elbow paths (`M... H... V...`), explicit arrowhead offsets, and CSS variable
  styling.
- **Embed External Media:** Embed local files via
  `<div class="embed" data-embed="../path" style="height: 480px">`. For interactive HTML embeds, include
  `<script src="../lib/embed-guest.js"></script>` to forward canvas scroll and pinch gestures.
- **A document to write in is a document board, not an embed.** A `.md`, `.tex` or `.docx` the
  person will type into goes in a board of its own holding one box,
  `<div class="live" data-id="doc" data-live="doc" data-path="../papers/paper.md"></div>`, which fills the board
  (the path relative to the board), at about 1000 by 1100. Markdown and LaTeX are typed into as
  they read, with a toolbar of styles; Word is typed into a paragraph at a time. The file is edited
  where it is: every keystroke goes to it, and its history and review are kept apart in `docs/<name>/`,
  which is not yours to write. Edit the file itself with your own tools: your edit lands at once, highlighted on the words you changed, and the person accepts or rejects
  it, one at a time or all at once. History shows and restores any earlier version.
  A Google Doc opens the same way from its link; edit it with `gdocs_read` and `gdocs_edit`
  (markdown in, real Docs formatting out), never by writing the mirror the page keeps in `docs/`.
- **Charts, 3D and animation: import from the head's import map.** Every new board carries one,
  naming `d3`, `three` (with `three/addons/`), `gsap` and `chart.js` pinned on jsDelivr. Edit it for
  anything else, and reach for a library with `const d3 = await import("d3")` where you draw, on
  `board:ready` if the layout has to be settled. Import inside the code path that needs it rather
  than at the top of a module, so a board that never gets there pays nothing.
- **Title: the finding, not the topic.** The title comes from `decks board create --title`. Write it
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
  never coloured. Change code by editing the file.
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
