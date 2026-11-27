---
name: canvas-authoring
description: A canvas is a native pen.dev .pen file — its cards, and notes, text, shapes, icons, arrows and frames around them. The item types and fields, canvas calls and boxes, beside and below, canvases, and patterns for arranging cards. Read before your first decks canvas insert or batch.
---

# Drawing on the stage

Your stage is one file, `canvases/<name>/canvas.pen`, in **pen.dev's own format**: it opens in pen.dev
as it is, and every type and field here is pen's, untranslated. It holds two kinds of thing.

- **Cards**: the HTML pieces you write (the card-authoring skill), each a folder in the canvas's own
  `canvases/<name>/cards/`, the card being its `index.html`. In the file each one is a pen `browser`
  item pointing at it, tagged `metadata: { type: "decks.card", path: "cards/<name>/index.html" }` — the
  path is the canvas's own folder's, so the folder stands alone and can be shared whole. Every canvas
  call reads and writes it as **`{ type: "card", card: "canvases/<name>/cards/<card>/index.html" }`**,
  its path in the deck, and takes a card's path wherever it takes an item's id. Make it with
  `decks.card.create({ title, canvas })` (it goes in that canvas's `cards/`), then place it with
  `decks.canvas.insert({ type: "card", card: path }, { beside })`; `canvas.move`, `canvas.update`
  (`{ size: { w, h } }`) and `canvas.delete` (the folder stays) do the rest, or put it inside a frame.
- **Apps and documents** are items with no file of their own: `{ type: "app", app: "<name>" }` shows an
  app from `apps/` (`decks apps list`), and `{ type: "document", path: "canvases/<canvas>/files/notes.md" }`
  opens a document as a page the person types into. A document's `path` names the file **as the deck
  does, from the deck's root** (`canvases/<canvas>/files/<name>.md` for a file of the canvas's own,
  `docs/<name>.md` for the deck's): never an absolute path, never from the canvas's folder. A file not
  there yet is made empty in the canvas's `files/` when the item is placed, so the person can type into
  it at once. Place them with `decks.canvas.insert` like a card; they read back as `browser` items
  tagged `decks.app` and `decks.document`.
- **A link** points at something in the deck without showing it: `{ type: "link", to, open? }` is a
  small chip, the kind's mark and the target's name, that the person presses to go there. `to` is
  what `decks view open` takes (a canvas's name or title, a card's or a document's path, an app's
  name), **any item's id on the canvas you are writing** (a note, a frame, a diagram), or an address:
  `#canvas/<name>`, `#card/<path>`, `#doc/<path>`, `#app/<name>`, `#item/<canvas>/<id>` for an item
  on another canvas. `open` is how it opens: `"canvas"`, the view flies to the item (on its own
  canvas when that is another), or `"tab"`, a tab of its own. Leave it out and a card or an item
  opens on the canvas, a canvas, a document or an app in a tab. ⌘ or Ctrl and a click always opens a
  tab, whatever you set. It reads back as `{ type: "link", to, open, title }`, and `title` gives it
  words of your own. The same address works as a link in words, with `?open=canvas` or `?open=tab`
  after it when you want to say: `[the risks](#item/launch/risk-note)` in a note, a text or a
  markdown card. A chip follows a canvas that is renamed, and is dimmed when its canvas is deleted;
  change where one points with `canvas.replace`. Links are how a canvas hangs together: see
  "Organize a canvas".
- **The drawing**: notes, text, shapes, icons, arrows and frames. Use it for what sits *between*
  cards — a note beside one, an arrow from one to the next, an outline round a group. Put an
  answer on a card; put the arrangement around it here.

**Order decides what covers what.** A drawn item after a card in the file is shown over it, and one
before it is hidden behind it, so a note placed on a card covers that part of it, and a filled frame
laid over a group of cards hides them. To mark out a group, give the frame a stroke and no fill. The
person can use a card everywhere nothing is drawn over it, and not where something is. So keep notes
beside a card rather than on it, unless covering part of it is the point.

The person can move, delete and rewrite drawn items by hand, so read before you edit:
the file may have changed since you last looked.

The examples below are a node script, where `const { decks } = await import(process.env.DECKS_SDK)`
gives every call as a function; a big edit reads best that way. The same calls are commands in
bash: `decks canvas read`, `decks canvas insert '{…}' --beside <id>`, `decks canvas batch '[…]'`
(or `… | decks canvas batch -` from a file), `decks view focus <id>`.

## Canvases

Every canvas call takes `{ canvas }` last: a canvas's folder name or its title. **An agent has no
home canvas, so it is never left out**: a call that names none is refused. Your work lands on the
canvas you name, while the person looks wherever they like. Choose it when a piece of work starts,
and keep to it:

```ts
const here = (await decks.here()).name;        // the canvas the person has open beside your chat
await decks.canvas.list();                     // every canvas: { name, title, open: [agents], cards }
await decks.canvas.create("Launch plan");      // a new, empty canvas; nobody's camera moves to it
await decks.canvas.read({ canvas: here });     // every call names its canvas
await decks.view.goto("deploy");               // put your chat's camera on a canvas
```

In the examples below a call that shows no `{ canvas }` has it left out for room: yours names one.

What you have in place of a home is a camera: the tab the person sees beside your chat. `view.goto`
puts it on a canvas: when your chat is the one on screen, the screen goes there; in the background
it just moves, and the person sees that canvas when they open your chat; while they are using the
canvas they get a button instead, and nothing moves until they press it (`moved: false`, with a
note). `view.focus` on a card goes to the card's canvas first by the same rule, and `view.open`
opens a canvas, a card, a document or an app whole, as a tab. None of them changes where your
calls act.

Two agents naming one canvas share its cards and its drawing. Make a new canvas for a new piece
of work; name an old one to continue it.

**A friend's canvas.** A canvas shared with you through Decks Studio is named `shared/<owner>/<canvas>`
(`canvas.list` gives `shared: { owner, role }`) and lives in `shared/canvases/<owner>/<canvas>/`, the
same shape as yours. What the share lets you do is its `role`:

- `edit`: change it as your own, and everything goes into **its** folder, which syncs back to its
  owner and everyone else it is shared with: a card you make (`card.create({ canvas })`) goes in its
  `cards/`, a picture or file in its `files/` (the person's drops do this; from a script,
  `decks.upload(file, { canvas })`, or write the file into its `files/` yourself), named in its
  drawing as `files/<name>`. Never put what it uses in this deck's `assets/`: the owner would not get it.
- `view`: it follows its owner's copy, and every call that would change it refuses. To change it,
  make your own copy: `decks.canvas.copyShared({ canvas: "shared/ada/plan" })` copies its drawing,
  cards, frames and files into a new `canvases/copy-of-…/` of yours (its owner's deck files go in the
  copy's `files/`, links re-pointed), titled "Copy of …". The copy syncs as your canvas and never
  changes theirs; an app in it stays a picture, since the app runs on its owner's harness.

To bring a few items from one canvas to another with their files (a card's folder, pictures), not
the whole canvas: `decks.canvas.clip(ids, { canvas: from, id })` then
`decks.canvas.paste({ id, canvas: from }, { canvas: to, at })`, which is what the person's ⌘C and ⌘V do.

## The calls

```ts
const { items } = await decks.canvas.read();          // every item as saved, plus its box
await decks.canvas.insert(item, { beside: plan });           // plan: a card's path; or { below }, { at }, { parent }
await decks.canvas.update("check", { set: { content: "Done" } }); // fields, { at }, { size }
await decks.canvas.move("check", { below: plan });
await decks.canvas.delete("check");
await decks.canvas.batch([ /* ops */ ]);              // applied together, or not at all
const file = await decks.canvas.file();               // "canvases/<name>/canvas.pen", to edit by hand
```

- `read()` returns `{ canvas, title, version, variables?, themes?, items }`. Each item is exactly
  what the file holds, plus **`box: { x1, y1, x2, y2 }`**: where it is on the canvas; a card reads
  as `{ type: "card", card, title, width, height, box }`. An instance (`type: "ref"`) also lists
  `inside`, the items in its copy with their id paths and boxes.
- **`beside` and `below`** take an item's id or a card's path and aim the item 160 px clear of
  that item's box: `beside` to its right with the tops aligned, `below` under it with the lefts
  aligned. When that spot is taken it goes on the same way, right or down, until it is 160 px
  clear of everything, and a warning says so. They work for any item, a note under a card or a card
  beside a note. With no place given it aims beside the newest item and goes on right the same
  way. **`at`** is kept exactly, even over something; a warning names what it covers. Every time an item lands anywhere but where you asked, the answer starts a note with "Warning:": read it.
- Each call answers with the item as it now is, box included; `batch` with one per op. A note says
  what happened that you did not ask for (a size the layout overrode, a place chosen because you
  gave none). If any op of a batch fails, none is saved, and the error names the op and why.
- `batch` takes each op as the call of that name with its item or id inside —
  `{ op: "insert", item, beside }`, `{ op: "update", id, set }`, `{ op: "move", id, below }`,
  `{ op: "delete", id }` — and pen.dev's own form below (`node`, `box`) too, so a later op can be
  beside an item an earlier one made.
- Hand edits work too: keep it valid JSON, keep ids unique and free of `/`. A file that stops
  parsing is reported by `read()`, and the canvas keeps the last good version until you fix it.

## Boxes, not sums

Every position you read is a box with both corners, and every position you write can be one:

```ts
await decks.canvas.batch([
  { op: "insert", node: { type: "note", id: "check", content: "Check the margin" }, box: { x1: 1060, y1: 0, x2: 1300, y2: 120 } },
]);
```

The server turns the box into pen's own numbers — `x` and `y` from the parent's corner, `width`,
`height` — against wherever the parent really is. Give `x1, y1` alone to move without resizing.
`decks.canvas.read()` gives each card a `box` too, so a note 40 px beside a card is
`{ x1: card.box.x2 + 40, y1: card.box.y1, … }`; `beside` is the same at 160 px. Inside a frame that lays out its children (a row
or a column), the frame decides where they go, so only the size is taken from a box.

## Edits

```ts
{ op: "insert",  node: { type, id?, ... }, parent?: frameId, index?, box? }  // id made up if left out
{ op: "update",  id, set: { field: value, gone: null }, box? }               // null removes a field
{ op: "replace", id, node }                                                  // the whole item
{ op: "delete",  id }
{ op: "move",    id, parent?: frameId | null, index?, box? }                 // null is the top level
{ op: "copy",    id, parent?, index?, box?, as?: newId }
{ op: "variables", set: { name: { type: "color", value } | null }, themes? }
```

Ids are short words you choose (`"check"`, `"draft-arrow"`): you will use them in later edits.
Children are changed with insert, move and delete, never through `update`. An item inside an
instance is updated by its id path, `"card-1/label"`, and the change is kept in the instance's
`descendants`.

## The items

To design a screen, a page or a slide, read the canvas-design skill; its `schema.md` lists every
item type and field with its values.

Every item has `type` and `id`, and may have `name`, `x`, `y`, `width`, `height`, `opacity` (0–1),
`rotation` (degrees, counter-clockwise), `enabled: false` (hidden), and `metadata` (anything pen has
no field for: `{ type: "…", … }`).

| type | what it is | its own fields |
|---|---|---|
| `note` | a sticky note | `content`; `fill` for its colour; `width` (240 when left out); height follows the words |
| `frame` + `metadata: { type: "decks.card" }` | a **card**: white, with an edge, a column of markdown blocks and pictures (see Cards) | `layout: "vertical"`, `gap: 16`, `padding: 20`, `width` (320 reads well), `children`; height follows what it holds |
| `text` + `metadata: { type: "decks.markdown" }` | words in markdown: a block of a card, or on their own as the text tool makes them | `content`, `fontSize`, `textGrowth: "fixed-width"`, `width` (`"fill_container"` in a card) |
| `text` | words on the stage | `content`, `fontSize`, `fontWeight` ("400"…"700"), `fontFamily`, `textAlign`, `lineHeight` (× size), `fill` (the colour), `textGrowth` |
| `rectangle` | a box | `fill`, `stroke`, `strokeWidth`, `cornerRadius` |
| `ellipse` | a circle or oval, in its box | `fill`, `stroke`; `innerRadius` 0–1 for a ring; `startAngle`, `sweepAngle` for an arc |
| `polygon` | a regular polygon in its box | `polygonCount`, `fill`, `stroke`, `cornerRadius` |
| `path` | any line or outline | `geometry` (an SVG path), `viewBox`, `fill`, `stroke`, `strokeWidth`, `strokeLinecap`, `fillRule` |
| `frame` | a container, with layout | `children`, `layout`, `gap`, `padding`, `justifyContent`, `alignItems`, `clip`, `fill`, `stroke`, `cornerRadius` |
| `group` | a container, no layout: its box is its children's | `children` |
| `ref` | a copy of a `reusable: true` item | `ref` (the item's id), `descendants`, and any field to lay over the copy |
| `icon` | an icon from a library | `library` (`"lucide"`, `"feather"`, `"phosphor"`, `"Material Symbols Outlined"` / `"Rounded"` / `"Sharp"`), `icon` (its name there, e.g. `"rocket"`), `fill` (its colour), `weight` 100–700; 24 by 24 unless sized |
| `browser` | a card (see above), an app or a document | `url`, `metadata: { type: "decks.card", path }` — read and written as `{ type: "card", card }` through the canvas calls; an app `metadata: { type: "decks.app", name }` and a document `metadata: { type: "decks.document", path }`, inserted as `{ type: "app", app }` and `{ type: "document", path }`; its frame is pen's own `cornerRadius`, `stroke`, `strokeWidth`, `strokeAlignment`, `strokeDash` and `effect` (12 px corner and the canvas's 1 px outline when left out) |
| `frame` + `metadata: { type: "decks.link", to }` | a **link chip** (see above): a pill that goes to a canvas, a card, a document, an app or any item, on the canvas or in a tab | read and written as `{ type: "link", to, open, title }` through the canvas calls; in the file a mark, a `text` and an arrow, the opening in the address after `?open=` |
| `frame` + `metadata: { type: "decks.shape", kind }` | a **shape** from the library, with words in it (see Shapes) | its outline is its first `path` child, its words a `text` child |

Any item with a line can draw it in dashes or dots: `strokeDash: "dashed"` or `"dotted"` (ours;
pen.dev draws the line solid).

**Text.** `textGrowth` decides the size: `"auto"` (the default) is one line as long as the words,
and ignores `width`; `"fixed-width"` wraps at `width` and grows down; `"fixed-width-height"` is the
box you give it. A text given a box with a width is switched to `"fixed-width"` for you. Write
text at 18 or larger: the stage is read zoomed out.

**Cards.** A card is the drawing's way to say something with structure: a heading, a few points,
a table, a link. Its words are **Obsidian's markdown**, so a card opens as it is in Obsidian:
headings `#` to `######`, lists (nested, numbered, `- [ ]` / `- [x]` tasks), `>` quotes, callouts
(`> [!note] A title`, and Obsidian's other types: `tip`, `warning`, `danger`, `example`, `quote`…),
fenced code with its language coloured (` ```ts `), tables with `:--:` alignment, `---` rules,
footnotes (`[^1]` and `[^1]: …`), and inside a line `**bold**`, `*italic*`, `~~struck~~`,
`` `code` ``, `==highlighted==` (or in a colour: `==🔴…==` `==🟠…==` `==🟡…==` `==🟢…==` `==🔵…==`
`==🟣…==`), `[words](url)` (a web address, or something in the deck by its address: `[the budget](#app/budget)`), `[[a note]]`, bare `https://` links and `:emoji:` shortcodes. A picture is
`![alt](url)` or `![alt|240](url)` for its width (a path beside the stage file or a web address); a
file shown where it sits is `![[name.pdf]]` on its own line. `%%hidden%%` is a comment nobody sees
on the canvas.

Two things Obsidian has no word for are ours; Obsidian shows them as the words typed, and an export to Obsidian takes the styles out:

- **Styled words**: `[not flexible]{.red}`, in `red`, `orange`, `yellow`, `green`, `blue` or `purple`;
  a size, `.small`, `.large` or `.huge`; a font, `font="Lora"` (any family on Fontsource; `.serif` and `.mono`
  for short); several at once, `[words]{.large font="EB Garamond"}`.
  Underline is `<u>words</u>`, which Obsidian draws too.
- **Suggestions**, in CriticMarkup. To propose a change to a card the person wrote, write it as a
  suggestion rather than overwriting their words: `{~~old words~>new words~~}` to replace,
  `{++added++}` to add, `{--removed--}` to take out, each followed by `{>>why<<}` if there is a
  reason. The card draws it struck through and in blue, and the person accepts or rejects it with
  ✓ or ✕ when they open the card. Your own card you can simply edit.

**A card is a frame**, a column whose children are its blocks: each heading, paragraph, list,
callout or table a `text` holding that block's markdown, and each picture pen's own rectangle filled
with the image. So a picture dragged onto a card drops between two lines, a picture dragged off it
leaves, and pen.dev opens the card as a column with its pictures in it. Write one block per text;
one text holding several blocks also works, and is split into blocks the first time someone edits it.

```ts
const block = (id, content) => ({ type: "text", id, content, fontSize: 16, textGrowth: "fixed-width", width: "fill_container", metadata: { type: "decks.markdown" } });
{ op: "insert", node: { type: "frame", id: "plan", name: "Next", layout: "vertical", gap: 16, padding: 20, cornerRadius: 12,
  metadata: { type: "decks.card" }, children: [
    block("plan-h", "## Next"),
    block("plan-l", "- Cut the **pilot** to 20 questions\n- Ask [Verasight](https://verasight.io) for a quote"),
    { type: "rectangle", id: "plan-p", name: "Gate", width: 280, height: 158, cornerRadius: 6, fill: { type: "image", url: "./gate.jpg", mode: "fill" } },
  ] },
  box: { x1: 1060, y1: 0, x2: 1380 } }
```

To change one block, `update` that text's `content`; to add one, `insert` with `parent: "plan"` and
an `index`. A person follows a card's link with a click, and types into the whole card as it reads.
A note with `metadata: { type: "decks.markdown" }` is a card from before: it is still drawn, and
becomes a frame when someone edits it. Use a plain `note` for one line; a card when there is a
heading or a list. Keep it short: a note is read on the canvas, and a long document is a card or a document.

**Colour.** `fill` and `stroke` take `"#RRGGBB"` or `"#RRGGBBAA"`, a variable `"$name"`, or a list
of fills drawn in order (`{ type: "color", color }`, `{ type: "gradient", gradientType: "linear",
colors: [{ color, position }], rotation }`, `{ type: "image", url: "./pic.png", mode: "fill" }`).
The stage is light or dark with the app, and a hex is the same in both, so **use Decks's
adaptive colours**, `$decks-<role>`: text for words (`"$decks-text"`), line for arrows and edges
(`"$decks-line"`), surface for paper (`"$decks-surface"`), fill for areas (`"$decks-fill-blue"`),
accent for emphasis (`"$decks-accent-red"`). An edit defines any it uses. Your own colour:
`decks canvas variables '{"brand":{"light":"#4f46e5","dark":"#818cf8"}}'`. The table is in [colors.md](colors.md).

**Stroke.** `stroke` is a colour (or fills), `strokeWidth` a number or `{ top, right, bottom, left }`,
`strokeAlignment` `"inner" | "center" | "outer"`, `strokeLinecap` `"butt" | "round" | "square"`.

**Layout.** A frame lays its children in a **row by default**; `layout: "vertical"` is a column and
`layout: "none"` lets each child sit at its own `x`, `y`. `gap` is the space between, `padding` a
number or `[vertical, horizontal]` or `[top, right, bottom, left]`, `justifyContent` `"start" |
"center" | "end" | "space_between" | "space_around"`, `alignItems` `"start" | "center" | "end"`.
A width or height is a number, `"fit_content"` (hug the children; a frame's default),
`"fit_content(120)"` (hug them, but never less than 120) or `"fill_container"` (take the room the
parent has left). A frame you insert with a `box` hugs what it holds, and the box's height is its floor;
give a plain number in `height` only when it should stay that tall whatever it holds. A child with `layoutPosition: "absolute"`
leaves the layout and sits at its own `x`, `y`. Want five notes in a tidy column? A frame with
`layout: "vertical", gap: 16` and the notes inside: no coordinates at all.

**Reuse.** Mark an item `reusable: true` and place copies with `{ type: "ref", ref: "<its id>" }`.
Change the original and every copy follows. `descendants: { "<child id>": { content: "…" } }`
overrides inside a copy; an override with a `type` replaces that child whole. A frame inside the
reusable item marked `slot: ["<item id>", …]` is a place for content: a copy fills it with
`descendants: { "<slot id>": { children: [ … ] } }`, refs included.

**Saved frames.** A frame worth using again goes in your canvas's own `frames/` folder
(`canvases/<name>/frames/`), as its cards go in its `cards/`, in folders if you like; a frame from the
deck's old `frames/` placed on a canvas is copied in. Two ways in:

- `decks.frame.create("frames/ui/agent-card", { type: "frame", layout: "vertical", children: [ … ] })` makes
  `frames/ui/agent-card.pen` with that frame as its one reusable item;
- `decks.canvas.save("<item id>", "frames/ui/agent-card")` saves something already on your stage there, and
  puts a ref to it where the item was.

Your canvas places it with `{ type: "ref", ref: "frames/ui/agent-card" }` and its own `descendants`,
with nothing to declare. To change the frame itself, give the canvas item calls `{ frame }` in place of
`{ canvas }`: `decks.canvas.read({ frame: "frames/ui/agent-card" })`, then `insert`, `update`, `replace`,
`delete`, `move`, `copy`, `variables` or `batch` with the same items, as in
`decks.canvas.update("title", { set: { content: "Agent" } }, { frame: "frames/ui/agent-card" })`
(`decks canvas update title --set.content Agent --frame frames/ui/agent-card`). Every canvas placing it
shows the change. A frame holds drawn items, never a card, and a call names a canvas or a frame, not both.

Items can also come from any other `.pen` file: `"imports": { "kit": "../../kit.pen" }` at the top of
the stage file names it (relative to the stage file, inside the deck), and `ref: "kit:<id>"` places a
copy; that file's variables come with it.

## Shapes

A diamond, a cylinder, a speech bubble: the person picks these from a library of 32, and you make
the same ones. A shape is a `frame` marked `decks.shape` that holds its outline, a `path` drawn in a
100 by 100 box, and, for words in it, a `text`. The frame is what is selected, moved and sized;
**the outline follows the frame's size by itself after every edit**, so size the frame and leave
the path's box alone. Fill and line go on the outline.

```ts
{ op: "insert", box: { x1: 400, y1: 0, x2: 560, y2: 120 }, node: {
  type: "frame", id: "check", name: "Decision", layout: "vertical", justifyContent: "center",
  alignItems: "center", padding: 10, clip: false, metadata: { type: "decks.shape", kind: "Decision" },
  children: [
    { type: "path", id: "check-o", layoutPosition: "absolute", x: 0, y: 0, viewBox: [0, 0, 100, 100],
      geometry: "M50 0L100 50L50 100L0 50Z", fill: "$decks-surface", stroke: "$decks-line-strong", strokeWidth: 1.5, strokeAlignment: "center" },
    { type: "text", id: "check-t", content: "Signed in?", fontSize: 14, fontWeight: 500,
      textAlign: "center", textGrowth: "fixed-width", width: "fill_container", fill: "$decks-text" },
  ] } }
```

The kinds and their outlines (`kind` is the name; each geometry in a 100 by 100 box):

- **Basic:** Rectangle `M0 0H100V100H0Z`, Rounded, Ellipse `M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z`,
  Triangle `M50 0L100 100H0Z`, Diamond `M50 0L100 50L50 100L0 50Z`, Pentagon, Hexagon
  `M25 0H75L100 50L75 100H25L0 50Z`, Octagon, Star, Parallelogram `M22 0H100L78 100H0Z`, Trapezoid,
  Plus, Ring, Heart.
- **Flowchart:** Process (a rectangle), Decision (a diamond), Terminator
  `M22 0H78A22 50 0 0 1 78 100H22A22 50 0 0 1 22 0Z`, Document `M0 0H100V82C75 66 25 100 0 82Z`, Data
  (a parallelogram), Database `M0 14A50 14 0 0 1 100 14V86A50 14 0 0 1 0 86ZM0 14A50 14 0 0 0 100 14`,
  Manual input, Predefined, Delay, Off-page, Preparation, Card.
- **Arrows and callouts:** Arrow right, Arrow both, Chevron, Speech, Cloud, Brace (a line, no fill).

A geometry you write yourself works too: any SVG path in the 100 by 100 box, with the `kind` you
choose; the person's panel then shows its kind as it is, and can swap it for one of the library's.

## Arrows

pen has no arrow type: an arrow is a `path` whose `metadata` says what it joins. Give the ends and
nothing else — the server draws the line and its head between the facing edges, and **redraws it
whenever either end moves**, a card included:

```ts
await decks.canvas.batch([
  { op: "insert", node: { type: "path", id: "then", metadata: { type: "decks.arrow", from: draft, to: final } } },
]);
```

`from` and `to` are an item's id, a card's path, or a point on the stage as `[x, y]`: an end
that stops on bare canvas, which the person makes by letting an arrow go there. An end can also
keep to one side of what it joins — `{ item: "check", side: "right" }`, with `"top"`, `"right"`,
`"bottom"` or `"left"` — and then leaves the middle of that side, square to it, however things
move; a flowchart reads best that way (out of a decision's right and bottom, into the next box's
top or left). A sided end can sit elsewhere on its side with `at`, from 0 (the side's top or left
end) to 1: `{ item: "check", side: "right", at: 0.25 }`. An end with no side meets whichever edge
faces the other end. A point end stays
where it is on the stage, so to move such an arrow shift its points in `metadata` along with its
`x` and `y`, or the next redraw puts it back.

Its style is three more `metadata` fields, each optional: `route` is `"straight"` (the default),
`"curved"` (leaves and arrives square to the two edges) or `"elbow"` (right angles); `heads` is
`"end"` (the default), `"both"` or `"none"`, for a plain connector; and `dash: true` dashes the
line. `bend` moves an arrow off its automatic route and is kept when things move: on an elbow, where
its turn sits from start (0) to end (1), `bend: 0.3`; on a curve, how far its middle is pulled in
stage pixels, `bend: [0, -40]`. Change one with `{ op: "update", id, set: { metadata: { ...its metadata, route: "curved" } } }`;
the path is redrawn for you. Set `stroke` and `strokeWidth` if you want a colour or weight other
than the grey default (`$decks-line`). Words on the line — "yes", "no", "then" — are `label` in its metadata,
drawn on the middle of the line.

## Look at it

`decks.canvas.screenshot()` takes a picture of your canvas as the person sees it, cards and drawing
together, and hands it to you in the call's result. Check with it after a big change: text that
overflows a note, an arrow that crosses a card, a frame that clips what is in it are plain in a
picture and invisible in `read()`.

**Point the person's camera at one item** with `decks.view.focus`: an item's id or a card's path,
and the screen flies to it. Nothing on the canvas changes, and naming an item and a card together
frames both. It is the only thing that moves the person's view; nothing else does.

```ts
await decks.view.focus("summary");                          // look at this note
await decks.view.focus([plan, "summary"]);                  // the card and the note beside it
```

The person can drag an item **into the composer** to talk about it, and it arrives in their
message as `@item:<id>` — the id to look up in `read()`.

```ts
await decks.canvas.screenshot();                               // the whole stage
await decks.canvas.screenshot({ of: "summary" });             // one item, with a margin
await decks.canvas.screenshot({ of: [plan, "then"] });
await decks.canvas.screenshot({ of: { x1: 0, y1: 0, x2: 1200, y2: 800 }, scale: 2 });
await decks.canvas.screenshot({ format: "pdf", to: "exports/plan.pdf" });   // a file to hand on
```

## Ink

What the person draws with the brush is on the stage too: one `path` per stroke, drawn as it
looks, with what was drawn in its `metadata`:

```json
{ "type": "path", "name": "Ink", "metadata": { "type": "decks.ink", "tool": "pen", "color": "red", "size": 4, "points": [12.5, 8, 0.5, …] } }
```

`points` are `x, y, pressure` triples from the path's own top-left corner, so its `box` is where
the stroke is. Read ink to see what the person circled, underlined or crossed out, and what it is
near. Leave it as they drew it: move or delete a stroke only when asked.

## Organize a canvas

A canvas has three kinds of area. An area is a place, not an object: a title in plain words and the
items by it. Nothing is tagged and no frame is needed; a frame or an outline the person draws is an
area too. The arrangement is the canvas's own (top to bottom, left to right, anything): read where
the areas are with `decks canvas read` and keep to it.

Nothing makes the areas for you: laying them out is your design work. When you start work on a
canvas that has none, place the titles yourself where they suit what the canvas is for (a title
`text` for To do and one for Working, with room by each, and a title per topic as topics come),
clear of what is already there (`decks canvas space`), and say in your answer what you set up. On a
canvas that already has things on it, ask before rearranging them.

- **To do** is the person's. Each note there is a to-do. At the start of a turn on the canvas, read
  them and say which you can take; start one when the person says so, not by yourself. When it is
  done, fade the note (`opacity: 0.5`) and put a link chip by it to the card or drawing that answers
  it. Leave the notes where they are: the person clears them.
- **Working** is shared by every agent, one row each, your row starting with your name. Put work in
  progress there and nowhere else: a progress card (card-authoring, progress.md: steps as goal or
  hypothesis, method and expect, and a log of what ran), a draft, a half-done diagram, each with a link chip to the topic it
  is for. When the work is finished, move it into its topic and take your
  row down to what is still going.
- **A topic** is everything about one subject: its title, then its cards, drawings and apps in
  reading order. Finished work goes into the topic it belongs to, `beside` or `below` the topic's
  last item, whichever way that topic runs; a new subject gets a new title clear of the other areas
  (`decks canvas space`). One subject, one area: two topics never share one.

### Finding a place for something new

Every card, drawing or app you add goes in an area, at the end of what is there, never at a corner
you guessed:

1. **Pick the area.** Unfinished: your row in Working. Finished: the topic it belongs to, or a new
   topic when no area is about it. A note or an arrow that explains one card belongs beside that card.
2. **Read the area.** `decks canvas read --depth 0` lists the top-level items with their boxes: find
   the area's title and the items by it, and see which way it runs (a row grows right, a column down).
3. **Continue it.** In a row, `--beside` its last item; to start the next row, `--below` the first
   item of the last row. In a column, `--below` its last item. A note about a card goes `--beside`
   that card, an arrow joins the two items it connects, a group outline goes round items already placed.
4. **A new topic** gets its title where the canvas grows: `decks canvas space` with `near` the last
   topic's title and the `side` the topics run to, then the title at that corner and its first item
   `--below` the title.
5. **Read the answer.** If it starts "Warning:", the spot you aimed at was taken and the item went on
   past what was in the way. Look at where it landed: still in its area, leave it; pushed into
   another area or far off, move it (`decks canvas move`) or make room by moving your own items.

Moving finished work from Working into its topic is the same: `decks canvas move <id> --beside
<the topic's last item>`, then close the gap in your Working row.

Links tie the areas together: a to-do links to its answer, a working item to its topic, and a topic
can link to another where they meet (`{ type: "link", to: "<item id>" }`). Never move the person's
things or another agent's out of their areas without asking. An older canvas with no areas is left
as it is until the person asks you to organize it; then move its things into topics, and say what
went where.

## Patterns

- **A note beside a card:** `decks.canvas.insert({ type: "note", content: "…" }, { beside: plan })`,
  or, closer than 160 px, read the card's `box` from `decks.canvas.read()` and insert with
  `at: { x1: box.x2 + 40, y1: box.y1 }`.
- **A titled area behind cards:** a `frame` with `layout: "none"`, a soft `fill`
  (`"#3b82f614"`), `cornerRadius: 16`, boxed 40 px outside the cards it gathers, and a `text`
  above its top edge. Insert it at `index: 0` so it paints first.
- **A flow:** cards left to right with `decks.arrow` paths between them; the arrows follow when
  a card is moved.
- **A flowchart:** `decks.shape` frames (a Terminator to start, Process boxes, Decision diamonds)
  in a column 60 to 80 apart, joined by arrows whose ends name their sides, with `label`s on the
  arrows out of each decision.
- **Cards in a row:** a frame with `gap: 80` and no size, then `move` each card's item into it:
  the frame lines them up, and keeps them lined up as they grow.
- **A labelled icon:** a row frame with `alignItems: "center"`, `gap: 8`, an `icon` and a `text`.
- **A checklist:** a vertical `frame` of `text` items; update each `content` as work lands.

Keep the drawing light: a handful of notes and arrows around the cards, not a second document.
The finding still goes on a card.
