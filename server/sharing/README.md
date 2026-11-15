# server/sharing

Sync with Decks Studio, and the canvases friends shared. Handles `studio.status`, `studio.connect` and
`studio.disconnect`. Built from today's `packages/hub` and `packages/sync-client`, on the deck interface.

## Owns

- `feature.ts`: the feature, `sharingFeature(opts)`, and its three calls.
- `client/link.ts`: Studio's key and the sync state, kept in the kernel's private `Store`.
- `client/`: the sync client that keeps a deck in step with Studio, over a `Transport`.
- `hub/`: Studio's side kept in memory: the store, the merge, the `/sync/v1` routes, the live socket. Its entry is `hub/index.ts`; a store is any `HubStore`.
  Studio's own repo brings a database store; tests use `MemoryHub`.

## May import

`protocol/`, `server/kernel/`, `@decks/pen` (the drawing format, until it moves to `pen/`) and node's
own modules. Never another feature.

## Rules

1. Only the person connects and disconnects. Studio's key and the sync state are kept in the
   feature's private store (`ctx.store`, `kernel.store("sharing")`), never in the deck.
2. The client speaks today's messages: the routes, live events and shapes of `protocol/sync.ts`.
3. A canvas is its Studio id, written in its `canvas.json` as `studio`, not its folder's name. A renamed
   folder keeps its canvas; a copied folder becomes a canvas of its own.
4. A folder with no id meets a canvas of mine with the same name: it merges into it. Otherwise it
   becomes a new canvas. A name Studio refuses is skipped, and said once.
5. A drawing goes up as edits from the last drawing both sides agreed on; Studio merges them item by
   item, and its answer is written back. Changes made elsewhere come down as edits since a revision,
   or whole when Studio's log no longer reaches back.
6. A merge keeps both sides' items. A field set by both takes the last push. An edit to an item
   someone removed is dropped; an insert whose sibling or parent went goes to the end of its list.
7. Files sync inside a canvas's bundle only (`cards/`, `frames/`, `files/`). Secrets and
   dependencies never sync.
8. A file both sides changed, with no version agreed on, is kept twice: Studio's at its path, ours
   beside it as `<name>.conflict-<yyyymmdd>-<hhmm>.<ext>`, which goes up too.
9. When Studio asks for no more files (429 and Retry-After), files wait that long and then go up by
   themselves; drawings and other canvases do not wait. A file Studio refuses is not sent again.
10. A canvas shared with me lands in `shared/canvases/<owner>/<name>/`. One shared to view never
    pushes edits or files.
11. The app list goes to Studio once a connection, then only when a name, title or kind changes.
12. Studio closing the live socket for a revoked key (4001) unlinks the deck; a token asked on the
    socket is answered on that socket.
13. On the hub, who may read and edit is the store's role: a viewer may read, never write.
14. `GET /api/bundle/<canvas>` (`bundle/`) gives the person the canvas as one `.decks` zip: a
    manifest, its folder, `lib/`, and the files its cards name. Pictures wait for `pictures/`.

Left out for now: presence through Studio, card pictures, deck files a canvas mirrors (`assets/`,
`docs/`), the multi-process live bus (Studio's), and the canvas follower (the page's, in `canvas/`).

## Check

```
node tools/check.mjs server
node tools/gates/run.mjs
```
