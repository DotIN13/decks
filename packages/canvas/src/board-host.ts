/**
 * The page around a board's frame handing that board its own token: the Decks app, Studio, any host.
 *
 * A board's button runs its code in the board's own page, and that code calls verbs on the harness
 * with the SDK (`lib/board.js`). Who it calls as is the token it carries, and a board's token says
 * "this board" and nothing more: the harness asks the person once before it may use the stage, and
 * it may call nothing else (`server/src/auth/guard.ts`). The board cannot make one for itself, so the
 * page that framed it does, with the host's own way to ask the harness (`mint`, which is
 * `POST /api/tokens { kind: "board", path, stage }` with the person's or the site's token).
 *
 * The exchange, per frame:
 * - the board's page says it is listening: `{ decks: "board.ready" }`, posted to its parent;
 * - this page makes (or reuses) that board's token and posts `{ decks: "board.token", token }` to
 *   **that frame's own window**, at **the origin of the address the frame was given**. If the frame
 *   has since gone somewhere else (a page that navigated itself away), the browser drops the message
 *   rather than hand the token to a page it was not made for. Never `"*"`: an address with no
 *   origin that can be named (a sandboxed copy, `about:blank`) is given no token at all;
 * - before the token can run out it is made again and sent again (`renew: true`), and a frame that
 *   reloads says `board.ready` again and is sent the one it had.
 *
 * Which board a frame is comes from the host (`path`), read when the token is made, never from the
 * message, which the board wrote.
 */

import { onFrameMessage } from "./frame-messages.ts";

/** What a board's page posts up when it can take its token. */
export interface BoardReady {
	decks: "board.ready";
}

/** What this page posts down: the token, or why there is none. */
export type BoardTokenMessage = { decks: "board.token"; token: string; renew?: boolean } | { decks: "board.token"; error: string };

/** How a host asks the harness for a board's token: undefined (or a throw) when this board can have none here. */
export type MintBoardToken = (path: string, stage?: string) => Promise<string | undefined>;

export interface BoardHostOptions {
	mint: MintBoardToken;
	/**
	 * How long a token is used before a new one is made and sent. The harness forgets a board's token
	 * twelve hours after its last use (`BOARD_IDLE_MS`), so six is well inside that. Default: six hours.
	 */
	renewMs?: number;
	/** The window frames' messages arrive at. Default: the frame's document's, else this page's. */
	view?: Pick<Window, "addEventListener" | "removeEventListener">;
	/** Timers, for tests. */
	setTimer?: (run: () => void, ms: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}

/** One frame, as the host is told about it. */
export interface BoardFrameSpec {
	/** The board's deck path, read each time a token is made. */
	path: () => string;
	/** The canvas it is on, if the host knows; a parameter of its calls, not who it is. */
	stage?: () => string | undefined;
	/** The address the frame was given. Default: its `src`, read against its document. */
	page?: () => string | undefined;
}

export interface BoardHost {
	/** Hand this frame its board's token whenever its page asks; answers what stops it. */
	attach(frame: HTMLIFrameElement, spec: BoardFrameSpec): () => void;
	/**
	 * A card's token: a card is in this page, not a frame, so its buttons ask here (`card-surface.tsx`).
	 * Kept per board and canvas until it is due for renewal.
	 */
	token(path: string, stage?: string): Promise<string | undefined>;
	/** Stop every frame's renewals and listening. */
	dispose(): void;
}

const SIX_HOURS = 6 * 3_600_000;

/** The origin a message to this frame is addressed to, or undefined for an address that names none. */
export function frameOrigin(frame: HTMLIFrameElement, page?: string): string | undefined {
	const given = page ?? frame.getAttribute("src") ?? undefined;
	if (!given) return undefined;
	try {
		const base = frame.ownerDocument?.baseURI ?? undefined;
		const origin = new URL(given, base).origin;
		// `null`: `about:`, `data:`, `blob:` of an opaque page. Such a page is not told anything.
		return origin && origin !== "null" ? origin : undefined;
	} catch {
		return undefined;
	}
}

export function createBoardHost(options: BoardHostOptions): BoardHost {
	const renewMs = options.renewMs ?? SIX_HOURS;
	const setTimer =
		options.setTimer ??
		((run: () => void, ms: number) => {
			const timer = setTimeout(run, ms);
			// In Node (a test, a server-side host), a renewal does not keep the process alive.
			(timer as { unref?: () => void }).unref?.();
			return timer;
		});
	const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	const detachers = new Set<() => void>();

	const attach = (frame: HTMLIFrameElement, spec: BoardFrameSpec): (() => void) => {
		/*
		 * The window the frame's messages arrive at: the host's own. Not read off the frame alone, which a
		 * framework may hand over while it is still in a template's document, with no window yet.
		 */
		const view = options.view ?? frame.ownerDocument?.defaultView ?? (typeof window === "undefined" ? undefined : window);
		if (!view) return () => {};
		/** The token this frame was last given, for which board and canvas, so a reload is sent the same one. */
		let held: { token: string; path: string; stage: string | undefined } | undefined;
		let renewal: unknown;
		let asking: Promise<void> | undefined;
		let gone = false;

		const post = (message: BoardTokenMessage) => {
			const to = frame.contentWindow;
			const origin = frameOrigin(frame, spec.page?.());
			if (!to || !origin || gone) return;
			/*
			 * Inside the canvas frame (`frame/`), which is sandboxed, every frame in it is sandboxed too and has
			 * no origin to name: the message goes to this frame's own window, the one place it can arrive.
			 */
			const sandboxed = typeof self !== "undefined" && self.origin === "null";
			to.postMessage(message, sandboxed ? "*" : origin);
		};

		const schedule = () => {
			if (renewal !== undefined) clearTimer(renewal);
			renewal = setTimer(() => {
				renewal = undefined;
				held = undefined;
				void give(true);
			}, renewMs);
		};

		/** Make the token (or use the one held, for the same board on the same canvas) and send it. */
		const give = (renew = false): Promise<void> => {
			if (asking) return asking;
			const path = spec.path();
			const stage = spec.stage?.();
			if (held && held.path === path && held.stage === stage) {
				post({ decks: "board.token", token: held.token, ...(renew ? { renew: true } : {}) });
				return Promise.resolve();
			}
			asking = (async () => {
				let token: string | undefined;
				let error = "This canvas cannot give this board a token, so its buttons have no stage here. Open it on the harness it came from.";
				try {
					token = await options.mint(path, stage);
				} catch (failed) {
					error = (failed as Error)?.message || error;
				}
				if (gone) return;
				if (!token) {
					post({ decks: "board.token", error });
					return;
				}
				held = { token, path, stage };
				schedule();
				post({ decks: "board.token", token, ...(renew ? { renew: true } : {}) });
			})().finally(() => {
				asking = undefined;
			});
			return asking;
		};

		const listener = (event: MessageEvent) => {
			if (!frame.contentWindow || event.source !== frame.contentWindow) return;
			const data = event.data as Partial<BoardReady> | null;
			if (!data || typeof data !== "object" || data.decks !== "board.ready") return;
			void give();
		};
		// The page's own window is shared by every frame (`frame-messages.ts`); any other (a test's) is listened to directly.
		const shared = typeof window !== "undefined" && view === window;
		const unlisten = shared ? onFrameMessage(frame, listener) : (view.addEventListener("message", listener), () => view.removeEventListener("message", listener));
		const detach = () => {
			gone = true;
			unlisten();
			if (renewal !== undefined) clearTimer(renewal);
			renewal = undefined;
			held = undefined;
			detachers.delete(detach);
		};
		detachers.add(detach);
		return detach;
	};

	const cardTokens = new Map<string, { token: Promise<string | undefined>; until: number }>();
	const token = (path: string, stage?: string): Promise<string | undefined> => {
		const key = `${stage ?? ""}\n${path}`;
		const kept = cardTokens.get(key);
		if (kept && kept.until > Date.now()) return kept.token;
		const made = options.mint(path, stage).catch(() => undefined);
		cardTokens.set(key, { token: made, until: Date.now() + renewMs });
		// A refusal is not kept: the person may allow it on the next press.
		void made.then((got) => !got && cardTokens.delete(key));
		return made;
	};

	return {
		attach,
		token,
		dispose: () => {
			cardTokens.clear();
			for (const detach of [...detachers]) detach();
		},
	};
}
