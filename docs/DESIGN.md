# Decks: how it is built

Decks is a canvas you share with AI agents. An agent answers on the canvas with a drawing, a
**card** (a piece of HTML it designs), a **document** you can type into, or an **app**; you pan,
zoom, drag and retype what it made. This page describes the system as it is now. The reasoning
of the board era, much of which still holds, is in
[`archive/DESIGN-boards-era.md`](archive/DESIGN-boards-era.md).

## 1. The parts

| Part | Where | What it does |
| --- | --- | --- |
| The harness | `apps/server` | One Node process per deck: the files, the agents, the verbs, the pictures, the sockets. |
| The app's page | `apps/web` | The chrome around the canvas: the agent panel, the composer, settings, the canvas manager. |
| The canvas frame | `packages/canvas` (`frame/`) | The canvas itself, its engine and every card on it, in a sandboxed page of its own. |
| The stage engine | `packages/stage` | Rust built to WebAssembly: draws the drawing and the cards' pictures with WebGPU or WebGL 2, in a render worker. |
| The verb table | `packages/api` | Every call Decks answers, declared once; the routes and the SDK are made from it. |
| The SDK | `packages/sdk` | The verbs three ways: a TypeScript client, the `decks` command, an MCP server. |
| The wire | `packages/protocol` | What the page and the harness say on the socket and the event stream. |
| Documents | `packages/docs` | `.md`, `.tex` and `.docx` files opened as pages you type into. |
| Sharing | `packages/hub`, `packages/sync-client`, `packages/sync-protocol` | The canvas folder layout, and keeping a deck in step with Decks Studio. |
| The runtime | `runtime/` | What agents read: the deck context template, the command reference, guidelines, skills. |

Decks Studio, a separate product, is a front end on many harnesses: it syncs their canvases and
draws them with the same `@decks/canvas`.

## 2. The deck is a folder

Everything a person makes is a file in the deck folder (`data/decks` in a checkout, or
`DECKS_DATA_DIR`), so a deck is backed up, diffed and moved like any folder:

```
deck/
  canvases/<name>/                  a canvas, standing alone
    canvas.pen  canvas.json         its drawing (a pen.dev file) and its title
    cards/<card>/index.html         its cards, each a folder with what it keeps beside it
    frames/  files/                 its saved frames, and the pictures and files it uses
  shared/canvases/<owner>/<name>/   a canvas a friend shared, the same shape
  assets/  docs/  apps/             the deck's own, pointed at by their deck path
  lib/                              the page runtime a card page loads, copied in and refreshed
  .decks/                           revisions, tokens, the Studio key, trash
```

A canvas may point at its own folder and at the deck's `assets/`, `docs/` and `apps/`, never at
another canvas, a hidden folder or outside the deck (`packages/hub/src/layout.ts`); placing
something from elsewhere copies it in. That is what lets a canvas be copied, shared or synced
whole. The rules for a path that becomes a file are in `deck/roots.ts`, which resolves symlinks
before it compares.

When the shape on disk changes, a migration converts it (`apps/server/src/migrations`, one file
per change, named by the day it shipped). The last two turned the deck's boards into cards and
its document and app boards into items. A friend's shared canvas is never rewritten: a board left
on one is drawn as its picture.

Every write the harness makes is recorded as a revision (`deck/snapshots.ts`), content
addressed under `.decks/revisions`, so the timeline can show the canvas as it was at any point
of a conversation and restore it when asked.

## 3. What is on a canvas

A canvas's drawing is a pen.dev document: notes, text, shapes, arrows, icons, frames and refs to
saved frames, edited by hand and by agents in the same operations (`@decks/pen`). Three kinds of
item carry more than a drawing:

- **A card** is pen's `browser` item tagged `{ type: "decks.card", path }`, read and written
  through the verbs as `{ type: "card", card: <path> }`. Its file is a piece of HTML (no
  `<html>` or `<body>`) that the canvas puts in a closed shadow root of the frame's own page
  (`packages/canvas/src/items/card.ts`): its styles stay inside, its events bubble out to the
  stage, a library two cards import loads once. Its inline scripts are modules, each served at
  its own address beside the card (`index.html.m0.js`, `apps/server/src/cards/cards.ts`), so a
  relative import resolves from the card's folder; the default export is called with the card
  (`card.root`, `card.decks`, …) each time it wakes. A card opened by itself, or pictured, is the
  same piece in a page of its own (`cardPage`), at `/api/card/<path>`.
- **A document** is `{ type: "browser", metadata: { type: "decks.document", path } }`: a file in
  the deck opened as a page you type into. Keystrokes reach the file as splices, another writer's
  edits come back as changes to accept or reject, and every pause is a version (`packages/docs`).
- **An app** is `{ type: "browser", metadata: { type: "decks.app", name } }`: a folder in
  `apps/<name>/` that the harness serves (`static`), builds (`build`) or runs and puts to sleep
  (`server`), shown on the canvas as the app itself at `/app/<name>/` (`apps/server/src/apps`).

Only the person and agents make document and app items; a card's script may move, size or delete
one, never make one or change what it names (`verbs/router.ts`, `touchesTrustedItems`).

## 4. Trust

Who is calling is a token or a pass, and nothing else: no header, address or machine says it
(`auth/guard.ts`, `auth/tokens.ts`, `auth/passes.ts`).

- **A harness token** (`dk_h_`) is the person (a Decks tab, a terminal after `decks login`), a
  site the person paired (Studio, a second Decks), or one agent. Only its hash is kept; it slides,
  lasting a day unused (an agent's lasts as long as the agent runs).
- **A canvas pass** (`dk_cp_`) is the canvas frame's one credential: one canvas, your role there,
  an hour, renewed by the page unseen. It is signed with the pass secret (kept in
  `<data dir>/ticket-secret`) and stored nowhere; every use checks the token that asked for it and
  your role now. It goes in the `Authorization` header for calls, and in the address for files and
  pictures (`/api/t/<pass>/card/…`), since an image or a module cannot send a header.
- **An app pass** (`dk_ap_`) is one app's: its server gets one as `DECKS_TOKEN` for that run, and
  a tab another site opens it in carries one in its address.

**The canvas frame is the sandbox.** It is a page of its own origin with `allow-scripts`, holding
nothing but its canvas pass, so a card's script can reach neither the app's page nor the person's
token. Each verb says where a card's call to it goes (the table's `card` column,
`frame/inside/card-calls.ts`): the person's view and the time are answered in the frame; the
canvas's own calls go to the harness on the canvas pass, which refuses anything else
(`CANVAS_FRAME_VERBS`); an agent call goes to the app's page, which asks the person first; and
anything that reaches past the canvas is refused. A canvas shared with you to view reads only.

A card from a friend's canvas runs no scripts: they are cleaned out before it is placed and never
served. An app calling the verbs is asked about once ("Allow until Decks restarts", "Always
allow"), remembered in `AppTrust` (`auth/app-trust.ts`).

## 5. The verbs

`packages/api/src/verbs.ts` is the API. Each entry names a call (noun then verb: `canvas.insert`,
`card.create`, `agent.send`), what it touches (`deck`, `screen`, `agents`, `outside`), whether it
changes it, its parameters and its result as schemas. From it:

- the harness makes a route of each (`POST /api/v1/<name>`), checks the arguments against the
  schema before the handler runs, and answers `{ ok, value, notes }` (`verbs/router.ts`);
- `scripts/gen-sdk.mjs` writes the SDK's types and verb list, `verbs.json` for the command and the
  MCP server, and `runtime/decks-commands.md`, the reference every agent is given.

Calls are stateless: every canvas call takes `{ canvas }`, and left out it means `decks.here()`,
the caller's home canvas. The old names (the board verbs, `newBoard`, `pen.edit`, …) still answer
until 2026-11-30, each with a note naming its new call, and the harness logs the first use of each.

`GET /api/v1/events` streams every change the harness broadcasts as Server-Sent Events, the same
messages the page hears on its socket (`card.changed`, `stage.pen.delta`, `agent.state`, …).

## 6. The canvas in the browser

The app's page makes the frame (`createFramedEditor`), gives it `start` and a `MessagePort`, and
after that trades only what is the page's: its chrome, the composer, your storage
(`frame/protocol.ts`). The frame reads its drawing from the harness on its pass, follows its
canvas's event stream, and sends your edits itself; the page never relays the drawing.

Inside the frame, the editor (`packages/canvas`) keeps the drawing as a model, sends each edit as
pen operations, and hands the engine what to draw. The engine draws the drawing and, for each card
that is not live, its **picture**; only the cards near the screen and at a readable zoom are live
DOM, within a budget per device. Panning is native scrolling over the engine's canvas.

**Pictures** are taken on the server by its own Chromium (`pictures/service.ts`): a card is a page
of its own, and the server is the one place that can reach every card without anybody opening it.
One browser, two pages at a time, newest request first, kept on disk by path, revision and scheme,
at a ladder of widths (`pictures/ladder.ts`), compressed for the GPU and the wire. A picture of a
whole canvas (`canvas.screenshot`, export) is drawn natively by `stage-shot` over the cards'
pictures where it can, and in Chromium where it must.

## 7. Agents

An agent is a conversation with a runtime: Pi, Claude Code, opencode, OpenCode 2 or Antigravity
(`apps/server/src/runtimes`). Each has a name, a face, tags, a workspace and a home canvas
(`agents/registry.ts`), and its own `DECKS_TOKEN` and the `decks` command in its shell, so
everything it does on the canvas is a verb call as itself.

Its context is the deck: `runtime/AGENTS.md.tmpl` filled in with the deck, its cards and the
command reference (`agents/context.ts`), the guidelines in `runtime/guidelines.txt`, and the
skills in `runtime/skills` (card authoring and debugging, canvas authoring and design, building
apps). Changes to its canvas made by others reach it with its next message.

Agents hand work to one another: `agent.send` delivers now (steering a running turn where the
runtime can), `agent.queue` waits for the turn to end, and a hand-off names the cards it is about,
whose source the receiver is given. Permissions are the runtime's own; the app supplies the
surface for its questions.

## 8. Sync with Studio

A harness with a Studio key (`DECKS_STUDIO_KEY`, or `.decks/studio.json`) keeps its deck in step
with Studio in the background (`apps/server/src/studio`, `@decks/sync-client`): it watches the
folder, pushes and pulls each canvas's drawing as changes and its files by hash, over the
`/sync/v1` routes `@decks/sync-protocol` describes and `@decks/hub` serves. Edits made on both
sides at once are merged. The harness reads and writes its folder as before; nothing else needs
to know.

The key is also the pairing. Studio's browsers are never paired themselves: when one needs the
harness, Studio asks on its socket for a harness token for the person signed in, bound to Studio's
origin and lapsing after an hour unused. Studio draws a harness's canvas with the same canvas
frame, on a canvas pass it asks for, with the cards' pictures the harness uploads. Unpairing deletes
the key and takes back every token given through it.

Canvases friends share arrive in `shared/canvases/<owner>/<canvas>/` with your role there: edit,
where your changes sync back to them, or view, where the only change is your own copy
(`canvas.copyShared`).

## 9. Working on it

- `npm run dev` runs the harness and Vite; `npm run typecheck`, `npm test` and `node e2e/run.mjs`
  are the checks (`e2e/README.md`).
- A new call is an entry in the verb table and a handler in `apps/server/src/verbs`, then
  `node --import tsx scripts/gen-sdk.mjs`; a test fails while the generated files are stale.
- A new message on the socket is a variant in `packages/protocol/src/wire.ts`; the harness's table
  of handlers (`wire/index.ts`) fails to compile until something answers it.
- A change to how the deck is kept on disk is a migration, never a reader that guesses.
