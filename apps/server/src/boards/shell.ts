import { basename } from "node:path";

/**
 * The document a non-component board is served as.
 *
 * A board is an iframe pointed at `/api/board/<path>`, and until now the file at that path
 * *was* the document. A markdown file is not a document, so the route answers with one: a
 * doctype, the board primitives, and a single full-bleed component pointing back at the real
 * file. `[data-embed]` has rendered markdown and images since it shipped, so a markdown board
 * needs no renderer written — only a wrapper to be rendered inside.
 *
 * ### Not written to disk, and that is the point
 *
 * It is a pure function of the path and a little metadata. So it cannot drift from the file,
 * there is nothing to clean up when a board is deleted, and `rev` stays the hash of the
 * *real* file — which means a save still reloads the frame and a revision still restores
 * something a person recognises. A generated file on disk would have failed all three.
 *
 * ### Why the shell fetches rather than being inlined
 *
 * The alternative was to render the markdown here and send HTML. That would put the deck's
 * content through the server's own renderer, which is a second implementation of something
 * the board runtime already does — and it would mean the embed's own machinery (KaTeX,
 * mermaid, a PDF page range) either got reimplemented or quietly stopped working inside a
 * markdown board. One renderer, in the browser, where it already is.
 */

export interface ShellSpec {
	/** Deck-relative path of the real file, e.g. `boards/notes.md`. */
	path: string;
	/**
	 * Which kind of content is being wrapped — `deck/kinds.ts` decides, and it is the one
	 * thing this file cannot work out for itself.
	 *
	 * It used to be inferred from the extension: an `.html` document board was assumed to be
	 * a page from somewhere else and sandboxed. That was true while a document board was
	 * always markdown and is not now — every board this app writes is a single HTML file, and
	 * one of those is a document in its own right rather than something to wrap.
	 */
	shell: "content" | "foreign";
	title: string;
	w: number;
	h: number;
}

/**
 * `/api/board/boards/nested/notes.md` is two directories below `/api/board/`, so a relative
 * `../lib/board.css` would resolve differently for a nested board than for a top-level one.
 * Absolute `/api/lib/...` instead — the alias that exists for exactly this reason (see the
 * `/lib/*path` route, added for revision previews).
 */
const LIB = "/api/lib";

export function renderShell(spec: ShellSpec): string {
	const meta = JSON.stringify({ w: spec.w, h: spec.h, bg: "plain" });
	/*
	 * The file, relative to the shell's own URL — with `?raw=1` on it, and that is
	 * load-bearing rather than decorative.
	 *
	 * The shell is served *at the board's own URL*, so a bare `notes.md` beside it resolves
	 * to the shell again: the embed would fetch the wrapper instead of the markdown and
	 * render an empty board with no error anywhere. `?raw=1` asks the same route for the
	 * file itself.
	 *
	 * Relative rather than absolute so a nested board still resolves — `boards/talks/a.md`
	 * asks for its own sibling — and the extension survives because `mountEmbed` reads the
	 * extension from the *written* path with the query stripped, for its own older reason.
	 */
	const file = `${escapeAttribute(basename(spec.path))}?raw=1`;
	const body = flowBody(file, spec.shell === "foreign");
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeText(spec.title)}</title>
		<meta name="board" content='${escapeAttribute(meta)}' />
		<link rel="stylesheet" href="${LIB}/card.css" />
	</head>
	<body class="board board-shell">
${body}
		<script src="${LIB}/card.js"></script>
	</body>
</html>
`;
}

/**
 * Markdown, or an HTML document, in one `.doc` block: the board's page, flowing (board.css).
 *
 * `data-id="body"` is a name, so a comment on the board has a block to land on. No height:
 * the board is as tall as its content, and the canvas measures it.
 */
function flowBody(file: string, framed: boolean): string {
	/*
	 * `framed` is the one asymmetry inside this format, and it is forced rather than chosen.
	 *
	 * Markdown is rendered *into* this document, so the component grows to its content and
	 * the board can report a true height. A document from somewhere else goes into a
	 * sandboxed, opaque-origin iframe — which has no intrinsic height and cannot be measured
	 * from outside — so it fills the board's frame (board.css, `.doc[data-framed]`) and keeps
	 * the height it was given. It is sandboxed because it may carry scripts and must not run
	 * in the deck's own origin; a board *this app* wrote never reaches here at all.
	 */
	const flag = framed ? " data-framed=\"true\"" : "";
	return `		<div class="doc" data-id="body"${flag} data-embed="${file}"></div>`;
}

/** Five entities, the same five `deck/meta.ts` decodes. */
function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
