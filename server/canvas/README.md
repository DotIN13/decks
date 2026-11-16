# server/canvas

The canvas feature: a canvas's drawing, the ops that change it, and the log of those changes.
It answers `item.*` (13 calls), `canvas.*` (12 of 14: not `screenshot` or `export`), `frame.*` (4).

## Owns

- `doc.ts`: `PenCanvas`, one drawing's `CanvasDoc`; `log.ts` its changes and undo; `arrows.ts` reroutes.
- `ops.ts`, `place.ts`, `kinds.ts`, `paths.ts`: ops, places, kinds, paths kept in the canvas; `spans.ts`
  untouched bytes; `store.ts` canvases, titles, files, history; `clips.ts`; the calls, `feature.ts`.

## May import

The kernel and the protocol, and today's `@decks/pen` for parsing, edits and layout.

## Rules

1. A drawing is a canvas's `canvas.pen`, or a frame file `frames/<name>.pen` in its folder.
2. A drawing changes only by `apply(ops, by)`. An op is one of insert, update, replace, delete,
   move, copy, variables, named as the item call of that name.
3. All or none: the ops apply in order to a copy, and the copy is kept only if every one works.
   If one fails nothing changes, and the refusal says which op (counting from 1) and why.
4. Each kept apply is one change: the next revision (from 0 when the server opens the drawing),
   its caller and its ops. `since(rev)` gives the changes after rev, oldest first, for undo,
   sync and news; a socket catching up replays the last 500 item.changed after its rev, or missed.
5. A change is written to the file, then announced as `item.changed`: its ids, its ops, the same
   change as pen's diff edits (routes too), and in `made` the edit name its caller gave, if any;
   a call that makes it answers after both. `canvas.drawing` reads the file's document and rev.
6. A place is one of `at` (the top-left corner), `beside` (160 px right of an item, tops aligned)
   or `below` (160 px under it, lefts aligned). Two at once is refused. A later op may be beside
   an item an earlier op made. An insert given no place keeps its own x and y, or else joins
   right of the newest page (a kind's item), in the nearest open slot. An item moved to another
   parent keeps its drawn size. A page already on the canvas is not inserted again (a conflict).
7. `item.space` finds the free corner nearest the middle, or on one side of `near`, with `margin`
   (160) clear of every top-level item but arrows. Nothing is placed.
8. Undo takes back the person's last change, only while it is the drawing's latest change.
   If anyone else changed the drawing since, it is refused as a conflict naming who. Redo puts
   back what undo took, only while that undo is the latest change. Both are changes too.
9. A node whose `metadata.type` is `decks.<type>` belongs to the item kind with that type, which
    another feature registers; this folder never names those kinds. Before an insert or replace
    of such an item, its kind's `prepare` (if it has one) is awaited; a box it adds is a size only.
    Every other node is drawn: notes, text, shapes, frames, arrows, refs, kept as pen.dev wrote them.
    Anywhere an item's id is taken, a page's path is too: a card's as its folder or its
    index.html, an older page's as its file, with or without the canvas's folder before it.
    Every path an item a call puts or changes names (a page's, a picture's url), read decoded and
    normalised, stays in its canvas's own folder or the deck's assets/, docs/, apps/; else refused.
10. After every change each joined arrow is routed again between its ends, in the same revision,
    so the file holds the path the page draws. Any other item you did not touch keeps its bytes.
11. `item.clip` keeps a copy of items and the files their kinds name, for a day. `item.paste`
    puts them in with new ids as one change; arrows stay joined to the copies.
12. A canvas's `name` is its folder and never changes; its `title` is in `canvas.json`. A call
    may name a canvas by either; one written there from outside is read in. A canvas named by
    none is the caller's here.
13. A frame file holds one reusable item; `frame.save` writes one and leaves a ref unless `replace` is false.
14. A drawing's versions are its file's revisions in the deck's history, newest first. `restore`
    reads one back in at once and writes it as a new change, announced like any other.

## Check

`node tools/check.mjs server`, then `node tools/gates/run.mjs`.
