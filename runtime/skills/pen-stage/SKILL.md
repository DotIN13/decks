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
  boards — a note beside one, an arrow from one to the next, a titled area behind a group. Put an
  answer on a board; put the arrangement around it here.

**Boards are at the back.** The drawing is shown over the boards, so a note placed on a board
covers that part of it. One exception: an item listed *before* a board in the file that holds the
whole board (a frame or panel round it) is a backdrop, and is drawn under the boards. The person
can use a board everywhere nothing is drawn over it, and not where something is. So keep notes
beside a board rather than on it, unless covering part of it is the point.

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

**Text.** `textGrowth` decides the size: `"auto"` (the default) is one line as long as the words,
and ignores `width`; `"fixed-width"` wraps at `width` and grows down; `"fixed-width-height"` is the
box you give it. A text given a box with a width is switched to `"fixed-width"` for you. Write
text at 18 or larger: the stage is read zoomed out.

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
overrides inside a copy; an override with a `type` replaces that child whole.

## Arrows

pen has no arrow type: an arrow is a `path` whose `metadata` says what it joins. Give the ends and
nothing else — the server draws the line and its head between the facing edges, and **redraws it
whenever either end moves**, a board included:

```ts
await stage.pen.edit([
  { op: "insert", node: { type: "path", id: "then", metadata: { type: "decks.arrow", from: "boards/draft.html", to: "boards/final.html" } } },
]);
```

`from` and `to` are an item's id or a board's path. `metadata.route: "elbow"` draws right angles
instead of a straight line. Set `stroke` and `strokeWidth` if you want a colour or weight other
than the grey default; a label is a `text` placed by the arrow's `box`.

## Look at it

`stage.screenshot()` takes a picture of your stage as the person sees it, boards and drawing
together, and hands it to you in the call's result. Check with it after a big change: text that
overflows a note, an arrow that crosses a board, a frame that clips what is in it are plain in a
picture and invisible in `read()`.

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
- **Boards in a row:** a frame with `gap: 80` and no size, then `move` each board's item into it:
  the frame lines them up, and keeps them lined up as they grow.
- **A labelled icon:** a row frame with `alignItems: "center"`, `gap: 8`, an `icon` and a `text`.
- **A checklist:** a vertical `frame` of `text` items; update each `content` as work lands.

Keep the drawing light: a handful of notes and arrows around the boards, not a second document.
The finding still goes on a board.
