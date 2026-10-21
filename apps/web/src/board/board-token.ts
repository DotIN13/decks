import { createBoardHost } from "@decks/canvas/internal/board-host.ts";
import { api } from "../connections/connection.ts";
import { authHeaders } from "../lib/session.ts";
import { stageOnScreen } from "../state/decks.ts";

/**
 * Each board frame's own token, for its buttons (`@decks/canvas/internal/board-host.ts`, `lib/board.js`).
 *
 * This page asks the harness its boards come from for a token that is one board and nothing else
 * (`POST /api/tokens { kind: "board", path, stage }`, with this tab's person token), and the host
 * posts it to that board's frame alone, at the origin of the address it was given. The board then
 * calls its verbs itself: this page passes no call on for it.
 */
async function mint(path: string, stage?: string): Promise<string | undefined> {
	const response = await fetch(api("/tokens"), {
		method: "POST",
		headers: { ...authHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify({ kind: "board", path, ...(stage ? { stage } : {}) }),
	});
	const answer = (await response.json().catch(() => ({}))) as { token?: unknown; error?: unknown };
	if (!response.ok || typeof answer.token !== "string") throw new Error(typeof answer.error === "string" ? answer.error : `Decks answered ${response.status} when asked for this board's token.`);
	return answer.token;
}

export const boardTokens = createBoardHost({ mint });

/** Hand this frame its board's token whenever its page asks; answers what stops it. */
export function attachBoardToken(frame: HTMLIFrameElement, path: () => string): () => void {
	return boardTokens.attach(frame, { path, stage: stageOnScreen });
}
