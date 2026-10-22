import { attachBoardStorage, boardStorageKey, isSharedBoard, sharedFolderOf, SHARED_SANDBOX, storageHash, storageKeeper } from "@decks/canvas/host";
import { createSignal } from "solid-js";
import { api } from "../connections/connection.ts";
import { authHeaders } from "../lib/session.ts";

/**
 * A board on a canvas a friend shared (`shared/canvases/<owner>/<canvas>/`), as this page frames it.
 *
 * It is someone else's code on this machine, so it runs sandboxed with no token: the frame has
 * `sandbox` without `allow-same-origin` and the harness sends the same sandbox as a header, so its
 * page has a blank origin. Such a page sends no cookie and cannot be handed a header, so it is framed
 * at an address carrying a ticket for its canvas's folder, `/api/t/<ticket>/board/<path>`, and what
 * it loads by relative address carries the ticket too. The ticket reads that folder and nothing else
 * (`server/src/auth/tickets.ts`). Its `localStorage` is kept here, per canvas and board, by the shim
 * the harness puts in its page (`lib/storage-shim.js`, `@decks/canvas/host (board-storage.ts)`).
 */
export { isSharedBoard, SHARED_SANDBOX };

const [tickets, setTickets] = createSignal<Record<string, { ticket: string; expires: number }>>({});
const asking = new Set<string>();
const keeper = storageKeeper(typeof localStorage === "undefined" ? undefined : localStorage, "decks.board-storage:");

/** Ask the harness for a ticket to a shared canvas's folder, once at a time; the frames waiting on it follow the signal. */
async function askTicket(folder: string): Promise<void> {
	if (asking.has(folder)) return;
	asking.add(folder);
	try {
		const path = `/api/board/${folder.split("/").map(encodeURIComponent).join("/")}`;
		const response = await fetch(api("/tickets"), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ paths: [path] }) });
		const answer = (await response.json().catch(() => ({}))) as { tickets?: Record<string, string>; folderExpires?: number };
		const ticket = answer.tickets?.[path];
		if (ticket) setTickets({ ...tickets(), [folder]: { ticket, expires: answer.folderExpires ?? Date.now() + 3_600_000 } });
	} finally {
		asking.delete(folder);
	}
}

/** The key this board's storage is kept under: this harness, its canvas and its path. */
const keyOf = (path: string) => boardStorageKey(location.origin, sharedFolderOf(path), path);

/**
 * The address a shared board's frame loads, or undefined while its ticket is being asked for. Its
 * storage rides after the `#`, so the board reads it as it starts.
 */
export function sharedBoardSrc(path: string, rev: number): string | undefined {
	const folder = sharedFolderOf(path);
	if (!folder) return undefined;
	const held = tickets()[folder];
	// Asked again an hour before it runs out; the frame keeps its address until then.
	if (!held || held.expires - Date.now() < 3_600_000) void askTicket(folder);
	if (!held) return undefined;
	const encoded = path.split("/").map(encodeURIComponent).join("/");
	return api(`/t/${held.ticket}/board/${encoded}?rev=${rev}${storageHash(keeper.read(keyOf(path)))}`);
}

/** Keep a shared board's storage as its page writes it; answers what stops it. */
export function attachSharedStorage(frame: HTMLIFrameElement, path: () => string): () => void {
	return attachBoardStorage(frame, () => keyOf(path()), keeper);
}
