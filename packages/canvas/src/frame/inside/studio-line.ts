import { CanvasFollower } from "@decks/hub/follower";
import type { PenDocument, PenEdit } from "@decks/pen";
import type { Presence, ServerMessage } from "@decks/protocol";

/**
 * The canvas frame's line to Decks Studio, where a canvas is kept by Studio rather than a harness:
 * its drawing (`GET /api/canvases/:id`), what changed (`changes?since=`), your edits
 * (`POST /api/canvases/:id/edits`) and Studio's live socket, held to this one canvas, all on a token
 * Studio made for this frame and canvas (`frame-token`), which the page renews.
 *
 * The drawing is kept in step as Studio's own page keeps it (`@decks/hub`'s `CanvasFollower`): the
 * page's edits shown at once and sent in order, Studio's revisions applied as they are said, the
 * whole drawing only when its log no longer reaches back. The same socket carries presence both
 * ways: where this frame's person is, said as `presence` (`presence.ts`, as `presence.set` is said
 * on a harness's line), and where everyone else on the canvas is, heard as `presence.changed`.
 */
export interface StudioLine {
	drawing(): Promise<{ doc: PenDocument; rev: number }>;
	/** Follow the canvas: each newer drawing as it comes, and everyone else's presence on it (`heard`). Answers what stops it. */
	follow(show: (doc: PenDocument) => void, now: () => PenDocument, rev: number, heard?: (message: Extract<ServerMessage, { type: "presence.changed" }>) => void): () => void;
	/** Your edits, already shown, sent in order. */
	save(edits: PenEdit[]): void;
	/** Where this frame's person is on the canvas, for the others on it: only what changed, and only down an open socket. */
	presence(presence: Presence): void;
	setToken(token: string): void;
}

export function createStudioLine(api: string, canvas: string, firstToken: string): StudioLine {
	let token = firstToken;
	const base = api.replace(/\/+$/, "");
	const at = `${base}/canvases/${encodeURIComponent(canvas)}`;
	const client = `frame-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
	const headers = (more: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...more });
	const json = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
		const response = await fetch(url, { ...init, headers: headers((init.headers as Record<string, string>) ?? {}), cache: "no-store" });
		if (!response.ok) throw new Error(`${response.status} ${await response.text().catch(() => "")}`.trim());
		return (await response.json()) as T;
	};
	let follower: CanvasFollower | undefined;
	let saving = Promise.resolve();
	let socket: WebSocket | undefined;

	return {
		async drawing() {
			const { canvas: got } = await json<{ canvas: { rev: number; pen: PenDocument } }>(at);
			return { doc: got.pen, rev: got.rev };
		},

		follow(show, now, rev, heard) {
			follower = new CanvasFollower(
				{
					doc: now,
					show: (doc) => show(doc),
					changes: (since) => json(`${at}/changes?since=${since}`),
					whole: async () => {
						const { canvas: got } = await json<{ canvas: { rev: number; pen: PenDocument } }>(at);
						return { rev: got.rev, pen: got.pen };
					},
				},
				rev,
				client,
			);
			let stopped = false;
			const open = () => {
				if (stopped) return;
				const url = new URL(`${base.replace(/\/api$/, "")}/live`);
				url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
				// A socket carries no header: the frame's token is in its address, and holds it to this canvas.
				url.searchParams.set("frame", token);
				socket = new WebSocket(url);
				socket.onmessage = (message) => {
					let event: { type?: string; id?: string; canvas?: string };
					try {
						event = JSON.parse(String(message.data)) as { type?: string; id?: string; canvas?: string };
					} catch {
						return;
					}
					if (event.type === "hello") void follower?.catchUp();
					else if (event.type === "canvas" && event.id === canvas) follower?.heard(event as never);
					// Someone else on this canvas, as Studio relays it: the same message a harness's line says.
					else if (event.type === "presence" && event.canvas === canvas) heard?.({ ...(event as object), type: "presence.changed" } as Extract<ServerMessage, { type: "presence.changed" }>);
				};
				socket.onclose = () => setTimeout(open, 2000);
			};
			open();
			return () => {
				stopped = true;
				socket?.close();
			};
		},

		save(edits) {
			const f = follower;
			if (!f) return;
			const body = f.sending(edits);
			saving = saving.then(async () => {
				try {
					f.answered(await json(`${at}/edits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
				} catch (error) {
					f.failed();
					console.warn("Not saved:", error);
				}
			});
		},

		presence(presence) {
			if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "presence", canvas, ...presence }));
		},

		setToken(next) {
			token = next;
		},
	};
}
