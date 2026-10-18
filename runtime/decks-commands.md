<!-- Generated from packages/api by scripts/gen-sdk.mjs. Edit the table there, then run the script. -->

```ts
type Corner = { x1: number; y1: number } | { x: number; y: number };
type Board = { path: string; title: string; x: number; y: number; w: number; h: number; box: Box; content?: { w: number; h: number }; clipped?: boolean; inContext: string[]; lastWrittenBy?: string };
type Box = { x1: number; y1: number; x2: number; y2: number };
type Point = { x: number; y: number };
type PenEdit = { op: "insert"; node: PenItem; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "update"; id: string; set?: Record<string, unknown>; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "replace"; id: string; node: PenItem } | { op: "delete"; id: string } | { op: "move"; id: string; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "copy"; id: string; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number }; as?: string } | { op: "variables"; set: Record<string, unknown>; themes?: Record<string, string[]> | null };
type PenItem = { type: string; id?: string; children?: unknown[]; [key: string]: unknown };
type AppState = { name: string; title: string; kind: AppKind; status: "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken"; url: string; board: string; port?: number; error?: string; seenAt?: number; at?: number; version?: number };
type AppKind = "static" | "build" | "server";
type AppOutcome = { ok: boolean; status: "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken"; ms: number; errors: string[]; pending?: true };
type WebTarget = string | { ref: string } | { name: string; nth?: number };
```

**Boards: make, size and refresh a board file**

- `decks new-board` · `newBoard(options: { title: string; format?: "board" | "slides"; w?: number; h?: number; at?: Corner }): string`. Write a blank board and return its path. The title is the finding, as a sentence. `format` "board" (default) is one HTML page you design; "slides" is a reveal deck of <section>s. `at` is its top-left corner on your stage: say it every time, after reading the stage with pen.read. Left out, the board goes beside your newest board and the result says where.
- `decks fit` · `fit(path: string, options?: { canvas?: string; margin?: number }): { path: string; w: number; h: number; content?: { w: number; h: number; page?: number } }`. Set a board's height from its content, measured at the width it has on a canvas (`canvas` names one, else your stage's). The board must be on it. The notes say what the browser found: the height, the word count, the smallest type, content wider than the board, boxes that cut off their content, and any view that breaks when a control is pressed. Use it instead of a screenshot.
- `decks resize` · `resize(path: string, size: { w?: number; h?: number }): { path: string; w: number; h: number }`. Set a board's size outright.
- `decks report` · `report(path: string | string[]): { reported: string[] }`. Name boards you edited without showing them, so they are listed as yours.
- `decks reload` · `reload(path: string): void`. Reload a board's frame, if you changed something the watcher cannot see.

**Boards on your stage**

- `decks boards` · `boards(): Board[]`. Every board in the deck, placed as your stage has them.
- `decks show` · `show(target: string | string[], options?: { fit?: "board" | "all"; highlight?: string; animate?: boolean; at?: Corner }): { shown: string[] }`. Add these boards to your stage and move the camera to them. `at` places the one board named, top-left corner; for a board already on the stage it moves it. `highlight` outlines one data-id. A drawn item's id can be named instead of a board path: the camera goes to it.
- `decks hide` · `hide(path: string | string[]): void`. Take boards off your stage, keeping them in your context.
- `decks move` · `move(path: string, at: Point): Board`. Move a board on your stage: `at` is its top-left corner.
- `decks cursor` · `cursor(path: string, at: Point | null): void`. A labelled dot on a board, at board coordinates; null removes it.

**Your view**

- `decks camera` · `camera(at?: { x: number; y: number; zoom: number }, options?: { animate?: boolean }): { x: number; y: number; zoom: number } | null`. Where your stage is looking, or move it with { x, y, zoom }. `zoom` 1 is life size.
- `decks viewport` · `viewport(): { width: number; height: number } | null`. The room your stage has on screen, in CSS pixels.
- `decks screenshot` · `screenshot(options?: { of?: string | string[] | { x1?: number; y1?: number; x2?: number; y2?: number }; scale?: number; format?: "png" | "jpeg" | "pdf"; to?: string; scheme?: "light" | "dark" }): { file: string; width: number; height: number; box: Box; how?: "canvas" | "snapshot" | "server"; note?: string }`. A picture of your stage, or part of it, as the person sees it, saved to `file`. `of` is an item's id, a board's path, a list of them, or a box; nothing is the whole stage. A .pen file's path pictures that file whole. `format` "jpeg" or "pdf", and `to` a deck path, make a file to hand on. One board's path alone is that board as the browser has it now.

**Stages**

- `decks stages` · `stages(): { name: string; title: string; open: string[]; boards: number; mine?: true }[]`. Every stage (canvas) and who has it open. A stage's `name` is its folder and never changes; its `title` is what the person calls it.
- `decks open` · `open(name: string): { stage: string; boards: string[] }`. Move to another stage, by name or title: its boards become the ones you show, hide and move.
- `decks new-stage` · `newStage(title: string): { stage: string }`. Make an empty stage from a title, and open it.
- `decks title` · `title(title?: string): { stage: string; title: string }`. Name the canvas you are on, or read its name with nothing. Name it for what is on it, as a few words a person would look for.

**The drawing on your stage**

- `decks pen read` · `pen.read(path?: string): { stage?: string; file: string; ref?: string; version: string; error?: string; children: unknown[] }`. Your stage's drawing: every item as saved, plus its `box` on the stage. With `path`, any .pen file ("frames/ui/button", "canvases/<name>/canvas.pen").
- `decks pen edit` · `pen.edit(edits: PenEdit[], options?: { path?: string }): { rev?: number; file?: string; ref?: string; results: { op: string; id: string; box?: Box; note?: string }[] }`. Edit your stage's drawing, or with `path` any .pen file; the edits apply together or not at all. A `box` places an item on the stage.
- `decks pen create` · `pen.create(path: string, item?: PenItem): { file: string; ref?: string; id: string }`. A new .pen file at `path` ("frames/ui/button"), with `item` as its one reusable item. One in frames/ is placed on any stage with { type: "ref", ref }.
- `decks pen save` · `pen.save(id: string, path: string, options?: { replace?: boolean }): { frame: string; ref: string; replaced: boolean; overwrote: boolean }`. Save an item of your stage as a frame file at `path` in frames/, and put a ref to it in its place (`replace: false` leaves the stage alone).
- `decks pen file` · `pen.file(): string`. The path of your stage's .pen file, to edit it by hand instead.

**Agents**

- `decks me` · `me(patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string }): { name: string; avatar?: string; color: string; tags?: string[]; workspace?: string; avatarChanged?: string }`. Who you are: read with nothing, change with a patch. Set all four first in every session: a short name of your own, an avatar (an <svg> with xmlns and a viewBox, or an emoji), the project as `workspace`, and up to four tags for what you are doing now.
- `decks agents` · `agents(options?: { filter?: { workspace?: string } }): { id: string; name: string; me: boolean; state: string; kind: string; tags: string[]; workspace?: string; queued: number }[]`. Every agent; `filter.workspace` narrows to one project.
- `decks send` · `send(to: string | { name: string; kind?: "pi" | "claude" | "opencode" | "opencode2" | "antigravity"; model?: string; thinking?: string; mode?: "manual" | "acceptEdits" | "plan" | "auto"; tags?: string[]; workspace?: string }, work: { task: string; boards?: string[]; reply?: boolean }): { queued: true; position: number; agent?: string; name?: string }`. Hand work over, and carry on: to an agent by name, or to { name, kind }, which makes it first. Returns at once; `reply: true` brings their report back to you.
- `decks queue` · `queue(agentId?: string): { from: string; fromName: string; task: string; boards: string[]; at: number }[]`. What is waiting in an agent's queue: yours, or another's.

**Apps**

- `decks apps list` · `apps.list(): AppState[]`. Every app in the deck's apps/ folder, with its status.
- `decks apps status` · `apps.status(name: string): AppState`. One app's state.
- `decks apps create` · `apps.create(name: string, options?: { starter?: "static" | "node" | "solid" | "react" | "next"; title?: string }): { name: string; kind: AppKind; folder: string; files: string[]; board: string; url: string; next: string }`. Make an app folder from a starter ("static" default, "node", "solid", "react", "next"), and its board.
- `decks apps board` · `apps.board(name: string): string`. The board for an app whose folder you wrote yourself.
- `decks apps build` · `apps.build(name: string): AppOutcome`. Build an app; waits up to fifteen seconds, and `pending` means ask status later.
- `decks apps run` · `apps.run(name: string): AppOutcome`. Start an app; waits up to fifteen seconds.
- `decks apps stop` · `apps.stop(name: string): { stopped: boolean }`. Stop an app.
- `decks apps restart` · `apps.restart(name: string): AppOutcome`. After you change a server app's code: stop it and start it again. Its board reloads by itself.
- `decks apps logs` · `apps.logs(name: string, options?: { tail?: number }): string[]`. An app's log lines.
- `decks apps check` · `apps.check(name: string): { verdict: string; url?: string; title?: string; errors: string[]; failed?: string[]; words?: number; file?: string }`. The app opened in the server's browser: what fit is to a board. Read `verdict`; `file` is a picture.

<!-- web -->
**The person's Chrome**

- `decks web status` · `web.status(): { paired: boolean; connected: boolean; tab?: { title: string; url: string }; pending?: { id: string; text: string }; closed?: string }`. Whether the person is sharing a Chrome tab through the Decks extension, and which.
- `decks web pairing` · `web.pairing(): { code: string; path: string; note: string }`. A code to pair the Decks extension.
- `decks web repair` · `web.repair(): { code: string }`. A fresh pairing code.
- `decks web board` · `web.board(): string`. The board that shows the shared tab.
- `decks web open` · `web.open(url: string): { url: string; title: string }`. Open an address in the shared tab.
- `decks web read` · `web.read(): { url: string; title: string; snapshot: string; truncated?: boolean }`. The shared page: address, title, and an accessibility tree that names every field and button with a [ref=e42]. References die when the tab navigates.
- `decks web screenshot` · `web.screenshot(options?: { full?: boolean }): { file: string; width: number; height: number }`. A picture of the shared tab.
- `decks web fill` · `web.fill(field: WebTarget, text: string): { field: string }`. Type into a field. Never passwords or codes.
- `decks web select` · `web.select(field: WebTarget, option: string): { field: string; option: string }`. Pick an option in a select.
- `decks web click` · `web.click(what: WebTarget): { clicked: string }`. Click a button or link.
- `decks web press` · `web.press(key: string): { pressed: string }`. Press a key.
- `decks web submit` · `web.submit(what?: WebTarget, options?: { ask?: boolean }): { submitted: string; allowed: boolean }`. Submit a form; asks the person first and may come back with allowed: false.
- `decks web stop` · `web.stop(): void`. Stop driving the shared tab.

<!-- /web -->

**Addresses and time**

- `decks url` · `url(path: string): string`. The URL of a board, for a Playwright screenshot.
- `decks resolve` · `resolve(file: string): string`. A file on disk -> the URL a board should embed.
- `decks ports` · `ports(change?: { open?: number; close?: number; label?: string }): { port: number; label?: string; by?: string; at: number; node: string; rnode: string }[]`. Servers on this machine, forwarded through Decks so a board can frame them: read with nothing, { open: port, label } to forward one, { close: port } to stop. `node` passes the path on; `rnode` strips it.
- `decks now` · `now(): { iso: string; timezone: string; words: string; epoch: number }`. The time where the person is.
