---
name: canvas-design
description: Design an app screen, a web page, a slide, a dashboard or a component as real pen frames on the canvas, editable by hand, openable in pen.dev and exportable as HTML. Use when someone asks for a design, a UI, a layout or a visual to look at and change; an interactive mockup or a demo is an HTML board instead. Read canvas-authoring first for the canvas calls; schema.md beside this skill lists every item type and field.
---

# Designing on the canvas

A design here is a **top-level frame on the canvas**: a screen, a page, a slide. Everything in it
is pen.dev's own items (frames, text, shapes, icons, pictures), so the person can select and move
any part, pen.dev opens the canvas as it is, and `decks canvas export` turns a frame into a web
page. Every item type and field, with its values and what Decks does not draw, is in
[schema.md](schema.md) beside this file; canvas-authoring covers the canvas calls and cards. This skill is
about putting them together.

**Drawing, card or app?** Draw a design when the person wants to see it and shape it: a screen,
a page, a slide, a component, a set of screens side by side. Write an HTML card instead when it
has to be clicked through or run: a demo, an interactive mockup, a prototype with states. Build an
app when it is a tool they will use again. Stay open: a drawn screen can sit beside the card that
makes it clickable.

## The loop

1. **Find room.** `decks canvas space '{"w":1440,"h":900}' --near <something> --side right`
   answers a free corner; insert the screen there with `at`. Never guess coordinates, and never
   lay a screen over another item.
2. **Open the screen frame** with `placeholder: true`, `clip: true`, a `name`, its width and a
   `fit_content(<min>)` height. While `placeholder` is true the person sees the frame drawn as
   unfinished, dashed in your colour with your name.
3. **Build one section at a time**, each section one `decks canvas batch` (or one script, below).
   Show something early: the person watches the canvas fill in.
4. **Check the section before the next.** Read the batch's notes: each warning names a field that
   does nothing or a value Decks does not draw, and you fix it in the next call. Then
   `decks canvas read --of <section> --depth 2` and look for `clipped`, and for boxes with no width
   or no height. Then `decks canvas screenshot --of <section>` and look at it.
5. **Fix in place.** `update` the item that is wrong. Never delete a section to draw it again.
6. **Close it.** Set `placeholder: false` on the screen as soon as it is done, not at the very end
   of several screens.
7. **Export when asked**: `decks canvas export <screen> --format tailwind` writes
   `exports/<id>.html`.

## Names, not ids

Give every item a `name` that says what it is ("Price", "Buy button", "Nav item: Billing") and no
`id`. The id is made from the name (`buy-button`, then `buy-button-2` if taken) and comes back in
the answer; use the answer's ids in later calls, since a taken name gets a number. A name is also
what the person sees in the layers panel and what the export writes as a class.

## Repeated parts: a script

Lists, nav items, table rows and cards are loops. Write a node script, build the ops with
ordinary JavaScript, and send them as one batch, which lands whole or not at all. Name each repeated part by what makes it different ("Ada Lovelace: Plan"), so its id reads too:

```js
const { decks } = await import(process.env.DECKS_SDK);
const text = (name, content, size = 14, weight = "400", fill = "$ink") =>
	({ type: "text", name, content, fontFamily: "Inter", fontSize: size, fontWeight: weight, fill });
const columns = [["Name", 240], ["Plan", 160], ["Seats", 80]];
const row = (values) => ({
	type: "frame", name: `Row: ${values[0]}`, width: "fill_container", padding: [12, 16],
	children: values.map((value, i) => ({
		type: "frame", name: `${values[0]}: ${columns[i][0]}`, width: columns[i][1],
		children: [text(`${values[0]}: ${columns[i][0]} text`, value)] })),
});
const people = [["Ada Lovelace", "Team", "12"], ["Alan Turing", "Solo", "1"], ["Grace Hopper", "Team", "40"]];
const [table] = await decks.canvas.batch([{ op: "insert", parent: "billing-screen", item: {
	type: "frame", name: "Members table", layout: "vertical", width: "fill_container",
	cornerRadius: 12, stroke: "$line", strokeWidth: 1, clip: true,
	children: people.map(row) } }]);
console.log(table.id); // "members-table"
```

Read back what you need between steps with `decks.canvas.read({ of, depth })`: a copied item's
children have new ids, and a size after layout is in each item's `box`.

## Layout is pen's, not CSS

- A frame lays its children out in one direction: a row by default, `layout: "vertical"` for a
  column, `layout: "none"` for children at their own `x`, `y`. Nothing wraps: a grid is a column
  of row frames.
- `gap` spaces children, `padding` insets them all. There is no margin: to push one child off,
  wrap it in a frame with padding.
- Sizes are numbers, `fit_content` (hug the children; a frame's default), `fit_content(600)` (hug,
  but never under 600) or `fill_container` (take the parent's room). No percentages, no `vh`, no
  `calc`. Several equal columns: each `fill_container`, the parent's `gap` between.
- A parent that hugs (`fit_content`) cannot be filled by children that all `fill_container`: give
  the parent a number, or one child a size.
- Centre with `justifyContent: "center"` and `alignItems: "center"` on the parent.
  `alignItems` is `start`, `center` or `end`; there is no `stretch` or `baseline`.
- `x` and `y` are ignored inside a layout. Use `layoutPosition: "absolute"` for the one child that
  must sit on top (a badge, a close button).
- Prefer layout everywhere; `layout: "none"` only for a true collage.

## Text

- Give every text a `fill`. Decks draws a text with none in the scheme's ink, but pen.dev draws
  it invisible, and a colour that flips with dark mode is rarely what a design means.
- Wrapping needs `textGrowth: "fixed-width"` and a `width`, usually `"fill_container"` inside a
  frame with a layout. The default, `auto`, is one line as long as its words and ignores `width`.
- `fixed-width-height` only when the box must stay that tall; words that do not fit read
  `clipped: "partly"`.
- Never size a text to fit its words by hand: layout and wrapping measure them for you.
- `lineHeight` is a multiple of the font size (1.4 for body, 1.1 to 1.2 for big titles).
- Words starting with `$` are a variable: write prices as "US$24", or "24 dollars".
- Body text 14 px or more on a screen, 24 px or more on a slide. Any Google font works; two
  families at most.

## Colour and themes

Never leave a colour as a bare hex unless it must stay the same in light and dark: a hex does not
change with the scheme. Put the palette in variables once, each with a light and a dark value, then
use `$name` everywhere, so a change is one edit and the design follows light and dark:

```json
{ "op": "variables", "themes": { "mode": ["light", "dark"] }, "set": {
  "ink":    { "type": "color", "value": [{ "value": "#111827" }, { "value": "#f3f4f6", "theme": { "mode": "dark" } }] },
  "muted":  { "type": "color", "value": [{ "value": "#6b7280" }, { "value": "#9ca3af", "theme": { "mode": "dark" } }] },
  "paper":  { "type": "color", "value": [{ "value": "#ffffff" }, { "value": "#111827", "theme": { "mode": "dark" } }] },
  "line":   { "type": "color", "value": [{ "value": "#e5e7eb" }, { "value": "#374151", "theme": { "mode": "dark" } }] },
  "accent": { "type": "color", "value": "#4f46e5" },
  "space":  { "type": "number", "value": 16 } } }
```

Decks's adaptive colours (`$decks-ink`, `$decks-line`, …; see canvas-authoring's
[colors.md](../canvas-authoring/colors.md)) are for what sits around a design; the design's own
variables are for the design.

Check what a variable comes to with `decks canvas read --of <item> --resolve.variables true
--theme.mode dark`. Keep one accent for what can be pressed; text needs clear contrast on its
ground in both themes.

## Components

When a part repeats (a button, a nav item, a card), draw it once with `reusable: true`, then place
copies as `{ type: "ref", ref: "<its id>", descendants: { "<child id>": { "content": "…" } } }`.
An edit to the original reaches every copy. Put components above the screens, screens below,
growing right and down. `decks canvas read --of <copy> --resolve.instances true` shows a copy as
it is drawn, children as `copy-id/child-id`.

## Style

- One idea leads each screen; make it the largest and most contrasting thing on it.
- Not everything in a box. A card, a border or a shadow only where it groups something.
- Few gradients, shadows and big radii; use them on purpose.
- Vary the rhythm: one wide section, then a split, then a grid, not five identical rows.
- Icons are `icon` items (`library: "lucide"`, `icon: "rocket"`, `fill`); pictures are image
  fills on a rectangle or frame. Never draw a logo, a mascot or an illustration out of paths: it
  looks bad. Without a picture, leave a plain frame named for what goes there.
- Effects Decks draws: colour, linear, radial and angular gradients, image fills, strokes,
  outer shadows, inner shadows on boxes and ellipses, blur, opacity. Kept but not drawn (the notes
  will say): mesh gradients, background blur, shader fills and effects, scripts.

## By kind

- **App screen** (phone 390 wide, tablet 834, desktop 1440): one vertical frame,
  `fit_content(844)` tall on a phone, the status bar or top bar first, one content wrapper whose
  padding (16 to 20 on a phone) and gap (24 between sections, 12 within) do all the spacing, a tab
  bar last in the column rather than absolutely placed. One main action, within reach.
- **Web page**: 1440 wide, sections as full-width frames in a column, the first screen saying
  what it is, why it matters and what to do, with one call to action in the accent. Line length
  50 to 75 characters; centre at most two or three lines.
- **Slide**: 1920 × 1080, `clip: true`, content 100 px from the edges, one message, the title is
  the takeaway, body 28 to 32 px, titles 48 px or more. If it does not fit, split the slide; never
  shrink the type. Slides side by side in a row frame of their own.
- **Dashboard or table**: a table is a column of rows, each row a frame of cell frames, each cell
  holding its text, cells sized by column (the same widths in every row) and rows
  `fill_container` wide. Bars in a chart are frames in a row with `alignItems: "end"`; let layout
  place labels, never set them by coordinates. Line charts are hard in pen: prefer bars.

## Before you say it is done

- Nothing collapsed: no box of width or height 0.
- Nothing cut: no `clipped` in a read of the screen, unless on purpose.
- No warnings left from the last calls.
- Contrast holds in light and dark (a screenshot with `--scheme dark`).
- Aligned and evenly spaced: edges line up, gaps repeat.
- `placeholder` is false.
- The screenshot looks like what was asked.

## Mistakes and their fixes

| Wrong | Right |
|---|---|
| `width: "100%"` | `width: "fill_container"` |
| `padding` on a text | a frame with padding round the text |
| a text with `width` and no `textGrowth` | `textGrowth: "fixed-width"` with the width |
| a `fit_content` column whose only child is `fill_container` text | give the column a number width |
| `x`, `y` on a child of a frame with layout | `layoutPosition: "absolute"`, or no position at all |
| an `id` you made up | a `name`, and the id from the answer |
| deleting a section to redo it | `update` the items that are wrong |
| a logo drawn from paths | a named empty frame, or a picture the person gives |
