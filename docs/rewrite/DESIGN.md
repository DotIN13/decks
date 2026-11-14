# The rewrite: design of record

Written 2026-11-14 by Mason (the integrator) from the design the person approved on the "Decks Studio"
canvas. This file is what every agent on the rewrite builds to. If the code and this file disagree,
say so to Mason; do not quietly follow either. `WORKING.md` beside this file says how we work.

Base: branch `rewrite`, cut from `origin/dev` at `c669a67f`.

## 1. Why

Measured on `dev`: 559 source files, 116,000 lines, a third of the bytes comments; 71 files over 400
lines hold 47% of the code; one call (`canvas.paste`) touched 12 files in 4 packages; `board` is still
written 5,205 times and `stage` 2,936 times for what is now a card and a canvas; 18 pairs of folders
import each other; agents reach the canvas code as functions in the same process. The rewrite makes one
change stay in one folder, and separates the canvas from the agents.

## 2. The whole system

Three repos on one protocol.

- **decks** (this repo, public): the protocol, the two programs that run on a person's machine, the
  libraries, the clients.
- **decks-studio** (private): the same server, hosted, plus its website.
- **decks-ios** (private): a client with a screen and an agent of its own.

Two programs answer the protocol's calls (servers): **Decks-local** (`server/` here) and Studio. Everything
else calls them: the harness (`harness/` here), Claude Code and Codex (through `clients/`), the iPad app,
apps and cards, a browser tab.

Three doors, one table of calls:

- **the `decks` command and files**, for a client with a shell and the deck's disk (Claude Code, Codex,
  agents the harness runs). Files are a shortcut, never a requirement.
- **MCP**, for a client with neither (the iPad app, an agent in the cloud).
- **a socket (WS)**, for anything with a screen or that must be woken; HTTP for apps and cards.

**The calls are complete without the disk.** Everything an agent can do to a deck it can do through calls
alone. Today no call reads or writes a card's content; eleven new calls close that (section 5).

## 3. This repo: ten folders

Imports go one way. `server/` and `harness/` never import each other; they share only `protocol/`.

```
AGENTS.md            the map: what is where, the glossary, the commands, the rules (150 lines)
protocol/            what every program agrees on; touches no disk and no network
  glossary.ts        the nouns, and the retired words: board, stage (see section 5, Words)
  schema.ts          the small schema builders (str, obj, arr, opt, …) and the type they infer
  shapes.ts          Box, Size, Point, Item, Card, Canvas, Agent, App, Message, …
  call.ts            defineCall, Caller, the five refusal codes
  event.ts           defineEvent
  calls/<noun>.ts    one file per noun: deck canvas item card file frame app port agent view tab studio,
                     and the harness's own: chat account runtime
  events.ts          every event
  layout.ts          the deck folder's layout and path rules
  sync.ts            the messages a server and Studio exchange
  version.ts         the protocol's version
server/              Decks-local, the canvas server
  main.ts            builds the kernel, hands it the list of features; the only place a feature is named
  kernel/            deck.ts history.ts callers.ts router.ts events.ts feature.ts lockfile.ts
                     doors/http.ts socket.ts mcp.ts      (names no feature)
  canvas/            item.* canvas.* frame.*   the drawing and its ops
  cards/             card.* file.*             cards and every file in the deck
  documents/         files you type into: splices, versions, review, Google Docs
  apps/              app.* port.*              app folders served, built or run
  pictures/          card pictures, screenshots, fit, export
  people/            agent.* view.*            who is here, mail, hosts, views; starts no one
  tab/               tab.*                     the shared Chrome tab
  sharing/           studio.*                  sync with Studio, friends' canvases
  upgrade/           migrations for old decks
  compat/            old call names and routes, each with the date it goes
harness/             the agents app, a client of the server
  main.ts host.ts calls.ts voice.ts
  sessions/          session.ts queue.ts transcript.ts timeline.ts identity.ts tools.ts
  runtimes/          runtime.ts claude/ pi/ opencode/ antigravity/
  accounts/          logins and usage limits
  prompts/           what an agent is told: the template, guidelines, skills, the generated reference
  page/              shell/ chat/ composer/ agents/ canvases/ settings/ state/ styles/
canvas/              the canvas page, a library (today's packages/canvas, docs/page, card-host, ink)
engine/              the Rust drawing engine (today's packages/stage)
pen/                 the drawing's file format (today's packages/pen)
ui/                  controls that know nothing of Decks (today's packages/ui)
clients/             sdk/ cli/ mcp/ attach/ extension/
tools/               gates/ gen/ measure/ checks/ fixtures/
docs/
```

**Inside a server feature**, always the same names:

```
server/canvas/
  README.md     60 lines: what it owns, what it may import, its rules, how to check it
  feature.ts    its one export: defineFeature({ name, calls, items, start })
  calls.ts      one short handler per call; a long one moves to a file of its own beside it
  doc.ts ops.ts place.ts …   its modules, each under 400 lines, each with its test beside it
  checks/       its browser checks, in TypeScript
```

A feature imports the kernel and the protocol, never another feature's files. A part of the harness's
page is three files: `model.ts` (state and rules, no DOM, unit-tested), `view.tsx`, `actions.ts`.

**Who may import whom**

| folder | may import |
|---|---|
| `protocol/` | nothing |
| `pen/`, `ui/`, `engine/` | `protocol/` at most |
| `canvas/` | `protocol/`, `pen/`, `ui/`, `engine/` |
| `server/` | `protocol/`, `pen/`, `engine/` (for pictures) |
| `clients/` | `protocol/` |
| `harness/` | `protocol/`, `clients/sdk`, `ui/`, the canvas's host entry |

**Where today's code goes**: `apps/server` → `server/` (its `agents/` and `runtimes/` → `harness/`, the
record half of `agents/` → `server/people/`); `apps/web`, `packages/agent-ui` → `harness/page/`;
`packages/api`, `protocol`, `sync-protocol`, hub's `layout.ts` → `protocol/`; `packages/hub`,
`sync-client` → `server/sharing/`; `packages/canvas`, `card-host`, `ink`, the page half of `docs` →
`canvas/`; the server half of `docs` → `server/documents/`; `packages/pen` → `pen/`; `packages/stage` →
`engine/`; `packages/sdk`, `extension/` → `clients/`; `runtime/` → `harness/prompts/`; `scripts/`,
`e2e/` → `tools/`. In `apps/server/src`: `app.ts http.ts ws.ts line.ts config.ts static.ts auth/ deck/
routes/ lib/` → `kernel/`; `verbs/` → each feature's `calls.ts` (the router → kernel); `stage/` →
`canvas/`, `pictures/`, `people/`; `cards/ files/` → `cards/`; `docs/ google/` → `documents/`; `apps/
ports.ts` → `apps/`; `pictures/` → `pictures/`; `browser/` → `tab/`; `share/ studio/` → `sharing/`;
`migrations/` → `upgrade/`; `wire/` → `compat/`.

New code is built **beside** the old. `apps/` and `packages/` stay untouched and working until the
switch-over at the end of wave 2. Libraries that only move (`pen`, `ui`, `engine`, `canvas`) are imported
by their current package names until they move.

## 4. Nine abstractions

Each is one type in one file.

```ts
// 1. Deck — server/kernel/deck.ts. Every read and write of a deck. Nothing else touches node:fs.
//    Decks-local implements it on a folder, Studio on a database, tests in memory.
interface Deck {
  read(path: DeckPath): Promise<Bytes>
  write(path: DeckPath, bytes: Bytes, by: Caller): Promise<Revision>   // recorded and announced
  remove(path: DeckPath, by: Caller): Promise<Revision>               // file.delete; to the deck's trash
  move(from: DeckPath, to: DeckPath, by: Caller): Promise<Revision>   // file.move
  list(dir: DeckPath): Promise<Entry[]>
  watch(on: (change: FileChange) => void): Stop
}

// 2. Caller — protocol/call.ts. Worked out once at the door from a token or a pass.
type Caller = { kind: "person" | "agent" | "app" | "card"; id: string; name: string; canvas?: string }

// 3. Call — declared once in protocol/calls/<noun>.ts, handled once in a feature's calls.ts.
export const move = defineCall({
  name: "item.move",
  summary: "Move an item to a corner, beside another, or into a frame.",
  who: ["person", "agent", "card"],
  args: { id: str(), to: Place },
  answer: Item,
})
handle(move, (ctx, { id, to }) => ctx.canvas(to.canvas).apply([{ op: "move", id, ...to }]))

// 4. Event — protocol/events.ts. One stream; each listener gets what it may see.
export const itemChanged = defineEvent("item.changed", { canvas: str(), ids: arr(str()), by: str(), rev: int() })

// 5. CanvasDoc and Op — server/canvas/doc.ts, ops.ts. A drawing changes only by ops.
interface CanvasDoc {
  read(query?: ItemQuery): Item[]
  apply(ops: Op[], by: Caller): { items: Item[]; rev: number }   // all or none
  since(rev: number): Change[]                                  // undo, sync and news all read this
}

// 6. ItemKind — one kind of thing on a canvas, said once per side.
defineItemKind({ type: "card", fromPen(node), toPen(item), files(item), picture(item, size) })   // server
defineSurface("card", { awake(el, item) { … }, asleep: "picture" })                              // canvas

// 7. Feature — server/kernel/feature.ts. The only way code enters the server.
export default defineFeature({ name: "canvas", calls, items: [note, frame, arrow], start(kernel) { … } })
startServer({ features: [canvas, cards, documents, apps, pictures, people, tab, sharing] })

// 8. Host — harness/host.ts. A client's line to the server.
interface Host {
  decks: Decks                                              // every call, typed, from clients/sdk
  on<E>(event: E, hear: (it: Payload<E>) => void): Stop
  mail(agent: string, deliver: (m: Message) => void): Stop
  offer(kinds: AgentKind[], start: (spec: AgentSpec) => Promise<void>): void
}

// 9. Runtime and Session — harness/runtimes/runtime.ts, sessions/session.ts. Exists today as AgentRuntime.
interface Runtime { kind: AgentKind; capabilities: Capabilities; available(): true | { reason: string }; start(session: SessionContext): Promise<Backend> }
```

A handler's context is `ctx = { caller, deck, canvas(name?), events, note(text) }`. A handler never sees
a token and cannot tell whether it runs on Decks-local or Studio.

## 5. The protocol's grammar

1. **One table for every caller.** Each call lists who may call it: person, agent, app, card. Today
   there are two tables (77 calls for agents in `packages/api/src/verbs.ts`, 49 for the person in
   `person.ts`) with different words for the same thing.
2. **A name is `noun.verb`**, the noun singular, and a noun means one thing: `canvas` is the canvas,
   `item` is what is on it.
3. **A verb means the same on every noun**: `list get create update delete move copy`. An item's verbs
   are pen.dev's own ops (`insert update replace delete move copy`), so a batch is a list of the same words.
4. **Arguments come in one order**: the thing, the change, then options. `canvas` is always an option and
   defaults to the caller's "here". On the wire, arguments are one object keyed by name.
5. **A change answers with the thing as it now is** (`Item`, `Card`, `Canvas`, `Agent`, `App`); a delete
   answers `{ deleted }`; a list answers a list. Notes ride beside the value.
6. **A refusal is `{ code, message, hint }`**. Codes: `invalid`, `not_found`, `refused`, `conflict`,
   `unavailable`. The message is a sentence that says why; the hint names the call that would work.
7. **An event is `noun.verbed`** with `{ canvas?, ids, by, rev }`. A snapshot is a call, never an event.
8. **One geometry, one kind of path**: `Box { x1, y1, x2, y2 }`, `Size { w, h }`, `Point { x, y }`; a path
   starts at the deck's root.

**Words.** The glossary retires only a word with no meaning left in new code: `board` (it is a card)
and `stage` (it is a canvas; the Rust engine's own crates are exempt). `verb` is not retired: a call's
name is a noun and a verb, though the thing itself is always a **call**, never "a verb". `ports` is not
retired: `port` is a noun, and a list of them is `ports`. A rename of one call (`web.*` to `tab.*`) is a
row in `calls.md`, not a retired word.

Envelope: `{ ok: true, value, notes }` or `{ ok: false, error: { code, message, hint }, notes }`.

**Nouns and verbs** (about 90 calls on the server):

| noun | verbs |
|---|---|
| `deck` | get · now · pair |
| `canvas` | list · get · create · update · delete · copy · here · undo · screenshot · export |
| `item` | list · get · insert · update · replace · delete · move · copy · batch · clip · paste · space · variables |
| `card` | list · get · create · fit · claim · url |
| `file` | list · find · read · write · edit · grep · move · delete · url |
| `frame` | list · get · create · save |
| `app` | list · get · create · clone · build · run · stop · restart · delete · logs · check |
| `port` | list · open · close |
| `agent` | me · list · get · create · update · attach · host · send · queue · inbox · news |
| `view` | get · move · focus · goto · cursor · reload |
| `tab` | status · pair · open · read · screenshot · fill · select · click · press · submit · stop |
| `studio` | status · connect · disconnect |

The harness answers about 25 more by itself, for the person only: `chat.*`, `account.*`, `runtime.*`.
Studio adds 14 of its own in its repo: `account.*`, `share.*`, `machine.*`.

**The eleven new calls**: `file.list find read write edit grep move delete` (fenced to the deck; a file
written through a call carries its author), `agent.attach` (trades a person's login for an agent's own
token, name and colour), `agent.news` (what changed on the caller's canvas since it last asked, and its
mail), `agent.host` (a client says which kinds of agent it can start).

**What breaks the grammar today, and what it becomes**: `canvas.delete(id)` removes an item while
`canvas.remove` removes a canvas → `item.delete`, `canvas.delete`. `card.move` (person) and `canvas.move`
(agent) → `item.move`. `agent.add`/`agent.create`, `agent.set`/`agent.update` → `agent.create`,
`agent.update`. `canvas.edit` and `canvas.batch` → `item.batch`. `apps.*` → `app.*`, `web.*` → `tab.*`,
`here` → `canvas.here`, `now` → `deck.now`, `ports` → `port.*`, `pair.code` → `deck.pair`. Answers like
`{ stopped: true }` → the thing as it now is. Boxes as `{ x, y, w, h }` and sizes as `{ width, height }`
→ `Box`, `Size`. Events `agent.list`, `chat.delta`, `stage.pen` → `agent.changed`, `chat.added`,
`item.changed`. An old name keeps answering for one release from `server/compat/`; after that its refusal
names the new call.

**Versions**: the protocol has a version, said when a client connects. Within a major, calls are only
added. A gate compares the table with the last released one. The other two repos pin a released version.

## 6. Ten rules, each a gate

Each gate starts from a list of what breaks its rule today; a change may shorten the list, never add to it.

1. A file holds 400 lines at most, a function 80.
2. One name per thing: one glossary; a retired word lives only in `compat/` and `upgrade/`.
3. Imports go one way (the table in section 3), through a folder's entry file only.
4. A call is declared once in the protocol and handled once; everything else is generated.
5. Every folder has a README of 60 lines at most: owns, may import, rules, how to check.
6. A comment states the rule in 5 lines or fewer; the story goes in a numbered record in
   `docs/decisions/`, which the comment cites.
7. A commit title is 72 characters at most; the body says why and what was checked.
8. A part of the page is three files: model, view, actions.
9. Changing values live in a store, never loose at the top of a file.
10. Nothing built is in git: engine binaries and generated tables come from the build; styles are scoped
    to their part, so their order decides nothing.

Plain words and short sentences in comments, READMEs and messages. No em dashes.

## 7. Rules first, not comparison

A folder is rebuilt from written rules, not ported line by line and not compared with the old code by a
harness. Write the rules in the folder's README, write tests from those sentences, then the code. The
old code is where you learn what the rules are; the old browser checks are the acceptance at the
switch-over.

## 8. Waves

- **Wave 0**: Lexicon (the protocol, the kernel's interfaces as types, the generators) and Warden (the
  map, the gates, the fixtures, a type-check project per folder). **Stop 1**: the person approves the
  table of calls.
- **Wave 1**: Keel `server/kernel/` and `server/main.ts`, Easel `server/canvas/`, Folio `server/cards/` and `documents/`,
  Roster `server/people/` and `sharing/`, Lexicon `clients/`. **Stop 2**: Decks-local runs alone, Claude
  Code attaches and makes a card, a client with no disk builds a card and a document (an app joins this
  check at stop 3, when `server/apps/` exists).
- **Wave 2**: Depot `server/apps/ pictures/ tab/`, Helm `harness/` (not `page/`), Pane `harness/page/`,
  Loft (decks-studio), Slate (decks-ios); then Warden switches over. **Stop 3**: the 87 browser checks
  pass on two processes.
- **Wave 3**: Loom `canvas/ pen/ ui/` (on today's TypeScript editor: the person chose on 2026-11-14 to
  leave the `editor-remodel` branch out), Anvil the engine for Metal (the person chose it on 2026-11-14), after which Slate drops
  the iPad app's Swift drawing code.
