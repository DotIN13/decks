import type { Board } from "@decks/protocol";

/**
 * The server's file surface, over HTTP: what a URL is, for reading.
 *
 * State changes go over the socket, so this stays a handful of GETs — which is
 * also why there is no error-handling ceremony here: a failed read is a caller's
 * problem to show, not a thing to retry silently. The one exception is bytes,
 * which are not state: a file the user drops on a board is POSTed in
 * `upload.ts`, where it can be streamed and its progress reported.
 *
 * The deck itself does not come through here: its state arrives over the socket, on
 * connect and on every change (`state/socket.ts`). There used to be a `fetchDeck()` in this
 * file for the first paint, from before the greeting carried everything.
 */

/**
 * The URL a board's frame loads.
 *
 * `rev` is in the query because the frame fetched the document itself and
 * re-reading the file cannot reach it: a new URL is the only way to say "this
 * changed". It is the file's modification time, so it is stable across reloads
 * and unique per edit.
 */
export function boardUrl(board: Pick<Board, "path" | "rev">): string {
	const path = board.path.split("/").map(encodeURIComponent).join("/");
	return `/api/board/${path}?rev=${board.rev}`;
}

/** A deck-relative path (a poster, an asset) as a URL. */
export function deckFileUrl(path: string, rev?: number): string {
	const encoded = path.split("/").map(encodeURIComponent).join("/");
	return rev ? `/api/board/${encoded}?rev=${rev}` : `/api/board/${encoded}`;
}

/** The six families an embed's file can belong to, as `board.js` counts them. */
export type EmbedFamily = "md" | "pdf" | "image" | "html" | "text" | "file";

const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"];
const TEXTUAL = ["txt", "log", "csv", "tsv", "json", "yaml", "yml", "toml", "xml", "sh", "bash", "py", "ts", "js", "mjs", "css", "sql", "ini", "conf", "env"];
const MARKDOWN = ["md", "markdown", "mdx"];

/**
 * Which renderer a file needs, from its extension.
 *
 * The same ladder `familyOf` in `lib/board.js` climbs, and it has to agree with it: the
 * overlay and the board draw the same file, and two answers to "what is this" is how a
 * fullscreen shows something the board does not. The extension comes from the path the
 * **board** wrote rather than from the URL it resolves to, because an out-of-deck path
 * becomes `/api/file?path=…`, which ends in no extension at all.
 */
export function embedFamily(raw: string): EmbedFamily {
	const withoutQuery = String(raw ?? "").split("?")[0] ?? "";
	const match = /\.([a-z0-9]+)$/i.exec(withoutQuery.split("#")[0] ?? "");
	const extension = (match?.[1] ?? "").toLowerCase();
	if (MARKDOWN.includes(extension)) return "md";
	if (extension === "pdf") return "pdf";
	if (IMAGE.includes(extension)) return "image";
	if (["html", "htm", "xhtml"].includes(extension)) return "html";
	if (TEXTUAL.includes(extension)) return "text";
	return "file";
}

/**
 * An embed's path → a URL a browser can fetch. `urlFor` in `lib/board.js`, app-side.
 *
 * Relative means what it would mean in an `<img src>`: relative to **this board**. A path
 * that stays inside the deck is used as it is, which is what keeps a board openable as a
 * plain file; anything else goes through `/api/file`, which resolves it against a declared
 * root and refuses what is outside them — so the roots are enforced where they are known
 * rather than trusted here.
 *
 * A query parameter rather than a path for the same reason it is there: a browser strips
 * `..` segments out of a URL path before the request is sent, so `/api/file/../shared/x`
 * arrives as `/api/shared/x` and 404s.
 */
export function embedUrl(boardPath: string, raw: string): string {
	const path = String(raw ?? "").trim();
	if (!path) return "";
	if (/^(https?|data|blob):/i.test(path)) return path;
	if (path.startsWith("/api/f/") || path.startsWith("/api/file")) return path;
	/*
	 * Everything else — a sibling, an absolute path, a `~` one — is asked of the server with
	 * the board named, and *it* decides: a path inside the deck resolves to the file, one
	 * outside a declared root is refused. Making the app the judge of that would be a second
	 * opinion about the roots, and the two would eventually differ.
	 */
	return `/api/file?path=${encodeURIComponent(path)}&from=${encodeURIComponent(boardPath)}`;
}

/**
 * The first page of a `data-pages` range, or nothing.
 *
 * `board.js` has understood `"3-5"` and `"1,4-6"` since it could render a PDF; this is the
 * same reading, for the one place the range has to travel somewhere else — a tab opens the
 * file in the browser's own viewer, and `#page=3` is how it is told where to start. A
 * fullscreen that shows the wrong pages is worse than no fullscreen.
 */
export function firstPage(pages: string | undefined): number | undefined {
	const match = /(\d+)/.exec(String(pages ?? ""));
	const page = match ? Number(match[1]) : Number.NaN;
	return Number.isFinite(page) && page > 0 ? page : undefined;
}

/** The URL a PDF's own viewer should open at, which is the file plus a page fragment. */
export function pdfUrl(url: string, pages: string | undefined): string {
	const page = firstPage(pages);
	return page === undefined ? url : `${url}#page=${page}`;
}
