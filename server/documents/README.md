# server/documents

Files you type into: a document page, its splices, its versions, the changes another writer made,
and Google Docs.

## Owns

- The document calls on `file.*` (open, close, splice, review, versions, version, restore), in
  calls.ts, over an open document in doc.ts and splices in splice.ts.
- Which deck revisions are versions, and the changes waiting for review (records.ts), in its store.
- The document as an item kind (item.ts): `{ type: "document", path, box }` on a call, a `browser`
  node tagged `decks.document` in canvas.pen.
- `google.status connect disconnect`, and a Google Doc's sync with its mirror (google.ts).

## May import

`protocol/` and `server/kernel/`, through their entry files. No other feature.

## Rules

1. A document is a text file in the deck (`.md .markdown .txt .tex .bib .rst .org`). Its path is
   fenced as every file's is: outside the deck or hidden is refused as `refused`.
2. A page opens a document and gets its text, its revision and the changes waiting for review.
3. Typing arrives as splices made on a revision: `{ at, before, text }`, `at` in UTF-16 units,
   sequential within a batch. A splice made on an older revision is moved past what landed since.
   One whose `before` is no longer there is refused, and the answer carries the whole text.
4. Each landed batch is written to the file through `ctx.deck`, by the caller, and announced as
   `file.changed` with `part: "words"`.
5. Typing that pauses for one second becomes a version. Keeping the same text twice is one version.
6. A write that did not come through the page (an agent's `file.write`, its own editor) becomes a
   change: its splices, its author, the version before and after. It waits for a person to accept
   it (it stays) or reject it (its reverse splices land, as typing does). `"*"` is every change.
7. Restoring a version is one edit, made by the caller, kept as a version itself.
8. A version is a revision in the deck's history, its `sha` the revision's number, so `file.read`
   with `sha` reads it. Which revisions are versions, and the changes waiting, are in `ctx.store`.
9. On a canvas a document is a `browser` node whose metadata is `{ type: "decks.document", path }`,
   the path from the deck's root. Its file travels with it on copy, paste and share.
10. Without Google credentials the google calls answer `unavailable`; they never throw anything else.

Typesetting, git and Google comments are not built in wave 1: the router answers them `unavailable`.

## Check

- `node tools/check.mjs server`
- `node tools/gates/run.mjs`
