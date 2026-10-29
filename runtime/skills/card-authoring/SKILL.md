---
name: card-authoring
description: How to write a card. One format: a one-screen piece of HTML you design, in a folder of its own (cards/<name>/index.html), whose content flows top to bottom inside one `.doc` and whose scripts are modules handed the card. Covers the tokens, scripts and libraries, diagrams, files and links. Read before building anything beyond a title, a visual and a few words.
---

# Card authoring

Boards are retired: everything that used to be a board is now a card. Old boards on a canvas still show and can be read; new work is a card.

**One screen**

- A card is read in about ten seconds. One idea, the title is the finding as a sentence, one main
  visual (diagram, chart, table, or two to four large numbers), about 120 words, five blocks at most.
- No section headings (Summary, Method, Next), no background, no recap. About 1000 by 700 or smaller.
  What does not fit is cut; a real second idea is a second card, linked with `<a href="../other/index.html">`.
- Body text 17px or larger, nothing under 14px, the title on one or two full-width lines.
- Say each thing once. The title carries the finding and its number, so the body does not restate them: it shows what stands behind them. If the title already has the headline number, the large figures under it are other numbers. A caption never repeats a label, and a detail view never repeats the row that opened it. Write for a smart reader from outside the project. The first time a term of art, an abbreviation or an internal name appears (a KV cache, a t value, a file or variable name, an arm of an experiment), either replace it with plain words or say in a few words what it is. A statistic says how to read it, for example "t 2.3, where above 2 is unlikely to be chance". Before you finish, reread the card as someone who has never seen this project or paper: every name that came from its files (an arm, a scheme, a clause, a metric, a model's nickname, a statistic) is either replaced by what it does or explained once. The cheapest way costs no space: give the term a dotted underline and put its meaning in a hover or tap note, `<abbr title="what it means, in plain words">term</abbr>` with `abbr { text-decoration: underline dotted; cursor: help }`. A chart labels both axes with their units and says in its own title what to see in it; small multiples each carry their scale.
- Plain words, no em dashes. Every axis, column and number says what it measures, with its unit.

**Depth behind a click**

- Depth goes behind a click, not below the fold.
  At rest the card shows the finding and its one visual.
  What a reader may want next (the numbers behind a bar, the method, the runner-up, a definition, the second paper) is one click or hover away on the same screen: tabs, a row that opens its detail in a fixed panel, a toggle between two views, a value on hover, a filter on a table. Swap content in place rather than appending it, so an opened card is still one screen, and give each hidden view about the same word budget as the resting one. Controls are real <button> elements, look pressable, work offline, and the card makes sense before anything is pressed. Never hide the finding itself. If the person asked for several parts (say the claim, the method, the result and why it matters), none is dropped: the finding is what shows at rest and each other part is a view one click away.
- **A card does not grow.** It is as tall as its box on the canvas, which `decks canvas fit` sets.
  A panel that opens must open into space the card already reserves (a fixed height and
  `overflow: auto`), or over the content; anything taller is cut at the card's foot.
- A pattern that works: a table whose rows are buttons, and one detail panel of fixed height beside
  or under it that shows the chosen row. Another: two or three tabs over one chart area.
- When the person asks for something to use as it stands (a message to send, a section of a protocol, a full list, code), the card holds that thing in full and nothing else. The one-screen rule limits what you add, not what they asked for.

**One format: a piece you design, in a folder of its own**

- A card is a folder, `canvases/<canvas>/cards/<name>/`, and the card is its `index.html`.
  `decks card create --title …` makes the folder and writes the start of one: a `<title>`, a
  `<meta name="card" content='{"w":1000}'>`, a `<style>`, one block `<div class="doc" data-id="doc">`
  and a module. Write everything inside that `.doc`, top to bottom. Lay it out with normal CSS:
  flexbox and grid for columns and rows.
- **A piece, not a page.** No `<!doctype>`, `<html>`, `<head>` or `<body>`: the card is drawn straight
  into the canvas's own page, inside a shadow root of its own, so its styles reach nothing else and
  nothing else's reach it. Write selectors for your own classes (`.phases .phase`); `.doc` is the
  card's block.
- **Nothing is placed by coordinates.** No `position: absolute` blocks, no `left` and `top`, no pixel
  grid. The content flows, and its order in the file is its order on the card.
- The width comes from `<meta name="card">` (`"w"`). The height is the card's box on the canvas:
  `decks canvas fit <path>` measures the content and sets it.
- The tokens follow the app's light and dark mode: `--b-fg --b-muted --b-faint --b-bg --b-bg-deep
  --b-bg-layer --b-border --b-border-strong --b-accent --b-accent-soft --b-ok --b-warn --b-danger
  --b-radius --b-font --b-mono`. Never hardcode a colour the tokens cover.
- **What the card keeps beside it goes in its folder**: `card.css` (`<link rel="stylesheet"
  href="card.css">`), `chart.js` (`import { draw } from "./chart.js"`), `data.json`
  (`fetch(card.file("data.json"))`), `pics/q3.png` (`<img src="pics/q3.png">`). Every address in a
  card is read from the card's folder. Edit any file in it and the open card picks the change up.
- Patterns that work: a highlighted row in a comparison table; before and after side by side; a
  sequence diagram with three lifelines; a row of large numbers with a one-line label each; one
  chart with a labelled axis and the winning series in the accent colour.
- Then `decks canvas insert --type card --card <path> --beside <id or path>` (or `--below`,
  `--at.x1 --at.y1`) puts it on your canvas, and `decks canvas fit <path>` sizes it. `fit` reports the
  height, the word count, the smallest type and any content wider than the card. Fix what it says is
  over; when it says "One screen", stop.

**Scripts: modules handed the card**

- A `<script type="module">` in a card exports one function, and it is called with the card each
  time the card wakes (it sleeps when panned far away):

  ```html
  <script type="module">
  	import * as d3 from "d3";
  	import { draw } from "./chart.js";
  	export default async function (card) {
  		const data = await (await fetch(card.file("data.json"), { signal: card.signal })).json();
  		draw(card.root.getElementById("chart"), data);
  		card.root.querySelector("#reset").addEventListener("click", () => draw(…), { signal: card.signal });
  		const timer = setInterval(tick, 1000);
  		return () => clearInterval(timer); // when it sleeps
  	}
  </script>
  ```

- **`card.root` is what `document` is to a page**: `querySelector`, `querySelectorAll`,
  `getElementById`. `document` and `window` are the app's own page, shared by every card: never
  query, listen on or write to them. A key listener goes on an element of the card.
- `card.signal` is aborted when the card sleeps: pass it to every `addEventListener` and `fetch`.
  Return a function to stop anything else you started (a timer, an animation frame).
- `card.file(name)` is a file's address in the card's folder; `card.url` is the card's own.
  `card.theme` is "light" or "dark", and `card.on("theme", draw)` hears it change, as
  `card.on("size", …)` hears its box change. `card.store` keeps a little data of the card's own
  (`getItem`, `setItem`). `card.elements` defines custom elements for this card alone.
- The top of a module runs once for every placement of the card; what belongs to one card's view
  lives inside the function.

**Libraries**

- Import by name, with no import map to write: `d3`, `chart.js`, `three` (and `three/addons/…`) and
  `gsap`. Every card on the page shares one copy. A library the deck uses often is named in the deck's
  `assets/importmap.json` (`{ "imports": { "name": "./libs/name.js" } }`, an address relative to
  `assets/` or an https one), and is then imported by that name too.
- Anything else is a module in the card's folder, or a full https address. Unsure of an API? Download
  the file and read it: `curl -s <url>` works, and `cdn.jsdelivr.net/npm/<package>@<version>/` serves
  the whole package.

**Names and building blocks**

- **`data-id` is an optional name.** Put one on a block a person may want to comment on, or that
  you may want to point at later (`data-id="auth-flow"`). Short, stable and meaningful.
- **Ready-made boxes:** `.card` (a box; the name is old), `.sticky`, `.text`, and
  `.callout[data-tone="warn|danger|ok"]`; `.kpi`, `.table` and `.chip`. They nest and flow like any
  other element.
- **Markdown, maths & Mermaid:** `data-md` on a block is drawn as markdown (with KaTeX via `$..$` /
  `$$..$$`), `$…$` in the `.doc` itself is drawn as maths, and `data-mermaid` is drawn as a diagram
  (give it a height). Code in `<pre><code class="language-ts">` is coloured with the `--b-code-*`
  tokens; with no language it is drawn plain.

**Visuals, diagrams, files**

- **Custom SVG diagrams:** an `<svg>` with a `viewBox` and `width="100%"`, so it scales with the
  card. Inside it, use even coordinates, orthogonal elbow paths (`M... H... V...`), explicit
  arrowhead offsets, and CSS variable styling.
- **Pictures and video** are `<img>` and `<video>` of a file in the card's folder, the canvas's
  `files/` (`../../files/clip.mp4`) or the deck's `assets/` (`../../assets/photo.png`). A PDF, or a file
  the person should see whole, goes on the canvas itself as a drawn file, beside the card.
- **A document to write in is a document item, not a card.** A `.md`, `.tex` or `.docx` the person
  will type into is still made as a small page holding one box,
  `<div class="live" data-id="doc" data-live="doc" data-path="../papers/paper.md"></div>`, which fills
  it (the path relative to that page), at about 1000 by 1100. The file is edited where it is: every
  keystroke goes to it, and its history and review are kept apart in `docs/<name>/`, which is not yours
  to write. Edit the file itself with your own tools: your edit lands at once, highlighted on the
  words you changed, and the person accepts or rejects it. A Google Doc opens the same way from its
  link; edit it with `gdocs_read` and `gdocs_edit`, never by writing the mirror in `docs/`.
- **Title: the finding, not the topic.** The title comes from `decks card create --title`. Write it as
  a statement ("Returning customer share fell after the second tab shipped"), never a question.
- **A plot says what it shows, and what its axes are.** Give it a title of its own, both axes, a tick
  value on each, and a title on each saying what it counts and in what unit ("share of visits,
  percent"). A chart without them shows a shape and makes no claim.
- **Copy: plain words and short sentences, no em dashes.** A card is read once, by somebody deciding
  something, so a sentence they have to read twice is a sentence that did not earn its place.

**Links and buttons**

- **A card link opens a card, anything else opens a tab.** Link to another card by its `index.html`,
  relative to this one: `<a href="../risks/index.html">the risks card</a>`. Clicking it puts that card
  on the canvas beside this one. Every other link opens in a new tab of its own, never in place of the
  app, so a claim can cite its source with `href="https://…"`.
- **A button acts through `card.decks`, wired in the card's module.** The calls are the `decks`
  command's, by group and name, answering a promise: a decision is a button whose listener calls
  `await card.decks.agent.send("<your name>", { task: "Option A", boards: [card.path] })`. The view,
  `here` and `now` are answered at once; the canvas's own calls (`canvas.*`, `card.*`, `frame.create`,
  `file.url`) change this canvas as the person; `agent.*` and `view.goto` go through the app, which
  asks the person before a card's message reaches an agent; anything else (apps, the shared tab,
  another canvas) is refused. There are no `data-eval` blocks in a card.
