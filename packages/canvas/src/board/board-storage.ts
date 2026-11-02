/**
 * The sandbox a friend's board runs in (shared canvases only; your own boards run as they always
 * have): scripts, forms, pop-ups, dialogs and downloads, and never `allow-same-origin`, so its page
 * has a blank origin and reaches nothing of the page around it, the harness or another board. The
 * harness sends the same sandbox as a header with every page of a shared canvas (`server/src/http.ts`).
 */
export const SHARED_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/** Whether a board's deck path is on a canvas a friend shared: `shared/canvases/<owner>/<canvas>/…`. */
export const isSharedBoard = (path: string | undefined): boolean => typeof path === "string" && /^shared\/canvases\/[^/]+\/[^/]+\//.test(path);

/** The folder of a shared board's canvas, deck-relative with a slash: what a folder ticket is asked for. */
export function sharedFolderOf(path: string): string | undefined {
	const match = /^(shared\/canvases\/[^/]+\/[^/]+\/)/.exec(path);
	return match?.[1];
}

/** Whether a message came from this sandboxed frame's own page: by its window, with the blank origin it must have. */
function fromFrame(event: Pick<MessageEvent, "source" | "origin">, frame: HTMLIFrameElement | undefined): boolean {
	return !!frame?.contentWindow && event.source === frame.contentWindow && event.origin === "null";
}

/** Post to this frame's own window and no other; a blank origin is addressed as `"*"`, the only name it has. */
function postToFrame(frame: HTMLIFrameElement | undefined, message: unknown): boolean {
	const to = frame?.contentWindow;
	if (!to) return false;
	to.postMessage(message, "*");
	return true;
}

/**
 * Where a board's `localStorage` is kept: in the page around it (the Decks app, Studio), in that page's
 * own browser storage, one entry per canvas and board.
 *
 * A friend's board runs sandboxed and has no storage of its own; its storage shim
 * (`lib/storage-shim.js`) is its `localStorage`, and says every change up to the page around by
 * message. This is that page's end:
 * - `storageHash` is what the page puts after the `#` of the frame's address, so the board finds its
 *   storage as it starts, before any message could arrive;
 * - `attachBoardStorage` listens to that frame's window alone, keeps what it writes, and answers a
 *   page that reloaded itself (`storage.hello`) with what is kept.
 *
 * Which board and canvas a frame is comes from the page around (`key`), never from the board, so a
 * board cannot read or write another board's storage. A board keeps at most a megabyte, as the shim
 * says; a write past that is not kept.
 */

/** A board's storage, as it is kept. */
export type BoardItems = Record<string, string>;

/** Where the items of each board are kept, by a key the page around makes from the canvas and the board. */
export interface BoardStorageKeeper {
	read(key: string): BoardItems;
	write(key: string, items: BoardItems): void;
}

/** The most a board keeps, in characters of its keys and values: the shim's limit too. */
export const BOARD_STORAGE_MAX = 1_000_000;

/** The key of a board's storage: the page's scope (a harness, a connection), the canvas and the board's path. */
export function boardStorageKey(scope: string, canvas: string | undefined, path: string): string {
	return `${scope}\u0000${canvas ?? ""}\u0000${path}`;
}

/** A keeper in a `Storage` (the page's own `localStorage`), each board under `prefix` and its key. */
export function storageKeeper(store: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined, prefix: string): BoardStorageKeeper {
	return {
		read: (key) => {
			try {
				const parsed = JSON.parse(store?.getItem(`${prefix}${key}`) ?? "{}") as unknown;
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
				const items: BoardItems = {};
				for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") items[k] = v;
				return items;
			} catch {
				return {};
			}
		},
		write: (key, items) => {
			try {
				if (Object.keys(items).length === 0) store?.removeItem(`${prefix}${key}`);
				else store?.setItem(`${prefix}${key}`, JSON.stringify(items));
			} catch {
				/* the page's own storage is full: the board's change is kept for as long as the page is up */
			}
		},
	};
}

/** The size of a board's items, as the limit counts it. */
function sizeOf(items: BoardItems): number {
	let n = 0;
	for (const [k, v] of Object.entries(items)) n += k.length + v.length;
	return n;
}

/** base64url of a string's UTF-8 bytes, in pieces small enough for `fromCharCode`. */
function base64url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What goes after a frame's address so its board starts with its storage: "" for a board that keeps nothing. */
export function storageHash(items: BoardItems): string {
	return Object.keys(items).length === 0 ? "" : `#decks-storage=${base64url(JSON.stringify(items))}`;
}

/**
 * Keep one frame's board storage: what its page writes, and what it is answered when it asks. `key` is
 * read on every message, so a frame that comes to show another board keeps that board's. Answers what
 * stops it.
 */
export function attachBoardStorage(frame: HTMLIFrameElement, key: () => string | undefined, keeper: BoardStorageKeeper, view?: Pick<Window, "addEventListener" | "removeEventListener">): () => void {
	const at = view ?? frame.ownerDocument?.defaultView ?? (typeof window === "undefined" ? undefined : window);
	if (!at) return () => {};
	const listener = (event: MessageEvent) => {
		if (!fromFrame(event, frame)) return;
		const message = event.data as { decks?: unknown; key?: unknown; value?: unknown } | null;
		if (!message || typeof message !== "object" || typeof message.decks !== "string" || !message.decks.startsWith("storage.")) return;
		const which = key();
		if (!which) return;
		switch (message.decks) {
			case "storage.hello":
				postToFrame(frame, { decks: "storage.snapshot", items: keeper.read(which) });
				return;
			case "storage.set": {
				if (typeof message.key !== "string" || typeof message.value !== "string") return;
				const items = { ...keeper.read(which), [message.key]: message.value };
				if (sizeOf(items) > BOARD_STORAGE_MAX) return;
				keeper.write(which, items);
				return;
			}
			case "storage.remove": {
				if (typeof message.key !== "string") return;
				const items = keeper.read(which);
				if (!(message.key in items)) return;
				delete items[message.key];
				keeper.write(which, items);
				return;
			}
			case "storage.clear":
				keeper.write(which, {});
				return;
		}
	};
	at.addEventListener("message", listener as EventListener);
	return () => at.removeEventListener("message", listener as EventListener);
}
