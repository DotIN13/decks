/**
 * A component on a board that carries code, pressed.
 *
 * The board does not send its code. `lib/board.js` posts the *name* of the code block
 * (`{ decks: "board.eval", id, value }`) and this stamps the board path from the frame the
 * message came from, exactly as `board-links.ts` does for a board link — so what reaches
 * the server is the app's word about which board asked, and the server reads the code out
 * of that board's own file (`apps/server/src/boards/eval-code.ts`).
 *
 * That split is the whole design: a board cannot ask for another board's trust, and what ran
 * is always recoverable from the file on disk.
 *
 * Same-origin, like the rest of the frame protocol, and guarded the same two ways: the
 * message has to come from *this* frame's window, and the id is checked before it is used.
 */

/** What a board posts when a component carrying `data-eval` is pressed. */
export interface BoardEval {
	decks: "board.eval";
	id: string;
	/** What the pressed component carried: its own value, or its `data-value`. */
	value?: unknown;
}

/**
 * The eval ask in a message, or `undefined` when the message was not one.
 *
 * Taken structurally rather than as a `MessageEvent`, so the guard can be tested without a
 * browser — the same shape `boardOpenOf` has.
 */
export function boardEvalOf(event: { source: unknown; data: unknown }, frame: HTMLIFrameElement): BoardEval | undefined {
	if (event.source !== frame.contentWindow) return undefined;
	const message = event.data as { decks?: unknown; id?: unknown; value?: unknown } | null;
	if (!message || message.decks !== "board.eval" || typeof message.id !== "string") return undefined;
	const id = message.id.trim();
	if (!id) return undefined;
	return { decks: "board.eval", id, ...(message.value !== undefined ? { value: message.value } : {}) };
}

/**
 * Listen for one board asking to run a component's code.
 *
 * Attached per frame and re-attached on every load, like every other wire into a board's
 * document: a reload is a new document, and a listener on the old one went with it.
 */
export function attachBoardEval(frame: HTMLIFrameElement, onEval: (ask: BoardEval) => void): () => void {
	const view = frame.ownerDocument.defaultView;
	if (!view) return () => {};
	const listener = (event: MessageEvent) => {
		const ask = boardEvalOf(event, frame);
		if (ask) onEval(ask);
	};
	view.addEventListener("message", listener);
	return () => view.removeEventListener("message", listener);
}
