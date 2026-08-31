# Decks

A canvas-centric coding agent powered by [Pi](https://github.com/earendil-works/pi).

A **board** is a local HTML file of absolutely-positioned components. Boards live on an
infinite stage you pan and zoom; the agent draws on them by editing the file, and you draw
on them with a palette. The transcript floats at the edge. Boards are artifacts: they pass
between agents as context, and they can embed your real documents — markdown, PDF, HTML.

```
deck.json → Deck → boards/*.html → the stage · the chats → Pi sessions
```

## Requirements

- Node.js >= 22.19
- Pi credentials configured (`pi auth`, or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in the
  environment). Decks reads the same `~/.pi/agent/auth.json` the Pi CLI uses.

## Getting started

```bash
npm install
npm run dev            # API on 127.0.0.1:4329, Vite on 127.0.0.1:4328
npm run dev:example    # the demo deck instead of yours
```

Open the Vite URL. The first run creates an empty deck and shows you a blank canvas; ask
the agent for something and the first board appears on it.

## Where things are kept

One directory holds everything, and the deck is `decks/` inside it:

```
$DECKS_DATA_DIR/          default ~/.decks · npm run dev uses <repo>/data
  decks/
    deck.json             where the boards sit, and which roots embeds may reach
    boards/*.html         the boards. The artifact
    lib/                  the primitives, copied in so a board renders on its own.
                          Refreshed from the running build every time the deck is opened
    assets/               images the boards use, and the files you drop on them
    .decks/               revisions and agent avatars — never served except by hash
```

One deck per data directory, because a deck is a working directory: Pi keys a session's
transcripts to the path it ran in, so "which deck" and "which history" are one choice.
Switch by pointing somewhere else — `npm start -- ~/other-data`, or `DECKS_DATA_DIR`.

**The transcripts are not in the deck.** Pi owns them, under
`~/.pi/agent/sessions/<slug of the deck path>/`. Moving a deck therefore leaves its
conversations behind unless you copy that directory too; the boards, their revisions and
their arrangement all travel with the folder. Note that the app never resumes a session —
each start is a new conversation, and older ones are reachable with `pi -r` from inside the
deck directory.

| variable | |
|---|---|
| `DECKS_DATA_DIR` | the directory above. A positional argument beats it: `npm start -- ~/other` |
| `DECKS_HOST` / `DECKS_PORT` | default `127.0.0.1:4329` |

## What it does

- **Boards are files.** `boards/*.html`, absolutely positioned, rendered on an infinite
  canvas. The agent writes them with its ordinary tools; you drag, resize, retype and
  insert with a palette. Both edits land in the same file, and a drag rewrites exactly
  one attribute.
- **And most of a board is editable by hand.** Double-click any run of words the board
  named — a card's heading and its paragraph are separate edits, and a markdown or
  Mermaid component opens its whole source — and the selection gets an inspector: what
  kind of box it is (text · sticky · card · callout), its tone, what an embed points at
  and which pages of a PDF, its name, its order, a copy of it. A run is editable when the
  file says so, with a `data-edit` naming it, which is also what earns it an underline
  under the cursor. What the inspector offers is exactly what the board stylesheet
  already styles, and every change lands as a splice of the lines it named — so the file
  an agent reads back is still one it recognises, and an edit it cannot do that way is
  refused with a reason rather than half-applied.
- **One tool for the canvas.** `stage_eval` runs TypeScript against a typed API
  (`runtime/stage.d.ts`, injected into the agent's context verbatim): start a board, put
  boards in play, hold others in context, rearrange, name itself, draw its own avatar,
  hand work to a subagent.
- **Boards are how the agent talks.** It answers your questions, lays out designs and
  reports finished work on boards, so the canvas — not the chat column — is where you look
  to see what is happening. It holds a set of boards in context and chooses which of them
  to put in play; the chat says which board and why.
- **Embeds.** A board can show your real documents — markdown, PDF with page ranges,
  HTML, images, plain text and source — from the deck or from a root declared in
  `deck.json`. Anything the board cannot draw becomes a chip naming the file, its size
  and its kind, which opens or downloads it.
- **Drag files in.** Drop files from your desktop onto a board and they land there as
  embeds, at the point you dropped them. The bytes are copied into the deck's
  `assets/` — a deck is self-contained, so an embed of something on your desktop would
  be a board that breaks the moment you tidy up. Identical files are stored once, and
  nothing is ever overwritten. The agent is told what you dropped, the same way it is
  told about any other edit you make to a board. Where there is nothing to drag from, the
  file picker will take one from the device instead — the camera or the photo library on a
  phone — and a file on the clipboard can be pasted onto the selected board.
- **And it works under a finger.** Two fingers pan and pinch the canvas, over the boards as
  well as between them; one finger pans, and a tap selects — tap the same thing again to
  retype it. The panels become sheets you open from the title bar, since there is no cursor
  to reach an edge with, and the chrome grows to fingertip size. A phone will never be the
  main way to use this: the aim is looking at a deck, reading a board, talking to the agent
  and light editing, and [docs/DESIGN.md §7.1](docs/DESIGN.md) says what is out of scope.
- **Two runtimes.** An agent runs on [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
  or on Claude Code, chosen when you create it and fixed for its life; `DECKS_BACKEND=pi|claude`
  sets what `+` gives you. Claude agents also carry a mode — ask first, edit freely, plan
  only, auto — and their permission questions appear in the chat column rather than stopping
  the turn silently. A Claude agent needs Claude Code on `PATH`, or `DECKS_CLAUDE_PATH`
  pointing at it.
- **Agents are a chat list.** Each has the name it chose and the face it drew.
  Subagents are rows too, tagged with their parent.
- **A time machine.** Hover the timeline to see the boards as they were at that point
  in the conversation; click to rewind; restore the boards only if you ask.

## Development
```bash
npm test            # 200 unit tests: config, path guards, uploads, patches, revisions, eval, camera, touch
npm run test:e2e    # 215 browser checks against a throwaway copy of example/ (~60s)
npm run typecheck
npm run vendor      # re-copy the board primitives into runtime/lib
```

The browser checks are in [e2e/](e2e/README.md). One of them (`mobile.mjs`) runs in a
Playwright device context and drives real touches, because a mouse hides every bug a
touchscreen has. Six more files drive a real agent turn and are skipped unless you ask:
`DECKS_E2E_AGENT=1 npm run test:e2e`.

`example/` is a committed data directory — `example/decks` is the demo deck and
`example/shared` is the out-of-deck file its sources board embeds, which is the only thing
in the repository that exercises the quarantine path end to end. Its `decks/lib` is
generated rather than committed and needs no step of its own: opening a deck refreshes its
primitives (DESIGN §2.1), so a fresh clone gets one on the first `npm run dev:example`, and
an edit to `runtime/lib` reaches the demo deck on the next restart.

See [docs/DESIGN.md](docs/DESIGN.md) for the design and the reasoning behind it, and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for running a deck on a machine other than the one
you are sitting at — which starts by noting that Decks has no authentication, and that this
governs everything else about such a setup.
