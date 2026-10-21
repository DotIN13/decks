import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tickets: one page's admission, for another site that holds a site token (`tokens.ts`).
 *
 * A ticket is the `page` principal (`principal.ts`): the gate (`guard.ts`) lets a GET of its one path
 * in on it and nothing else.
 *
 * A frame or a new tab cannot send an `Authorization` header, so another site (Decks Studio) used to
 * put its pairing token in a board's address, and every script on that board could read the token
 * out of its own `location` and keep it. A ticket is what goes in the address instead: it admits one
 * GET of one path, the board page (`/api/board/<path>`), one file (`/api/f/<path>`, an export opened
 * in a tab) or an app (`/app/<name>/`, its whole address), for five minutes, and nothing else. What the page then asks for is on its own origin and
 * needs no ticket.
 *
 * A ticket is `<payload>.<mac>`, both base64url: the payload is `{ p: path, e: expires, k: token id }`
 * and the mac its HMAC-SHA256 under a secret made when the server starts and never written down, so
 * a restart ends every ticket. `k` is the id of the token it was made with (`TokenStore.issue`): a ticket
 * works only while that token does, so revoking the token ends its tickets too.
 */

/** How long a ticket admits its page: enough to load it, too short to be worth stealing. */
export const TICKET_MS = 5 * 60_000;

/**
 * How long a shared canvas's folder ticket lasts: a friend's board runs sandboxed, with no token,
 * and loads what it is made of (and what it fetches later) on the ticket in its address, so it is
 * good for a working day. It reads only that canvas's folder, which the board could read anyway.
 */
export const FOLDER_TICKET_MS = 12 * 3_600_000;

/**
 * A friend's canvas's folder, as a ticket admits it: `/api/board/shared/canvases/<owner>/<canvas>/`.
 * Every page and file under it, and nothing else: no hidden part, no step out (`deck/layout.ts`).
 */
const SHARED_FOLDER = /^\/api\/board\/shared\/canvases\/[^/.][^/]*\/[^/.][^/]*\/$/;

/** Whether a ticket's path is a shared canvas's whole folder rather than one page. */
export const isFolderTicket = (path: string): boolean => SHARED_FOLDER.test(path);

/**
 * The token id a ticket the harness makes for its own pages is made with (`stage/shots.ts`): its own
 * Chromium drawing a canvas reads that canvas with one, and needs no token of anyone's.
 */
export const HARNESS_TICKET = "harness";

/** The most paths one `POST /api/tickets` may ask for. */
export const MAX_TICKETS = 200;

interface Payload {
	p: string;
	e: number;
	k: string;
}

/**
 * The path a ticket is for, from what a front end asked one for: a board's request path
 * (`/api/board/boards/a.html`, or the deck path `boards/a.html` alone), a file's (`/api/f/…`), or an
 * app's, which is widened to the app's whole address (`/app/<name>/`). Undefined for anything else: a ticket
 * admits a page, not the API.
 */
export function ticketPath(given: string): string | undefined {
	if (typeof given !== "string" || given.length > 2000 || /[?#\0\\]/.test(given)) return undefined;
	const path = given.startsWith("/") ? given : `/api/board/${given}`;
	const app = /^\/app\/([^/]+)(?:\/.*)?$/.exec(path);
	if (app) return `/app/${app[1]}/`;
	// A friend's canvas's boards: a ticket for the folder, so a sandboxed page loads its files on it.
	const shared = /^\/api\/board\/shared\/canvases\/([^/]+)\/([^/]+)\/(?:.*)$/.exec(path);
	if (shared && !shared[1]!.startsWith(".") && !shared[2]!.startsWith(".") && path.endsWith("/")) {
		const folder = `/api/board/shared/canvases/${shared[1]}/${shared[2]}/`;
		return SHARED_FOLDER.test(folder) ? folder : undefined;
	}
	if (!/^\/api\/(?:board|f)\/[^/]/.test(path)) return undefined;
	// No `..` or `.` segment: a ticket names the page it is for, and that page only.
	if (path.split("/").some((segment) => segment === ".." || segment === ".")) return undefined;
	return path;
}

/** Whether a ticket's path admits a request for `requested` (decoded): the same page, or inside the same app. */
export function covers(path: string, requested: string): boolean {
	if (isFolderTicket(path)) {
		// Inside the folder, every part plain: never `..`, `.`, or a hidden folder.
		if (!requested.startsWith(path)) return false;
		return requested.slice(path.length).split("/").every((part) => part !== "" && !part.startsWith("."));
	}
	if (!path.startsWith("/app/")) return requested === path;
	// The bare `/app/<name>` is redirected to `/app/<name>/`, ticket and all.
	return requested.startsWith(path) || requested === path.slice(0, -1);
}

/** The ticket a request carries in its query (`decks_ticket`), if any. */
export function ticketOf(url: string | undefined): string | undefined {
	try {
		return new URL(url ?? "/", "http://decks").searchParams.get("decks_ticket") ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * A ticket carried in the path rather than the query, `/api/t/<ticket>/board/<path>`: what a shared
 * canvas's sandboxed board is framed at, so every relative address it loads (`../lib/board.css`,
 * `../files/a.png`) carries the ticket too. Answers the ticket and the path as the route sees it.
 */
export function splitPathTicket(url: string | undefined): { ticket: string; rest: string } | undefined {
	const match = /^\/api\/t\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)(\/[^?]*)(\?.*)?$/.exec(url ?? "");
	return match ? { ticket: match[1]!, rest: `/api${match[2]}${match[3] ?? ""}` } : undefined;
}

/** A request's path as the route will see it: percent-decoded, without its query. */
export function decodedPath(url: string | undefined): string | undefined {
	const raw = (url ?? "/").split("?")[0] ?? "/";
	try {
		return decodeURIComponent(raw);
	} catch {
		return undefined;
	}
}

export class Tickets {
	private readonly secret = randomBytes(32);

	/** `live(id)`: whether the token with that id still works (`TokenStore.live`). */
	constructor(private readonly live: (id: string) => boolean) {}

	/** A ticket for one path (`ticketPath`), made with the token whose id is `id`. */
	make(path: string, id: string, now = Date.now()): string {
		const payload = Buffer.from(JSON.stringify({ p: path, e: now + (isFolderTicket(path) ? FOLDER_TICKET_MS : TICKET_MS), k: id } satisfies Payload)).toString("base64url");
		return `${payload}.${this.mac(payload).toString("base64url")}`;
	}

	/** Whether a ticket is one this server made, not yet run out, made with a token that still works, and for this request path. */
	admits(ticket: string | undefined, requested: string | undefined, now = Date.now()): boolean {
		if (!ticket || requested === undefined) return false;
		const payload = this.open(ticket);
		if (!payload || payload.e <= now) return false;
		return covers(payload.p, requested) && this.live(payload.k);
	}

	/** The payload of a ticket whose mac is right, else undefined. */
	private open(ticket: string): Payload | undefined {
		const [payload, mac, extra] = ticket.split(".");
		if (!payload || !mac || extra !== undefined) return undefined;
		const given = Buffer.from(mac, "base64url");
		const wanted = this.mac(payload);
		if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return undefined;
		try {
			const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Payload>;
			if (typeof parsed.p !== "string" || typeof parsed.e !== "number" || typeof parsed.k !== "string") return undefined;
			return { p: parsed.p, e: parsed.e, k: parsed.k };
		} catch {
			return undefined;
		}
	}

	private mac(payload: string): Buffer {
		return createHmac("sha256", this.secret).update(payload).digest();
	}
}
