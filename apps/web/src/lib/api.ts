import { api, rebase } from "../connections/connection.ts";
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
	return api(`/board/${path}?rev=${board.rev}`);
}

/** The server's `PICTURE_LOOK` (`boards/thumbs.ts`): raised with it, so a picture taken before a change to how every board looks is a URL the browser has not kept. */
const PICTURE_LOOK = 3;

/**
 * The server's picture of a board (`boards/thumbs.ts` over there), in the app's scheme.
 *
 * `v` is the revision, for the same reason `rev` is in `boardUrl`: the picture is cached for
 * a year, and an edited board has to be a URL the browser has never seen.
 */
export function thumbUrl(board: Pick<Board, "path" | "rev">, scheme: "light" | "dark"): string {
	const path = board.path.split("/").map(encodeURIComponent).join("/");
	return api(`/thumb/${path}?v=${board.rev}&scheme=${scheme}&look=${PICTURE_LOOK}`);
}

/** A deck-relative path (a poster, an asset) as a URL. */
export function deckFileUrl(path: string, rev?: number): string {
	const encoded = path.split("/").map(encodeURIComponent).join("/");
	return rev ? api(`/board/${encoded}?rev=${rev}`) : api(`/board/${encoded}`);
}

/** The families an embed's file can belong to, as `board.js` counts them. */
export type EmbedFamily = "md" | "pdf" | "image" | "video" | "audio" | "html" | "text" | "file";

const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"];
const TEXTUAL = ["txt", "log", "csv", "tsv", "json", "yaml", "yml", "toml", "xml", "sh", "bash", "py", "ts", "js", "mjs", "css", "sql", "ini", "conf", "env"];
const MARKDOWN = ["md", "markdown", "mdx"];
/** What plays. The same two lists as `VIDEO` and `AUDIO` in `lib/board.js`, which must agree. */
const VIDEO = ["mp4", "m4v", "webm", "mov", "ogv", "mkv"];
const AUDIO = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "weba"];

/** Whether a family is something the browser plays, which decides who gets a player. */
export function playable(family: EmbedFamily): family is "video" | "audio" {
	return family === "video" || family === "audio";
}

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
	if (VIDEO.includes(extension)) return "video";
	if (AUDIO.includes(extension)) return "audio";
	if (["html", "htm", "xhtml"].includes(extension)) return "html";
	if (TEXTUAL.includes(extension)) return "text";
	return "file";
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
