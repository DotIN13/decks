# Decks — architecture & design

Pi owns reasoning, conversation, context, compaction, tool use and the session tree.
Decks is the environment around it, and the environment is a **canvas**: an infinite
stage of boards, with the transcript floating at its edge. This document is what the
code's comments point at when they say "§4".

Status: **all six milestones built and verified** — deck and stage, one agent,
`stage_eval`, the user's editor, many chats with delegation, and the time machine.

---

## 1. Product definition

A **board** is a local HTML file of absolutely-positioned components. It is where a
plan gets drafted, and where the agent reports that work is done. Both sides draw on
it: the agent by editing the file with its ordinary tools, the user by direct
manipulation. Because a board is a file it is also an artifact — it passes between
agents as context, and it can embed the user's real documents instead of summaries of
them.

What Decks is not: a diagramming tool, a document editor, or a place the agent's
output is *rendered*. The board is the shared workspace, not a view of a transcript.

## 2. The deck, and the data directory

One directory holds everything Decks stores, named by one variable, and the deck is
`decks/` inside it:

```
$DECKS_DATA_DIR/     default ~/.decks · npm run dev uses <repo>/data · tests a scratch dir
  decks/
    deck.json        the arrangement, and the roots embeds may reach
    boards/*.html    the boards
    lib/             the primitives, copied in so a board is standalone
    assets/          images the boards use
    .decks/          revisions and avatars — never watched, never served except by hash
  shared/            optional; the demo uses one as an out-of-deck root
```

**Three tiers, and only one of them is a directory.** The deck is every board file; what
an agent is *holding* is the rail; what it has put *in play* is the canvas.

| | is | owned by | changed by |
|---|---|---|---|
| **deck** | every board under `boards/` | the filesystem | writing or deleting a file |
| **context** | what an agent holds — the rail | the agent | `attach` / `detach` |
| **in play** | what the canvas renders | the agent, narrowed by the user | `show` / `hide`, or a click in the rail |

Attaching a board puts it in play, so holding something still surfaces it; `show` is how an
agent narrows to what matters now, and `hide` takes a board off the canvas *without*
dropping it from context. That asymmetry is deliberate: the canvas is the user's view and
they may clear it, but an agent's context is its own, and a user quietly removing a board
the agent is reasoning from would be a bug they could not see.

**An agent holding nothing shows the whole deck.** Without that fallback a fresh agent on
an existing deck would open on a blank canvas and look broken. It is one rule in two
places — `railBoards` in the client and the stage — and it is why a new agent is useful
before it has done anything.

**A deleted board has to leave the context with it**, or the fallback is one path away from
never firing. A board that is gone still resolves to nothing in the rail and matches nothing
on the canvas, so an agent holding only that one path showed an empty rail *and* an empty
canvas — and because its context was not empty, the whole-deck fallback stayed out of it.
The deck looked deleted. The watcher now prunes the path from every agent
(`registry.boardRemoved`), and the client resolves held paths against the deck as well,
because a rewind can restore a context naming a board that has since been deleted; holding
only ghosts counts as holding nothing.

**One deck per data directory.** That is a constraint, not a preference: the deck
directory is the agent's cwd, a Pi session's cwd cannot move, and Pi keys a session's
transcripts to the path it ran in — so "which deck", "which history", "which revisions"
and "which settings" are all one choice. Switching decks means pointing at another data
directory, which is also how the tests stay out of the way of real work.

It grew the other way round first: a `DECKS_DECK` variable naming any directory, whose
default was a fixture *inside the repository*. That produced `decks/decks/example` in the
logs, put the user's own board in a committed folder, and let the verification suite
write into the deck somebody was working in. `DECKS_DATA_DIR` had been sitting in the
config the whole time, read by nothing.

`$DATA` is the application's directory and the deck is one thing inside it, which leaves
the room `settings.json` and a recents list will want.

**A first run creates an empty deck** — `boards/`, `assets/`, a copy of `runtime/lib`, a
`deck.json` (`Deck.create`) — and nothing else. Not a copy of the demo: a blank canvas is
the honest first screen, and `example/` is a data directory you opt into
(`npm run dev:example`).

**The transcripts are not in the deck.** They are Pi's, at
`~/.pi/agent/sessions/<slug of the deck path>/`. Moving a deck leaves its conversations
behind unless that directory is copied to the new path's slug; boards, revisions and
arrangement travel with the folder.

What copying them buys is narrower than it sounds, and worth stating so nobody expects
more: **nothing in the app resumes a session.** Every start is a new conversation, so the
spine shows only the live one. Copied files stay keyed to the deck's path, which means
`pi -r` in the deck directory still lists them and a session picker would find them — and
they keep their `board-rev` entries, which is how a past board is dated. A copied file also
still records the old cwd in its header: harmless for listing, but a fork resumed from one
would carry the stale path.

The deck directory is the agent's cwd. That is the whole integration: the agent's
`read`, `write`, `edit` and `grep` already work on boards, so there are no board CRUD
tools to keep in sync with a schema.

**Two sources of truth, split on purpose.** What a board *contains* lives in the board
file. Where boards *sit* lives in `deck.json`. A drag writes the second and never the
first; an agent's edit writes the first and never the second.

`deck.json` is read forgivingly and written completely: an unparseable field is a
default plus a warning, never a refusal to open, and keys this build does not
understand survive a write (`schema.ts`). It is a file a person is expected to open.

## 3. The board file

```html
<meta name="board" content='{"w":1600,"h":1000,"bg":"grid"}'>
<link rel="stylesheet" href="../lib/board.css">
<section class="card" data-id="goal" style="left:40px;top:40px;width:360px">…</section>
<div data-embed="../papers/oauth.pdf" data-pages="3-5" data-id="spec" …></div>
<script src="../lib/board.js"></script>
```

- Intrinsic size lives in the board's own `<meta>`, because how big a page is, is a
  property of the page. Position does not; that is the arrangement's business.
- **Every component carries `data-id`.** It is what makes a board addressable from
  three directions: the agent edits by unique anchor, the stage highlights by id, and
  a user's drag becomes a patch against an id rather than against a pixel.
- `<meta name="poster">` is optional and is the escape hatch for a board too
  expensive to mount at thumbnail size (§7).
- The head asks for exactly two files. `board.js` loads whatever a component actually
  uses — marked, KaTeX, mermaid, pdf.js — from the same `lib/`, so a board of three
  stickies does not pay for pdf.js and the agent does not have to remember which
  script tag goes with which component.
- `board.js` sets `window.__boardReady` when fonts and every mount are done. The app
  waits for it before measuring; the agent's Playwright waits for it before shooting.
  Without it a screenshot is a race, and the race is usually lost.

The revision of a board is a **hash of its contents**, not its modification time.
Mtime was the obvious choice and the wrong one: it has millisecond resolution, so two
writes inside the same millisecond leave it unchanged and the frame never reloads.

## 4. Two trust tiers

Agent-authored HTML needs no protecting from — the agent has `bash`. Foreign HTML
does. So the sandbox is applied where the danger is, and nowhere else.

**A board frame is same-origin.** `/api/board/*path` sends the file with `nosniff` and
no sandbox, path-shaped so a board's own relative references resolve to siblings and
land back on the same guard. Because the frame shares the app's origin, the app reads
`frame.contentDocument` directly — measuring, hit-testing, theming and (from M4)
editing are ordinary app code. There is no bridge, no `postMessage` protocol and no
capability token anywhere in the system. The first thing this buys is small and
telling: a dark shell hands its `data-theme` to its boards in three lines
(`lib/theme.ts`), and a board that named its own theme keeps it.

**A foreign file is quarantined.** `/api/file` is read-only, resolves only inside a
root declared in `deck.json`, never follows a symlink out, never lists a directory,
and sends `Content-Security-Policy: sandbox allow-scripts` for anything a browser
*runs* — HTML, SVG, XML. `board.js` mounts an HTML embed as a nested
`<iframe sandbox="allow-scripts">`: one level in from a board, two from the app.
Everything else on that route (markdown, PDF bytes, images) is data that `board.js`
draws itself, so it never executes at all. The example deck's `report.html` prints
what it can reach, and what it prints is `localStorage: blocked`.

The trade, stated: a script the agent writes into a board has the app's authority. It
could call `/api/*` or read app storage. That is not a new capability — the agent has
bash — and it buys the entire editor as testable app code. Foreign content, which
*would* be a new capability, is the thing behind glass. If a board ever needs to run
something genuinely untrusted, it embeds it rather than inlining it.

**Why `/api/file` takes a query and answers a redirect.** A browser deletes `..`
segments from a URL path before the request is sent — including their `%2e%2e`
spellings — so a relative path cannot survive inside the path. It arrives in a query
parameter, where nothing rewrites it, and leaves as `302 → /api/f/<absolute path>`.
From then on the URL is path-shaped, which is what makes a foreign page's own relative
references land back on the guard. `from` names the board that asked, so a relative
path means what it would mean in an `<img src>` on that board.

Every path decision is in `deck/roots.ts` and nothing else makes one. Symlinks are
resolved *before* the containment test, because a link inside a directory the agent
can write is not hypothetical.

## 5. The protocol

One WebSocket per browser (`/ws`), JSON frames, typed in `@decks/protocol` so both
sides are forced to agree. Reads that return bytes are HTTP; everything that changes
state is a frame. The server's greeting on connect is the whole deck state, which is
what makes a reconnect a refresh — and the dev server restarts on every save, so that
path is exercised constantly rather than theoretically.

## 6. The server

### 6.1 The open deck

`Deck` (`deck/loader.ts`) holds `deck.json`, the boards found under `boards/`, and the
resolved roots. It owns no agent and no camera: the camera belongs to the browser
looking, the selection belongs to the frame. Boards nobody has arranged are auto-placed
in rows so a board the agent just wrote appears beside its siblings instead of on top
of one; dragging it makes that position permanent.

The watcher (`deck/watcher.ts`) coalesces per path — a single save fires several
filesystem events, and without the quiet period a board reloads three times per edit.
`.decks/` is ignored, and that is load-bearing rather than tidy: the revision store
lives there and is written *in response to* a change, so watching it would loop.

### 6.2 One agent, and many

**Two runtimes, one seam.** `agents/backend.ts` says what the shell needs from an agent;
`pi/backend.ts` wraps Pi's `createAgentSession` and `claude/backend.ts` holds one
`@anthropic-ai/claude-agent-sdk` `query()` open per agent in streaming-input mode. Streaming
input is not a preference: it is what makes `interrupt`, `setModel`, `setPermissionMode` and
`getContextUsage` exist at all, and a query per turn would re-pay process start every time.
The SDK is a thin client for the `claude` binary, which it does *not* look for on `PATH`, so
`claude/available.ts` does the looking (`DECKS_CLAUDE_PATH` overrides) — that way an install
can use the Claude Code already on the machine instead of a per-platform 283 MB dependency.

Which runtime an agent uses is chosen when it is created and fixed for its life: a live
session cannot swap the process behind it, and pretending otherwise would silently start a
new conversation. `DECKS_BACKEND` is only what the `+` button hands you. Where the runtimes
differ, the difference is in `capabilities` rather than in a method that throws, so a client
that can see what an agent cannot do never offers it.

`agents/session.ts` owns what is neither runtime's: the transcript in memory, the identity, the
context set. `agents/translator.ts` decides what a transcript *is* — when a reply is
flushed, what a tool call is called — and is shared by any future backend;
`pi/events.ts` is the only file that reads Pi's event shapes.

An agent exists before it can be prompted: a Pi session has to load extensions,
resolve models and check credentials, so `start()` is a promise a prompt waits on. A
failure to start (no credentials, usually) is a notice in that agent's own transcript
rather than something that takes the deck down.

**Delegation** (`registry.spawn`) creates a child in-process — not a subprocess, as
Pi's own subagent example does — because the child should share this deck's stage, so
its boards land on the same canvas and its transcript is a row in the same chat list.
What it does not share is context: it is a fresh session with its own file. The child
is handed the *source* of the boards it needs, because that is the point of boards
being files — alignment is a paste, not a briefing. Four children at a time, which is
a legibility limit rather than a resource one.

**The canvas tool is defined once.** `stage/tool.ts` holds its description, its guidelines
and the `stage` object; `pi/extension.ts` registers it with a TypeBox schema and
`claude/tools.ts` wraps it in an in-process MCP server with a Zod one. That split is forced:
`tool()` inside `createSdkMcpServer` is the SDK's only route for your own tools — the `tools`
option is an availability filter over Claude's built-ins — and "MCP" oversells it, because
the server runs in this process with no subprocess and no transport. Two consequences are
real: the model sees `mcp__decks__stage_eval`, so the instruction text names the tool through
a `{{STAGE_TOOL}}` placeholder rather than hardcoding it; and tool search defers SDK MCP
tools by default, so `alwaysLoad` keeps the schema in the initial prompt instead of costing
a discovery call.

**Two things Pi did through its session tree now live in the shell**, because they had no
Claude counterpart and one mechanism is better than two. The stage snapshot — what an agent
held, showed and called itself — was carried in a tool result's `details` and rebuilt from
the branch on `session_start`; MCP tool results have no `details`, and the SDK's
`structuredContent` looks like the equivalent but *replaces* the text the model reads. It is
now `agents/snapshot.ts`, a series resolved by time, the same way `App.boardsAt` picks which
revision of a board to show. It is in memory rather than on disk because nothing recreates
agents when the server restarts, so a snapshot has nothing to survive to. And the "the user
edited a board" nudge was `pi.sendMessage({ deliverAs: "nextTurn" })`; it is now a queue on
the agent, prepended to the next prompt, which keeps the property it was chosen for — a
board edit is not an interruption — without needing the runtime's cooperation.

**A board has to be cheaper than a paragraph.** If answering on a board costs fifteen
lines of boilerplate and answering in chat costs nothing, the chat wins every time — so
`stage.newBoard({ title, kind })` writes the shell, mints a unique slug from the title,
attaches the board, puts it in play, and returns the deck-relative path. It does not move
the camera, and it refuses to overwrite an existing board.

The shells are files, not strings in a TypeScript module: `runtime/templates/<kind>.html`
for `answer`, `design`, `report`, `plan` and `blank`, beside `runtime/lib` and
`runtime/skills` where they can be read and edited like anything else. Each is a real
board — a sized `<meta name="board">`, both `lib` tags, a title and one placeholder
section with `data-id`s — and substitution is `{{TITLE}}`/`{{W}}`/`{{H}}`, the same shape
`pi/context.ts` already uses for `AGENTS.md.tmpl`. No template engine.

The write itself lives in `app.ts` next to the other board writes, because that is what
owns revision recording; the extension reaches it through `StageService`.

### 6.3 `stage_eval`

One tool, taking TypeScript against a typed stage API (`runtime/stage.d.ts`), injected
into the prompt verbatim. Everything the agent does to the canvas — showing a board,
holding one in context, rearranging, naming itself, drawing its own avatar, handing
boards to a subagent — goes through it. Not a table of narrow tools: the surface the
agent has to learn is one function and one interface, and the interface is the
documentation.

The code is wrapped in a function *before* it is compiled. The API tells the agent to
`return` a value, and a top-level return is a syntax error in a module — so compiling
the snippet on its own rejected exactly the code the documentation asks for.

Reads the server can answer (`boards`, `read`, `roots`, `resolve`, `url`) are answered
directly. Anything only the browser can do becomes a `stage.call` frame and is awaited;
with no browser connected it resolves as a no-op that says so, because an agent working
while nobody watches should finish and report, not block.

### 6.4 State that survives rewinding

Every effect of an eval is recorded in the tool result's `details`, never in a server
variable alone, and rebuilt by walking `sessionManager.getBranch()`. Rewinding the
conversation then rewinds what is in context and what is on screen, because the
transcript is the record.

What is restored is a *set*: the snapshot carries `inPlay: string[]`, not one shown board,
so a rewind puts back the arrangement the user was looking at rather than a single frame of
it.

### 6.5 Direct manipulation

The editor is app code over `frame.contentDocument` (§4), and two things follow from
that. Pointer events inside the frame arrive in the frame's own pixels, which *are*
board coordinates — the stage's zoom is a transform on an ancestor — so there is no
camera maths in the editor at all. And the affordances (handles, outline) are elements
appended to the board's document and marked `data-decks-ui`, never written to the file,
because patches are declarative and the overlay cannot leak into what is saved.

A committed gesture becomes a `BoardPatch` the server applies by **splicing the
original file at parse5 source locations** — not re-serialising, because the agent
re-reads that file and a re-serialise turns every drag into an unreadable diff. A drag
rewrites exactly the `style` attribute's byte range and keeps declarations the patch
never mentioned; everything else in the file comes out identical, which the tests
assert byte-for-byte. What the splicer cannot do safely — a text edit over a component
made of markup — is refused with a reason rather than half-applied.

Ids are minted on the server, against the file as it is now: two tabs inserting at once
would both pick `sticky-3` otherwise, and the second would be refused for a reason that
reads like a bug.

A patch carries the rev it was composed against. If the file changed underneath, the
patch is refused with the new rev and the browser re-reads the frame — last-write-wins
on a shared artifact is a bug that looks like a haunting. And a browser's *own* edit
does not reload its frame: the DOM is already right, so the frame is pinned to the
revision it loaded and only somebody else's write unpins it.

The agent is told, through `pi.sendMessage({deliverAs: "nextTurn"})`, which rides along
with the user's next message rather than interrupting a run. An agent holding an
explicit context hears only about boards in it; an agent holding nothing hears about
everything, because "no declared context" means the whole deck is its business — and
that is the common case, so the narrower rule alone meant the notification almost never
fired.

### 6.6 Seeing a board is the agent's job

There is no screenshot service and no thumbnail service, by design. Pi's `read` takes
images, so the loop is entirely the agent's: drive Playwright over bash, wait for
`window.__boardReady`, shoot, `read` the PNG. `runtime/skills/board-debug` teaches it.
That gives the agent a debugger rather than a camera — console output, `page.evaluate`
measurements, click-and-re-shoot — and it costs the app no dependency. Playwright is
the agent's to install, when it first wants it.

### 6.7 Revisions, and the time machine

Every new version of a board, from either author, is stored content-addressed under
`.decks/revisions/`, and the sequence is stored beside it in `index.json`. The files
were always durable; the *order* was not, and without it a restart made "the oldest
version I know of" mean "the file as it is now" — so both undo and the timeline quietly
lost everything from before the restart.

Which version belonged to which moment is answered two ways. Under Pi the agent's writes
append a `board-rev` custom entry to the session, so the mapping travels in the session tree
and costs no LLM context. For boards the conversation has not written to — and for every
board under Claude, which has no custom-entry API — the store answers by time: the newest
version that already existed when that message was sent. That fallback is why the Claude
backend can return an empty map from `revisionsAt` and still have a working time machine;
the two answers differ only where two writes share a second. That scan does not assume the
sequence is sorted — a migrated index has entries dated zero, and a restore is old content
written now.

**A rewind means different things to the two runtimes, and the same thing to the user.** Pi
walks its session tree in place with `navigateTree`. Claude cannot, but it can copy a session
up to a point, so a rewind is *a fork you stay in*: the history becomes a new session id and
the agent's query is reopened against it. Either way the abandoned path stays on disk.

Pairing a message with its session entry has a timing trap worth knowing. Pi's `prompt()`
awaits the turn, so the shell can pair immediately afterwards. Claude's returns as soon as
the message is queued — the turn runs on its message stream — so pairing there happens when
the *turn ends*, on the `result` frame. Doing it where Pi does left every message after the
first with no id, and a message with no id has no rewind, no fork and no board restore.

**The controls live on the user's messages**, one set per turn: `rewind · fork · restore
boards`, revealed on hover. A user message is the point `navigateTree` accepts and the
thing a person recognises, so it is also the natural place to act from — and the server
pairs each message with the session entry it became (`PiBackend.syncEntryIds`, the field
`ChatItem.entryId`) precisely so it can be.

Hovering **rewind** is a **preview**, immediately: the frames load revisions from the
store, the stage marks itself and refuses pointer events, and nothing is written. There is
no dwell delay because you only arrive by reaching for the action itself. Clicking rewinds
the conversation — which also rewinds the context set and the identity, since all three are
reconstructed from the same branch (§6.4). Restoring the *boards* is a separate, deliberate
button, and is itself recorded as a new revision: going back is a thing that happened, and
undoing it has to be possible too.

There was a second control for a while — a bar of notches at the bottom right — and it was
the same list of user messages drawn twice, thirty pixels from the spine. Removed. The
spine keeps one job (open the chat at a turn) and the messages carry the actions.

### 6.8 Permissions belong to the runtime, and the app supplies the surface

Decks ships no policy of its own. What it ships is the surface a runtime needs to ask a
human: `bindExtensions({mode: "rpc", uiContext})` for Pi, `canUseTool` for Claude, and one
bridge (`agents/extension-ui.ts`) that turns either into frames the browser draws. Under Pi
a permission extension then covers `bash`, `write`, `edit` and `stage_eval` alike, and
nothing about it is Decks-specific. Under Claude the CLI decides what is worth asking about
and Decks answers. The path guards on the HTTP routes stay regardless: that is web-server
hygiene, not agent policy.

**Claude's four modes are exposed rather than chosen for you** — `manual`, `acceptEdits`,
`plan`, `auto`, mapping onto the CLI's own permission modes, with `acceptEdits` the default
because writing boards is what the agent is *for* and a confirm per board write would make
the app unusable. `capabilities.modes` is empty for Pi, so the control is absent rather than
present and inert.

Two things this got wrong first, both about visibility rather than policy. The question was
drawn inside the chat column, which is away by default, so the first thing a Claude agent
asked stopped the turn for a reason nobody could see; it is in the dock above the input bar
now (§7). And a pending question is replayed in the agent's greeting — it was sent once, to
a browser that then reloaded, and the agent waited forever on an answer that could no longer
arrive.

## 7. The canvas

One CSS transform over an absolutely-positioned layer of frames. The boards live in
world coordinates and never learn about the camera except to counter-scale their title
bars, so a pan composites one layer instead of re-laying-out a dozen documents.

- `camera.x/y` is the world point under the **centre** of the viewport. Centre-based is
  what makes "zoom about the cursor" and "fit these boards" two lines each, and it
  means a resized window keeps looking at the same thing.
- Gestures follow the trackpad, because that is what this is used on: two-finger scroll
  pans, pinch zooms, ⌘-wheel zooms, space or middle-drag pans from anywhere. The
  per-event zoom factor is clamped, or one wheel notch jumps 2.7×.
- **A gesture that starts over a board is forwarded out of it** (`frame-gestures.ts`).
  A board frame is a separate document, so a wheel event over it never reaches the
  stage — no amount of listening in the parent will see one. With the frame live that
  meant panning and pinching stopped working exactly where the user is most likely to
  be looking. Same origin makes the fix small: listen inside the frame, hand the
  gesture to the stage. Positions are converted (in-frame pixels are board pixels,
  since the zoom is a transform on an ancestor) and deltas are passed through
  unchanged; a test pans by the same delta over bare stage and over a board and
  insists the camera moves equally.
- **Space is held in one place.** Each document only sees the keys pressed while it has
  focus, so a space pressed over the canvas and a drag begun over a board were two
  documents with two opinions. The stage owns the answer and the frames ask it.
- **A scroll a box inside a board can take is given to it.** An embedded paper or a long
  markdown file has its own scrollbar, and turning that into a canvas pan would make
  the embed unreadable; the canvas takes over at the end of the box. The scroll is
  applied by hand rather than by leaving the default action alone, because inside a
  scaled iframe the browser does not reliably scroll anything — the same board scrolls
  when opened on its own and not at 64%. Doing it by hand is also what makes the
  content follow the fingers at the current zoom.
- Above `INTERACT_ZOOM` (0.5) a frame stops taking pointer events: at a distance the
  boards are a map and dragging across one should pan; up close they are documents and
  a click belongs to the page.
- A board's title counter-scales against the camera (`scale(1/zoom)`) so it stays legible
  however far out you are, and there is one identity to keep in mind when touching it: a box
  inside a world scaled by `zoom` that carries `scale(1/zoom)` renders at **its layout size
  in screen pixels** — the two cancel. So its height and width are written in screen pixels,
  and only the visual gap above the board needs dividing by the zoom. Asking for `24 / zoom`
  height made the bar 88px tall at 27% zoom, which read as the title drifting off the boards
  as they shrank.
- A board's title bar sits *outside* its surface and is the drag handle. A board is a
  document, not a window — its own top-left corner belongs to the page — and moving one
  should never depend on finding a part of the page that happens to be empty. Below
  `INTERACT_ZOOM` the whole board is the handle: the title bar is a 24px target that can
  end up behind a floating panel, and at that distance there is nothing inside the board
  worth clicking anyway.
- A board off screen is a document not loaded. The margin is one viewport, so panning
  arrives at boards that are already rendered.
- **A board row owns a live document, so its identity must not change.** Solid re-creates
  a row whose item is a new object, and re-creating a row reloads the iframe in it — so
  replacing the boards array reloaded every board on screen. That was what "moving a
  board refreshes the page" turned out to be: a drag writes `deck.json`, the watcher
  reports it, and the whole deck arrived as new objects. Board updates are now merged in
  place (`reconcile` keyed on the path), and the server no longer reports its own
  `deck.json` write back — a hand edit still gets through, because the bytes differ.
- **A user's own edit must not reload the board they are editing.** The editor applies the
  change to the live document, so a reload can only replace what is already correct — with
  a white flash, losing scroll position and selection. The frame is therefore *pinned* to
  the revision it loaded, and only an edit from somewhere else clears the pin.

  Two things made that pin leak, and both are the same mistake in different clothes:
  assuming a write produces one notification, and assuming the pin can be re-set. One patch
  produces **two** `board.changed` messages — the immediate one from the write and the
  watcher's — so a boolean "I just wrote this" flag is consumed by the first, and the second
  is indistinguishable from the agent's write. The guard is keyed by revision instead
  (`selfRevs`), and since a rev is a content hash it absorbs however many echoes arrive.
  Separately, re-pinning on each edit moved the pin to the newest rev while the document on
  screen was still the one it first loaded, so the URL changed and the frame reloaded from
  the second drag onward: the pin is set once and left alone.

  A third trap sits next to them: assigning `src` reloads an iframe **even when the value is
  identical**, so the attribute cannot be a plain reactive binding — `BoardFrame` assigns it
  only when the string actually differs. The pin is safe against a stale document because
  `rev` is a cache-buster, not a content selector: the server serves the current file for a
  path whatever rev the URL names, so a board culled while panned away and remounted comes
  back current.
- A rail item is the board itself, scaled down, mounted when it scrolls into view.
  A thumbnail is therefore never stale and never a job that has to finish before you
  can see your deck. `<meta name="poster">` is the way out for a board that is
  expensive to mount.
- **The dock: the last reply, a question if one is waiting, and the input bar.** One
  bottom-centred stack rather than three separately-positioned things, so a question
  appearing pushes the reply up instead of landing on it, and none of them has to know how
  tall the others are. The first-run hint sits in it too, which is what removed the
  hardcoded `bottom: 92px` that a taller stack collided with.

  The reply floating there is the concession the app owes its own thesis. Boards are the
  medium and the chat column is away by default — but *not needing* the transcript is not
  the same as never seeing a word of it, and a reply that names the board it just wrote is
  worth a glance. So the last one flows above the input bar as it arrives, following the
  text while it streams and returning to the top once it stops, because a finished message
  left scrolled to its end opens mid-sentence and reads as if the start had been lost.
  Clicking it opens the column; the × waves it away, keyed by message id so dismissing one
  reply does not silence the next.

  A question goes here too, and only here (§6.8). It used to be a card in the transcript on
  the argument that a question belongs to the conversation that raised it. That argument was
  right and the placement was still wrong: the column is away, so the first thing a Claude
  agent asked stopped the turn for a reason nobody could see. Above the input bar it is
  where the user's hands already are, and it is not a modal — the canvas the question is
  about stays visible.
- **A list that scrolls has to be allowed to shrink.** `.side` is the box with a height
  (`top`/`bottom`), and the rail inside it is `flex: 1` — but a flex child defaults to
  `min-height: auto`, which refuses to go below its content. So a rail of fourteen boards
  took its full 2022px, ran a thousand pixels off the bottom of the screen, and never
  scrolled: `overflow-y: auto` does nothing to a box that is never smaller than what is in
  it. `min-height: 0` on the rail and on its `.items` is the fix, and the agent list needed
  the same.
- **What mounts follows the scroll, not the array.** A rail item is a live document, so the
  number of them has to be bounded — but bounding it by *index* (the first eight) meant a
  thumbnail past the eighth board stayed blank however far you scrolled. The bound comes
  from geometry instead: an item mounts while it is within a screen of the visible part of
  the list, and unmounts when it is not, so the cost holds for any size of deck. The margin
  is what stops that thrashing as you scroll.
- A thumbnail is a second copy of the document with no live DOM to protect, so it does have
  to reload to show an edit — but it reloads the whole board, libraries included, and a drag
  produces a revision per drop. Rail reloads are coalesced on a trailing delay, which is all
  a thumbnail needs.
- **The rail is the context; the canvas is what is in play.** The rail lists what the
  focused agent is holding — the full set, whether or not it is on screen — and the stage
  renders the subset the agent put in play, falling back to the whole deck when it holds
  nothing (§2). Clicking a rail item plays it and flies to it; the `×` on a board's title
  bar hides it, which takes it off the canvas and leaves the agent's context alone. So the
  rail is the agent's shelf and the canvas is its slide, and the user can clear the slide
  without reaching into the shelf.
- The rail deliberately does not line up with the canvas. It is a list of what is held, in
  a stable order; the canvas is a spatial arrangement the agent chose. Making the two agree
  would mean either sorting the rail by position, which moves items around as boards are
  dragged, or letting the rail dictate layout.

## 8. What is built

All six milestones, each verified against the real app rather than only unit-tested.

| | |
|---|---|
| M1 | Deck, stage, embeds: pan/zoom, drag-to-arrange, md/pdf/html/image embeds, live reload. |
| M2 | One agent: Pi adapter, transcript, composer, extension-UI bridge, both skills. |
| M3 | `stage_eval`: stage service, eval, identity, state rebuilt from the branch. |
| M4 | The user draws: editor, palette, patches, revisions, undo, the agent is told. |
| M5 | Many chats: registry, chat list, `stage.delegate` with board handoff. |
| M6 | Time machine: rewind / fork / restore on each message, preview from revisions. |

### Known edges

- The rail and the chat list share the left panel, and it has no collapsed-but-visible
  state beyond the sliver — a board parked at the far left sits behind it when it is out
  (draggable by its body once zoomed out).
- No deck picker: switching decks means switching data directories, by argument or by
  `DECKS_DATA_DIR`. The socket already carries `deck.open` for the day there is one.
- No session resume, so a restart is a fresh conversation and older sessions are reachable
  only through the Pi CLI. Drawing one would mean rebuilding a transcript from a session
  file — `agents/translator.ts` builds it from live events only.
- Panel reveal is hover-driven, and so is the reveal of a message's `rewind · fork ·
  restore boards` row. Both want rethinking for touch, where there is no cursor to approach
  an edge with and no hover to preview from.
- Arrows cannot be drawn from the palette — connectors are the agent's to write.
- A rewind truncates our transcript by matching the rewound message's text, which is
  what `navigateTree` hands back. Two identical messages in one conversation would cut
  at the first.
- `stage.delegate` waits for the child. A detached mode (`detach: true` in the plan) is
  not built, so a long child blocks the parent's turn.
