import { attachCommentSelect } from "../markup/comment-select.ts";
import { attachLiveDoc } from "./live-doc.ts";

/**
 * What the Decks app wires into each board's frame (`boards.attach` in `@decks/canvas`'s mount).
 *
 * - A document board's messages, carried on the app's socket (`live-doc.ts`).
 * - Words selected in the page, offering a comment on them (`markup/comment-select.ts`): the board
 *   is on this app's own origin, so the app listens inside it, as Decks always has. Each load of
 *   the page is a new document, so it is listened to again on every load.
 */
export function attachBoardFrame(frame: HTMLIFrameElement): () => void {
	const detachDoc = attachLiveDoc(frame);
	let detachComments: (() => void) | undefined;
	const listen = () => {
		detachComments?.();
		detachComments = undefined;
		const path = frame.dataset.path;
		let doc: Document | null = null;
		try {
			doc = frame.contentDocument;
		} catch {
			/* another origin: its page says what is selected itself (`board.js`) */
		}
		if (!path || !doc || doc.URL === "about:blank") return;
		detachComments = attachCommentSelect(frame, path);
	};
	frame.addEventListener("load", listen);
	return () => {
		frame.removeEventListener("load", listen);
		detachComments?.();
		detachDoc();
	};
}
