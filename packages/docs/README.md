# @decks/docs

Real `.md`, `.tex` and `.docx` files opened as pages that people type into, while agents and
other programs keep writing the same files with their own tools.

- **Every keystroke reaches the file.** A page sends splices of the source (`at`, the old
  characters, the new ones) at most every 50 ms; the server writes each batch as it lands.
- **Nothing is refused for being late, and overlaps merge.** A splice is moved past whatever
  landed since it was made; where two edits touch the same characters, each removes only what
  the other did not, and the one that starts first puts its new text first. Page and server move
  splices by one shared rule (`transformSplice`), so they end on the same text.
- **Other writers come back as changes to review.** A write to the file from outside (an agent's
  Edit, a script, git) is diffed by word into splices, sent to every page as a `DocChange`, and
  kept until a person accepts it or rejects it; rejecting lands the reverse splices.
- **Every pause is a version.** A version is kept when typing stops for a second and on both
  sides of every outside write; any version can be put back as one ordinary edit.

`.docx` is edited through its `word/document.xml`, and the zip is rewritten with every other part
copied byte for byte. The page draws it with [docx-preview](https://github.com/VolodymyrBaydalka/docxjs),
which reads it as Word lays it out, and matches each drawn paragraph to the file's in order, so a
click edits that paragraph's words.

## Entry points

| Import | What it is | Runs in |
| --- | --- | --- |
| `@decks/docs` | types, the messages, `applySplice`, `transformSplice` | anywhere |
| `@decks/docs/merge` | `land` (a late batch onto a moved text), `spliceDiff`, `invert` | anywhere |
| `@decks/docs/server` | `DocService`, `DirectoryVersions`, `MemoryVersions`, the zip reader | Node |
| `@decks/docs/client` | `DocSync`, one page's copy kept in step | browser or Node |

## Server

```ts
import { WebSocketServer } from "ws";
import { DocService, DirectoryVersions } from "@decks/docs/server";

const sockets = new Set<WebSocket>();
const docs = new DocService({
	// The security boundary: throw for anything a page must not open.
	resolve: (path) => ({ file: safeJoin(ROOT, path), key: path, writable: true }),
	versions: new DirectoryVersions(`${ROOT}/.versions`),
	send: (message) => sockets.forEach((s) => s.send(JSON.stringify(message))),
});

new WebSocketServer({ port: 8080 }).on("connection", (socket) => {
	sockets.add(socket);
	socket.on("close", () => sockets.delete(socket));
	socket.on("message", (data) => docs.handle(JSON.parse(String(data)), (reply) => socket.send(JSON.stringify(reply))));
});
```

`handle` answers the page that asked on `reply`; what changed goes to every page through `send`.
Pass your own `VersionStore` if you already keep versions of these files, and `writer(file)` to
credit an outside write to an agent by name.

### A library of working copies

Pass `library: () => new DocLibrary(dir)` and opening a file copies it into a folder of its own
under `dir`; from then on pages and agents edit the copy, and the original is left alone until a
page sends `doc.writeback`. Each folder keeps what that document's work needs, so it survives a
restart and travels with the folder:

```
<dir>/paper/
    paper.tex      the working copy
    doc.json       where it came from, when it was copied and last written back
    base           the original's text as last taken in or written back
    changes.json   suggestions still waiting for a yes or a no
    versions/      every version
```

A write to the original while the copy is open (an agent that edited the original instead of the
copy) is merged three ways, base to original against base to copy, and arrives as a change to
review. Writing back takes in any such write first, so it never undoes one. A read-only original
can still be copied and edited; only writing back is refused.

## Page

```ts
import { DocSync } from "@decks/docs/client";

const sync = new DocSync({ path: "docs/paper.md", send: (m) => socket.send(JSON.stringify(m)), onUpdate: redraw });
socket.onmessage = (event) => sync.receive(JSON.parse(event.data));
sync.open();

// After the page has changed its own text:
sync.edit({ at: 120, before: "", text: "x" });
// Draw from sync.text, and sync.changes as tracked changes with:
sync.accept(id); sync.reject(id);
```

Offsets are JavaScript string indices into the whole file's text. Block structure is the page's
business: keep a map from each block to its span of source, and turn a keystroke into a splice.

## Limits

- An outside write is credited to `"outside"` unless the host supplies `writer`.
- A page older than the kept history (200 batches) lands its splices by searching for their old
  text, and a short one that is not found is refused; the page then resyncs from the server's text.
- Without a library, pending changes live in memory, and a restart forgets which writes were
  still to review. With one, they are in each folder's `changes.json`; a restart keeps them, but a
  rejection of one made before the restart finds its words by search rather than by history.

## Tests

`npm test` in this folder. `converge.test.ts` drives two pages and an outside writer over one
file with every message delivered in a shuffled order, and checks that all three end equal
(`SEEDS=1000` for a longer run).
