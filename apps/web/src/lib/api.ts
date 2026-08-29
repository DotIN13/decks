import type { Board, DeckState } from "@decks/protocol";

/**
 * The server's file surface, over HTTP: what a URL is, for reading.
 *
 * State changes go over the socket, so this stays a handful of GETs — which is
 * also why there is no error-handling ceremony here: a failed read is a caller's
 * problem to show, not a thing to retry silently. The one exception is bytes,
 * which are not state: a file the user drops on a board is POSTed in
 * `upload.ts`, where it can be streamed and its progress reported.
 */
export async function fetchDeck(): Promise<{ deck: DeckState; warnings: string[] }> {
	const response = await fetch("/api/deck");
	if (!response.ok) throw new Error(`GET /api/deck: ${response.status}`);
	return (await response.json()) as { deck: DeckState; warnings: string[] };
}

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
