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
    lib/             the primitives, copied in and refreshed on open (§2.1)
    assets/          images the boards use, and the files the user drops on them
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

### 2.1 `lib/` is a copy, and the copy is refreshed

A board is a standalone document, so its stylesheet and its runtime have to be files
sitting beside it — not a route this server serves. That is why `lib/` is copied into
every deck, and it is not negotiable: a board has to render from the filesystem with
Decks not running.

But a copy taken once and never touched again is a deck frozen at the version of Decks
that happened to create it, and the cost was not hypothetical. It set the ceiling on the
component vocabulary the editor could offer (§6.5): a class this build added to
`board.css` was an unstyled box in every deck made before it, so the editor could only
ever speak the *oldest* `board.css` in the wild. It also meant a fixed bug in
`board.js` never reached the decks that had it.

So **opening a deck brings its `lib/` up to this build** (`deck/lib-sync.ts`,
`App.refreshLib`). `lib/` is this application's directory, not the user's; a file of
your own belongs in `assets/`. Three properties make that safe to do on every start:

- **Content-compared, so an unchanged restart writes nothing.** Not an mtime
  comparison, which is the usual shortcut and wrong here — a fresh clone or an
  `npm ci` rewrites mtimes without changing a byte. Rewriting 82 files would wake the
  watcher and reload every board on the canvas for nothing (§4, the `asset` case).
- **It runs before the watcher attaches**, so even the restart that *does* rewrite
  files cannot reload the boards twice.
- **A missing `runtime/lib` is refused rather than treated as an empty one.** A broken
  or partial install must not be able to prune a working deck's primitives to nothing.

Stale files are removed, which is the part worth arguing about since it can delete
something a person put there. It earns its keep: the vendored libraries rename files
between versions, and a `pdf.worker.min.mjs` from an older pdf.js sitting beside a
newer `pdf.min.mjs` is not untidiness — it is a board that fails to open a paper with a
version-mismatch error nobody can place. Every removal is logged by name for that
reason.

## 3. The board file

```html
<meta name="board" content='{"w":1600,"h":1000,"bg":"grid"}'>
<link rel="stylesheet" href="../lib/board.css">
<section class="card" data-id="goal" style="left:40px;top:40px;width:360px">
  <h3 data-edit="goal-title">Goal</h3>
</section>
<div data-embed="../papers/oauth.pdf" data-pages="3-5" data-id="spec" …></div>
<script src="../lib/board.js"></script>
```

- Intrinsic size lives in the board's own `<meta>`, because how big a page is, is a
  property of the page. Position does not; that is the arrangement's business.
- **Every component carries `data-id`.** It is what makes a board addressable from
  three directions: the agent edits by unique anchor, the stage highlights by id, and
  a user's drag becomes a patch against an id rather than against a pixel.
- **Every editable run of words carries `data-edit`**, unique within the board. A retype
  is a patch against that name alone, and a run without one is not retypeable — the
  convention is the whole mechanism, so the templates, the example deck and the authoring
  skill all carry it. `data-edit` and not a nested `data-id` because the rule above is the
  one that defines what a component *is*: a `data-id` inside another component is not a
  component, and reusing the attribute for parts would blur the only line there is.
- `<meta name="poster">` is optional and is the escape hatch for a board too
  expensive to mount at thumbnail size (§7).
- **The component vocabulary is small, and it is `board.css`'s.** Five classes that mean
  "a box with prose in it" (`text`, `sticky`, `card`, `callout`), three that
  bring their own inner markup (`kpi`, `table`, `chip`), and the `embed`; the only
  variant attribute is `data-tone`. That list is also the ceiling on what the
  user's editor can offer (§6.5). It is a copy in every deck rather than a route, and it
  is brought forward on every open (§2.1), so growing the vocabulary means editing
  `board.css` and the editor's list together.
- **There is no connector, and `board.js` draws nothing of its own.** It used to route an
  `svg.link` between two components named by id, and that was removed: a line positioned
  at mount time is a drawing the file does not state, so the file stopped being the whole
  truth about the board — the agent could not say where a line went without running the
  page, and the user had nothing to drag. A diagram is now a component that owns its own
  geometry, an `<svg>` inside a box with coordinates its author chose, which is a thing
  both of them can read and edit. `runtime/skills/board-authoring` teaches it and the
  example deck's two boards are built that way. The cost is accepted and was paid
  knowingly: `lib/` is re-synced on every open (§2.1), so existing user boards lost their
  arrows on their next restart, with no compatibility path.
- The head asks for exactly two files. `board.js` loads whatever a component actually
  uses — marked, KaTeX, mermaid, pdf.js — from the same `lib/`, so a board of three
  stickies does not pay for pdf.js and the agent does not have to remember which
  script tag goes with which component.
- `board.js` sets `window.__boardReady` when fonts and every mount are done. The app
  waits for it before measuring; the agent's Playwright waits for it before shooting.
  Without it a screenshot is a race, and the race is usually lost.

**An embed is sorted into a family by extension, and the last family is "anything".**
Markdown, PDF (with page ranges), image, HTML, and plain-text-or-source — the last
rendered as escaped preformatted text through `textContent`, never as markup, and asked
for with a `Range` header so a 50MB log truncates on the wire rather than in a DOM node
every other mount waits behind. What is left over is not an error case: a file with no
family becomes a chip naming it, its size and its kind, with an open and a download,
because "put anything on a board" is the promise and a blank box with a console warning
behind it is indistinguishable from a broken embed. `familyOf` in `board.js` is the one
place that decides, and the file picker's icons and the drop's default box shape both
name the same list from their own side — `board.js` is standalone by design (§3) and
cannot import from the app.

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

**Inside the deck, only a board gets the origin.** `/api/board/*path` serves the whole
deck, because that is what makes a board's own `../assets/photo.png` and
`../lib/board.css` resolve — so "same origin, no sandbox" cannot be a property of the
route. It is a property of *being a board*: a path under `boards/` ending in `.html`
gets `boardHeaders`, and everything else gets `assetHeaders`, which adds
`Content-Security-Policy: sandbox allow-scripts` to anything a browser would run. That
distinction was cosmetic until the user could drop a file onto a board (§6.9): an
uploaded `evil.html` served with the app's origin is a stored cross-site script, and
`data-embed="../assets/evil.html"` writes the URL into a board file where somebody
will eventually open it in a tab. The rule is decided from the shape of the path rather
than by asking the open deck, because a board written a second ago is on disk before the
watcher has mentioned it, and a board served as an asset loses the origin the editor
needs.

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

**What "editable" means, and the three mechanisms that cover it.** For a while only one
thing was: a component whose entire content was plain text. That excluded the shape the
agent writes most — a card with a heading and a paragraph — and everything about a
component that is neither its box nor its words. It is now three mechanisms, and
between them they cover most of every kind:

| | | |
|---|---|---|
| **position, size** | drag, resize handle, arrow-key nudge | `update` with `style` |
| **words** | double-click a named run and retype it, in place or in a source editor | `text`, addressed by `data-edit` |
| **everything else** | the inspector, floating for the selection | `update` with `class` / `attrs`, `rename`, `duplicate`, `order`, `remove` |

Two of those ops existed and nothing reached them: `update` could already carry a
`class` and an `attrs` map, and `order` had a test and no caller. Most of what follows
is therefore a UI over the protocol that was already there, and the protocol grew by
two ops rather than by ten.

**An editable run is one the author named, and the name is the whole address.** A
`data-edit`, unique within a board, on the leaf element holding the words: a `text`
patch carries that name and the new text and nothing else. The component is not in the
patch — the server finds the run and walks up to the nearest `data-id` — because a
second address in the same message is a second thing that can disagree with the first,
and the server has to resolve the element anyway to say which component the edit landed
in.

Three decisions, in the order they were made.

*`data-edit`, not a nested `data-id`.* The protocol's one structural rule is that a
component is a `data-id` on a child of the body, and that a `data-id` *inside* another
component is therefore not a component — the card around it is. Reusing the attribute
for parts would blur the only line that defines the vocabulary, and every place that
resolves a component by id (`elementOf`, `findById`, the stage's highlight) would have
had to learn "…but only at the top level".

*A name, not an index path.* Typing used to carry `path: number[]`, the indices of the
element children walked into from the component, because nothing in a board named its
runs. The browser computed one from the element under the pointer and parse5 resolved it
against the file: two derivations of one thing, which agree only where the DOM's shape
*is* the file's. That held for a hand-written card and failed completely for anything
`board.js` renders, so markdown was not editable at all — a path into what it drew
addressed nothing in the file, and the editor had to refuse such a component up front.
An authored id is the same string on both sides of the wire, so the failure mode moves
from "silently addresses the wrong element as a board is edited" to "refuses a name
nothing has". The one wrong answer it can give — two elements with one name — is checked
rather than resolved to the first match, and `duplicate` mints new names for every run
inside the copy so the app never creates that case itself. The cost is real and was
accepted: **a board written before this convention has no retypeable text**, and there is
no fallback path, because a fallback would be the index path again with its failures
moved later.

*Two editing surfaces, because there are two shapes.* Plain text keeps the in-place
`contenteditable` it always had: that path preserves the file's own whitespace and
produces a one-line diff, which is the property everything here is for, and it must not
regress. A `[data-md]` or `[data-mermaid]` component gets a **monospace textarea over
it** holding its whole source, because what is on screen there is not what the file says
— `board.js` was handed `## The sequence` and drew an `<h2>`, and there is no byte range
in the file corresponding to that `<h2>`. So the editable unit is the source, named once
on the component, and not a rendered block. `board.js` keeps the source it drew from (a
`WeakMap`, not a `data-source` attribute — the file is the one truth, and a copy in the
DOM would be a second) and exposes `source` and `redraw` on `window.__board`. A commit
re-renders that one component rather than reloading the frame, which is what keeps the
frame pinned to the revision it loaded (§7) — the alternative flashed the whole board for
one component. A re-render takes `__boardReady` down and puts it back, because everything
that waits for a board waits on that flag.

The splice keeps the whitespace it found. A paragraph written over three indented lines
is the normal shape of a board, and replacing the whole inner range pulled the text up
onto the opening tag and the closing tag up behind it: a three-line diff for a retype.
Only the text *between* the surrounding whitespace is replaced — and the incoming text
is trimmed when that whitespace is being kept, because `contenteditable` hands back the
file's own indentation as part of `textContent` and writing it on top of the indent
already there put a blank line in the file on every edit. The source editor is the
multi-line case of the same rule: it shows the block dedented, since that is what the
markdown parser sees and four stray spaces are a code block, and re-indents it on commit
so that changing one line of a rendered component is one line of the diff. Two characters are escaped
on the way in, `&` and `<`, and no longer `>` — a Mermaid source is `A --> B` on every
line, and escaping that rewrote a whole diagram for a one-line edit.

What is still refused, and honestly: a run whose content is markup (`See <a>the doc</a>`
cannot survive a plain-text replacement, so the author marks the words instead), a source
with raw HTML in it (the browser only ever had the element's `textContent`, with the tags
already dropped, so writing it back is the same loss), a name nothing on the board has,
and a `data-embed`, whose content is somebody else's file and whose editable thing is the
path.

**The appearance vocabulary is the stylesheet's, and it is thinner than it looks.**
`board.css` has five component classes that mean the same thing — a box with prose in
it: `text`, `sticky`, `card`, `callout` — and one variant attribute,
`data-tone` (a callout's warn/danger/ok). That is all it has:
there is no sticky colour, no font size, no alignment. So the inspector offers a class
switch and a tone, and nothing it invented. **A deck's `lib/` is a copy** — but one
that is refreshed on every open (§2.1), so the constraint this design was written under
has softened: a class added to `board.css` reaches an existing deck on its next restart
instead of never. What survives is the discipline rather than the deadline — the
vocabulary and the stylesheet are one decision, and inventing `.sticky[data-tone="blue"]`
in the inspector without the CSS to match is still a control that does nothing.
`BOX_CLASSES` and the tone lists live in `@decks/protocol` with that written next to them. `kpi`, `table` and `chip`
are deliberately not in the switch: their CSS styles children the other five do not
have, so swapping one in produces a component whose content no longer fits it.

`panel` was a fifth and is gone. It differed from `card` in two declarations — a deeper
background and no shadow — which is too little to choose between under pressure, and the
inspector offered the choice on every box. A board still saying `class="panel"` gets a box
with no padding, no border and no background: the words are still where the author put
them, because `body.board > *` positions every top-level component regardless of its class,
but it no longer looks like anything. So the removal is paired with rewriting the boards
that used one, which is why the fixtures, the templates and the skill changed in the same
commit.

An earlier version of this paragraph claimed such a board "drops out of absolute
positioning and collapses into document flow". That was read off the `.card, .sticky, …`
selector list without checking whether anything else granted it, and `body.board > *` does
— so it is true only of a *nested* `class="panel"`, which was never a component anyway. The
action was right and the stated failure was worse than the real one.

**A `data-edit` earns a hover underline, and `"false"` is reserved.** The name is the
whole address (§6.5), so an element carrying one is exactly an editable element — which
is what makes the affordance safe to draw: a dotted underline under the cursor answers
"can I type here" where the question is asked, and it cannot promise a retype that will
then be refused. The other line of this branch arrived at the same underline from the
opposite direction, as a *hint* over editability that stayed inferred, with
`data-edit="false"` sealing an element and its subtree. The seal is discarded — under this
rule there is nothing to seal, because a run with no name is already not editable — but
`"false"` stays reserved and refused in both places (`Editor.nameOf`, `patch.retype`).
That is not tidiness. With the name as the address, an author who wrote
`data-edit="false"` meaning to turn editing off would create an editable run *called*
`false`, which is the one way this attribute could do the opposite of what it says.

**The inspector is a floating panel, not a sidebar.** It appears at the top right for
the selection and only above `INTERACT_ZOOM`, the rule the palette already documents —
below that a board is a tile on a map, its frame takes no pointer events, and there is
nothing to select. `right: 30px` is load-bearing: the chat panel opens when the cursor
comes within 26px of the right edge (`lib/panels.ts`), and a panel any closer would
pull the transcript over itself as you reached for it. A permanent sidebar was the
obvious alternative and it contradicts §7 — the chrome is away by default because the
canvas is the work. A context menu was the other, and it is a second place to put the
same rows, reachable only by knowing it is there; the keyboard covers the frequent ones
instead (⌘D duplicates, `[` and `]` change order, ⌫ deletes, and the palette's own
`V S C T E` finally do something).

What the inspector will not offer, on purpose: a colour picker writing
`background: #f0c`. (The source editor is not a counter-example: it holds a markdown or
Mermaid source, which is text a `text` patch can splice, and never a component's HTML.) Boards use tokens, the authoring skill tells the agent never to
write a hex, and widening `update`'s `style` from a rectangle to arbitrary CSS turns a
byte-range splice into a stylesheet editor. Nor a textarea holding the component's
HTML: that is re-serialising by hand, and the agent is the fallback editor.

**Two new ops, both of which had to be ops.** `duplicate` copies the component's own
source bytes with a handful of attributes rewritten inside the copy, because that is the
only copy that keeps a card's heading, its paragraph and its list — an `insert` composed
by the browser would produce the palette's placeholder wearing a new name. Every
`data-edit` inside the copy is renamed along with the `data-id`, which is not a nicety:
two components sharing an editable name make a retype of either ambiguous, and it is the
one way the app could create that case itself. The palette's `insert` writes a
`data-edit` for the same reason from the other end — the first thing anybody does with a
new sticky is double-click the placeholder, and a component that had to be named by an
agent before it could be typed into would look broken. Its name is
derived from the original's (`goal` → `goal-2`), since an id is the one thing in a
board a person and an agent both address by hand. `rename` is an op rather than an
`attrs: { "data-id": … }` write because a name is not an attribute like the others: it
has to be one a board can use, it has to be one nothing else has, and the op has to
answer with it. Renaming is worth having despite what it costs — an agent may hold the
old name in context — because the summary it is told says exactly what changed, which is
the same mechanism every other edit relies on. It used to have a second job: rewriting
every `data-from`/`data-to` that named the old id, in one pass of descending offsets,
because otherwise the file still looked right while an arrow silently stopped being
drawn. Connectors went, and with them the only thing in a board that named a component
from outside it, so a rename is now a single-attribute splice. `duplicate` is what still
needs the multi-splice path, for the copy's `data-id` and its `style`.

**What a family is, after the connector went.** The inspector sorts the selection into
`box`, `embed` or `other` by its classes and attributes, and no longer by its tag: an
`<svg>` was a connector by construction, and a hand-drawn diagram is whatever its author
classed it. A top-level `<svg>` is therefore an `other` — a name, an order, a copy, a
delete — and gets no drag, no resize and no retype, because every gesture in
`canvas/Editor.ts` is `offsetLeft`/`offsetWidth` and an `SVGElement` has neither. The
authoring skill answers that by putting the drawing inside a box component, which is
draggable like anything else and scales the `viewBox` with it. A guard in the editor
rather than a fix: making SVG geometry work would mean a second coordinate path through
that file for a shape the guidance says not to write.

**A burst of inspector clicks is one patch.** A patch carries the rev it was composed
against and a stale one is refused (below) — right for "the agent wrote this file while
you were dragging", absurd for "you clicked three tone swatches". So an edit made while
a patch is in flight waits (`canvas/patches.ts`), coalesced — consecutive updates to
one component merge, and two retypings of one run keep the last — and goes as a single
batch against the rev the acknowledgement carries. The rev has to come from that
message: `board.rev` in the store is not updated until `board.changed` arrives one
message later, so composing against it there would send a stale patch to fix a stale
patch. The file-drop path (§6.9) found this first and solved it by hand for its own
batch; this is the general form, and it also fixes the case that was quietly broken
before there was an inspector — an arrow key held down sends a patch per repeat.

**An inspector edit is applied to the live document as well.** The frame is pinned to
the revision it loaded so a user's own edit does not reload the board they are working
on (§7), and that pin assumes the editor has already made the change on screen. Every
edit therefore does both halves — `setAttribute` and the patch — and asks `board.js` to
re-mount an embed whose source changed. Deleting was the one that had never done its
half: the patch took the component out of
the file and it stayed on screen until something else reloaded the frame. A duplicate
is the deliberate exception, since its markup exists only in the file; that op unpins
and takes the reload, exactly as an insert does.

One trap worth naming, because it shipped for an hour: a class swap sends the whole
attribute, and the editor's own `decks-editing` class lives on that element in that
document. The first version wrote `class="callout decks-editing"` into the file — the
overlay leaking into the artifact, which is the one thing the affordances are marked
for. `readShape` drops every `decks-` class, and a check asserts the file never
contains one.

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

### 6.9 Files the user drops in

Everything that changes state goes over the socket (§5) — but bytes are not state, so a
file dragged in from the desktop is the one thing that arrives as a request body:
`POST /api/upload?name=…`, one file per request, the bytes raw. Not
`multipart/form-data`, which would be a parser and therefore a dependency for no gain;
one request per file is also what lets the browser report progress per file and land each
one as its own component.

**A dropped file is copied into the deck.** `assets/` already meant "the images the
boards use", and a deck is meant to be self-contained: an embed pointing at
`~/Desktop/photo.png` is a board that breaks the first time the user tidies up, and it
would not survive being handed to another machine either.

This is the first thing in Decks that writes bytes the user did not name, so the guards
are worth listing, and so is what they do not cover.

- **One directory.** `resolveAssetWrite` in `deck/roots.ts` — every path decision is
  still in that one file — takes a plain file name and answers with a path inside
  `<deck>/assets`, resolving symlinks before both containment tests, since an `assets`
  that is a link out of the deck is as much a way out as a name that is.
- **The name is derived, not trusted.** `assetName` reduces whatever the browser sent to
  a basename over a conservative ASCII alphabet: no separators of either kind, no `..`,
  no control characters, no leading dot (so an upload can never be a dotfile, and never
  addresses `.decks/`). It *repairs*; `resolveAssetWrite` then *refuses* anything that
  still does not look like a plain name, so a bug in the repair is a 403 rather than a
  traversal. A test asserts every name the first produces is one the second accepts,
  because the interesting failure is those two drifting apart.
- **A cap checked before the body is buffered.** `MAX_UPLOAD_BYTES` (32MB) lives in the
  protocol package so both sides know it; `express.raw` refuses on `Content-Length`
  before reading a byte and again on a chunked body that lied, and the answer is a 413
  with a sentence.
- **Nothing is overwritten, and identical files are stored once.** The name stays
  readable and a clash becomes `photo-2.png`; the content hash is used for *comparison*
  rather than as the file name. Naming files after their hash was the alternative and it
  is worse where it matters: `assets/` is a directory a person opens and an agent greps,
  and `data-embed="../assets/9f3c…d1.png"` tells neither of them anything. The write is
  `O_EXCL`, so "never overwrite" survives the gap between the check and the write.
- **An uploaded HTML file cannot script the app.** See §4: an asset that a browser would
  run is served sandboxed even though it lives inside the deck.
- **One CSRF-shaped check**, because it is free: `Sec-Fetch-Site` is set by the browser
  and cannot be forged by page script, so an upload that says `cross-site` is refused. An
  absent header is allowed — `curl` and older Safari do not send one.

**What is deliberately not defended against.** There is no authentication anywhere
(DEPLOYMENT §1), and this route does not invent any: `/ws` next door accepts every frame
from every origin and runs `bash`, and WebSockets are not subject to CORS, so a hostile
page in a browser pointed at the port already has strictly more than this offers. Nor is
there a quota — the cap is per file, not per deck — no rate limit, no scanning of what is
uploaded, and no re-encoding of images: an uploaded PNG is stored as it arrived and drawn
by the browser's own decoder. Windows-reserved names (`nul.txt`) are not special-cased.

**The agent hears about it for free.** A drop is an ordinary `insert` patch, so it goes
through the same path a palette insert does and produces the same "the user edited this
board" nudge (§6.5) — with the embed's path named in the summary, since "added embed
#embed-2" would leave the agent unable to see the file the user just dropped without
re-reading the board to find out what it points at.

**Two inserts in one batch used to collide.** Ids are minted on the server against the
file as it is (§6.5), and the batch was named up front — so two files dropped together
both became `embed-1` and the second was refused for a name the first had only just
taken. `applyPatches` now takes the minting function and calls it per patch, against the
file the previous patch produced.

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
- **A file dropped on a board is the same problem, and the same answer.** A drag from the
  desktop over a board produces `dragover`/`drop` inside the frame's document and nothing
  in the app's, so `file-drop.ts` listens inside the frame exactly as `frame-gestures.ts`
  does. Drag events carry `clientX/clientY` in the frame's pixels, which are board
  pixels, so the drop point needs no camera maths either — asserted by a check that drops
  at a known point and reads back the `left`/`top` the server wrote, rather than assumed
  from the pointer case. The highlight is an element appended to the board's document and
  marked `data-decks-ui`, like the editor's handles, and it is driven by a *counter* over
  `dragenter`/`dragleave`: both fire per element crossed and both bubble, so a boolean
  made the highlight strobe as the cursor passed over a card. A batch flows rightwards
  from the drop point and wraps at the board's own width; each component is sized for what
  it holds, an image from its own pixels. The first version cascaded them a few pixels
  apart, which for five embeds is a pile in which four are unreadable.
- **The app's document swallows file drags globally**, because the browser's default for a
  dropped file is to navigate to it — which would unload the SPA, socket and camera and
  all, to show a PNG. Reaching the parent's handler means the drop missed every live
  board, since a drop over one is consumed inside that frame, and the answer there is a
  notice: an embed belongs to a board, and inventing a board to hold a file dropped on
  empty canvas would be the app deciding something it was not asked to. Zoomed out past
  `INTERACT_ZOOM` the frames take no pointer events at all, so a drop then lands on the
  stage; the notice says to zoom in when the cursor was over a board.
- **An insert is the one edit that does want the frame to reload** — and a duplicate, for
  the same reason. The pin (below) exists because the editor has already mutated the
  frame's DOM: true of a drag, of a class swap, of a delete, and false of an insert or a
  copy, whose component exists only in the file because the server mints the id and
  writes the markup. Pinned, a dropped file landed in `assets/`, landed in the board's
  source, and appeared nowhere on screen. `needsReload` in `canvas/patches.ts` is the one
  place that decides.
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

### 7.1 A hand instead of a cursor

A phone is not the primary way to use a coding agent's canvas and never will be. But an
infinite canvas you cannot zoom with two fingers is not usable *at all*, and that is what
this was: a touchscreen sends no wheel events, so two-finger scroll, pinch, ⌘-wheel and
space-drag were all simply absent, and a one-finger drag over a live board moved nothing
whatsoever — the canvas was frozen wherever a board sat under your finger, which up close
is the whole screen. The aim here is "genuinely usable for looking at a deck, reading a
board, talking to the agent and light editing", and everything below serves that.

- **Two fingers are always the canvas, and there is one pool of fingers for the whole
  stage.** `canvas/touch.ts` reduces a set of fingers to a pan or to one step of a pinch,
  and `pinchCamera` (`lib/camera.ts`) turns that step into a camera: the world point under
  the old midpoint goes under the new one at the new zoom, which is `zoomAbout` generalised
  to an anchor that moves. Steps are measured against the previous event rather than
  against the start of the gesture, so a spread past `MAX_ZOOM` is clamped once instead of
  being accumulated into a gesture the camera has to unwind before it answers again.

  The pool is what makes it correct, and it is not an optimisation. A pinch does not
  respect document boundaries: one finger can be inside a board's iframe and the other on
  bare canvas, or on a *different* board's title bar. Each of those is two event streams
  and one gesture, and a tracker per stream turns a pinch into two independent one-finger
  pans — which was the original bug in miniature. So the stage owns the fingers and the
  other documents report into it (`frame-gestures.ts`, `BoardFrame`), which is the same
  division of labour §7 already describes for the wheel: the frame knows where the pointer
  is, the stage owns the camera.

- **One finger moves the canvas unless it landed on something that says otherwise.** That
  is the whole rule, and the exceptions are: a board's title bar moves the board, a
  scrollable box inside a board scrolls, and a component *already selected* drags. A
  desktop distinguishes dragging from panning by which button is down and whether space is
  held; a finger has neither, and the two gestures it must not confuse are "read this
  board" and "rearrange it". So **selecting is a tap and only a tap**, and dragging is
  available on the second gesture, when the thing under the finger is the thing the outline
  is already around. Nothing is ever picked up by accident, a pan across a board never
  changes the selection, and the price is one extra tap before a move.

  A finger that belongs to something else is *claimed* rather than withheld
  (`claimTouch`): it still counts towards the pool, so a second finger forms a pinch with
  the right positions, and two fingers clear every claim — pinching out of a board you had
  begun to drag is a change of mind, not an ambiguity, and the board goes back where it
  was.

- **Coordinates, three traps deep.** In-frame pixels are board pixels (§6.5), and for
  touch that is not enough. (1) A pan measured in them cancels half of itself, because the
  pan drags the board along under the finger: 60 screen pixels of finger moved the camera
  30. So the frame converts to stage pixels before reporting, and the stage does *not*
  convert again — subtracting the stage's offset twice is a horizontal pinch that walks the
  canvas 90px vertically. (2) The conversion has to use the frame's geometry as of the
  coordinates the browser is reporting, which during a gesture is *before* the camera
  change that gesture just caused; sampling it after each step and using it for the next is
  the pairing that holds a pinch's midpoint still. (3) A tap cannot be told from a pan by
  distance travelled at all, for the same reason as (1) — a 60px pan measures 8px in the
  board's frame — so `frame-gestures.ts` says so out loud and `Editor.ts` listens
  (`pan-signal.ts`). Screen coordinates would have answered it, and `screenX` is 0 for a
  synthesised touch, so the browser checks could not have seen the bug either.

- **`touch-action: none` on everything inside a board frame.** On the root alone it was not
  enough: the browser still claimed a finger that landed inside an embed's own scroller,
  scrolled it natively and sent a `pointercancel` three events in, so the gesture was half
  native and half ours and the canvas took the rest. The universal selector is blunt and it
  is exactly the intent — a board on the stage does not scroll itself, and the scrolling
  that looks native is done by hand for the reason the wheel path documents. The style is
  marked `data-decks-ui` like every other affordance, so a board opened on its own scrolls
  the way any page does.

- **Tap to select, tap again to retype.** A double-tap is the browser's zoom gesture and a
  poor thing to ask of a finger over a 14px line of text, so the second tap on a component
  that is already selected starts the edit — the idiom every phone teaches, and it falls
  out of the selection rule rather than being a second mechanism. Focusing that
  `contenteditable` raises the keyboard over the bottom half of the screen, which is
  usually where the words are: `keepVisible` pans the camera the smallest distance that
  puts the component in the room left over, and `lib/viewport.ts` publishes how much of the
  window the keyboard is covering as `--keyboard`, which the bottom chrome adds to its own
  offset. There is no CSS unit for that inset, and `dvh` describes the wrong thing.

- **Where a cursor cannot hover, the chrome is toggled.** The two floating panels arrive
  when the cursor approaches an edge, and a finger cannot approach anything: on a phone
  both panels were unreachable, and worse, a pan that began at the left edge summoned the
  rail over the canvas mid-gesture. So under `(hover: none)` proximity is off entirely and
  two buttons in the title bar open the panels, which honours §7's thesis better than an
  edge that opens by accident. Below 760px they are sheets across the screen and **mutually
  exclusive** — 200px of rail and 380px of transcript on a 390px phone is two panels and no
  canvas — and both stop above the dock, so the composer is never what a panel covers.
  Everything else that was revealed by hovering (a board's `×`, a message's `rewind · fork ·
  restore boards`) is simply there.

- **Three media queries, asked about three different things.** `(hover: none)` is about
  *discoverability*, `(pointer: coarse)` is about *size* — nothing moves, the targets grow
  to 40–44px — and a width breakpoint is used only for what is genuinely about width: the
  dock's clearance, and the panels becoming sheets. Nothing is a separate mobile layout;
  every rule is an override, and above the thresholds the stylesheet is the app it was.

- **The inspector becomes a bottom sheet, and it is the one place the desktop's reasoning
  does not survive the smaller screen.** Top right is right on a laptop (§6.5). Across the
  top of a phone it is in the way of the tap that opened it: you tap a component, a panel
  appears where your finger just was, and the next tap lands on a class switch nobody meant
  to touch — which happened, and wrote a revision each time. At the bottom the hand is
  already there and the component stays visible above it. It takes the zoom controls' place
  while it is up, because zooming has fingers to do it with.

- **The dock was zero pixels wide.** `width: min(720px, calc(100% - 650px))` is the room
  left beside two panels, and on a 390px screen that is a negative number: the composer was
  18px across with the placeholder broken one letter per line, and the send button was
  unreachable. This is the whole class of bug that only a real device viewport finds, which
  is why `e2e/checks/mobile.mjs` runs in a device context with `hasTouch` and dispatches
  real touches through CDP — a mouse would have hidden every one of these.

- **Getting a file in without a desktop to drag from.** The upload route and the insert
  path already existed (§6.9); what was missing was somewhere to tap. The file picker grew
  a "from this device" button over a hidden `<input type="file">`, which on a phone offers
  the camera and the photo library as well as the file browser — three routes for one
  control, none of them ours to build — and a pasted file lands on the selected board, at
  the last point that board was touched. The picker is dismissed by a press that *begins*
  on its backdrop rather than by a click on it: the tap that opened the picker produces a
  `click` afterwards at the same coordinates, and the backdrop is by then underneath it, so
  a click closed the picker the instant it opened.

- **Every keyboard-only action has a touch route.** The palette's `V S C T E` are its
  buttons, ⌘D / `[` / `]` / ⌫ are the inspector's row, `0` is the zoombar's `fit`, `1` is a
  rail item or a double-tap on a title bar, and Escape is the inspector's `×`. ⌘Z had
  nothing, so undo sits in the palette on a touch device — not a tool, and there anyway,
  because the palette is the only editing chrome a finger has and it appears under exactly
  the condition that makes an edit possible.

**What mobile deliberately does not cover.** Editing on a phone happens zoomed in, because
`INTERACT_ZOOM` is unchanged: a whole 1600px board fitted to a 390px screen is 24%, where a
frame takes no pointer events and text is unreadable anyway. There is no drag-and-drop of
files (the platform has none), no marquee, no multi-select, no keyboard shortcuts, and no
hover preview on the timeline — the spine is hidden below 760px and rewinding is reached
through the transcript, so the tap is the whole gesture rather than a preview and then a
commitment. A pinch whose fingers land inside a *nested* sandboxed embed (an HTML embed is
an iframe two levels in) is not forwarded, exactly as a wheel over one is not. And the
agent-facing side is untouched: `stage_eval`, the time machine and the permission dialogs
are the same code on any device.

## 8. What is built

All six milestones, each verified against the real app rather than only unit-tested.

| | |
|---|---|
| M1 | Deck, stage, embeds: pan/zoom, drag-to-arrange, md/pdf/html/image/text embeds, files dropped in from the desktop, live reload. |
| M2 | One agent: Pi adapter, transcript, composer, extension-UI bridge, both skills. |
| M3 | `stage_eval`: stage service, eval, identity, state rebuilt from the branch. |
| M4 | The user draws: editor, palette, inspector, patches, revisions, undo, the agent is told. |
| M5 | Many chats: registry, chat list, `stage.delegate` with board handoff. |
| M6 | Time machine: rewind / fork / restore on each message, preview from revisions. |

Since then the canvas also works under a finger — pinch and two-finger pan pooled across
the board frames, tap to select and tap again to retype, the panels toggled and the chrome
sized for a fingertip (§7.1) — with the scope of that stated at the end of the same
section.

### Known edges

- The rail and the chat list share the left panel, and it has no collapsed-but-visible
  state beyond the sliver — a board parked at the far left sits behind it when it is out
  (draggable by its body once zoomed out).
- No deck picker: switching decks means switching data directories, by argument or by
  `DECKS_DATA_DIR`. The socket already carries `deck.open` for the day there is one.
- No session resume, so a restart is a fresh conversation and older sessions are reachable
  only through the Pi CLI. Drawing one would mean rebuilding a transcript from a session
  file — `agents/translator.ts` builds it from live events only.
- Panel reveal is hover-driven, and where there is no hover the two panels are toggled
  from the title bar instead and everything hover-revealed is simply shown (§7.1). What
  touch loses with it is the *preview*: `rewind` previews the boards on hover, so on a
  phone the tap is the whole gesture.
- A diagram drawn as a bare top-level `<svg>` can be selected, renamed, copied and
  deleted but not dragged, resized or retyped — the editor's geometry is `HTMLElement`'s
  and an `SVGElement` has none of it (§6.5). Putting the drawing inside a box component
  is the answer the authoring skill gives, and it costs one wrapper.
- A board written before `data-edit` has no retypeable text: the name is the whole
  address and there is no fallback (§6.5). The templates, the example deck and the
  authoring skill all carry the convention, so what is left is boards an older agent
  wrote — for those, a retype is a sentence to the agent, which is also what adds the
  names.
- A markdown or Mermaid source containing raw HTML cannot be edited from the app. What
  `board.js` mounted was the element's `textContent`, with the tags already dropped, so
  the browser never had the file's bytes to send back; it is refused rather than
  flattened.
- The inspector edits one component at a time. There is no multi-select, so "make these
  four cards callouts" is four clicks or a sentence to the agent.
- `kpi`, `table` and `chip` get a name, an order, a copy and a delete, and no appearance
  rows: their CSS styles children the four prose classes do not have.
- An embed's caption, an image's alt text and how a picture fits its box are not
  editable, and this is the lib-is-a-copy constraint rather than an oversight —
  `board.js` labels an embed from its filename and `board.css` has one rule for the
  image inside one, so every one of those needs a runtime that older decks do not have.
  The board's own `<meta>` (size, background, theme) is not editable either: it is not a
  component, and it is one line for the agent.
- A component inserted or duplicated lands before `</body>`, which is *after* the
  `<script src="../lib/board.js">` line. Valid, and it renders, but a reader of the file
  sees a component below the script tag.
- A dropped file only lands on a board, and only while the board is live: on empty canvas
  it is refused with a notice, and there is no drop onto a rail thumbnail (they are
  `pointer-events: none`, so such a drop is the stage's and gets the same notice). Pasting
  is built now and needs a rule where a drop has a point: a pasted file lands on the
  *selected* board, at the last place that board was touched, and on no board at all if
  none is selected. A file added through the picker's "from this device" is one file, not a
  batch — a batch is the drop path's shape, which lays several out in a row.
- A rewind truncates our transcript by matching the rewound message's text, which is
  what `navigateTree` hands back. Two identical messages in one conversation would cut
  at the first.
- `stage.delegate` waits for the child. A detached mode (`detach: true` in the plan) is
  not built, so a long child blocks the parent's turn.
