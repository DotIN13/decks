<!-- Generated from packages/pen/src/types.ts and fields.ts by scripts/gen-pen-schema.mjs. Edit those, then run the script. -->

# The .pen format, as Decks reads it

Every item on a canvas is one of the types below, with the fields its type has. A field an item's
type does not have is kept in the file and does nothing; the canvas calls say so in their notes.
Every number, colour, string and boolean can also be a variable, `"$name"`, set with
`decks canvas variables`. A colour is best one with a light and a dark value: Decks's own
(`$decks-ink`, `$decks-muted`, `$decks-line`, `$decks-shape`, `$decks-frame`, `$decks-red`,
`$decks-blue`, … listed in canvas-authoring) are defined by any edit that uses them; a hex stays
the same in light and dark.

## Values

| name | values | meaning |
|---|---|---|
| `Variable` | `string` | A `$name` that binds a property to a document variable. |
| `NumberOrVariable` | `number \| Variable` | A number, or a variable holding one. |
| `ColorOrVariable` | `string` | `#RGB`, `#RRGGBB` or `#RRGGBBAA`, or a variable. |
| `SizeValue` | `NumberOrVariable \| string` | `fit_content`, `fill_container`, either with a fallback in brackets, or a number. |
| `Fills` | `Fill \| Fill[]` | One fill, or a list drawn in order, the first at the back. |

## Fills

`fill` (and `stroke`) is one of these, or a list of them drawn in order:

```ts
type Fill = ColorOrVariable
	| { type: "color"; color: ColorOrVariable; enabled?: boolean | Variable; blendMode?: string }
	| { type: "gradient"; gradientType?: "linear" | "radial" | "angular"; opacity?: NumberOrVariable; center?: { x?: number; y?: number }; size?: { width?: NumberOrVariable; height?: NumberOrVariable }; rotation?: NumberOrVariable; colors?: Array<{ color: ColorOrVariable; position: NumberOrVariable }>; enabled?: boolean | Variable; blendMode?: string; }
	| { type: "image"; url?: string; mode?: "stretch" | "fill" | "fit"; opacity?: NumberOrVariable; enabled?: boolean | Variable; blendMode?: string }
	| { type: string; enabled?: boolean | Variable; [key: string]: unknown };
```

## Effects

`effect` is one of these, or a list:

```ts
type Effect = { type: "blur"; radius?: NumberOrVariable; enabled?: boolean | Variable }
	| { type: "background_blur"; radius?: NumberOrVariable; enabled?: boolean | Variable }
	| { type: "shadow"; shadowType?: "inner" | "outer"; offset?: { x: NumberOrVariable; y: NumberOrVariable }; spread?: NumberOrVariable; blur?: NumberOrVariable; color?: ColorOrVariable; enabled?: boolean | Variable; blendMode?: string; };
```

## Kept, but not drawn by Decks

pen.dev draws these; Decks keeps them in the file, draws nothing for them, and says so in the notes:

- fills: `shader`, `mesh_gradient`
- effects: `background_blur`, `shader`; and an inner `shadow` on anything but a frame, a rectangle or a whole ellipse
- `script` items: Decks does not run them

## Fields every item has

| field | values | meaning |
|---|---|---|
| `type` | `string` | Which kind of item this is: frame, group, rectangle, ellipse, polygon, path, text, note, prompt, context, icon, script, browser or ref. |
| `id` | `string` | Unique in the document; never contains `/`, which separates the steps of an id path. Left out on insert, it is made from `name`. |
| `name` | `string` | What the item is, in words: shown in the layers panel, and the source of a new item's id. |
| `context` | `string` | Free words for whoever reads the file next: what this item is for, or where it came from. |
| `reusable` | `boolean` | A component: other items copy it with `{ type: "ref", ref: <its id> }`, and follow its changes. |
| `theme` | `Record<string, string>` | The theme this item and what is in it use, by axis: `{ mode: "dark" }`. |
| `enabled` | `boolean \| Variable` | `false` hides the item and leaves it out of its parent's layout. |
| `opacity` | `NumberOrVariable` | 0 (clear) to 1 (solid), for the item and everything in it. |
| `flipX` | `boolean \| Variable` | Mirrors the item left to right. |
| `flipY` | `boolean \| Variable` | Mirrors the item top to bottom. |
| `layoutPosition` | `"auto" \| "absolute"` | `absolute` takes the item out of its parent's layout, to sit at its own `x`, `y`. |
| `metadata` | `{ type: string; [key: string]: unknown }` | pen's extension point: anything pen.dev has no field for rides here. |
| `rotation` | `NumberOrVariable` | Degrees counter-clockwise, about the top-left corner. |
| `x` | `number` | From the parent's top-left corner, rightwards; ignored inside a flex layout. |
| `y` | `number` | From the parent's top-left corner, downwards; ignored inside a flex layout. |

## The item types

### `frame`

A container. Lays its children out in a row, a column or not at all; a screen, a section, a button, a cell.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `stroke` | `Fills \| LegacyStroke` | The outline's fill: a colour, a gradient, or a list. |
| `strokeWidth` | `NumberOrVariable \| { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable }` | How thick the outline is, in px; one number, or each side on its own. |
| `strokeLinecap` | `"butt" \| "round" \| "square"` | How an open line ends. |
| `strokeLinejoin` | `"miter" \| "bevel" \| "round"` | How a line turns a corner. |
| `strokeAlignment` | `"inner" \| "center" \| "outer"` | Whether the outline sits inside the edge, on it, or outside it. |
| `strokeDash` | `"dashed" \| "dotted"` | Ours, not pen's: a line drawn in dashes or dots. pen.dev carries it and draws the line solid. |
| `fill` | `Fills` | What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. |
| `cornerRadius` | `NumberOrVariable \| NumberOrVariable[]` | Rounds the corners, in px; one number, or four from the top-left clockwise. |
| `layout` | `"none" \| "vertical" \| "horizontal"` | How the children are placed: in a row (a frame's default), in a column, or each at its own `x`, `y`. |
| `gap` | `NumberOrVariable` | Space between children along the layout, in px. |
| `layoutIncludeStroke` | `boolean` | Whether a child's stroke counts in the layout. |
| `padding` | `NumberOrVariable \| NumberOrVariable[]` | Space inside the edge, round every child: one number, [vertical, horizontal], or [top, right, bottom, left]. |
| `justifyContent` | `"start" \| "center" \| "end" \| "space_between" \| "space_around"` | Where the children sit along the layout, and how spare room is shared. |
| `alignItems` | `"start" \| "center" \| "end"` | Where the children sit across the layout. |
| `children` | `PenNode[]` | The items inside, in drawing order: the first is at the back. |
| `clip` | `boolean \| Variable` | Cuts off whatever reaches outside the frame. |
| `placeholder` | `boolean` | A frame still being made; Decks draws it as unfinished. |
| `slot` | `false \| string[]` | In a component, marks this frame as a place a copy fills with its own children; a list names the components suggested for it. |

### `group`

A container with no layout: its box is its children's.

| field | values | meaning |
|---|---|---|
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `children` | `PenNode[]` | The items inside, in drawing order: the first is at the back. |

### `rectangle`

A box.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `stroke` | `Fills \| LegacyStroke` | The outline's fill: a colour, a gradient, or a list. |
| `strokeWidth` | `NumberOrVariable \| { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable }` | How thick the outline is, in px; one number, or each side on its own. |
| `strokeLinecap` | `"butt" \| "round" \| "square"` | How an open line ends. |
| `strokeLinejoin` | `"miter" \| "bevel" \| "round"` | How a line turns a corner. |
| `strokeAlignment` | `"inner" \| "center" \| "outer"` | Whether the outline sits inside the edge, on it, or outside it. |
| `strokeDash` | `"dashed" \| "dotted"` | Ours, not pen's: a line drawn in dashes or dots. pen.dev carries it and draws the line solid. |
| `fill` | `Fills` | What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. |
| `cornerRadius` | `NumberOrVariable \| NumberOrVariable[]` | Rounds the corners, in px; one number, or four from the top-left clockwise. |

### `ellipse`

An oval in its box; a ring with `innerRadius`, an arc with `startAngle` and `sweepAngle`.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `stroke` | `Fills \| LegacyStroke` | The outline's fill: a colour, a gradient, or a list. |
| `strokeWidth` | `NumberOrVariable \| { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable }` | How thick the outline is, in px; one number, or each side on its own. |
| `strokeLinecap` | `"butt" \| "round" \| "square"` | How an open line ends. |
| `strokeLinejoin` | `"miter" \| "bevel" \| "round"` | How a line turns a corner. |
| `strokeAlignment` | `"inner" \| "center" \| "outer"` | Whether the outline sits inside the edge, on it, or outside it. |
| `strokeDash` | `"dashed" \| "dotted"` | Ours, not pen's: a line drawn in dashes or dots. pen.dev carries it and draws the line solid. |
| `fill` | `Fills` | What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. |
| `innerRadius` | `NumberOrVariable` | A ring: the hole's size, 0 (none) to 1, of the ellipse. |
| `startAngle` | `NumberOrVariable` | An arc: where it starts, in degrees. |
| `sweepAngle` | `NumberOrVariable` | An arc: how far round it goes from `startAngle`, in degrees, counter-clockwise when positive; 360 is whole. |

### `polygon`

A regular polygon in its box.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `stroke` | `Fills \| LegacyStroke` | The outline's fill: a colour, a gradient, or a list. |
| `strokeWidth` | `NumberOrVariable \| { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable }` | How thick the outline is, in px; one number, or each side on its own. |
| `strokeLinecap` | `"butt" \| "round" \| "square"` | How an open line ends. |
| `strokeLinejoin` | `"miter" \| "bevel" \| "round"` | How a line turns a corner. |
| `strokeAlignment` | `"inner" \| "center" \| "outer"` | Whether the outline sits inside the edge, on it, or outside it. |
| `strokeDash` | `"dashed" \| "dotted"` | Ours, not pen's: a line drawn in dashes or dots. pen.dev carries it and draws the line solid. |
| `fill` | `Fills` | What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. |
| `polygonCount` | `NumberOrVariable` | How many sides a polygon has. |
| `cornerRadius` | `NumberOrVariable \| NumberOrVariable[]` | Rounds the corners, in px; one number, or four from the top-left clockwise. |

### `path`

Any outline, from an SVG path.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `stroke` | `Fills \| LegacyStroke` | The outline's fill: a colour, a gradient, or a list. |
| `strokeWidth` | `NumberOrVariable \| { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable }` | How thick the outline is, in px; one number, or each side on its own. |
| `strokeLinecap` | `"butt" \| "round" \| "square"` | How an open line ends. |
| `strokeLinejoin` | `"miter" \| "bevel" \| "round"` | How a line turns a corner. |
| `strokeAlignment` | `"inner" \| "center" \| "outer"` | Whether the outline sits inside the edge, on it, or outside it. |
| `strokeDash` | `"dashed" \| "dotted"` | Ours, not pen's: a line drawn in dashes or dots. pen.dev carries it and draws the line solid. |
| `fill` | `Fills` | What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. |
| `fillRule` | `"nonzero" \| "evenodd"` | Which parts of a path that crosses itself are filled. |
| `geometry` | `string` | The outline, as an SVG path's `d`. |
| `viewBox` | `[number, number, number, number]` | The part of the path's coordinates that is stretched to the item's box: [x, y, width, height]. |

### `text`

Words.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `stroke` | `Fills \| LegacyStroke` | The outline's fill: a colour, a gradient, or a list. |
| `strokeWidth` | `NumberOrVariable \| { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable }` | How thick the outline is, in px; one number, or each side on its own. |
| `strokeLinecap` | `"butt" \| "round" \| "square"` | How an open line ends. |
| `strokeLinejoin` | `"miter" \| "bevel" \| "round"` | How a line turns a corner. |
| `strokeAlignment` | `"inner" \| "center" \| "outer"` | Whether the outline sits inside the edge, on it, or outside it. |
| `strokeDash` | `"dashed" \| "dotted"` | Ours, not pen's: a line drawn in dashes or dots. pen.dev carries it and draws the line solid. |
| `fill` | `Fills` | What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. |
| `fontFamily` | `string` | Any Google font, by name: "Inter". |
| `fontSize` | `NumberOrVariable` | In px. |
| `fontWeight` | `string \| number` | "400" regular to "700" bold, or 100 to 900. |
| `letterSpacing` | `NumberOrVariable` | Extra space between letters, in px. |
| `fontStyle` | `string` | "normal" or "italic". |
| `underline` | `boolean \| Variable` | Underlines the words. |
| `lineHeight` | `NumberOrVariable` | Lines apart, as a multiple of the font size: 1.4 for reading, 1.1 for big titles. |
| `textAlign` | `"left" \| "center" \| "right" \| "justify"` | Where lines sit in the box; seen when the box is wider than the words. |
| `textAlignVertical` | `"top" \| "middle" \| "bottom"` | Where the words sit in a `fixed-width-height` box. |
| `strikethrough` | `boolean \| Variable` | Strikes the words through. |
| `href` | `string` | Makes the words a link to this address. |
| `content` | `string` | The words. One starting with `$` is a variable. |
| `textGrowth` | `"auto" \| "fixed-width" \| "fixed-width-height"` | `auto`: one line as long as the words, ignoring width; `fixed-width`: wraps at the width and grows down; `fixed-width-height`: the box given, words may overflow. |

### `note`

A sticky note.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `fontFamily` | `string` | Any Google font, by name: "Inter". |
| `fontSize` | `NumberOrVariable` | In px. |
| `fontWeight` | `string \| number` | "400" regular to "700" bold, or 100 to 900. |
| `letterSpacing` | `NumberOrVariable` | Extra space between letters, in px. |
| `fontStyle` | `string` | "normal" or "italic". |
| `underline` | `boolean \| Variable` | Underlines the words. |
| `lineHeight` | `NumberOrVariable` | Lines apart, as a multiple of the font size: 1.4 for reading, 1.1 for big titles. |
| `textAlign` | `"left" \| "center" \| "right" \| "justify"` | Where lines sit in the box; seen when the box is wider than the words. |
| `textAlignVertical` | `"top" \| "middle" \| "bottom"` | Where the words sit in a `fixed-width-height` box. |
| `strikethrough` | `boolean \| Variable` | Strikes the words through. |
| `href` | `string` | Makes the words a link to this address. |
| `content` | `string` | The words. One starting with `$` is a variable. |

### `prompt`

A prompt card, with the model it is for.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `fontFamily` | `string` | Any Google font, by name: "Inter". |
| `fontSize` | `NumberOrVariable` | In px. |
| `fontWeight` | `string \| number` | "400" regular to "700" bold, or 100 to 900. |
| `letterSpacing` | `NumberOrVariable` | Extra space between letters, in px. |
| `fontStyle` | `string` | "normal" or "italic". |
| `underline` | `boolean \| Variable` | Underlines the words. |
| `lineHeight` | `NumberOrVariable` | Lines apart, as a multiple of the font size: 1.4 for reading, 1.1 for big titles. |
| `textAlign` | `"left" \| "center" \| "right" \| "justify"` | Where lines sit in the box; seen when the box is wider than the words. |
| `textAlignVertical` | `"top" \| "middle" \| "bottom"` | Where the words sit in a `fixed-width-height` box. |
| `strikethrough` | `boolean \| Variable` | Strikes the words through. |
| `href` | `string` | Makes the words a link to this address. |
| `content` | `string` | The words. One starting with `$` is a variable. |
| `model` | `string` | The model the prompt is for. |

### `context`

A context card.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `fontFamily` | `string` | Any Google font, by name: "Inter". |
| `fontSize` | `NumberOrVariable` | In px. |
| `fontWeight` | `string \| number` | "400" regular to "700" bold, or 100 to 900. |
| `letterSpacing` | `NumberOrVariable` | Extra space between letters, in px. |
| `fontStyle` | `string` | "normal" or "italic". |
| `underline` | `boolean \| Variable` | Underlines the words. |
| `lineHeight` | `NumberOrVariable` | Lines apart, as a multiple of the font size: 1.4 for reading, 1.1 for big titles. |
| `textAlign` | `"left" \| "center" \| "right" \| "justify"` | Where lines sit in the box; seen when the box is wider than the words. |
| `textAlignVertical` | `"top" \| "middle" \| "bottom"` | Where the words sit in a `fixed-width-height` box. |
| `strikethrough` | `boolean \| Variable` | Strikes the words through. |
| `href` | `string` | Makes the words a link to this address. |
| `content` | `string` | The words. One starting with `$` is a variable. |

### `icon`

An icon from a library: lucide, feather, phosphor or Material Symbols.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `library` | `string` | The icon set: "lucide", "feather", "phosphor", or "Material Symbols Outlined", "Rounded" or "Sharp". |
| `icon` | `string` | The icon's name in its set: "rocket". |
| `weight` | `NumberOrVariable` | A variable font's weight, 100 to 700, for the libraries that have one. |
| `fill` | `Fills` | What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. |

### `icon_font`

The older icon item, as some files still have it.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `iconFontFamily` | `string` | The older `icon_font` item's library. |
| `iconFontName` | `string` | The older `icon_font` item's icon. |
| `weight` | `NumberOrVariable` | A variable font's weight, 100 to 700, for the libraries that have one. |
| `fill` | `Fills` | What fills the item: a colour, a gradient, a picture, or a list of them drawn in order. On text, the colour of the words. |

### `script`

A JavaScript file that makes the item's children in pen.dev.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `clip` | `boolean \| Variable` | Cuts off whatever reaches outside the frame. |
| `scriptUri` | `string` | The JavaScript file that makes the item's children, relative to the .pen file. |
| `inputs` | `Record<string, string \| number \| boolean>` | The script's inputs, by name. |

### `browser`

A live web page. On a Decks canvas this is a board.

| field | values | meaning |
|---|---|---|
| `width` | `SizeValue` | A number in px, `fit_content` (hug what it holds), `fit_content(n)` (hug, but never under n) or `fill_container` (take the parent's room). |
| `height` | `SizeValue` | As `width`: a number, `fit_content`, `fit_content(n)` or `fill_container`. |
| `effect` | `Effect \| Effect[]` | Shadows and blurs, one or a list. |
| `stroke` | `Fills \| LegacyStroke` | The outline's fill: a colour, a gradient, or a list. |
| `strokeWidth` | `NumberOrVariable \| { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable }` | How thick the outline is, in px; one number, or each side on its own. |
| `strokeLinecap` | `"butt" \| "round" \| "square"` | How an open line ends. |
| `strokeLinejoin` | `"miter" \| "bevel" \| "round"` | How a line turns a corner. |
| `strokeAlignment` | `"inner" \| "center" \| "outer"` | Whether the outline sits inside the edge, on it, or outside it. |
| `strokeDash` | `"dashed" \| "dotted"` | Ours, not pen's: a line drawn in dashes or dots. pen.dev carries it and draws the line solid. |
| `url` | `string` | The page's address. |
| `deviceId` | `string` | A device preset to show the page as; left out, the page fits the box. |
| `zoom` | `number` | How large the page is drawn, 1 being its own size. |
| `scrollX` | `number` | How far the page is scrolled across, in px. |
| `scrollY` | `number` | How far the page is scrolled down, in px. |
| `cornerRadius` | `NumberOrVariable \| NumberOrVariable[]` | Rounds the corners, in px; one number, or four from the top-left clockwise. |

### `ref`

A copy of an item marked `reusable: true`. Any other field set on it overrides the copy.

| field | values | meaning |
|---|---|---|
| `ref` | `string` | The id of the item copied; `"name:id"` for one from an imported file. |
| `descendants` | `Record<string, Record<string, unknown>>` | Changes inside the copy, by the id path of what they change: `{ "label": { content: "Buy" } }`. With a `type`, that child is replaced whole. |
