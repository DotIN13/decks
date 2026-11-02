# Matching Decks Studio to the reorganized tree

How Decks Studio's `cards` branch moves from the decks commit it is pinned to onto the reorganized
`studio-canvas`, what breaks on the way (very little), what the new tree offers it, and the order to
do it in. Written 2026-11-02 against Studio `1b0d0ee` (branch `cards`, decks pinned at `443dc4d`
of 2026-10-30) and decks `a34df42` (the tip of `studio-canvas` after the reorganization).

Everything in §2 and §3 was measured, not read off: Studio's `vendor/decks` was pointed at a checkout
of `a34df42`, its workspaces installed, and its checks run. §7 says exactly how.

## 0. Where this stands

Done on Studio's branch `match-decks-reorg` (from `cards`), four commits, 2026-11-02: the bump to
`d4b2bcc` and then `703a515` (§6 step 1), the four lines (step 2), and the verbs in place of the alias
routes (step 5, §4.2) for all eight helpers, with two answers widened in decks for it (`chat.rewind`
returns the taken-back words, `chat.fork` the new agent's name). Left: a browser against a harness
(step 3), presence (step 4), `sheet` (step 6).

## 1. Where Studio stands

Studio vendors this repository as the submodule `vendor/decks`, lists fourteen of its packages as
workspaces (`pen`, `stage`, `canvas`, `ink`, `protocol`, `api`, `docs`, `sdk`, `sync-protocol`, `hub`,
`sync-client`, `card-host`, `ui`, `agent-ui`), and imports only their entry points: 19 specifiers, 120
names, every one of which still resolves at the tip (`scripts/public-entries.test.mjs` in this
repository holds the list and checks it on every `npm test`). It drives the canvas as the Decks app
does, `createFramedEditor` on its page and `bootFrame` in its frame, with a `FrameChrome` of its own.
It reads a harness through `@decks/sdk`: the verbs on `/api/v1`, the event stream, and seven routes.

The pin is 500 commits behind the tip. Two kinds of change are between them: the branch's own work
(cards and the canvas frame finished, the harness's one vocabulary, presence), and the
reorganization, which moved files inside the packages and changed no entry point. The second kind is
invisible to Studio by construction. The first is what this document is about.

## 2. What the bump breaks: four lines

With `vendor/decks` at `a34df42` and nothing else changed, Studio installs (`npm install`), its
API and contract typecheck cleanly, its canvas stylesheet builds, and **its web app has two type
errors and two silent listeners**. That is the whole migration.

### 2.1 Two listeners on the harness's event stream say the old names

The harness renamed 21 events in the "one vocabulary" change. The tab socket (`/ws`) still says the
old names to a client whose hello lacks `v: 2`, but **the event stream (`GET /api/v1/events`), which
is what the SDK's `events()` reads, says only the new names**, and its `?types=` filter matches by
name. So two of Studio's listeners hear nothing at the tip:

| file | says | must say |
|---|---|---|
| `apps/web/src/canvas/AgentDialog.tsx` (the `types` list and both handlers) | `extension.ui.prompt`, `extension.ui.prompt.closed` | `agent.prompt`, `agent.promptClosed` |
| `apps/web/src/data/alerts.tsx` (the `types` list and the handler) | `extension.ui.prompt` | `agent.prompt` |

The other names Studio listens for (`agent.state`, `agent.queued`, `chat.item`, `chat.delta`,
`chat.history`) were noun.verb already and are unchanged. `e.type === "hello"` in `routes/canvas.tsx`
is Studio's own `/live` socket, not the harness's, and stays.

The effect at the pin today: a runtime's question to the person (a login, a choice, an editor) never
reaches Studio's dialog or its alert. Nothing else is affected.

### 2.2 `LiveSend` is a union now

`@decks/sync-protocol`'s `LiveSend`, which Studio re-exports through `@studio/contract`, was one
shape (`cursor`) and is a union of two (`cursor` and `presence`, §4.1). `Omit<LiveSend, "type">` of a
union is not what `sendCursor` means, so `apps/web/src/data/live.ts` fails twice:

```ts
// was
export function sendCursor(msg: Omit<LiveSend, "type">) {
	…
	ws.send(JSON.stringify({ type: "cursor", ...msg } satisfies LiveSend));
// is
export function sendCursor(msg: { canvas: string; x: number; y: number }) {
	…
	ws.send(JSON.stringify({ type: "cursor", ...msg } satisfies Extract<LiveSend, { type: "cursor" }>));
```

The one caller (`routes/canvas.tsx`, the pointer-move handler) already passes exactly that.

### 2.3 Nothing else

Measured after those four lines, against `a34df42`:

| check | result |
|---|---|
| `npm install` (workspaces resolved to the tip) | ok |
| `npx tsc -p tsconfig.json --noEmit` (the API, the contract) | ok, before and after |
| `npx tsc -p apps/web/tsconfig.json --noEmit` | 2 errors before, 0 after |
| `npm test` (the API, sync, and decks's own sync client run against Studio) | 502 tests, 0 failures |
| `npx vitest run --root .` (the contract, the page's data layer) | 14 tests, 0 failures |
| `npm run build:css -w @decks/canvas` (the `canvas.css` Studio imports) | ok, 6,590 classes |
| `npm run build -w @studio/web` | ok |

Not measured here: `scripts/demo.mjs` and `scripts/controls.mjs`, which open a browser against a
running harness. The sandbox this was written in has no GPU and headless Chromium's renderer crashes
in it, on any commit. They are the step that wants a Mac (§6).

The routes and verbs Studio calls were checked by name at the tip: `canvas.insert`, `canvas.fit`,
`canvas.screenshot`, `card.list`, `file.url`; `/api/t/<pass>/card/…`, `/api/f/…`, `/api/stt`,
`/api/pair`; and the three alias routes `GET /api/agents/:id/settings`, `POST /api/agents/:id/queue`,
`POST /api/agents/:id/:act` (§5). All answer.

## 3. What changed underneath, so nobody is surprised later

By package, pin to tip, in what Studio touches. None of it is a break beyond §2; all of it is
behaviour Studio may now lean on.

- **`@decks/protocol`**: `names.ts` is new, `EVENT_NAMES` typed over every event and
  `OLD_EVENT_NAMES` for the socket's one-release aliases; `wire.ts` has the renamed events, the line's
  own messages (`line.hello`, `line.call`, `canvas.watch`, `presence.set`), `canvas.changed`,
  `presence.changed`, and the `Presence` and `PresenceBy` types. `ChatItem`, `AgentState`,
  `AgentKind`, `AgentMode`, `ModelOption`, `SlashCommand`, `THINKING_LEVELS` are as they were.
- **`@decks/sync-protocol`**: `Presence`, `PresenceBy`; `LiveSend` and `HarnessSend` are unions
  that carry `presence`; `LiveEvent` has a `presence` member. `SyncRoutes` and `SyncRouteName`, which
  nothing read, are gone. `Changes`, `HarnessApp`, `Inventory`, `Role`, `SyncCanvas`, `SyncFile`,
  `CANVAS_NAME`, `safeSyncPath` are as they were.
- **`@decks/hub`**: `Live` relays `presence` from harnesses and from Studio's own pages to everyone
  who hears the canvas (`present`, `fromHarness`), with a colour per connection; `layout.ts` lost
  `ownedBy`, which nothing read. Studio's API constructs `Live(store)` exactly as before and types
  clean: the relay is on by having the new hub.
- **`@decks/sync-client`**: `HarnessSync` takes `remote.write` and `presence` options, sends a
  person's or agent's presence to Studio, and has an outbox for the harness's own edits
  (`edited`, `pushEdits`). Studio's `harness-sync.test.ts` runs it against Studio's API and passes.
- **`@decks/canvas`**: `FrameHostOptions.sheet` (the frame says a drawer opened over its foot, so
  the page's composer can make way), `CanvasOptions.world`, `CanvasHandle.itemBox`, and `tiles`
  among the address parameters the frame passes on. `@decks/canvas/host` exports `StageEngine` by
  name instead of the engine's whole surface; `PenBar` and `InkBar`, which Studio takes from it, are
  there as before. Inside the package `render/` split into `render/` and `look/`, `CardEditor` is in
  `cards/`, ink in `ink/`, `theme.ts` is at the root, and the 33 `__decks*` globals are two
  (`__decksKnobs`, `__decksProbes`); none of this is behind an import Studio has, and Studio reads no
  `__decks*` global.
- **`@decks/canvas`'s sheets** (`canvas.css` 267 lines changed, `properties.css` +55, `chrome.css`
  18, `ink.css` +8): the branch's features, plus 31 rules nothing wrote removed by the
  reorganization, none of them among the 43 classes Studio's markup uses or the 25 it restyles.
  `dist/canvas.css` is built from the same eight sheets as before.
- **`@decks/ui`**: `cssEscape` is exported. **`@decks/agent-ui`**, **`@decks/pen`**, **`@decks/sdk`**,
  **`@decks/card-host`**: no change to what Studio imports.
- **`@decks/api`**: `person.ts`, the person's verb table (31 verbs marked `who: "person"`), which a
  paired site's token may call on `/api/v1` and which is the way off the alias routes (§5).

## 4. What the tip offers Studio, by priority

### 4.1 Presence: agents' and friends' cursors, selections and cameras

Today Studio draws other people's pointers from its own `/live` `cursor` events (`live.ts`,
`.s-rcur` in `routes/canvas.tsx`), and an agent's cursor is placed at the first item its last edit
touched (`routes/canvas.tsx`, "where an agent's cursor goes"). At the tip:

- A harness sends its agents' and its person's presence to Studio (`HarnessSync.presence`), and
  Studio's `Live` relays it as `presence` events (`{ canvas, by: { kind, id, name, color, harness },
  pointer, selection, camera, gone }`) to every page on that canvas. Studio's `live.ts` handles
  `cursor` and `cursor.gone` and ignores `presence`, so the data arrives and is dropped.
- The canvas frame draws presence itself when it is on a harness's line (`frame/inside/presence.ts`,
  from `presence.changed`): a pointer per person or agent in their colour, a fading leave. On Studio
  the frame is on Studio's line (`studio-line.ts`), which does not carry presence yet.

Two steps, each its own commit in Studio: (1) `live.ts` keeps `presence` events by `by.kind:by.id`
and drops them on `gone`, and `routes/canvas.tsx` draws them where it draws `.s-rcur` today, agents
and people alike, retiring the "first item touched" guess; (2) Studio's own page sends `presence`
(pointer, selection, camera) instead of `cursor`, so a person on Studio is seen the same way on the
harness side. The frame's own presence layer on Studio's line is a third step, in this repository
(`studio-line.ts`), and is not needed for the first two.

### 4.2 Off the alias routes and onto the verbs

`apps/web/src/harness.ts` calls six things on `/api/agents/:id/…`. Each is an alias of a person's
verb that the harness keeps "for one release" (`docs/COMPAT.md`), and Studio's `cards` branch is the
client that keeps them alive. The SDK already has `call(name, args)`; Studio's `verb(p, name, args)`
wraps it. The map, from `apps/server/src/routes/agents.ts`:

| Studio calls | the verb | note on the answer |
|---|---|---|
| `agentSettings(p, id, limits)` → `GET /agents/:id/settings?limits=1` | `agent.settings(id, { limits: true })` | same shape |
| `queueAct(p, id, action, what)` → `POST /agents/:id/queue` | `chat.queue(id, { action, ...what })` | the route answered `{ id, ...queuedMine() }`; the verb's answer is what it tells; `agent.queued` on the stream carries the queue either way |
| `agentAct(p, id, "rename", { name })` | `agent.set(id, { name })` | |
| `agentAct(…, "stop")` | `chat.abort(id)` | |
| `agentAct(…, "remove")` | `agent.remove(id)` | |
| `agentAct(…, "model", { provider, model, thinking? })` | `agent.set(id, { model: { provider, model, thinking } })` | |
| `agentAct(…, "thinking", { thinking })` | `agent.set(id, { thinking })` | |
| `agentAct(…, "mode", { mode })` | `agent.set(id, { mode })` | |
| `agentAct(…, "workspace", { workspace })` | `agent.set(id, { workspace })` (`null` for none) | |
| `agentAct(…, "reset")` | `agent.reset(id)` | |
| `agentAct(…, "account", { id: account })` | `account.use(account, id)` | argument order: the account first |
| `promptAgent(p, id, text, canvas?)` → `POST /agents/:id/prompt` | `chat.send(id, { text, canvas? })` | the route answered `{ id, sent: true }`; Studio's four callers `await` it and read nothing |
| `agentDialogs(p, id)` → `GET /agents/:id/dialogs` | `agent.dialogs(id)` | same shape (`{ dialogs }`) |
| `answerDialog(p, id, answer)` → `POST /agents/:id/dialog` | `agent.answer(answer)` | |

A paired site's token may call every one of these (`verbs/router.ts`: the person's verbs are the
person's or a paired site's, over HTTP and on the line alike), and `GET /api/v1` lists them to that
token. The three `door(…)` helpers in `harness.ts` become `verb(…)` calls; the "this harness may need
updating" fallbacks they carry are for a harness older than the verbs, and can say so for a
harness older than `one vocabulary` instead, or go. When this lands, tell this repository: the
Decks Studio row in `docs/COMPAT.md` names it as the condition for removing the alias routes.

### 4.3 The frame's `sheet` message

On a phone the frame opens a properties drawer over its foot and tells its page (`FrameHostOptions.sheet`),
so the page's composer makes way as under an iOS sheet. Studio's `createFramedEditor` options can pass
`frame: { …, sheet: (open) => … }` and move its dock; without it, nothing breaks.

### 4.4 Looking at the canvas once

The package sheets changed by about 350 lines since the pin, and Studio restyles 25 of their classes
from `packages/ui/src/styles.css` and `canvas/frame-chrome.css`. Nothing Studio uses was removed
(checked by name), but a rule Studio wrote to override one of those classes may now sit on a
different base. `scripts/controls.mjs` presses every control and is the check; a person looking at a
canvas in both schemes, once, is the other.

## 5. What Studio should not do

- **Do not import below an entry point.** The reorganization moved files inside `@decks/canvas` and
  will move more (the engine's collaborators, the `Properties` and `CardEditor` splits are still to
  come). Studio's 19 specifiers are all entry points today; the Studio contract test in this
  repository is what keeps them resolving, and it can only guard what Studio imports through them.
- **Do not read `__decksKnobs` or `__decksProbes`.** They are the browser checks' and the measuring
  scripts'. Studio's own probe is `window.__studio`, and that is right.
- **Do not keep the old event names as a fallback.** The stream never said them; the tab socket's
  aliases go with the Decks iOS app's update, and a client that listens for both names forever is how
  the second vocabulary comes back.

## 6. Sequence

Each is a commit in Studio, each leaving `npm run typecheck`, `npm test` and `npm run vitest` green.

1. **Bump.** `git -C vendor/decks checkout a34df42` (or the tip of `studio-canvas` when this is
   done), `npm install`. The lockfile changes by about 80 lines, most of them npm's own
   `"peer": true` marks. `docs/DEMO.md` still says the pin is `831eff5` and `README.md` lists three
   of the fourteen packages the submodule is for; both lines come up to date here.
2. **The four lines of §2**: `AgentDialog.tsx`, `alerts.tsx`, `live.ts`. The web typecheck is the
   proof; `npm run build -w @studio/web` the second.
3. **A browser.** `scripts/demo.mjs` and `scripts/controls.mjs` against a harness at the same decks
   commit (`DECKS_APP_DIR=$PWD node --import tsx apps/server/src/index.ts` from the decks checkout,
   as `docs/DEMO.md` says), on a machine with a GPU. A runtime's question reaching the dialog is the
   one thing to watch for that no test covers.
4. **Presence** (§4.1), two commits.
5. **Verbs** (§4.2), one commit per helper or one for all six; then the note to this repository.
6. **`sheet`** (§4.3) when the phone layout is next looked at.

After step 2, re-read Studio's imports and bring the contract list in
`scripts/public-entries.test.mjs` up to date; after step 4 it gains `Presence` and `PresenceBy`
from `@decks/sync-protocol` if Studio imports them by name.

## 7. How this was measured

In a sandbox holding both repositories: Studio's `vendor/decks` directory was replaced by a symlink to
a decks checkout at `a34df42`; `npm install --ignore-scripts` resolved the fourteen workspaces to it;
`npm run build:css -w @decks/canvas` built `dist/canvas.css`; `npx tsc -p tsconfig.json --noEmit`
and `npx tsc -p apps/web/tsconfig.json --noEmit` were run before and after the four-line change;
`npm test`, `npx vitest run --root .` and `npm run build -w @studio/web` after it. Every `from
"@decks/…"` import, `verb(…)` call and `/api/…` string in Studio's `apps/` and `packages/` was listed
and looked up at the tip. The event names were traced from Studio's `events(…)` calls to
`packages/protocol/src/names.ts` and to the stream route in `apps/server/src/verbs/router.ts`, which
applies no alias. Node 22 ran it all; Studio asks for 24, and nothing here depended on the difference.
