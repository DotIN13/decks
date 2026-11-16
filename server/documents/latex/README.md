# server/documents/latex

Typesetting a LaTeX document to a PDF: `file.compile`, and the event `file.compiled`. Part of the
documents feature, written by Quire.

## Owns

- `compile.ts`: the call's handler, one typesetting at a time per document.
- `tectonic.ts`: the job given to the machine, and LaTeX's errors read from its log.

## May import

`protocol/` and `server/kernel/`, through their entry files. In `server/documents/`, only `queue.ts`.

## Rules

1. `file.compile { path }` typesets a `.tex` or `.ltx` file in the deck. Any other file is refused
   as `invalid`; a path outside the deck or hidden is refused as every file's is.
2. It typesets the file as the deck holds it now. Typing reaches the file batch by batch, so
   nothing waits to be flushed first.
3. The typesetter is Tectonic: `DECKS_TECTONIC`, else the first of `~/.local/bin/tectonic`,
   `~/tools/tectonic/tectonic`, `/usr/local/bin/tectonic`, `/usr/bin/tectonic`, else `tectonic` on the path.
4. It runs in the file's own folder, so its pictures, `.bib` and style files are found where the
   paper keeps them. Shell escape stays off: a document cannot run commands on the machine.
5. A run longer than 180 seconds is stopped; its answer's errors start with "Typesetting took too
   long and was stopped."
6. The PDF and the log are written through the deck, by the caller, at `docs/build/<path>.pdf` and
   `.log`: the document's path from the deck's root with its extension changed. Nothing is
   written beside the paper.
7. The answer is `{ path, ok, pdf?, errors, at, ms, error? }`. `errors` are LaTeX's own `! ...`
   lines, each with the `l.<n>` line it stopped at; with none in the log, the engine's `error:`
   lines. `pdf` is there when this run wrote one, even with errors. `ok` is a PDF and no errors.
8. With no Tectonic on the machine the answer is `ok: false` with `error` "No LaTeX typesetter is
   installed on this server (Tectonic)." Never a throw.
9. Asked again while a run goes, the next waits for it and then typesets the file as it is by
   then: a burst of asks costs at most one run behind.
10. Every finished run is told as `file.compiled` with the answer, to every page on the document.
11. On a server with no machine to run programs (in memory, Studio) the call is `unavailable`.
12. Tests fake the machine at its edge; one test typesets for real when Tectonic is installed.

## Check

- `node tools/check.mjs server`
- `node --import tsx --test server/documents/latex/*.test.ts`
