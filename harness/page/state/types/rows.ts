// What the page shows of the server and the harness, moved from @decks/protocol (types and limits only).

export interface StudioLinkRow {
	url: string;
	env?: true;
}

/** Another Decks front end this server has given a token to (`server/src/auth/issue.ts`). */
export interface PairedRow {
	id: string;
	/** What the other front end called itself when it paired. */
	label: string;
	/** The site it was served from. */
	origin: string;
	at: number;
	/** When it last used its token, to the minute. */
	last?: number;
	/** Given through Decks Studio's key, to a browser signed in there: it goes when the key does. */
	studio?: true;
}

/**
 * What the backend on the other end of the socket can do.
 *
 * A server can do everything; a canvas opened from a file can only be read (`web/src/connections`).
 * The front end draws only the controls the backend can serve, so a reader has no composer and no
 * editing tools rather than ones that fail when pressed.
 */
export interface BackendInfo {
	/** What the switcher calls it: the deck's name, or the canvas's title for a file. */
	name: string;
	can: { agents: boolean; write: boolean; share: boolean };
}

export interface StageRow {
	/** The folder: the stage's id, which agents open it by and never changes. */
	name: string;
	/** What it is called, which the person can change freely (`canvas.json` beside the drawing). */
	title: string;
	/** When its drawing last changed, in ms since the epoch: the manager's order and its "2 h ago". */
	changedAt?: number;
	boards: number;
	rev: number;
	agents: Array<{ id: string; name: string; color: string }>;
	/** The words its boards and notes carry, for the manager's search field. */
	words: string;
	/**
	 * A friend's canvas, shared with you (`shared/canvases/<owner>/<canvas>/`): who shared it, and
	 * whether you may change it. Its boards run sandboxed, with no token.
	 */
	shared?: { owner: string; role: "edit" | "view" };
	/**
	 * One of yours that someone else may edit (Studio says so, `othersEdit` in its `canvas.json`): what is on
	 * it may not be yours, so it is not "yours alone", and the canvas frame opens it in a frame of its own.
	 */
	othersEdit?: true;
	/**
	 * The folders it had before, since this server started: the first name chosen for a canvas names
	 * its folder (`stage/stage-admin.ts`), and a browser on it keeps its view rather than landing anew.
	 */
	formerly?: string[];
}
