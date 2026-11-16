# Later: what the frame's move to the protocol leaves for after

Improvements found while the canvas frame moved from compat's line to the protocol's socket, kept for
later on purpose: the move changes what the frame speaks, not how it recovers.

## An edit in flight at a drop

Today (as on the old line): an edit sent just before the socket drops is answered `unavailable`, the
frame drops it from its pending queue and reads the drawing whole, which empties the person's undo
and redo (`canvas/host/inside/options.ts`, `document.send`; `canvas/drawing/edits.ts`).

Better: on `unavailable` only, keep the edit shown and wait for the reconnect's catch-up
(`watch { canvas, since }`, which replays every revision after the one held with its `made`). If the
edit landed, its revision names it in `made` and it settles as any other; if it did not land, nothing
names it, and after `PENDING_MS` it goes as it does today. It is never doubled either way.

What it takes: `document.send` tells a refusal (`!answer.ok`) apart from a dropped socket (the
envelope's `code: "unavailable"`, which `backend.act` would have to pass on beside the message), and
reads whole only for the first; a test on the fake socket (`canvas/host/inside/backend.test.ts`) that
an edit in flight at a drop, replayed after it, keeps the person's undo. Found by Reader on step 2.
