---
name: app-building
description: Build an app the person can use on the canvas, as a folder in apps/<name>/ that Decks serves, builds or runs and shows on the canvas as the app itself. Use when they ask for an app, a tool, a game or a dashboard with its own pages, data or server, rather than a card to read.
---

# Building an app

An app is a folder, `apps/<name>/`, that you write with your own tools. Decks serves it at
`/app/<name>/` and shows it on the canvas as the app's own item (`app.board`, a small page Decks
writes for it): a bar (Running, Building, Asleep, Broken; Reload, Restart, Open, Log) over the app
itself. It reloads the app by itself when you
change a file, finish a build or restart the server.

## Pick the lowest rung that does the job

| Rung | Pick it when | Starter |
| --- | --- | --- |
| **A card** | One screen with a few controls. Not an app. | `decks card create` |
| **static** | Pages and scripts, no build. Libraries from a CDN. Data in `localStorage`. Most apps. | `static` |
| **server** | Data shared or kept on disk, an API key, code that cannot run in a page. | `node` (no packages) |
| **build** | You need JSX or a framework's compiler. | `react`, `solid` |
| **server, built** | Server rendering, with Next.js. Install is 370 MB and about 40 s. | `next` |

## The loop

As commands (`decks apps create polls --starter node`, `decks apps run polls`, `decks apps check polls`), or in a
node script, where `const { decks } = await import(process.env.DECKS_SDK)` gives the same calls:

```js
const app = await decks.apps.create("polls", { starter: "node", title: "Polls" });
// Write the files in app.folder with your own tools, then:
await decks.apps.run("polls");          // a server app; a built one: decks.apps.build
const seen = await decks.apps.check("polls");   // read seen.verdict; seen.file is a picture
await decks.canvas.insert({ type: "board", board: app.board }, { at: { x1: 0, y1: 0 } });  // an app is still placed by its page
```

- **`check` is to an app what `decks canvas fit` is to a card.** It opens the app in the server's browser and
  reports uncaught errors, failed requests and a page with no text. Fix what it says before you
  show it. Look at its picture when the page is visual.
- After you change a **server's** code, call `decks.apps.restart(name)`. The old process keeps
  serving the old code until you do. After you change a **built** app, call `build` again.
  A static app needs nothing.
- `build`, `run`, `restart` and `check` wait up to 15 s. `pending: true` means it is still
  installing or building: ask `decks.apps.status(name)` on your next call. `ok: false` comes with
  the error lines, and `decks.apps.logs(name)` has the rest.

## Every app is its own git repo

`create` makes `apps/<name>/` a git repository on `main` with the starter as its first commit;
`decks apps repo <name>` does the same for a folder you wrote by hand, and says its branch, last
commit and changed files. To share an app, push it:
`git -C apps/<name> remote add origin <url> && git -C apps/<name> push -u origin main`. To take
one in, `decks apps clone <url>` (https:// or git@host:path) adds it with its page on the canvas; read its files
before you run it. Keep secrets in `.env`, which the repo ignores.

## Rules that are easy to break

- **Use relative addresses.** The app lives under `/app/<name>/`, so write `fetch("api/items")`
  and `href="style.css"`, never `/api/items`, which points at Decks itself. Vite needs
  `base: "./"`, which the starters set.
- **A server listens on `process.env.PORT`**, on `127.0.0.1`. It sees the path inside the app
  (`/api/items`). Next.js is the exception: it is told its base path, so its `app.json` says
  `"prefix": true`, and `basePath: process.env.BASE_PATH` goes in its config.
- **Keep data in files in the app's folder**, not in memory. A server sleeps after ten minutes
  out of view on the canvas, and the next request starts it again.
- **Keys never go in a page.** A server app reads them from a file in its folder.
- Do not write in `node_modules/`, `dist/` or `.decks/`; they are generated.

## An app can call Decks' verbs

An app gets the verbs you have, through Decks' SDK, acting for the conversation the person is
reading, under the name `app <name>`. Use them to hand work to an agent, show a card, or read the
canvas. The person is asked once to allow it, and every call is noted in their chat.

```js
// A server app: Decks says where the SDK is, and which app it is.
const { decks } = await import(process.env.DECKS_SDK);
// A page: import { decks } from "../../api/sdk/decks.mjs";

await decks.canvas.read();                                             // any call, as the decks command has it
await decks.sendTo({ name: "Helper", kind: "claude" }, { task: "…" }); // made when missing
```

- Arguments and results are JSON. Hand long work over with a send, and read its result from a file
  the agent writes in your app's folder.
- Keep the calls in your server, not in the page, when the server can make them: then what the app
  may do is in one file somebody can read.
- `packages/sdk/README.md` has the rest, and `examples/mcp-server.mjs` is an MCP server on it.

## Recipes

- **A library in a static app:** `import { marked } from "https://esm.sh/marked@14";`, inside a
  `<script type="module">`.
- **Live updates for everyone:** Server-Sent Events. The server answers `GET api/events` with
  `content-type: text/event-stream` and writes `data: …\n\n` on each change. The page uses
  `new EventSource("api/events")`. They pass through Decks, as websockets do.
- **`app.json`:** `kind` (`static`, `build` or `server`), `title`, `start`, `build`, `install`,
  `root` (what to serve; `dist` for a build), `prefix`, and `idleMinutes` (10 by default).
