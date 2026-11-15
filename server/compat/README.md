# server/compat

Today's names, answered by the new ones until they go. Today's canvas page and today's browser
checks speak them; they are how we know the new programs behave.

## Owns

- `table.ts`: every old call and event of `docs/rewrite/calls.md`, the new name of each, the old
  arguments in order, and `GOES`, the day the old names stop answering.
- `args.ts`: an old call's arguments made into the new call's, and the answer made back.
- `events.ts`: a new event told as the old one a watcher expects.
- `line.ts`: today's line at `/compat/v1/socket` (`line.hello`, `line.call`, `canvas.watch`).
- `tab.ts`: today's tab socket at `/ws` (the roster, an agent's drawing, the checks' dozen messages).
- `drawing.ts`: today's `/compat/stage-pen/<canvas>`, the drawing as the canvas frame first reads it.
- `deck.ts`: today's `GET /api/deck`, the deck's folder and its cards and boards.
- `shot.ts`: today's `GET /api/stage-shot`, canvas.screenshot taken for a download.
- `files.ts`: today's `POST /api/upload` and `GET /api/where`.
- `pictures.ts`: today's `/api/stage-thumb/<canvas>`, read from server/pictures' canvas tile.
- `feature.ts`: its one export.

## May import

The kernel and the protocol through their entries, and today's `@decks/pen` for the drawing's diff.
No feature imports compat, and compat imports no feature.

## Rules

1. Compat is a door, never a hop: an old name is turned into its new call and handed to the router.
   No feature reads compat on the way to its work.
2. Every old name in the table answers: by its new call, or for a dropped one, by a refusal that
   says why and names the new call. An unknown name is refused as `not_found`.
3. An old call's arguments are a list, in the old order; an options object spreads into the new
   call's arguments. Old shapes are turned into new ones here: a corner `{ x1, y1 }` into a Point,
   pen.dev's own ops into item ops, `canvas.step` into `canvas.undo`.
4. An old line hears its watched canvases only. A change on one is told as today's
   `canvas.changed` with the whole drawing and its revision, which today's frame reads whole.
5. A line opened with a canvas pass calls and watches that canvas alone.
6. Each alias carries `GOES`. After that day it answers `refused` naming the new call.

## Check

```
node tools/check.mjs server
node --import tsx --test server/compat/*.test.ts
```
