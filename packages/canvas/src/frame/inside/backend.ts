import type { PenDocument, PenEdit } from "@decks/pen";
import type { Board, StageCall } from "@decks/protocol";
import type { CardShot } from "../../items/card-snapshot.ts";

/**
 * The canvas frame's own line to the harness: its drawing, the canvas's stream, and the calls it makes
 * as the person on that canvas, all on the canvas token the page handed it (`server/src/auth`, kind
 * `canvas`). The page renews the token (`token`), and never sees what goes over this line.
 */
export interface Backend {
	/** The drawing as it is now: its document, the folder its fills are read against, its revision. */
	drawing(): Promise<{ doc: PenDocument; base: string; rev: number; by?: string; cards: Board[] }>;
	/** Follow the canvas's stream until stopped, coming back after a drop. Answers what stops it. */
	follow(hear: (message: Heard) => void): () => void;
	/** One call on this canvas, with the edit's name when it is one (`X-Decks-Edit`). */
	call(verb: string, args: readonly unknown[], edit?: string): Promise<{ ok: boolean; value?: unknown; error?: string; notes?: string[] }>;
	/** This frame's name on its stream (`/api/v1/doc` answers to it). */
	frame: string;
	/** One of the harness's own routes beside the verbs (`/api/v1/board-seen`, `board-extent`), answering its JSON. */
	post(route: string, body: unknown): Promise<Record<string, unknown>>;
	/** The answer to an agent's call on this canvas (`stage.call`), as a tab answers it on the socket. */
	answer(id: string, value: unknown): void;
	/** A card written out as a page (`card-snapshot.ts`), drawn by the harness's Chrome (`/api/snapshot`): the picture, or why not. */
	snapshot(path: string, shot: CardShot): Promise<{ mime: string; data: string } | { why: string }>;
	/** A renewed token, for every request from now on. */
	setToken(token: string): void;
}

/** What the stream says about this canvas. */
export type Heard =
	| { type: "stage.pen"; stage: string; rev: number; doc: PenDocument; base: string; made?: string[]; by?: string }
	| { type: "stage.pen.delta"; stage: string; from: number; rev: number; edits: PenEdit[]; base: string; made?: string[]; by?: string }
	| { type: "board.changed"; path: string; rev: number; board?: Board; removed?: boolean; sized?: true }
	/** An agent's `decks view …` on this canvas: the frame showing it answers (`answer`). */
	| { type: "stage.call"; call: StageCall }
	/** About a document on this canvas: for its editor (`item-surfaces.tsx`). */
	| { type: `doc.${string}`; path?: string; [key: string]: unknown }
	/** The stream is back after a drop: what was missed is read again. */
	| { type: "reconnected" };

const TYPES = ["stage.pen", "stage.pen.delta", "board.changed", "stage.call", "doc.state", "doc.patched", "doc.changed", "doc.versions", "doc.version", "doc.compiled", "doc.repo", "doc.gdoc", "doc.gcomments", "doc.remote"];

/** `api` is the harness's `/api` address as the frame reaches it (`http://host:4329/api`). */
export function createBackend(api: string, canvas: string, firstToken: string): Backend {
	let token = firstToken;
	/** This frame's name on its stream: what the harness says to it alone (a document's answers) carries it. */
	const frame = `f${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
	const base = api.replace(/\/+$/, "");
	const headers = (more: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...more });

	return {
		async drawing() {
			const response = await fetch(`${base}/stage-pen/${encodeURIComponent(canvas)}`, { headers: headers(), cache: "no-store" });
			if (!response.ok) throw new Error(`The canvas ${canvas} did not load: ${response.status} ${await response.text().catch(() => "")}`.trim());
			return (await response.json()) as { doc: PenDocument; base: string; rev: number; by?: string; cards: Board[] };
		},

		follow(hear) {
			let stopped = false;
			let controller: AbortController | undefined;
			let wait = 500;
			const run = async (again: boolean) => {
				while (!stopped) {
					controller = new AbortController();
					try {
						const response = await fetch(`${base}/v1/events?types=${TYPES.join(",")}&frame=${frame}`, { headers: headers(), signal: controller.signal, cache: "no-store" });
						if (!response.ok || !response.body) throw new Error(String(response.status));
						if (again) hear({ type: "reconnected" });
						again = true;
						wait = 500;
						await readEvents(response.body, hear);
					} catch {
						/* dropped or refused: tried again, a little later each time */
					}
					if (stopped) return;
					await new Promise((done) => setTimeout(done, wait));
					wait = Math.min(wait * 2, 10_000);
				}
			};
			void run(false);
			return () => {
				stopped = true;
				controller?.abort();
			};
		},

		async call(verb, args, edit) {
			try {
				const response = await fetch(`${base}/v1/${verb}`, {
					method: "POST",
					headers: headers({ "content-type": "application/json", ...(edit ? { "x-decks-edit": edit } : {}) }),
					body: JSON.stringify({ args }),
				});
				const answer = (await response.json().catch(() => ({ ok: false, error: `${verb}: ${response.status}` }))) as { ok: boolean; value?: unknown; error?: string; notes?: string[] };
				return answer;
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},

		frame,

		async post(route, body) {
			try {
				const response = await fetch(`${base}/v1/${route}`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify(body) });
				return (await response.json().catch(() => ({ ok: false }))) as Record<string, unknown>;
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},

		answer(id, value) {
			const error = value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string" ? (value as { error: string }).error : undefined;
			void fetch(`${base}/v1/stage-result`, {
				method: "POST",
				headers: headers({ "content-type": "application/json" }),
				body: JSON.stringify(error ? { id, error } : { id, value }),
			}).catch(() => undefined);
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
		},
	};
}

/** Read Server-Sent Events off a body: each `data:` line a message, until the body ends. */
async function readEvents(body: ReadableStream<Uint8Array>, hear: (message: Heard) => void): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let cut: number;
		while ((cut = buffer.indexOf("\n\n")) >= 0) {
			const block = buffer.slice(0, cut);
			buffer = buffer.slice(cut + 2);
			const data = block
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (!data) continue;
			try {
				hear(JSON.parse(data) as Heard);
			} catch {
				/* a line that is not a message */
			}
		}
	}
}

/**
 * Keeps one drawing from the stream: the harness says each change once per agent on the canvas (or
 * once to none), so a revision already held is passed over; edits from the revision held are applied;
 * anything else, a gap, and the drawing is read whole again.
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
		hear(message: Heard) {
			if (message.type === "stage.pen") {
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
