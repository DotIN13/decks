# server/canvas

The canvas feature: a canvas's drawing, the ops that change it, and the log of those changes.
It answers `item.*` (13 calls), `canvas.*` (8 of 10) and `frame.*` (4).

## Owns

- `doc.ts`: `PenCanvas`, the `CanvasDoc` of one drawing; `log.ts` its changes and undo.
- `ops.ts` (ops into pen's edits), `place.ts` (at, beside, below, space), `kinds.ts` (who owns a node).
- `spans.ts`: writes a file back so untouched items keep their bytes.
- `store.ts`: every canvas in the deck, its title, its file; `clips.ts` for clip and paste.
- `item-calls.ts`, `canvas-calls.ts`, `frame-calls.ts`, `feature.ts`. Not answered here:
  `canvas.screenshot` and `export` (pictures), `versions`, `version`, `restore` (Studio's history).

## May import

The kernel and the protocol, and today's `@decks/pen` for parsing, edits and layout.

## Rules

1. A drawing is a canvas's `canvas.pen`, or a frame file `frames/<name>.pen` in its folder.
2. A drawing changes only by `apply(ops, by)`. An op is one of insert, update, replace, delete,
   move, copy, variables, named as the item call of that name.
3. All or none: the ops apply in order to a copy, and the copy is kept only if every one works.
   If one fails nothing changes, and the refusal says which op (counting from 1) and why.
4. Each kept apply is one change: the next revision of that drawing, the caller who made it and
   the ops. Revisions start at 0 when the server opens a drawing and rise by one per change.
5. `since(rev)` gives the changes after rev, oldest first. Undo, sync and news read it.
6. A change is written to the file, then announced as `item.changed` with the ids it touched;
   a call that makes it answers after both.
7. A place is one of `at` (the top-left corner), `beside` (160 px right of an item, tops aligned)
   or `below` (160 px under it, lefts aligned). Two at once is refused. A later op may be beside
   an item an earlier op made. An insert given no place keeps its own x and y, or else joins
   right of the newest page (a kind's item), in the nearest open slot. An item moved to another parent keeps the size it was drawn at.
8. `item.space` finds the free corner nearest the middle, or on one side of `near`, with `margin`
   (160) clear of every top-level item but arrows. Nothing is placed.
9. Undo takes back the person's last change, only while it is the drawing's latest change.
   If anyone else changed the drawing since, it is refused as a conflict naming who. Redo puts
   back what undo took, only while that undo is the latest change. Both are changes too.
10. A node whose `metadata.type` is `decks.<type>` belongs to the item kind with that type, which
    another feature registers; this folder never names those kinds. Before an insert or replace
    of such an item, its kind's `prepare` (if it has one) is awaited; a box it adds is a size only.
    Every other node is drawn:
    notes, text, shapes, frames, arrows, refs, kept as pen.dev wrote them.
11. After every change each joined arrow is routed again between its ends, in the same revision,
    so the file holds the path the page draws. Any other item you did not touch keeps its bytes.
12. `item.clip` keeps a copy of items and the files their kinds name, for a day. `item.paste`
    puts them in with new ids as one change; arrows stay joined to the copies.
13. A canvas's `name` is its folder and never changes; its `title` is in `canvas.json`. A call
    may name a canvas by either; one written there from outside is read in. A canvas named by
    none is the caller's here.
14. A frame file holds one reusable item. `frame.save` writes an item to one and puts a ref in
    its place unless `replace` is false.

## Check

```
node tools/check.mjs server
node tools/gates/run.mjs
```
