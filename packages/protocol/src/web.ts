/** The user's own Chrome, shared with the deck. */
/**
 * What the deck knows about the browser the user shared with it (`server/web/bridge.ts`).
 *
 * The extension in the user's Chrome dials the server and attaches to one tab; this is the
 * state of that connection, broadcast whenever it changes and drawn by the `data-live="web"`
 * board (`lib/live-web.js`). Nothing in it is a picture: the tab is on the user's own screen,
 * so the board is a status card — which tab, whether it is connected, what the agent did.
 */
export interface WebStatus {
	/** A pairing code exists, so the extension can be told where to connect. */
	paired: boolean;
	/** An extension is connected and at least one tab is attached. */
	connected: boolean;
	/** The tab the agent drives — the first attached one. */
	tab?: { title: string; url: string };
	/** Every attached tab, for a card that lists them. */
	tabs: Array<{ title: string; url: string }>;
	/** The last few things the agent did, newest last. */
	actions: WebAction[];
	/** A submit the agent is waiting for the user to allow. */
	pending?: { id: string; text: string };
	/** Why the last connection ended, if it did. */
	closed?: string;
}

export interface WebAction {
	at: number;
	text: string;
	ok: boolean;
}
