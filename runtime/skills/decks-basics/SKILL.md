---
name: decks-basics
description: How Decks works around your canvas work. The deck's folders and what a card may point at, canvases friends shared with you, your camera and moving the person's view, comments, documents and Google Docs, handing work to other agents, and the decks command's conventions (flags, output, the node SDK, events). Read when one of these comes up.
---

# Decks basics

## The deck's folders

The deck is your working directory. Each canvas is a folder that stands alone, `canvases/<name>/`:
its drawing (`canvas.pen`), its cards (`cards/<card>/index.html`), its saved frames (`frames/`) and
the pictures and files it uses (`files/`). A card you make goes in its canvas's own `cards/`
(`decks card create --canvas <name>` does that). A card may point at its own folder, its canvas's
folder and the deck's `assets/`, `docs/` and `apps/` (`../../files/a.png`, `../../assets/a.png`);
never at another canvas or a hidden folder. A deck from before cards may still hold a `boards/`
folder: plain files now, read like any other, shown on no canvas.

## Canvases friends shared with you

They are in `shared/canvases/<owner>/<canvas>/`. Their cards are their owner's and run no scripts
here. You change one only if they let you edit, and then everything you add goes in that canvas's own
folder, never this deck's `assets/`. One shared to view is changed only in your own copy:
`decks canvas copy-shared --canvas shared/<owner>/<canvas>`.

## Your camera and the person's view

You have no home canvas: every canvas call names its canvas with `--canvas <name or title>`, and one
that names none is refused. Each message the person writes says, in a line before their words, which
canvas they were looking at, by a name a call can use; `decks here` says the same. In a shell,
`c=$(decks here | jq -r .name)` once, then `--canvas "$c"` on each call.

What you have is a **camera**: the tab the person sees beside your chat. Only `decks view …` moves
it, and that never changes where your calls act:

- `decks view goto <canvas>` puts your camera on a canvas;
- `decks view focus <path or id>` flies to a card or item (an item's id needs `--canvas`);
- `decks view open <what>` opens a canvas, a card, a document or an app whole, as a tab.

While your chat is the one on screen, the screen moves with it. In the background your camera just
moves, and the person sees it when they open your chat. While they are using the canvas they are
offered a button instead, and the answer says so.

## Comments

The person comments on cards and draws on the canvas around them; they do not edit a card. A comment
arrives as a message naming the card, the block's `data-id` when it has one, and the words they
selected. Read a card again before assuming it still says what you last wrote.

## Documents and Google Docs

A document the person writes in (a `.md`, `.tex` or `.docx`) is a document item on the canvas
(`{ "type": "document", "path": "…" }`). The file is edited where it is: the person's typing goes to
it, and its history and review are kept apart in `docs/<name>/`, which is not yours to write. Edit
the file with your own tools: your edit lands at once, highlighted on the words you changed, and the
person accepts or rejects it; History shows and restores any earlier version.

A Google Doc opens the same way, from its link (Add menu, Document…). Edit it with `gdocs_read` and
`gdocs_edit`, never by writing its mirror in `docs/`.

## Handing work to another agent

Both return at once:

- `decks agent queue <name> --task …` puts it in their queue, taken up when their current turn ends;
  `--reply true` brings their report back into your transcript.
- `decks agent send <name> --task …` delivers it now, into the turn they are running (or a new one if
  they are idle); the answer says whether it landed.

`decks agent create --name … --kind …` makes an agent first; `decks agent list --workspace …` lists
who is on your project; `decks agent inbox` lists what was handed to you. A long brief goes on a
card, not in the task string. Changes others make on a canvas reach you with your next message, so
there is nothing to watch.

## The decks command

Everything you do to the canvas is a `decks` command; a card's content is files you write with your
own tools. `decks --help` lists the commands, `decks help <command>` explains one in full.

- A plain argument (a path, a name, a title) is a word; an object argument's keys are flags,
  `--title "…"`, with a dot for a key inside a key (`--at.x1 0`); anything else is JSON, and `-`
  reads it from stdin. `--args '<JSON list>'` gives every argument at once.
- The value goes to stdout: a string as it is (`u=$(decks card url <path>)`), anything else as JSON
  for `jq`. Notes (where a card went, what `decks canvas fit` measured, reminders) go to stderr; a
  refusal exits with 1 and says why.
- `decks events card.changed` prints each change to a card as it happens, one JSON line each.
- For loops, a node script: `const { decks } = await import(process.env.DECKS_SDK)` gives every
  command as `await decks.card.create({ … })`. A card's module has the same calls as `card.decks`.
- `$DECKS_SKILLS` is the folder these skills are in, for a file a skill offers to copy.
