# server/apps

Apps and forwarded ports: folders in the deck's `apps/` served, built or run, and local servers a
card or an app may frame.

## Owns

- `app.list get create update clone build run stop restart delete logs check`, `port.list open close`,
  in calls.ts and port-calls.ts.
- The app as an item kind (item.ts): `{ type: "app", app, box }`, a `browser` node tagged `decks.app`.
- `/app/<name>/` (serve.ts) and `/node/<host>/<port>/`, `/rnode/<host>/<port>/` (ports.ts).
- machine.ts: the app's running copy on this machine, its commands and its processes.

## May import

`protocol/` and `server/kernel/`, through their entry files; node's own modules; `playwright` in
check.ts only. No other feature.

## Rules

1. An app is `apps/<name>/` holding `app.json`: `{ title, kind, root, install, build, start, prefix,
   idleMinutes }`. A name is lower-case letters, digits and dashes, 48 at most. kind is `static`
   (the default), `build` or `server`.
2. An app's source is deck files, read and written through `ctx.deck`, so an app is made with the
   file calls and no disk. A folder with no `app.json` is not an app.
3. To build or run, the source is copied into the app's running copy, a machine folder only
   machine.ts touches; a file is written there only when its bytes differ. What the app's commands
   and its process write (`node_modules/`, `dist/`, its data) stays in the running copy.
4. A build installs when `package.json` names dependencies, then runs `build` (for kind build,
   `npm run build`). A static app needs neither and is `running` at once.
5. A server app is started with `PORT`, `HOST=127.0.0.1` and `BASE_PATH=/app/<name>`; it is
   `running` once its port answers, `broken` if it exits first or 45 s pass. Commands inherit no
   secret (`*_TOKEN`, `*_KEY`, `*_SECRET`, provider keys).
6. build and run wait up to 15 s; still going, the app answers with its status (`installing`,
   `building`, `starting`) and app.get tells the rest. A second call joins the job under way.
7. A server app unseen for `idleMinutes` (10) is put to sleep; the next request to it starts it.
   Every process is in its own group and the whole group is stopped. The feature's stop stops all.
8. `/app/<name>/<path>` serves a static app's file from the deck, a built app's from its `root`
   (`dist`) in the running copy, a path with no file its `index.html`, and proxies a server app,
   the path inside the app unless `prefix`. Each upstream request has its own connection, closed
   when it ends, with a 60 s limit: a proxy never keeps a socket.
9. An app's log keeps its last 600 lines, in the feature's store across restarts.
10. app.create writes a starter (`static`, `node`, `solid`, `react`, `next`) into a new folder, and
   refuses a folder that has files. Every app is a git repository in its running copy:
   create commits the starter, clone takes a repository in and writes its files to the deck.
11. app.delete stops it, moves `apps/<name>` to the deck's trash, and deletes its items on every
   canvas.
12. app.check loads the app in a browser and answers what went wrong: the status, uncaught errors,
   failed requests, the title and the words.
13. A port is forwarded by number, 1 to 65535, kept in the store. `/node/<host>/<port>/x` passes
   `/node/<host>/<port>/x` on; `/rnode/<host>/<port>/x` passes `/x`. A port not forwarded is 404.

Not yet: the kernel's routes are buffered, so the proxy carries GET and POST, not a websocket.

## Check

- `node tools/check.mjs server`
- `node tools/gates/run.mjs`
