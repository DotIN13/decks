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

`.docx` is edited through its `word/document.xml`: the page's text is that XML, and the zip is
rewritten with every other part copied byte for byte.

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
- Pending changes live in memory: a server restart forgets which writes were still to review,
  though the versions on both sides of them remain.

## Tests

`npm test` in this folder. `converge.test.ts` drives two pages and an outside writer over one
file with every message delivered in a shuffled order, and checks that all three end equal
(`SEEDS=1000` for a longer run).
