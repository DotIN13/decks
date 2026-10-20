import { api } from "../connections/connection.ts";
import { keyHeaders } from "../lib/person-key.ts";
import { stageOnScreen } from "../state/decks.ts";

/**
 * A board's button calling a verb, passed on by this page (`lib/board.js`, `boardStage`).
 *
 * A board's page cannot give the harness commands itself: it has no person key, and the harness
 * refuses a browser without one (`server/src/share/person-key.ts`). So its code posts each call up
 * here as `{ decks: "stage.call", id, verb, args }`, and this page makes it, with its key and the
 * board named by **the frame the message came from** — never by anything in the message, which the
 * board wrote. The harness then asks the person once whether that board may use the stage, as it
 * always did for a board's button. The answer goes back down as `{ decks: "stage.answer", id,
 * status, answer }`, the verb's own `{ ok, value, notes }` or `{ ok: false, error }`.
 */

export interface StageCall {
	decks: "stage.call";
	id: string;
	verb: string;
	args: unknown[];
}

/** A verb's name: words and dots, so it cannot climb out of `/api/v1/` in an address. */
const VERB = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/;

/** The call a board posted, or `undefined` when the message was not one, or not from this frame. */
export function stageCallOf(event: { source: unknown; data: unknown }, frame: HTMLIFrameElement): StageCall | undefined {
	if (!frame.contentWindow || event.source !== frame.contentWindow) return undefined;
	const message = event.data as Partial<StageCall> | null;
	if (!message || typeof message !== "object" || message.decks !== "stage.call") return undefined;
	if (typeof message.id !== "string" || typeof message.verb !== "string" || !VERB.test(message.verb) || !Array.isArray(message.args)) return undefined;
	return { decks: "stage.call", id: message.id, verb: message.verb, args: message.args };
}

/** Make one call for the board at `path`, and say what the harness answered. */
async function call(path: string, verb: string, args: unknown[]): Promise<{ status: number; answer: unknown }> {
	const stage = stageOnScreen();
	try {
		const response = await fetch(api(`/v1/${verb}`), {
			method: "POST",
			headers: { ...keyHeaders(), "Content-Type": "application/json", "X-Decks-Board": encodeURIComponent(path), ...(stage ? { "X-Decks-Stage": stage } : {}) },
			body: JSON.stringify({ args }),
		});
		const answer = await response.json().catch(() => ({ ok: false, error: `Decks answered ${response.status} without a result`, notes: [] }));
		return { status: response.status, answer };
	} catch (error) {
		return { status: 0, answer: { ok: false, error: `Could not reach Decks: ${(error as Error).message}`, notes: [] } };
	}
}

/**
 * Listen for one frame's calls. Attached on every load, like the frame's other wires, with the
 * board's path read when a call comes, so a frame that now shows another board is named as that one.
 */
export function attachStageCall(frame: HTMLIFrameElement, path: () => string): () => void {
	const view = frame.ownerDocument.defaultView;
	if (!view) return () => {};
	const listener = (event: MessageEvent) => {
		const asked = stageCallOf(event, frame);
		if (!asked) return;
		void call(path(), asked.verb, asked.args).then(({ status, answer }) => {
			frame.contentWindow?.postMessage({ decks: "stage.answer", id: asked.id, status, answer }, frame.ownerDocument.location.origin);
		});
	};
	view.addEventListener("message", listener);
	return () => view.removeEventListener("message", listener);
}
