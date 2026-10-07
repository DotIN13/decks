---
name: pen-stage
description: Your stage is a native pen.dev .pen file — its boards, and notes, text, shapes, icons, arrows and frames around them. The item types and fields, stage.pen.edit and boxes, moving between stages, and patterns for arranging boards. Read before your first stage.pen edit.
---

# Drawing on the stage

Your stage is one file, `stages/<name>/stage.pen`, in **pen.dev's own format**: it opens in pen.dev
as it is, and every type and field here is pen's, untranslated. It holds two kinds of thing.

- **Boards**: the HTML pages you write. Each one on the stage is a pen `browser` item pointing at
  its file, tagged `metadata: { type: "decks.board", path: "boards/…" }`. `stage.show`, `stage.hide`
  and `stage.move` add, remove and move them; you can also move them with `stage.pen.edit`, or put
  them inside a frame that lays them out. Never make a board by inserting a `browser` item: write it
  with `stage.newBoard` and show it.
- **The drawing**: notes, text, shapes, icons, arrows and frames. Use it for what sits *between*
  boards — a note beside one, an arrow from one to the next, an outline round a group. Put an
  answer on a board; put the arrangement around it here.

**Boards are at the back.** Every drawn item is shown over the boards, wherever it sits in the
file, so a note placed on a board covers that part of it, and a filled frame round a group of
boards hides them. To mark out a group, give the frame a stroke and no fill. The person can use a
board everywhere nothing is drawn over it, and not where something is. So keep notes beside a
board rather than on it, unless covering part of it is the point.

The person can move, delete and rewrite drawn items by hand in edit mode, so read before you edit:
the file may have changed since you last looked.

## Stages

```ts
await stage.stages();                  // every stage: { name, open: [agents], boards, mine? }
await stage.open("deploy");            // work on another stage: its boards become yours
await stage.newStage("Launch plan");   // an empty stage, opened; answers its folder name
```

The person sees the stage the agent they are talking to has open. Two agents on one stage share
its boards and its drawing. Make a new stage for a new piece of work; open an old one to continue it.

## The three calls

```ts
const drawing = await stage.pen.read();   // every item as saved, plus its box on the stage
await stage.pen.edit([ /* edits */ ]);    // applied together, or not at all
const file = await stage.pen.file();      // "stages/<name>/stage.pen", to edit by hand instead
```

- `read()` returns `{ stage, file, version, variables?, themes?, children }`. Each item is exactly
  what the file holds, plus **`box: { x1, y1, x2, y2 }`**: where it is on the stage. An instance
  (`type: "ref"`) also lists `inside`, the items in its copy with their id paths and boxes.
- `edit(edits)` answers `{ rev, results: [{ op, id, box, note? }] }`. `note` says what happened that
  you did not ask for (a size the layout overrode, a text that now wraps). If any edit fails, none
  is saved, and the error names the edit and why.
- Hand edits work too: keep it valid JSON, keep ids unique and free of `/`. A file that stops
  parsing is reported by `read()`, and the canvas keeps the last good version until you fix it.

## Boxes, not sums

Every position you read is a box with both corners, and every position you write can be one:

```ts
await stage.pen.edit([
  { op: "insert", node: { type: "note", id: "check", content: "Check the margin" }, box: { x1: 1060, y1: 0, x2: 1300, y2: 120 } },
]);
```

The server turns the box into pen's own numbers — `x` and `y` from the parent's corner, `width`,
`height` — against wherever the parent really is. Give `x1, y1` alone to move without resizing.
`stage.boards()` gives each board a `box` too, so a note beside a board is
`{ x1: board.box.x2 + 40, y1: board.box.y1, … }`. Inside a frame that lays out its children (a row
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

Every item has `type` and `id`, and may have `name`, `x`, `y`, `width`, `height`, `opacity` (0–1),
`rotation` (degrees, counter-clockwise), `enabled: false` (hidden), and `metadata` (anything pen has
no field for: `{ type: "…", … }`).

| type | what it is | its own fields |
|---|---|---|
| `note` | a sticky note | `content`; `fill` for its colour; `width` (240 when left out); height follows the words |
| `frame` + `metadata: { type: "decks.card" }` | a **card**: white, with an edge, a column of markdown blocks and pictures (see Cards) | `layout: "vertical"`, `gap: 18`, `padding: 20`, `width` (320 reads well), `children`; height follows what it holds |
| `text` + `metadata: { type: "decks.markdown" }` | one block of a card: its words markdown | `content`, `fontSize: 18`, `textGrowth: "fixed-width"`, `width: "fill_container"` |
| `text` | words on the stage | `content`, `fontSize`, `fontWeight` ("400"…"700"), `fontFamily`, `textAlign`, `lineHeight` (× size), `fill` (the colour), `textGrowth` |
| `rectangle` | a box | `fill`, `stroke`, `strokeWidth`, `cornerRadius` |
| `ellipse` | a circle or oval, in its box | `fill`, `stroke`; `innerRadius` 0–1 for a ring; `startAngle`, `sweepAngle` for an arc |
| `polygon` | a regular polygon in its box | `polygonCount`, `fill`, `stroke`, `cornerRadius` |
| `path` | any line or outline | `geometry` (an SVG path), `viewBox`, `fill`, `stroke`, `strokeWidth`, `strokeLinecap`, `fillRule` |
| `frame` | a container, with layout | `children`, `layout`, `gap`, `padding`, `justifyContent`, `alignItems`, `clip`, `fill`, `stroke`, `cornerRadius` |
| `group` | a container, no layout: its box is its children's | `children` |
| `ref` | a copy of a `reusable: true` item | `ref` (the item's id), `descendants`, and any field to lay over the copy |
| `icon` | an icon from a library | `library` (`"lucide"`, `"feather"`, `"phosphor"`, `"Material Symbols Outlined"` / `"Rounded"` / `"Sharp"`), `icon` (its name there, e.g. `"rocket"`), `fill` (its colour), `weight` 100–700; 24 by 24 unless sized |
| `browser` | a deck board (see above) | `url`, `metadata: { type: "decks.board", path }` — put up with `stage.show`, not inserted |
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
`==🟣…==`), `[words](url)`, `[[a note]]`, bare `https://` links and `:emoji:` shortcodes. A picture is
`![alt](url)` or `![alt|240](url)` for its width (a path beside the stage file or a web address); a
file shown where it sits is `![[name.pdf]]` on its own line. `%%hidden%%` is a comment nobody sees
on the canvas.

Two things Obsidian has no word for are ours; Obsidian shows them as the words typed:

- **Coloured words**: `[not flexible]{.red}`, in `red`, `orange`, `yellow`, `green`, `blue` or `purple`.
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
const block = (id, content) => ({ type: "text", id, content, fontSize: 18, textGrowth: "fixed-width", width: "fill_container", metadata: { type: "decks.markdown" } });
{ op: "insert", node: { type: "frame", id: "plan", name: "Next", layout: "vertical", gap: 18, padding: 20, cornerRadius: 12,
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
heading or a list. Keep it short: a card is read on the canvas, and a long document is a board.

**Colour.** `fill` and `stroke` take `"#RRGGBB"` or `"#RRGGBBAA"`, a variable `"$name"`, or a list
of fills drawn in order (`{ type: "color", color }`, `{ type: "gradient", gradientType: "linear",
colors: [{ color, position }], rotation }`, `{ type: "image", url: "./pic.png", mode: "fill" }`).
The stage is light or dark with the app: a colour that must read on both is a variable with two
values —

```ts
{ op: "variables", themes: { Mode: ["Light", "Dark"] }, set: {
  ink: { type: "color", value: [{ value: "#1f2328" }, { value: "#e6e6e6", theme: { Mode: "Dark" } }] },
} }
```

— and then `fill: "$ink"`. Mid-tone accents (`#3b82f6`, `#e8590c`, `#2f9e44`) read on both.

**Stroke.** `stroke` is a colour (or fills), `strokeWidth` a number or `{ top, right, bottom, left }`,
`strokeAlignment` `"inner" | "center" | "outer"`, `strokeLinecap` `"butt" | "round" | "square"`.

**Layout.** A frame lays its children in a **row by default**; `layout: "vertical"` is a column and
`layout: "none"` lets each child sit at its own `x`, `y`. `gap` is the space between, `padding` a
number or `[vertical, horizontal]` or `[top, right, bottom, left]`, `justifyContent` `"start" |
"center" | "end" | "space_between" | "space_around"`, `alignItems` `"start" | "center" | "end"`.
A width or height is a number, `"fit_content"` (hug the children; a frame's default) or
`"fill_container"` (take the room the parent has left). A child with `layoutPosition: "absolute"`
leaves the layout and sits at its own `x`, `y`. Want five notes in a tidy column? A frame with
`layout: "vertical", gap: 16` and the notes inside: no coordinates at all.

**Reuse.** Mark an item `reusable: true` and place copies with `{ type: "ref", ref: "<its id>" }`.
Change the original and every copy follows. `descendants: { "<child id>": { content: "…" } }`
overrides inside a copy; an override with a `type` replaces that child whole. A frame inside the
reusable item marked `slot: ["<item id>", …]` is a place for content: a copy fills it with
`descendants: { "<slot id>": { children: [ … ] } }`, refs included.

**Saved frames.** A frame worth using again goes in the deck's `frames/` folder, as a board goes in
`boards/`, in folders if you like. Two ways in:

- `stage.pen.create("frames/ui/agent-card", { type: "frame", layout: "vertical", children: [ … ] })` makes
  `frames/ui/agent-card.pen` with that frame as its one reusable item;
- `stage.pen.save("<item id>", "frames/ui/agent-card")` saves something already on your stage there, and
  puts a ref to it where the item was.

Any stage places it with `{ type: "ref", ref: "frames/ui/agent-card" }` and its own `descendants`,
with nothing to declare. `stage.pen.read("frames/ui/agent-card")` reads it and `stage.pen.edit([...],
{ path: "frames/ui/agent-card" })` edits it with the same edits a stage takes; every stage using it
shows the change. A path is relative to the deck, as a board's is, so `"stages/<name>/stage.pen"`
reads another stage; an absolute path reaches any `.pen` file. `.pen` may be left off.

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
      geometry: "M50 0L100 50L50 100L0 50Z", fill: "#fde68a", stroke: "#1f2328", strokeWidth: 1.5, strokeAlignment: "center" },
    { type: "text", id: "check-t", content: "Signed in?", fontSize: 14, fontWeight: 500,
      textAlign: "center", textGrowth: "fixed-width", width: "fill_container", fill: "#1f2328" },
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
whenever either end moves**, a board included:

```ts
await stage.pen.edit([
  { op: "insert", node: { type: "path", id: "then", metadata: { type: "decks.arrow", from: "boards/draft.html", to: "boards/final.html" } } },
]);
```

`from` and `to` are an item's id, a board's path, or a point on the stage as `[x, y]`: an end
that stops on bare canvas, which the person makes by letting an arrow go there. An end can also
keep to one side of what it joins — `{ item: "check", side: "right" }`, with `"top"`, `"right"`,
`"bottom"` or `"left"` — and then leaves the middle of that side, square to it, however things
move; a flowchart reads best that way (out of a decision's right and bottom, into the next box's
top or left). An end with no side meets whichever edge faces the other end. A point end stays
where it is on the stage, so to move such an arrow shift its points in `metadata` along with its
`x` and `y`, or the next redraw puts it back.

Its style is three more `metadata` fields, each optional: `route` is `"straight"` (the default),
`"curved"` (leaves and arrives square to the two edges) or `"elbow"` (right angles); `heads` is
`"end"` (the default), `"both"` or `"none"`, for a plain connector; and `dash: true` dashes the
line. Change one with `{ op: "update", id, set: { metadata: { ...its metadata, route: "curved" } } }`;
the path is redrawn for you. Set `stroke` and `strokeWidth` if you want a colour or weight other
than the grey default. Words on the line — "yes", "no", "then" — are `label` in its metadata,
drawn on the middle of the line.

## Look at it

`stage.screenshot()` takes a picture of your stage as the person sees it, boards and drawing
together, and hands it to you in the call's result. Check with it after a big change: text that
overflows a note, an arrow that crosses a board, a frame that clips what is in it are plain in a
picture and invisible in `read()`.

**Point the person's camera at one item** with `stage.show`, the same verb that puts a board up:
an item's id is taken where a board's path is, and the canvas flies to it. Nothing is held and
nothing moves — the item is on the stage already — and naming an item and a board together frames
both.

```ts
await stage.show("summary");                          // look at this note
await stage.show(["boards/plan.html", "summary"]);    // the board and the note beside it
```

The person can drag an item **into the composer** to talk about it, and it arrives in their
message as `@item:<id>` — the id to look up in `read()`.

```ts
await stage.screenshot();                               // the whole stage
await stage.screenshot({ of: "summary" });             // one item, with a margin
await stage.screenshot({ of: ["boards/plan.html", "then"] });
await stage.screenshot({ of: { x1: 0, y1: 0, x2: 1200, y2: 800 }, scale: 2 });
await stage.screenshot({ format: "pdf", to: "exports/plan.pdf" });   // a file to hand on
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

## Patterns

- **A note beside a board:** read the board's `box` from `stage.boards()`, insert a `note` with
  `box: { x1: box.x2 + 40, y1: box.y1, x2: box.x2 + 300 }`.
- **A titled area behind boards:** a `frame` with `layout: "none"`, a soft `fill`
  (`"#3b82f614"`), `cornerRadius: 16`, boxed 40 px outside the boards it gathers, and a `text`
  above its top edge. Insert it at `index: 0` so it paints first.
- **A flow:** boards left to right with `decks.arrow` paths between them; the arrows follow when
  a board is moved.
- **A flowchart:** `decks.shape` frames (a Terminator to start, Process boxes, Decision diamonds)
  in a column 60 to 80 apart, joined by arrows whose ends name their sides, with `label`s on the
  arrows out of each decision.
- **Boards in a row:** a frame with `gap: 80` and no size, then `move` each board's item into it:
  the frame lines them up, and keeps them lined up as they grow.
- **A labelled icon:** a row frame with `alignItems: "center"`, `gap: 8`, an `icon` and a `text`.
- **A checklist:** a vertical `frame` of `text` items; update each `content` as work lands.

Keep the drawing light: a handful of notes and arrows around the boards, not a second document.
The finding still goes on a board.
