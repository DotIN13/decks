import { api } from "../connections/connection.ts";
import { authHeaders } from "../lib/session.ts";

/**
 * The canvas in a sandboxed frame (`@decks/canvas`, `frame/`), while it is tried beside the canvas in
 * this page: `?frame=1` in the address. Measured against the page before it becomes the only way.
 */
export const framedCanvas = typeof location !== "undefined" && new URLSearchParams(location.search).get("frame") === "1";

/** The folder a canvas keeps its files in, as the harness serves it: `canvases/plan/`, or a friend's `shared/canvases/ana/trip/`. */
const folderOf = (canvas: string) => {
	const shared = /^shared\/([^/]+)\/([^/]+)$/.exec(canvas);
	return shared ? `shared/canvases/${shared[1]}/${shared[2]}/` : `canvases/${canvas}/`;
};

/**
 * A ticket for one canvas's folder (`server/src/auth/tickets.ts`): the frame reads that canvas's files
 * and pictures on it, and nothing else, since it has no token and no cookie of its own.
 */
export async function canvasTicket(canvas: string): Promise<{ files: string; pictures: string; expires: number }> {
	const path = `/api/board/${folderOf(canvas).split("/").map(encodeURIComponent).join("/")}`;
	const response = await fetch(api("/tickets"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ paths: [path] }) });
	const answer = (await response.json().catch(() => ({}))) as { tickets?: Record<string, string>; folderExpires?: number };
	const ticket = answer.tickets?.[path];
	if (!ticket) throw new Error(`No ticket for the canvas ${canvas}: ${response.status}`);
	const at = (rest: string) => new URL(api(`/t/${ticket}/${rest}`), location.href).href;
	return { files: at("board/"), pictures: at("thumb/"), expires: answer.folderExpires ?? Date.now() + 3_600_000 };
}

/**
 * The harness as the frame reaches it, and a token for the one canvas it shows (`kind: "canvas"`): the
 * frame reads, follows and edits that canvas on it, and this page asks again before it lapses.
 */
export async function canvasBackend(canvas: string): Promise<{ api: string; token: string; idle: number }> {
	const response = await fetch(api("/tokens"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ kind: "canvas", canvas }) });
	const answer = (await response.json().catch(() => ({}))) as { token?: string; idle?: number; error?: string };
	if (!answer.token) throw new Error(`No token for the canvas ${canvas}: ${answer.error ?? response.status}`);
	return { api: new URL(api("/"), location.href).href.replace(/\/$/, ""), token: answer.token, idle: answer.idle ?? 15 * 60_000 };
}
