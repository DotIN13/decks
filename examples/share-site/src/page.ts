import { mountCanvas } from "@decks/canvas";
import "@decks/canvas/canvas.css";
import { CanvasFollower } from "@decks/hub/follower";
import { serialize, type PenDocument, type PenEdit } from "@decks/pen";
import { LiveEvent, syncPath, syncRoutes, type CanvasAnswer, type Changes, type EditsAnswer, type SyncCanvas } from "@decks/sync-protocol";

/*
 * The page: open the site's first canvas (or make one), edit it, and see everyone else's edits as
 * they happen. The key in the address stands for signing in.
 */
const key = new URLSearchParams(location.hash.slice(1)).get("key") ?? "";
const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
	const res = await fetch(path, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
	if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
	return res.json() as Promise<T>;
};

const { canvases } = await call<{ canvases: SyncCanvas[] }>("GET", syncRoutes.canvases.path);
const canvas = canvases[0] ?? (await call<{ canvas: SyncCanvas }>("POST", syncRoutes.createCanvas.path, { name: "shared", title: "A shared canvas" })).canvas;
const opened = (await call<CanvasAnswer>("GET", syncPath(syncRoutes.canvas.path, { id: canvas.id }))) as Extract<CanvasAnswer, { pen: unknown }>;
document.getElementById("who")!.textContent = `${canvas.title} · rev ${opened.rev}`;

const engine = mountCanvas(document.getElementById("canvas")!, {
	text: serialize(opened.pen as unknown as PenDocument),
	onEdits: (edits) => void save(edits),
});

// The page's side of syncing: the hub's follower applies others' edits and sends the page's in order.
const follower = new CanvasFollower(
	{
		doc: () => engine.document(),
		show: (doc) => engine.setDocument(doc),
		changes: (since) => call<Changes>("GET", `${syncPath(syncRoutes.changes.path, { id: canvas.id })}?since=${since}`),
		whole: async () => {
			const c = (await call<CanvasAnswer>("GET", syncPath(syncRoutes.canvas.path, { id: canvas.id }))) as Extract<CanvasAnswer, { pen: unknown }>;
			return { rev: c.rev, pen: c.pen as unknown as PenDocument };
		},
	},
	opened.rev,
	`page-${crypto.randomUUID().slice(0, 8)}`,
);
let saving = Promise.resolve();
const save = (edits: PenEdit[]) => {
	const body = follower.sending(edits);
	saving = saving.then(async () => {
		try {
			follower.answered(await call<EditsAnswer>("POST", syncPath(syncRoutes.edits.path, { id: canvas.id }), body));
		} catch {
			follower.failed();
		}
		document.getElementById("who")!.textContent = `${canvas.title} · rev ${follower.rev}`;
	});
	return saving;
};

const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}${syncRoutes.live.path}?key=${encodeURIComponent(key)}`);
socket.onmessage = (m) => {
	const got = LiveEvent.safeParse(JSON.parse(String(m.data)));
	if (!got.success) return;
	const e = got.data;
	if (e.type === "hello") void follower.catchUp();
	if (e.type === "canvas" && e.id === canvas.id) follower.heard(e);
	void follower.settled().then(() => (document.getElementById("who")!.textContent = `${canvas.title} · rev ${follower.rev}`));
};
(window as unknown as { canvas: typeof engine }).canvas = engine;
