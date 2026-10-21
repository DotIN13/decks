<!-- Generated from packages/api by scripts/gen-sdk.mjs. Edit the table there, then run the script. -->

```ts
type Item = { type: string; id?: string; board?: string; box?: Box; children?: unknown[]; [key: string]: unknown };
type Box = { x1: number; y1: number; x2: number; y2: number };
type Corner = { x1: number; y1: number } | { x: number; y: number };
type Size = { w?: number; h?: number };
type CanvasOp = { op: "insert"; item: Item; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number } | { op: "update"; id: string; set?: Record<string, unknown>; at?: Corner; size?: Size } | { op: "replace"; id: string; item: Item } | { op: "delete"; id: string } | { op: "move"; id: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number } | { op: "copy"; id: string; as?: string; at?: Corner; parent?: string | null } | { op: "variables"; set: Record<string, unknown>; themes?: Record<string, string[]> | null };
type PenEdit = { op: "insert"; node: PenItem; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "update"; id: string; set?: Record<string, unknown>; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "replace"; id: string; node: PenItem } | { op: "delete"; id: string } | { op: "move"; id: string; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "copy"; id: string; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number }; as?: string } | { op: "variables"; set: Record<string, unknown>; themes?: Record<string, string[]> | null };
type PenItem = { type: string; id?: string; children?: unknown[]; [key: string]: unknown };
type Fit = { board: string; canvas: string; w: number; h: number; notes: string };
type Screenshot = { file: string; width: number; height: number; box: Box; how?: string; note?: string };
type Canvas = { name: string; title: string; open: string[]; boards: number; shared?: { owner: string; role: "edit" | "view"; studio?: string }; studio?: string };
type Board = { path: string; title: string; lastWrittenBy?: string };
type Placement = { board: string; canvas: string; box: Box; clipped?: boolean };
type Agent = { id?: string; name: string; avatar?: string; color?: string; kind?: string; workspace?: string; tags: string[]; canvas?: string; state?: string; queued?: number; model?: string; thinking?: string; mode?: string; avatarChanged?: string };
type Message = { from: string; task: string; boards: string[]; at: number; reply?: boolean };
type Camera = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };
type AppState = { name: string; title: string; kind: AppKind; status: "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken"; url: string; board: string; port?: number; error?: string; seenAt?: number; at?: number; version?: number };
type AppKind = "static" | "build" | "server";
type AppOutcome = { ok: boolean; status: "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken"; ms: number; errors: string[]; pending?: true };
type WebTarget = string | { ref: string } | { name: string; nth?: number };
```

**Canvas: every call takes { canvas }; left out, it is decks.here()**

- `decks canvas read` · `decks.canvas.read(options?: { canvas?: string; frame?: string }): { canvas?: string; frame?: string; title?: string; file?: string; version: string; rev?: number; error?: string; variables?: Record<string, unknown>; themes?: Record<string, unknown>; items: Item[] }`. Everything on the canvas, boards included, each with its box. A board is { type: "board", board: <path>, box }; every other item has pen.dev's own fields. Read it before placing anything. `frame: "frames/<name>"` reads a frame file instead, its items in its own space; this and the item calls below take `frame` in place of `canvas`, and a change to a frame shows on every canvas placing it.
- `decks canvas insert` · `decks.canvas.insert(item: Item, options?: { canvas?: string; frame?: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }): Item`. Add an item to the canvas. A board is { type: "board", board: <path>, width? }; anything else is a pen.dev item (note, text, frame, rectangle, ellipse, arrow, ref). Say where: `at` is its top-left corner; `beside` or `below` (an item's id or a board's path) puts it 160 px clear of that item, tops or lefts aligned; `parent` and `index` put it inside a frame.
- `decks canvas update` · `decks.canvas.update(id: string, change: { set?: Record<string, unknown>; at?: Corner; size?: Size }, options?: { canvas?: string; frame?: string }): Item`. Change an item's fields (`set`), its place (`at`) or its size (`size`). A board can be named by its path; its size here is its size on this canvas.
- `decks canvas replace` · `decks.canvas.replace(id: string, item: Item, options?: { canvas?: string; frame?: string }): Item`. Swap a whole item for another, keeping its id and its place unless the new one says otherwise.
- `decks canvas delete` · `decks.canvas.delete(id: string, options?: { canvas?: string; frame?: string }): { deleted: string }`. Take an item off the canvas. A board's file stays in the deck.
- `decks canvas move` · `decks.canvas.move(id: string, options?: { canvas?: string; frame?: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }): Item`. Move an item: to a corner (`at`), 160 px clear of another (`beside`, `below`), or into a frame (`parent`, `index`; null for the canvas itself).
- `decks canvas copy` · `decks.canvas.copy(id: string, options?: { canvas?: string; frame?: string; as?: string; at?: Corner; parent?: string | null }): Item`. Duplicate an item, with a new id or the one in `as`, at `at` or in `parent`.
- `decks canvas variables` · `decks.canvas.variables(set: Record<string, unknown>, options?: { canvas?: string; frame?: string; themes?: Record<string, string[]> | null }): { variables: Record<string, unknown>; themes?: Record<string, unknown> }`. Set the canvas's colour tokens, per theme such as light and dark: { accent: { type: "color", value: [{ value: "#e5484d" }, { value: "#ff6369", theme: { mode: "dark" } }] } }; null removes one.
- `decks canvas batch` · `decks.canvas.batch(ops: (CanvasOp | PenEdit)[], options?: { canvas?: string; frame?: string }): Item[]`. Several of the changes above in one call, applied together or not at all. Each op is the call of that name with its item or id inside: { op: "insert", item, beside }, { op: "update", id, set }, { op: "delete", id }. A later op can be beside an item an earlier one made. pen.dev's own form, { op: "insert", node, box }, is taken too.
- `decks canvas fit` · `decks.canvas.fit(board: string, options?: { canvas?: string; margin?: number }): Fit`. Set a board's height from its content, measured at the width it has on this canvas; it must be on it. `notes` say what the browser found: the height, the word count, the smallest type, content wider than the board, boxes that cut off their content, and views that break when a control is pressed. Use it instead of a screenshot.
- `decks canvas save` · `decks.canvas.save(id: string, frame: string, options?: { canvas?: string; replace?: boolean }): { frame: string; ref: string; replaced: boolean; overwrote?: boolean }`. Save an item as a reusable frame in frames/ ("frames/ui/card"), and put a ref to it in its place (`replace: false` leaves the canvas alone).
- `decks canvas screenshot` · `decks.canvas.screenshot(options?: { canvas?: string; of?: string | string[] | { x1?: number; y1?: number; x2?: number; y2?: number }; scale?: number; format?: "png" | "jpeg" | "pdf"; to?: string; scheme?: "light" | "dark"; live?: boolean }): Screenshot`. A picture of the canvas, or part of it: drawing and boards together, saved to `file`. `of` is an item's id, a board's path, a list of them, or a box; one board's path alone is that board as the person's browser has it now, without the drawing round it. A .pen file's path pictures that file whole. `format` "jpeg" or "pdf", and `to` a deck path, make a file to hand on. Drawn natively over each board's current picture (`how` "native"), or in the browser with live boards when asked (`live: true`) or when it must be: math, a picture it cannot load, a board not yet pictured, a PDF (`how` "chromium: <why>").
- `decks canvas rename` · `decks.canvas.rename(title: string, options?: { canvas?: string }): Canvas`. What the person calls this canvas: a few words for what is on it, that a person would look for. The folder never changes.
- `decks canvas file` · `decks.canvas.file(options?: { canvas?: string }): string`. The canvas's .pen file, to edit by hand instead.
- `decks canvas copy-shared` · `decks.canvas.copyShared(options?: { canvas?: string; title?: string }): Canvas`. Make your own copy of a canvas a friend shared with you (`canvas`, shared/<owner>/<canvas>): its drawing, boards, frames and files copied into a new canvases/<name>/ of yours, titled "Copy of …" (or `title`). The copy is yours and syncs as your own; it never changes theirs. How a canvas shared with you to view is changed.

**Board and deck: files in the deck folder, on any number of canvases**

- `decks board list` · `decks.board.list(): Board[]`. Every board file in the deck, placed or not.
- `decks board create` · `decks.board.create(options: { title: string; format?: "board" | "slides"; w?: number; h?: number; canvas?: string }): Board`. Write a blank board in a canvas's own boards/ (`canvas`, or your own canvas) and return it; placing it is the canvas's job (decks.canvas.insert({ type: "board", board: path }, { beside })). The title is the finding, as a sentence. `format` "board" (default) is one HTML page you design; "slides" is a reveal deck of <section>s. A canvas is a folder that stands alone (canvases/<name>/boards/…), and a board from anywhere else placed on it is copied in.
- `decks board get` · `decks.board.get(board: string): Board`. A board's path and title (the finding it states), and who last wrote it.
- `decks board canvases` · `decks.board.canvases(board: string): Placement[]`. The canvas this board is on, with its place and size there: a board in a canvas's folder is on that canvas alone. For a board in the library (boards/, on no canvas), the canvases that copied it, each with its copy's path.
- `decks board url` · `decks.board.url(board: string): string`. The board's address, for a browser such as Playwright.
- `decks canvas list` · `decks.canvas.list(): Canvas[]`. Every canvas in the deck, and which agents have it open.
- `decks canvas create` · `decks.canvas.create(title: string): Canvas`. A new, empty canvas, named from a title. Nobody moves to it: agent.update({ canvas }) makes it your home, view.goto shows it.
- `decks frame create` · `decks.frame.create(path: string, item?: PenItem): { file: string; ref?: string; id: string }`. A new reusable .pen file at `path` ("frames/ui/button"), with `item` as its one reusable item, in your canvas's own frames/. Placed on that canvas with { type: "ref", ref }; read and edited with the canvas item calls given { frame: ref }. A frame from the deck's own frames/ placed on a canvas is copied into it.
- `decks file url` · `decks.file.url(file: string): string`. A file on disk, as the address a board embeds.

**Agent: you, or another agent**

- `decks agent me` · `decks.agent.me(): Agent`. You: name, avatar, colour, workspace, tags and home canvas.
- `decks agent update` · `decks.agent.update(patch: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string; canvas?: string }): Agent`. Change your name, avatar (an <svg> with xmlns and a viewBox, or { emoji }), workspace (the project) or tags (up to four, for what you are doing now), or your home canvas: the one the app shows beside you, and what decks.here() means for a call that names none. Set the first four early in every session.
- `decks here` · `decks.here(): Canvas`. The canvas a call means when it names none: your home canvas for an agent, the board's canvas for a board button, the canvas on screen for the person. Asked, never set.
- `decks agent claim` · `decks.agent.claim(boards: string | string[]): string[]`. Say these boards carry your work, without showing them: you become their writer.
- `decks agent inbox` · `decks.agent.inbox(): Message[]`. Hand-offs waiting for you from other agents. Changes to a canvas need no watching: they reach you with your next message.
- `decks agent list` · `decks.agent.list(options?: { workspace?: string }): Agent[]`. Every agent, or the ones on one project (`workspace`), with what each is doing and how much waits for it.
- `decks agent get` · `decks.agent.get(name: string): Agent`. Another agent, by name or id: kind, workspace, tags, state, home canvas.
- `decks agent send` · `decks.agent.send(name: string, message: { task: string; boards?: string[] }): { delivered: boolean; turn: "running" | "new" | "queued"; position?: number; note?: string }`. Deliver now: the message reaches the agent in the turn it is running and steers it, where its runtime can take a message mid-turn; an idle agent starts a turn on it. A runtime that cannot be steered mid-turn gets it queued, and the answer says delivered: false.
- `decks agent queue` · `decks.agent.queue(name: string, work: { task: string; boards?: string[]; reply?: boolean }): { queued: true; position: number }`. Put work in the agent's queue, taken up after the turn it is running. Returns at once; with `reply: true` its report comes back to you.
- `decks agent create` · `decks.agent.create(spec: { name: string; kind?: "pi" | "claude" | "opencode" | "opencode2" | "antigravity"; model?: string; thinking?: string; mode?: "manual" | "acceptEdits" | "plan" | "auto"; workspace?: string; tags?: string[]; canvas?: string }): Agent`. Start a new agent, then send or queue it work. `kind` is the runtime ("claude", "pi", "opencode", "opencode2", "antigravity"; yours when left out), `model` any model that kind runs, `thinking` how hard it thinks as that kind names it, `mode` its permission mode, `canvas` its home canvas (a new one when left out).

**View: what the person is looking at, moved only on purpose (no file changes)**

- `decks view goto` · `decks.view.goto(canvas: string): { canvas: string; moved: boolean; note?: string }`. Bring the person's screen to a canvas. Only the view moves; nobody's home canvas changes.
- `decks view focus` · `decks.view.focus(target: string | string[], options?: { canvas?: string; highlight?: string; animate?: boolean }): { canvas: string; target: string | string[]; deferred?: string }`. Move the camera to a board or a drawn item on a canvas (a list frames them all), optionally outlining one data-id block inside a board. `animate: true` glides.
- `decks view camera` · `decks.view.camera(): Camera`. Where the person's screen is looking, and its zoom.
- `decks view move` · `decks.view.move(camera: { x: number; y: number; zoom: number; animate?: boolean }): Camera`. Move the person's camera outright: { x, y, zoom }, zoom 1 is life size.
- `decks view viewport` · `decks.view.viewport(): { width: number; height: number } | null`. The room the screen has, in CSS pixels, or null when no screen has said.
- `decks view cursor` · `decks.view.cursor(board: string, at: Point | null): void`. A labelled dot on a board, at board coordinates; null removes it.
- `decks view reload` · `decks.view.reload(options: { board: string; canvas?: string }): { reloaded: number }`. Reload the board's page in every browser and iPad showing it on that canvas; with no `canvas`, on every canvas it is on. For a change the watcher cannot see (a file it fetches, data from outside). No file changes.

**Apps: folders in apps/ that Decks serves, builds or runs**

- `decks apps list` · `decks.apps.list(): AppState[]`. Every app in the deck's apps/ folder, with its state.
- `decks apps status` · `decks.apps.status(name: string): AppState`. One app's state.
- `decks apps create` · `decks.apps.create(name: string, options?: { starter?: "static" | "node" | "solid" | "react" | "next"; title?: string }): { name: string; kind: AppKind; folder: string; files: string[]; board: string; url: string; repo?: { branch: string; head: string }; next: string }`. A new app folder from a starter ("static" default, "node", "solid", "react", "next"), with its board.
- `decks apps repo` · `decks.apps.repo(name: string): { branch: string; head: string; dirty?: number; remote?: string }`. Its git repository, made now with everything committed if the folder is not one yet: branch, last commit, changed files, origin.
- `decks apps clone` · `decks.apps.clone(url: string, options?: { name?: string; title?: string }): { name: string; kind: AppKind; folder: string; board: string; url: string; repo: { branch: string; head: string; remote?: string }; next: string }`. Take in an app from an https:// or git@host:path address, with its board. Nothing is installed or run.
- `decks apps board` · `decks.apps.board(name: string): string`. The board for an app whose folder you wrote yourself.
- `decks apps build` · `decks.apps.build(name: string): AppOutcome`. Build it, waiting up to 15 s; `pending` means ask its status later.
- `decks apps run` · `decks.apps.run(name: string): AppOutcome`. Start it, waiting up to 15 s.
- `decks apps stop` · `decks.apps.stop(name: string): { stopped: boolean }`. Stop it.
- `decks apps restart` · `decks.apps.restart(name: string): AppOutcome`. Stop and start again after a code change. Its board reloads by itself.
- `decks apps logs` · `decks.apps.logs(name: string, options?: { tail?: number }): string[]`. Its recent output.
- `decks apps check` · `decks.apps.check(name: string): { verdict: string; url?: string; title?: string; errors: string[]; failed?: string[]; words?: number; file?: string }`. Open it in the server's browser and say what is wrong: what fit is to a board. Read `verdict`; `file` is a picture.

<!-- web -->
**The person's shared Chrome tab**

- `decks web status` · `decks.web.status(): { paired: boolean; connected: boolean; tab?: { title: string; url: string }; pending?: { id: string; text: string }; closed?: string }`. Whether the person is sharing a Chrome tab through the Decks extension, and which.
- `decks web pairing` · `decks.web.pairing(): { code: string; path: string; note: string }`. A code to pair the Decks extension.
- `decks web repair` · `decks.web.repair(): { code: string }`. Pair the extension again: a fresh code.
- `decks web board` · `decks.web.board(): string`. A board showing the shared tab.
- `decks web open` · `decks.web.open(url: string): { url: string; title: string }`. Go to an address in the shared tab.
- `decks web read` · `decks.web.read(): { url: string; title: string; snapshot: string; truncated?: boolean }`. The page as a tree of fields and buttons, each with a [ref=e42]. References die when the tab navigates.
- `decks web screenshot` · `decks.web.screenshot(options?: { full?: boolean }): { file: string; width: number; height: number }`. A picture of the tab.
- `decks web fill` · `decks.web.fill(field: WebTarget, text: string): { field: string }`. Type into a field. Never passwords or codes.
- `decks web select` · `decks.web.select(field: WebTarget, option: string): { field: string; option: string }`. Choose an option in a select.
- `decks web click` · `decks.web.click(what: WebTarget): { clicked: string }`. Click a button or link.
- `decks web press` · `decks.web.press(key: string): { pressed: string }`. Press a key.
- `decks web submit` · `decks.web.submit(what?: WebTarget, options?: { ask?: boolean }): { submitted: string; allowed: boolean }`. Submit a form, asking the person first; may come back with allowed: false.
- `decks web stop` · `decks.web.stop(): void`. Stop sharing.

<!-- /web -->

**Ports and the clock**

- `decks ports` · `decks.ports(change?: { open?: number; close?: number; label?: string }): { port: number; label?: string; by?: string; at: number; node: string; rnode: string }[]`. Forward a local server so a board can frame it: read with nothing, { open: port, label } to forward one, { close: port } to stop. `node` passes the path on; `rnode` strips it.
- `decks studio connect` · `decks.studio.connect(url: string, key: string): { connected: boolean; url: string }`. Connect this harness to Decks Studio with the key Studio made for it: the deck then syncs there in the background. Only the person can call it, from a browser paired with this harness.
- `decks pair code` · `decks.pair.code(): { code: string; expires: number }`. A pairing code for another Decks front end, such as Studio, or a terminal elsewhere (decks login <code>), to connect to this harness with: six digits, ten minutes, once. Only on the harness's own machine, where a terminal logs in with decks login and no code; Settings never shows one.
- `decks studio status` · `decks.studio.status(): { connected: boolean; url?: string }`. Whether this harness syncs with Decks Studio, and with which.
- `decks studio disconnect` · `decks.studio.disconnect(): { connected: boolean }`. Stop syncing with Decks Studio and forget the key. Only the person can call it.
- `decks now` · `decks.now(): { iso: string; timezone: string; words: string; epoch: number; [key: string]: unknown }`. The time where the person is.

**Old names**, kept for one release; each answer through one names its new call:

`newBoard` → decks.board.create, then decks.canvas.insert; `fit` → decks.canvas.fit; `resize` → decks.canvas.update(board, { size }); `report` → decks.agent.claim; `reload` → decks.view.reload({ board }); `boards` → decks.canvas.read, or decks.board.list; `show` → decks.canvas.insert({ type: "board", board }) to place it, then decks.view.focus; `hide` → decks.canvas.delete; `move` → decks.canvas.move(board, { at }); `cursor` → decks.view.cursor; `camera` → decks.view.camera to read, decks.view.move to move; `viewport` → decks.view.viewport; `screenshot` → decks.canvas.screenshot; `stages` → decks.canvas.list; `open` → decks.agent.update({ canvas }), then decks.view.goto; `newStage` → decks.canvas.create, then decks.agent.update({ canvas }); `title` → decks.canvas.rename, or decks.here() to read; `pen.read` → decks.canvas.read (a frame file: decks.canvas.read({ frame })); `pen.edit` → decks.canvas.batch (or the single calls: insert, update, replace, delete, move, copy, variables; a frame file with { frame }); `pen.create` → decks.frame.create; `pen.save` → decks.canvas.save; `pen.file` → decks.canvas.file; `me` → decks.agent.me to read, decks.agent.update to change; `agents` → decks.agent.list; `send` → decks.agent.queue (and decks.agent.create to make the agent first; decks.agent.send now delivers at once); `queue` → decks.agent.inbox; `url` → decks.board.url; `resolve` → decks.file.url.
