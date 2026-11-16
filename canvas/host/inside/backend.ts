import { life } from "./life.ts";
import type { PenDocument, PenEdit } from "@decks/pen";
import type { Page, StageCall } from "@decks/protocol-old";
import type { Presence, PresenceBy, ChangeAuthor } from "@decks/protocol";
import type { CardShot } from "../../cards/card-snapshot.ts";
import { deckPathEdits, readDrawing } from "./drawing-read.ts";
import { openLine, type LineClient } from "./line.ts";
import { openSocket, type FrameSocket } from "./socket.ts";

/**
 * The canvas frame's own line to the harness: its drawing, the canvas's stream, and the calls it makes
 * as the person on that canvas, all on the canvas token the page handed it (`server/src/auth`, kind
 * `canvas`). The page renews the token (`token`), and never sees what goes over this line.
 */
export interface Backend {
	/** The drawing as it is now: its document, the folder its fills are read against, its revision. */
	drawing(): Promise<{ doc: PenDocument; base: string; rev: number; by?: string; cards: Page[]; /** Which harness keeps the canvas, as a copy on the clipboard names it. */ harness?: string }>;
	/**
	 * Follow the canvas on the line until stopped, coming back after a drop; `since` says the revision held,
	 * so what was missed while the line was down comes back as `canvas.changed`. Answers what stops it.
	 */
	follow(hear: (message: Heard) => void, since?: () => number): () => void;
	/** One call on this canvas, with the edit's name when it is one (`X-Decks-Edit`). */
	call(verb: string, args: readonly unknown[], edit?: string): Promise<{ ok: boolean; value?: unknown; error?: string; notes?: string[] }>;
	/** This frame's name, once its stream's; kept on a document message for a harness that still answers by it. */
	frame: string;
	/** One of the frame's own messages on the line (`doc`, `card-seen`, `card-extent`): sent, and answered `ok` at once. */
	post(route: string, body: unknown): Promise<Record<string, unknown>>;
	/** The answer to an agent's call on this canvas (`stage.call`), as a tab answers it on the socket. */
	answer(id: string, value: unknown): void;
	/** Where this frame is on its canvas, for the others on it (`presence.set`): only what changed. */
	presence(presence: Presence): void;
	/** A card written out as a page (`card-snapshot.ts`), drawn by the harness's Chrome (`/api/snapshot`): the picture, or why not. */
	snapshot(path: string, shot: CardShot): Promise<{ mime: string; data: string } | { why: string }>;
	/** A renewed token, for every request from now on. */
	setToken(token: string): void;
}

/** What the line says about this canvas. */
export type Heard =
	/** The canvas changed: from `from` as `edits`, or whole as `doc` (`server/canvas/store.ts`). */
	| { type: "canvas.changed"; canvas: string; rev: number; from?: number; edits?: PenEdit[]; doc?: PenDocument; base: string; made?: string[]; by?: string; author?: ChangeAuthor; error?: string }
	| { type: "card.changed"; path: string; rev: number; card?: Page; removed?: boolean; sized?: true }
	/** An app placed on this canvas changed state: for its windows (`item-surfaces.tsx`), through `apps.watch`. */
	| { type: "app.changed"; name: string; title?: string; status: string }
	/** An agent at work on a card of this canvas (the server's record of acts): its cursor follows the work (`presence.ts`). */
	| { type: "agent.act"; agentId: string; path: string; phase: "start" | "done"; what: string; ids?: string[]; boxes?: Array<{ x1: number; y1: number; x2: number; y2: number }>; label: string; color: string; at: number }
	/** Someone else on this canvas moved, selected, looked elsewhere or left (`presence.ts`). */
	| { type: "presence.changed"; canvas: string; by: PresenceBy; gone?: true; pointer?: { x: number; y: number } | null; selection?: string[]; camera?: { x: number; y: number; zoom: number } | null }
	/** An agent's `decks view …` on this canvas: the frame showing it answers (`answer`). */
	| { type: "view.called"; call: StageCall }
	/** About a document on this canvas: for its editor (`item-surfaces.tsx`). */
	| { type: `doc.${string}`; path?: string; [key: string]: unknown }
	/** The line is back after a drop and nothing says what was missed: the drawing is read again. */
	| { type: "reconnected" };

/**
 * `api` is the harness's compat address as the frame reaches it (`http://host:4329/compat`); `files`, the
 * deck's address on the pass, whose canvas folder the drawing's relative paths are read in.
 */
export function createBackend(api: string, canvas: string, firstToken: string, files: string): Backend {
	let token = firstToken;
	/** This frame's name on its stream: what the harness says to it alone (a document's answers) carries it. */
	const frame = `f${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
	const base = api.replace(/\/+$/, "");
	const headers = (more: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...more });
	/** Who hears the canvas's messages (`follow`), and the revision they hold (`since`), said in every watch. */
	const hearing = createHearing();
	let sinceOf: (() => number) | undefined;
	let opened: LineClient | undefined;
	/** The line, opened on first use: its calls, the canvas's changes and the frame's own messages. */
	const line = () =>
		(opened ??= openLine({
			api: base,
			token: () => token,
			watch: () => [{ canvas, ...(sinceOf ? { since: sinceOf() } : {}) }],
			// The drawing is the socket's now (`sock`): the line's copies of its changes are passed over.
			hear: (message) => {
				if ((message as { type?: string }).type === "canvas.changed") return;
				hearing.tell(message as Heard);
			},
		}));

	let socket: FrameSocket | undefined;
	const sock = () => (socket ??= drawingSocket(new URL(base).origin, () => token, canvas, hearing.tell, () => sinceOf?.()));

	// The line and the socket are this canvas's: they stop when the frame moves to another canvas in place (`life.ts`).
	life().addEventListener("abort", () => (opened?.stop(), socket?.stop()), { once: true });

	return {
		// Its relative paths are read in the canvas's folder on the pass, as compat's drawing gave it.
		drawing: () => readDrawing(sock(), canvas, `${files}canvases/${canvas}/`),

		follow(hear, since) {
			sinceOf = since;
			const stop = hearing.add(hear);
			sock();
			line();
			return stop;
		},

		async call(verb, args, edit) {
			return line().call(verb, args, edit);
		},

		frame,

		async post(route, body) {
			const data = (body ?? {}) as Record<string, unknown>;
			if (route === "doc") line().send(data.message as never);
			else if (route === "card-seen") line().send({ type: "card.seen", path: String(data.path) });
			else if (route === "card-extent") line().send({ type: "card.extent", ...(data as { path: string; rev: number; w: number; h: number }) });
			else return { ok: false, error: `The line has no ${route}.` };
			return { ok: true };
		},

		answer(id, value) {
			const error = value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string" ? (value as { error: string }).error : undefined;
			line().send(error ? { type: "view.answered", id, error } : { type: "view.answered", id, value });
		},

		presence(presence) {
			// Said only down an open line: where the pointer was while the line was down is not news when it comes back.
			if (opened?.open()) opened.send({ type: "presence.set", canvas, ...presence });
		},

		snapshot: (path, shot) => snapshotOf(`${base}/snapshot`, headers({ "content-type": "text/html" }), path, shot),

		setToken(next) {
			token = next;
			opened?.setToken(next);
			socket?.renew();
		},
	};
}

/**
 * Who hears the canvas's messages. What comes before anyone listens (the frame's editor is made between
 * the drawing's read and its follow) is held and told to the first to listen, which passes over what
 * the read already had by its revision.
 */
export function createHearing() {
	const hearers = new Set<(message: Heard) => void>();
	let held: Heard[] = [];
	return {
		tell(message: Heard): void {
			if (!hearers.size) held.push(message);
			else for (const one of hearers) one(message);
		},
		add(hear: (message: Heard) => void): () => void {
			hearers.add(hear);
			const waiting = held;
			held = [];
			for (const message of waiting) hear(message);
			return () => void hearers.delete(hear);
		},
	};
}

/** The socket on the protocol, for the drawing read and its changes (`item.changed`); after a drop it watches from `since`. */
function drawingSocket(origin: string, token: () => string, canvas: string, tell: (message: Heard) => void, since: () => number | undefined): FrameSocket {
	return openSocket({
		origin,
		token,
		canvas,
		since,
		hear: (name, payload) => {
			const heard = drawingHeard(canvas, name, payload);
			if (heard) tell(heard);
		},
	});
}

/**
 * An event on the socket as the drawing's follower hears it: `item.changed` with pen's own edits from the
 * revision before, named from the deck's root; one too large to carry them is read again whole.
 */
function drawingHeard(canvas: string, name: string, payload: Record<string, unknown>): Heard | undefined {
	if (name !== "item.changed") return undefined;
	const rev = payload.rev as number;
	const pen = payload.pen as PenEdit[] | undefined;
	// The server's log no longer reaches the revision held (`missed`), or the change came without its edits: read whole.
	if (payload.missed === true || !pen) return { type: "reconnected" };
	const made = payload.made as string[] | undefined;
	const author = payload.author as ChangeAuthor | undefined;
	return { type: "canvas.changed", canvas, rev, from: payload.base as number, edits: deckPathEdits(canvas, pen), base: "", ...(made ? { made } : {}), ...(author ? { author } : {}) };
}

/**
 * Keeps one drawing: a revision already held is passed over; edits from the revision held are applied;
 * anything else, a gap, and the drawing is read whole again.
 */
export function drawingFollower(handlers: {
	whole(doc: PenDocument, base: string, made?: readonly string[]): void;
	/** `author` is who made the change, when the harness says (an agent's edits are marked and its cursor follows them). */
	edits(edits: readonly PenEdit[], base: string, made?: readonly string[], author?: ChangeAuthor): boolean;
	reread(): void;
}) {
	let rev = -1;
	return {
		/** The revision the drawing was read at. */
		at(next: number) {
			rev = next;
		},
		/** The revision held now: what the line says it watches from. */
		rev: () => rev,
		hear(message: Heard) {
			if (message.type === "canvas.changed") {
				if (message.doc) {
					if (message.rev === rev) return;
					rev = message.rev;
					handlers.whole(message.doc, message.base, message.made);
				} else if (message.edits) {
					if (message.rev <= rev) return;
					if (message.from !== rev || !handlers.edits(message.edits, message.base, message.made, message.author)) {
						handlers.reread();
						return;
					}
					rev = message.rev;
				}
			} else if (message.type === "reconnected") handlers.reread();
		},
	};
}

/** A card written out as a page, drawn by the harness's Chrome at `url`: the picture as base64, or why not. */
async function snapshotOf(url: string, headers: Record<string, string>, path: string, shot: CardShot): Promise<{ mime: string; data: string } | { why: string }> {
	try {
		const query = new URLSearchParams({ path, w: String(shot.w), h: String(shot.h), scheme: shot.scheme });
		const response = await fetch(`${url}?${query}`, { method: "POST", headers, body: shot.html });
		if (!response.ok) return { why: `the harness could not draw it (${response.status} ${(await response.text().catch(() => "")).slice(0, 200)})`.trim() };
		const blob = await response.blob();
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = "";
		for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		return { mime: blob.type || "image/png", data: btoa(binary) };
	} catch (error) {
		return { why: error instanceof Error ? error.message : String(error) };
	}
}
