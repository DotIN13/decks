# server/cards

Cards, and every file in the deck. The file calls are why the protocol is complete without a disk.

## Owns

- `file.list find read write edit grep move delete url`, in files.ts and calls.ts.
- `card.list get create claim url`, in cards.ts and calls.ts. `card.fit` measures in a browser: it is
  `server/pictures/`'s, in wave 2, so the router answers it `unavailable` until then.
- The card as an item kind (item.ts): `{ type: "card", card, title, box }` on a call, a `browser` node
  tagged `decks.card` in canvas.pen.
- A card's page and its modules (page.ts), and the card runtime in a deck's `lib/` (lib.ts).
- no-disk.test.ts: a client builds a card and a document by calls alone, with every feature
  main.ts runs. Any feature may add its own test to it.

## May import

`protocol/` and `server/kernel/`, through their entry files. No other feature.

## Rules

1. A path starts at the deck's root. A path outside the deck, or with a hidden part (`.decks`,
   `.git`), is refused as `refused`, with a sentence naming the part.
2. Every read and write goes through `ctx.deck`. A write carries its caller, so history names its
   author; the answer is the file as it now is, with its revision and author.
3. A file's revision is the last one the deck's history recorded for it; a file history has never
   seen is at 0. `file.read` answers it, and `file.write` and `file.edit` with `rev` check against
   the same number: if the file has moved past it, `conflict`.
4. `file.edit` replaces exact words. Each `find` must occur exactly once, or every time with `all`.
   No match, or more than one without `all`, refuses the whole call: all edits or none.
5. `file.read` reads text; `from` (1-based) and `lines` read part, and `truncated` says so. A file
   over 1 MB is cut there.
6. `file.find` matches a glob (`*` within a folder, `**` across folders); `file.grep` matches a
   regular expression per line. Both stop at `limit` (200) and never enter `lib/`.
7. `file.delete` and `file.move` take a file or a folder. The deck's trash keeps what went.
8. `file.url` is `/files/<path>`: the address this feature serves the file at.
9. A card is `canvases/<canvas>/cards/<name>/index.html`, its folder holding what it keeps beside it.
   A card is named by its folder or its index.html; both mean the index.html.
10. `card.list` and `card.get` say where each card sits on its canvas (`placements`), each canvas
   read once. A card's title is its `<title>`, else its first `<h1>`, else its folder's name. Its writer is
   who last wrote its index.html through a call, or claimed it.
11. `card.create` writes a blank card from the title, in the named canvas or the caller's here. Its
   folder name is the title made plain (40 letters at most), with `-2`, `-3` when taken.
12. On a canvas a card is a `browser` node whose metadata is `{ type: "decks.card", path }`, the path
   from the canvas's folder. Read and written back, a node keeps every field it had.
13. A card's files are its whole folder: they travel with it on copy, paste and share.
14. A card's page (`/files/<card>`) is the card in a page of its own; its n-th module is
   `/files/<card>.m<n>.js`. A card on a friend's canvas runs no scripts: its modules are refused.
15. The card runtime in `lib/` is brought up to this build's on start: a file is written only when
   its bytes differ, and one this build no longer ships is removed.
16. A card item given as html is written into a new folder of the canvas before it is placed.
17. A card placed with no box takes the size its file declares (`<meta name="card">`), else 1000 by 600.
18. A card resized on its canvas writes its new size into its file's meta tag.

## Check

- `node tools/check.mjs server`
- `node tools/gates/run.mjs`
