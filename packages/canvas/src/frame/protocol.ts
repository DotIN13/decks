import type { PenDocument } from "@decks/pen";
import type { Board, Camera } from "@decks/protocol";
import type { PenTool } from "../state/pen-tools.ts";
import type { Insets } from "../camera/insets.ts";

/**
 * The canvas frame: the canvas, its engine and every card on it, in one sandboxed page of its own,
 * and the app's page around it as its broker.
 *
 * The frame keeps nothing and holds one credential: a token for its canvas alone, with your role on it,
 * lasting minutes and renewed by the page (`backend.ts`, `server/src/auth`, kind `canvas`). On it the
 * frame reads its drawing, follows the canvas's stream and makes your edits itself; the page never
 * relays the drawing. It is sandboxed (`allow-scripts`, an origin of its own), so a card's script there
 * cannot reach the app's page or your own token, and it reads its canvas's files on a ticket for that
 * canvas alone (`server/src/auth/tickets.ts`).
 *
 * The two talk on one `MessagePort`. The frame says `hello` to its parent once; the page answers on
 * that window alone with `start` and the port, and after that no window message is read again.
 */
export const PROTOCOL = 1;

/** The three envelopes, both ways: an event expects nothing back, a call exactly one reply. */
export type Message =
	| { t: "event"; name: string; data?: unknown }
	| { t: "call"; id: number; name: string; data?: unknown }
	| { t: "reply"; id: number; ok: true; value?: unknown }
	| { t: "reply"; id: number; ok: false; error: string; code?: ReplyCode };

/** Why a call was refused, for a caller that decides by it. */
export type ReplyCode = "refused" | "not-for-cards" | "asked-no" | "offline" | "gone";

/** The frame's first word to its parent, the only window message it sends. */
export interface Hello {
	t: "hello";
	protocol: number;
}

/** The page's answer, with the port transferred beside it. */
export interface StartMessage {
	t: "start";
	start: Start;
}

/** Everything the frame starts from: what was a host's options, as data. */
export interface Start {
	protocol: number;
	canvas: { name: string; title?: string; role: "owner" | "edit" | "view" };
	/** The harness, as the frame reaches it: its `/api` address and the canvas token, which lapses after `idle` unused. */
	backend: { api: string; token: string; idle: number };
	pages: Page[];
	/** The address the canvas's files are read at, with its ticket in it: `…/api/t/<ticket>/board/canvases/<name>/`. */
	files: { base: string; expires: number };
	/** Where the canvas's pictures are, by the same ticket: `…/api/t/<ticket>/thumb/`. */
	pictures: string;
	look: { dark: boolean; mode: "edit" | "browse"; readOnly: boolean; toolbar: boolean; insets?: Insets; agent?: string };
	camera?: Camera;
	writer?: { name?: string; color: string };
	/** What the frame keeps between visits, kept for it by the page (`store`). */
	stored: Record<string, string>;
	/** The tools' state as the app's chrome has it (`ui-sync.ts`). */
	tools?: Record<string, unknown>;
}

/** A card or a board on the canvas, as the frame draws it. */
export type Page = Board & { trust?: "own" | "friend" };

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

/** What the page sends the frame: events, and the calls it makes of it. */
export interface PageToFrame {
	/** The canvas token, renewed before it lapses. */
	token: { token: string };
	pages: { pages: Page[] };
	reload: { path: string };
	/** The page's scheme and mode, and what of the frame its own chrome covers (the side panel, the top bar). */
	look: { dark?: boolean; mode?: "edit" | "browse"; readOnly?: boolean; insets?: Insets; /** The conversation on screen, whose `decks view …` moves this canvas; another agent's waits for its chat. */ agent?: string };
	tool: { tool?: PenTool; ink?: { on: boolean } };
	camera: { camera: Camera; glide?: number };
	fit: Record<string, never>;
	select: { ids: readonly string[]; page?: string };
	step: { direction: "undo" | "redo" };
	news: { glow: Record<string, string> };
	marks: { path: string; marks: Array<{ id: string; quote: string; component?: string }> };
	busy: { switching?: boolean; mayStart?: boolean; writer?: { name?: string; color: string } };
	/** The tools' state, what changed of it (`ui-sync.ts`). */
	ui: Record<string, unknown>;
}

/** The calls the page makes of the frame, and what each answers. */
export type PageCalls = {
	edit: { data: { ops: unknown[] }; value: true };
	read: { data: Record<string, never>; value: PenDocument };
};

/**
 * What the frame hands the composer: what you point at, a comment written in the frame's popover, a
 * sketch to turn into something. **A draft, never a message**: whatever runs in the frame can say this,
 * a card's script too, so the page shows it in the composer and only your Send there sends it.
 */
export interface ComposerPart {
	selection?: { ids: readonly string[]; page?: string };
	pills?: Array<{ kind: "board" | "item"; id: string; label: string }>;
	/** `send`: you pressed Send in the popover, so the page puts it in the composer as its own message, still for you to send. */
	comment?: { path: string; title: string; quote: string; text: string; send?: boolean; component?: string; items?: string[] };
	ink?: { action: "drawing" | "board" | "send"; ids: string[]; canvas: string; box: Rect };
}

/** What the frame sends the page. */
export interface FrameToPage {
	composer: ComposerPart;
	/** Open one of the app's own panels, beside the canvas (the apps list). */
	panel: { name: "apps" };
	started: Record<string, never>;
	/** Once the camera rests; or a view kept for another conversation (`agent`), for the harness to answer that agent's `view.camera` by. */
	camera: { camera: Camera; agent?: string };
	viewport: { width: number; height: number };
	comment: { path: string; title: string; quote: string; component?: string; items?: string[]; at?: Rect };
	export: { ids: string[] };
	store: { key: string; value: string | null };
	keys: { key: string; code: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean };
	/** The tools' state, what changed of it (`ui-sync.ts`), for a frame with no chrome of its own. */
	ui: Record<string, unknown>;
}

/** The calls the frame makes of the page, and what each answers. */
export type FrameCalls = {
	open: { data: { path: string; from: string }; value: boolean };
	/** A card's agent call, or showing another canvas: the page's, with your token, and your OK before a message goes to an agent. */
	agent: { data: { verb: string; args: unknown[]; card: string }; value: unknown };
	upload: { data: { name: string; type: string; bytes: ArrayBuffer; at: Point }; value: { path: string } };
};

/** A call refused, with why: what a promise from `call` rejects with. */
export class CallRefused extends Error {
	constructor(
		message: string,
		readonly code?: ReplyCode,
	) {
		super(message);
		this.name = "CallRefused";
	}
}

type Handler = (data: unknown) => unknown;

/**
 * One end of the port: send events, make calls and wait for their replies, and answer the other
 * side's. Typed by what this end sends (`Out`, `OutCalls`) and hears (`In`, `InCalls`).
 */
export interface Peer<Out, OutCalls extends Record<string, { data: unknown; value: unknown }>, In, InCalls extends Record<string, { data: unknown; value: unknown }>> {
	emit<K extends keyof Out & string>(name: K, data: Out[K]): void;
	call<K extends keyof OutCalls & string>(name: K, data: OutCalls[K]["data"], transfer?: Transferable[]): Promise<OutCalls[K]["value"]>;
	on<K extends keyof In & string>(name: K, handler: (data: In[K]) => void): void;
	answer<K extends keyof InCalls & string>(name: K, handler: (data: InCalls[K]["data"]) => InCalls[K]["value"] | Promise<InCalls[K]["value"]>): void;
	close(): void;
}

/**
 * Post a message, as a plain copy when it is not one already: a host's state is often a Solid store,
 * whose proxies the structured clone refuses. A copy through JSON is what crosses then.
 */
function post(port: MessagePort, message: Message, transfer: Transferable[] = []): void {
	try {
		port.postMessage(message, transfer);
	} catch (error) {
		if (!(error instanceof DOMException) || error.name !== "DataCloneError" || transfer.length) throw error;
		port.postMessage(JSON.parse(JSON.stringify(message)) as Message);
	}
}

export function peer<Out, OutCalls extends Record<string, { data: unknown; value: unknown }>, In, InCalls extends Record<string, { data: unknown; value: unknown }>>(port: MessagePort): Peer<Out, OutCalls, In, InCalls> {
	let next = 1;
	const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	const listeners = new Map<string, Handler[]>();
	const answers = new Map<string, Handler>();
	port.onmessage = (event: MessageEvent<Message>) => {
		const message = event.data;
		if (!message || typeof message !== "object") return;
		if (message.t === "event") for (const handler of listeners.get(message.name) ?? []) handler(message.data);
		else if (message.t === "reply") {
			const one = waiting.get(message.id);
			if (!one) return;
			waiting.delete(message.id);
			if (message.ok) one.resolve(message.value);
			else one.reject(new CallRefused(message.error, message.code));
		} else if (message.t === "call") {
			const handler = answers.get(message.name);
			const reply = (out: Message) => post(port, out);
			if (!handler) return reply({ t: "reply", id: message.id, ok: false, error: `Nothing here answers ${message.name}.`, code: "refused" });
			Promise.resolve()
				.then(() => handler(message.data))
				.then(
					(value) => reply({ t: "reply", id: message.id, ok: true, value }),
					(error: unknown) => reply({ t: "reply", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error), ...(error instanceof CallRefused && error.code ? { code: error.code } : {}) }),
				);
		}
	};
	return {
		emit: (name, data) => post(port, { t: "event", name, data } satisfies Message),
		call: (name, data, transfer) =>
			new Promise((resolve, reject) => {
				const id = next++;
				waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
				post(port, { t: "call", id, name, data } satisfies Message, transfer ?? []);
			}),
		on: (name, handler) => {
			const list = listeners.get(name) ?? [];
			list.push(handler as Handler);
			listeners.set(name, list);
		},
		answer: (name, handler) => void answers.set(name, handler as Handler),
		close: () => {
			for (const one of waiting.values()) one.reject(new CallRefused("The canvas went away.", "gone"));
			waiting.clear();
			port.close();
		},
	};
}

/** The page's end, typed. */
export type PageEnd = Peer<PageToFrame, PageCalls, FrameToPage, FrameCalls>;
/** The frame's end, typed. */
export type FrameEnd = Peer<FrameToPage, FrameCalls, PageToFrame, PageCalls>;
