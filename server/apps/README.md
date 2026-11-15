# server/apps

Apps and forwarded ports: folders in the deck's `apps/` served, built or run, and local servers a
card or an app may frame.

## Owns

- The app and port calls (calls.ts, port-calls.ts); `decks-canvas.js` (guest.ts); open.ts.
- The app as an item kind (item.ts): `{ type: "app", app, box }`, a `browser` node tagged `decks.app`.
- `/app/<name>/` (serve.ts) and `/node/<host>/<port>/`, `/rnode/<host>/<port>/` (ports.ts).

## May import

`protocol/` and `server/kernel/`, through their entry files; node's own modules; `playwright` in
check.ts only. No other feature.

## Rules

1. An app is `apps/<name>/app.json`: `{ title, kind, root, install, build, start, prefix,
   idleMinutes, source, data }`; a name is lower-case letters, digits and dashes, 48 at most; kind is
   `static` (default), `build` or `server`. With no source its source is deck files (`ctx.deck`).
2. An in-deck app builds and runs in a copy outside the deck, `<machine>/app-run/<deck id>/<name>`
   (the kernel's user-only machine folder and deck id), so the deck holds no node_modules or build.
   Its data folder (app.json `data`, default `data/`) is the deck's: while it runs, what the app
   writes there reaches the deck, as the app, and what a call writes there reaches the copy.
3. A build installs when `package.json` names dependencies, then runs `build` (for kind build,
   `npm run build`). A static app needs neither and is `running` at once.
4. A server app is started with `PORT`, `HOST=127.0.0.1` and `BASE_PATH=/app/<name>`; it is
   `running` once its port answers, `broken` if it exits first or 45 s pass. Commands inherit no
   secret (`*_TOKEN`, `*_KEY`, `*_SECRET`, provider keys).
5. build and run wait up to 15 s, then answer the status; a second call joins the job. A server
   app unseen for `idleMinutes` (10) sleeps; the next request starts it. Every process is in its own group and the whole group is stopped. The feature's stop stops all.
6. `/app/<name>/<path>` serves a static app's file from the deck, a built app's from its `root`
   (`dist`) in the running copy, a path with no file its `index.html`, and proxies a server app,
   the path inside the app unless `prefix`. Each upstream request has its own connection, closed
   when it ends, with a 60 s limit: a proxy never keeps a socket. In a frame the pass rides in the
   path, `/app/t/<pass>/<name>/`, so the page's relative addresses carry it.
7. An app's log keeps its last 600 lines, in the feature's store across restarts.
8. app.create writes a starter (`static`, `node`, `solid`, `react`, `next`) into a new folder and
   commits it: every app is a git repository where it runs. clone takes a repository in.
9. app.delete stops it, trashes `apps/<name>` (an outside source stays), and unplaces its items.
10. app.check loads the app in a browser: its status, errors, failed requests, title and words.
11. A port is forwarded by number, 1 to 65535, kept in the store. `/node/<host>/<port>/x` passes
   `/node/<host>/<port>/x` on; `/rnode/<host>/<port>/x` passes `/x`. A port not forwarded is 404.
12. Every HTML page of a static or built app gets `decks-canvas.js` first in its head, and the
   script is served at any path ending in that name: storage and wheels inside the canvas frame.
13. `POST /app-pass/<name>`, on a canvas pass, opens an app placed on that canvas, not a shared one,
   inside it: `{ url: /app/t/<pass>/<name>/ }`; an app told its base path answers 409, `tab`.
14. `source: { path, repo? }` in app.json says the source is a folder on this machine. The file
   calls see only the record; the app builds and runs in that folder, its git its history.
15. Only the person names a folder: create's source, clone's `to`, update's source and app.move.
   Another caller is refused, hint the call as the person. A folder must be absolute, not `/`, a
   home itself, a system folder or under a hidden one; a new app's folder must be missing or empty.
16. A source folder not on this machine makes the app `missing`; app.clone with `to` takes it again.
17. app.move copies the source to the folder and keeps only app.json in the deck, with source.

## Check

- `node tools/check.mjs server`
- `node tools/gates/run.mjs`
