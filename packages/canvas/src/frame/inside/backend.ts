import type { PenDocument, PenEdit } from "@decks/pen";
import type { Page, StageCall } from "@decks/protocol";
import type { CardShot } from "../../items/card-snapshot.ts";
import { openLine, type LineClient } from "./line.ts";

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
	/** A card written out as a page (`card-snapshot.ts`), drawn by the harness's Chrome (`/api/snapshot`): the picture, or why not. */
	snapshot(path: string, shot: CardShot): Promise<{ mime: string; data: string } | { why: string }>;
	/** A renewed token, for every request from now on. */
	setToken(token: string): void;
}

/** What the line says about this canvas. */
export type Heard =
	/** The canvas changed: from `from` as `edits`, or whole as `doc` (`server/src/stage/pens.ts`). */
	| { type: "canvas.changed"; canvas: string; rev: number; from?: number; edits?: PenEdit[]; doc?: PenDocument; base: string; made?: string[]; by?: string; error?: string }
	| { type: "stage.pen"; stage: string; rev: number; doc: PenDocument; base: string; made?: string[]; by?: string }
	| { type: "stage.pen.delta"; stage: string; from: number; rev: number; edits: PenEdit[]; base: string; made?: string[]; by?: string }
	| { type: "card.changed"; path: string; rev: number; card?: Page; removed?: boolean; sized?: true }
	/** An app placed on this canvas changed state: for its windows (`item-surfaces.tsx`), through `apps.watch`. */
	| { type: "app.state"; name: string; title?: string; status: string }
	/** An agent's `decks view …` on this canvas: the frame showing it answers (`answer`). */
	| { type: "stage.call"; call: StageCall }
	/** About a document on this canvas: for its editor (`item-surfaces.tsx`). */
	| { type: `doc.${string}`; path?: string; [key: string]: unknown }
	/** The line is back after a drop and nothing says what was missed: the drawing is read again. */
	| { type: "reconnected" };

/** `api` is the harness's `/api` address as the frame reaches it (`http://host:4329/api`). */
export function createBackend(api: string, canvas: string, firstToken: string): Backend {
	let token = firstToken;
	/** This frame's name on its stream: what the harness says to it alone (a document's answers) carries it. */
	const frame = `f${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
	const base = api.replace(/\/+$/, "");
	const headers = (more: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...more });
	/** Who hears the canvas's messages (`follow`), and the revision they hold (`since`), said in every `hello`. */
	const hearers = new Set<(message: Heard) => void>();
	let sinceOf: (() => number) | undefined;
	let opened: LineClient | undefined;
	/** The line, opened on first use: its calls, the canvas's changes and the frame's own messages. */
	const line = () =>
		(opened ??= openLine({
			api: base,
			token: () => token,
			watch: () => [{ canvas, ...(sinceOf ? { since: sinceOf() } : {}) }],
			hear: (message) => {
				for (const one of hearers) one(message as Heard);
			},
			onState: (open, again) => {
				// Back with no revision to catch up from: the drawing is read again.
				if (open && again && !sinceOf) for (const one of hearers) one({ type: "reconnected" });
			},
		}));

	return {
		async drawing() {
			const response = await fetch(`${base}/stage-pen/${encodeURIComponent(canvas)}`, { headers: headers(), cache: "no-store" });
			if (!response.ok) throw new Error(`The canvas ${canvas} did not load: ${response.status} ${await response.text().catch(() => "")}`.trim());
			return (await response.json()) as { doc: PenDocument; base: string; rev: number; by?: string; cards: Page[]; harness?: string };
		},

		follow(hear, since) {
			sinceOf = since;
			hearers.add(hear);
			line();
			return () => {
				hearers.delete(hear);
			};
		},

		async call(verb, args, edit) {
			return line().call(verb, args, edit);
		},

		frame,

		async post(route, body) {
			const data = (body ?? {}) as Record<string, unknown>;
			if (route === "doc") line().send({ type: "doc", message: data.message as never });
			else if (route === "card-seen") line().send({ type: "card.seen", path: String(data.path) });
			else if (route === "card-extent") line().send({ type: "card.extent", ...(data as { path: string; rev: number; w: number; h: number }) });
			else return { ok: false, error: `The line has no ${route}.` };
			return { ok: true };
		},

		answer(id, value) {
			const error = value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string" ? (value as { error: string }).error : undefined;
			line().send(error ? { type: "stage.result", id, error } : { type: "stage.result", id, value });
		},

		async snapshot(path, shot) {
			try {
				const query = new URLSearchParams({ path, w: String(shot.w), h: String(shot.h), scheme: shot.scheme });
				const response = await fetch(`${base}/snapshot?${query}`, { method: "POST", headers: headers({ "content-type": "text/html" }), body: shot.html });
				if (!response.ok) return { why: `the harness could not draw it (${response.status} ${(await response.text().catch(() => "")).slice(0, 200)})`.trim() };
				const blob = await response.blob();
				const bytes = new Uint8Array(await blob.arrayBuffer());
				let binary = "";
				for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
				return { mime: blob.type || "image/png", data: btoa(binary) };
			} catch (error) {
				return { why: error instanceof Error ? error.message : String(error) };
			}
		},

		setToken(next) {
			token = next;
			opened?.setToken(next);
		},
	};
}

/**
 * Keeps one drawing from the line: a revision already held is passed over; edits from the revision
 * held are applied; anything else, a gap, and the drawing is read whole again. `canvas.changed` is
 * what the harness says now; `stage.pen` and `stage.pen.delta` are the same from an older one.
 */
export function drawingFollower(handlers: {
	whole(doc: PenDocument, base: string, made?: readonly string[]): void;
	edits(edits: readonly PenEdit[], base: string, made?: readonly string[]): boolean;
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
					if (message.from !== rev || !handlers.edits(message.edits, message.base, message.made)) {
						handlers.reread();
						return;
					}
					rev = message.rev;
				}
			} else if (message.type === "stage.pen") {
				if (message.rev === rev) return;
				rev = message.rev;
				handlers.whole(message.doc, message.base, message.made);
			} else if (message.type === "stage.pen.delta") {
				if (message.rev <= rev) return;
				if (message.from !== rev || !handlers.edits(message.edits, message.base, message.made)) {
					handlers.reread();
					return;
				}
				rev = message.rev;
			} else if (message.type === "reconnected") handlers.reread();
		},
	};
}
