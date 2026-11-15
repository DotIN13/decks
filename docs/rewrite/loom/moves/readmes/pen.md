# pen

The drawing's file format, pen.dev's own: reading and writing a `.pen` file, its ops, layout,
arrows, colours, clipping and the export to HTML. Today's `packages/pen`, moved.

## Owns

- `index.ts`: the one entry, `@decks/pen`.
- `types.ts`, `read.ts`, `doc.ts`, `fields.ts`, `values.ts`: the document and its values.
- `ops.ts`, `diff.ts`, `refs.ts`, `clip.ts`: changes to a document.
- `layout.ts`, `geometry.ts`, `shapes.ts`, `outline.ts`, `arrows.ts`: where things are.
- `colors.ts`, `html.ts`: Decks's colours, and a drawing as a web page.

## May import

`protocol/` at most. Today it imports nothing.

## Rules

1. A document changes only by ops; every op is all or nothing.
2. Layout is a function of the document and the theme, the same on the page, the server and the
   iPad: the fixtures in `tools/fixtures` hold its answers.
3. Nothing here touches the disk, the network or the DOM.

## Check

```
node tools/check.mjs pen
node tools/check.mjs server
```
