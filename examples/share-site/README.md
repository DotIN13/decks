# A canvas-sharing site, from the @decks packages

People open one canvas in their browsers and edit it together; a Decks harness on anyone's
machine syncs the same canvas into its deck folder, where its agents work on it. About 250 lines:

| File | What it is | From |
|---|---|---|
| `src/server.ts` | Who is who (a key each), the canvases, `/sync/v1`, the live socket, the board runtime | `@decks/hub`, `@decks/board-host` |
| `src/page.ts` | The editor in a page: load, edit, hear others' edits | `@decks/canvas`, `@decks/pen` |
| `index.html` | The page's frame | |

```sh
npm run start          # the server on :4900; PEOPLE and HARNESSES name the keys
npm run page           # the page on :4901, proxied to the server
open "http://127.0.0.1:4901/#key=ada-key"
```

A harness joins with its key: `DECKS_STUDIO_URL=http://127.0.0.1:4900` and the key
`ada-mini` (see `HARNESSES`). It syncs exactly as it does with Decks Studio.

What you would add for real use: accounts and sign-in instead of keys in the address, a
`HubStore` on your database instead of `MemoryStore`, and sharing (who may see which canvas).
Those are yours; everything about canvases, merging and syncing is the hub's.
