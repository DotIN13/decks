/**
 * A link on a board that points at another board.
 *
 * **A board link is not a navigation.** The frame a board is drawn in has no address bar and
 * no back button, so following a link inside it replaces the board the reader was reading
 * with the one they asked for and leaves nothing to go back to. So `lib/board.js` refuses to
 * navigate: it asks the app to open the linked board *beside* the one being read, on the
 * canvas, and the app is the only thing in the pair that knows the deck.
 *
 * The ask is one message (`{ decks: "board.open" }` with a deck-relative path) and the answer
 * is the board appearing on the canvas beside the one that carried the link. The board decides
 * *whether* to ask — only a `.html` or `.md` path is a board file, anything else from the deck
 * is an asset and opens in a tab like any other link — because a tab can only be opened from
 * the click itself, and an answer that arrives as a message is one turn too late for a user
 * gesture. So what arrives here is always meant to be a board, and a path this deck does not
 * hold is a broken link, which the app says in a notice.
 *
 * Same-origin, like the rest of the frame protocol (`live-chat.ts`), and guarded the same two
 * ways: the message has to come from *this* frame's window, and the path is checked before it
 * is used for anything.
 */

/** What a board posts when a link in it was clicked. */
export interface BoardOpen {
	decks: "board.open";
	path: string;
}

/**
 * The deck-relative path a board asked for, or `undefined` when the message was not that.
 *
 * `event` is taken structurally rather than as a `MessageEvent` so the guard can be tested
 * without a browser, and it is the same guard the listener below applies.
 */
export function boardOpenOf(event: { source: unknown; data: unknown }, frame: HTMLIFrameElement): string | undefined {
	if (event.source !== frame.contentWindow) return undefined;
	const message = event.data as { decks?: unknown; path?: unknown } | null;
	if (!message || message.decks !== "board.open" || typeof message.path !== "string") return undefined;
	return deckPath(message.path);
}

/**
 * Check a path a board sent against the deck.
 *
 * A board's content is a file, and a file can carry a script, so what arrives here is
 * somebody else's string: it has to name one path inside the deck and nothing else. The
 * lookup in the app is the real authority — a path this deck does not hold is a broken link,
 * and it says so rather than opening anything — and this is what keeps a lookup from being
 * asked about `../../etc/passwd`.
 */
export function deckPath(path: string): string | undefined {
	if (!path || path.startsWith("~") || path.includes("\\") || path.includes("\0")) return undefined;
	const parts = path.split("/");
	if (parts.some((part) => part === "" || part === "." || part === "..")) return undefined;
	return path;
}

/**
 * Listen for a board asking to open another board.
 *
 * Attached per frame and re-attached on every load, like every other wire into a board's
 * document: a reload is a new document, and a listener on the old one went with it.
 */
export function attachBoardOpen(frame: HTMLIFrameElement, onOpen: (path: string) => void): () => void {
	const view = frame.ownerDocument.defaultView;
	if (!view) return () => {};
	const listener = (event: MessageEvent) => {
		const path = boardOpenOf(event, frame);
		if (path) onOpen(path);
	};
	view.addEventListener("message", listener);
	return () => view.removeEventListener("message", listener);
}
