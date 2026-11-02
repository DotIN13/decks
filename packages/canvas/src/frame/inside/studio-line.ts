import { CanvasFollower } from "@decks/hub/follower";
import type { PenDocument, PenEdit } from "@decks/pen";

/**
 * The canvas frame's line to Decks Studio, where a canvas is kept by Studio rather than a harness:
 * its drawing (`GET /api/canvases/:id`), what changed (`changes?since=`), your edits
 * (`POST /api/canvases/:id/edits`) and Studio's live socket, held to this one canvas, all on a token
 * Studio made for this frame and canvas (`frame-token`), which the page renews.
 *
 * The drawing is kept in step as Studio's own page keeps it (`@decks/hub`'s `CanvasFollower`): the
 * page's edits shown at once and sent in order, Studio's revisions applied as they are said, the
 * whole drawing only when its log no longer reaches back.
 */
export interface StudioLine {
	drawing(): Promise<{ doc: PenDocument; rev: number }>;
	/** Follow the canvas: each newer drawing as it comes. Answers what stops it. */
	follow(show: (doc: PenDocument) => void, now: () => PenDocument, rev: number): () => void;
	/** Your edits, already shown, sent in order. */
	save(edits: PenEdit[]): void;
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

	return {
		async drawing() {
			const { canvas: got } = await json<{ canvas: { rev: number; pen: PenDocument } }>(at);
			return { doc: got.pen, rev: got.rev };
		},

		follow(show, now, rev) {
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
			let socket: WebSocket | undefined;
			const open = () => {
				if (stopped) return;
				const url = new URL(`${base.replace(/\/api$/, "")}/live`);
				url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
				// A socket carries no header: the frame's token is in its address, and holds it to this canvas.
				url.searchParams.set("frame", token);
				socket = new WebSocket(url);
				socket.onmessage = (message) => {
					let event: { type?: string; id?: string };
					try {
						event = JSON.parse(String(message.data)) as { type?: string; id?: string };
					} catch {
						return;
					}
					if (event.type === "hello") void follower?.catchUp();
					else if (event.type === "canvas" && event.id === canvas) follower?.heard(event as never);
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

		setToken(next) {
			token = next;
		},
	};
}
