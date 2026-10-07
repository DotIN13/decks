import type { DocClientMessage, DocServerMessage } from "@decks/protocol";
import { send } from "../state/socket.ts";

/**
 * The relay between a document board (`lib/live-doc.js`) and the server.
 *
 * A board has no socket of its own, and should not have one: every socket the server greets is
 * sent the whole deck. So the page posts its `doc.*` messages up, and they go out on the app's
 * own connection; the server's answers and news come back in `app/frames.ts` and are posted down
 * to every frame that has spoken about a document. Each page keeps what is about its own document
 * and its own client id (`@decks/docs/client`), so a frame hearing another's is harmless.
 *
 * Same origin (DESIGN §4), so the frame is trusted to the extent any board is: what it may open is
 * still decided by the server's resolver, not here.
 */

const frames = new Set<HTMLIFrameElement>();

/** Carry a frame's document messages to the server; answers what stops it. */
export function attachLiveDoc(frame: HTMLIFrameElement): () => void {
	const view = frame.ownerDocument.defaultView;
	if (!view) return () => {};
	const listener = (event: MessageEvent) => {
		if (event.source !== frame.contentWindow) return;
		const data = event.data as { decks?: unknown; message?: { type?: unknown } } | null;
		if (data?.decks !== "doc" || typeof data.message?.type !== "string" || !data.message.type.startsWith("doc.")) return;
		frames.add(frame);
		send(data.message as DocClientMessage);
	};
	view.addEventListener("message", listener);
	return () => {
		view.removeEventListener("message", listener);
		frames.delete(frame);
	};
}

/** A document message from the server, to every frame that holds a document. */
export function receiveDoc(message: DocServerMessage): void {
	for (const frame of frames) {
		if (!frame.isConnected) {
			frames.delete(frame);
			continue;
		}
		frame.contentWindow?.postMessage({ decks: "doc", message }, frame.ownerDocument.location.origin);
	}
}
