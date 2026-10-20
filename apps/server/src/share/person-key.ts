import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fromThisMachine, tokenOf, originOf, type Pairing } from "./pairing.ts";

/**
 * Who may give this harness commands from a browser.
 *
 * A board is a page the harness serves on its own address, and its scripts are whoever wrote the
 * board: an agent, a file somebody sent, a page off the internet. Once a request from the harness's
 * own address went straight on, a board could call any verb as the person (`X-Decks-Person`), and
 * the "Let this board use the stage?" question was only asked of boards that said they were boards.
 *
 * So a **command** — any request under `/api/` or `/c/` that is not a read (GET, HEAD), and the
 * socket at `/ws` — from a browser must carry credentials: a pairing token (Studio, another Decks),
 * or the **person key**. The person key is a random secret made when this process starts, written
 * only into the Decks page a person opened in a tab (`withPersonKey`): never into a page fetched by a
 * script or put in a frame, so a board cannot read it by asking for the page. The Decks page holds it
 * and sends it on each command (`X-Decks-Key`, or `decks_key` on its socket). A board asks the page
 * around it instead, and the page names the board by the frame the ask came from.
 *
 * A request with neither a browser's headers nor a proxy's, from this machine, is the `decks`
 * command, an agent or an app's server, and is let through as it always was.
 */

/** The header the Decks page sends its key in. */
export const KEY_HEADER = "x-decks-key";

/** The person key: one per harness process. */
export class PersonKey {
	readonly value: string;
	private readonly hash: Buffer;

	constructor(value = randomBytes(32).toString("base64url")) {
		this.value = value;
		this.hash = createHash("sha256").update(value).digest();
	}

	/** Whether a key a request carries is this one, compared in constant time. */
	matches(given: string | undefined): boolean {
		if (!given) return false;
		return timingSafeEqual(createHash("sha256").update(given).digest(), this.hash);
	}
}

/** The person key a request carries: the header, or `decks_key` in the query for a socket, which cannot set headers. */
export function personKeyOf(headers: Record<string, string | string[] | undefined>, url: string | undefined): string | undefined {
	const header = headers[KEY_HEADER];
	if (typeof header === "string" && header) return header;
	try {
		return new URL(url ?? "/", "http://decks").searchParams.get("decks_key") ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * Whether a browser made the request: browsers send `Sec-Fetch-Site` with every request to HTTPS
 * and localhost, and `Origin` with every POST and every socket. A program (curl, Node's fetch, the
 * `decks` command) sends neither unless it means to look like a browser.
 */
export function fromBrowser(headers: Record<string, string | string[] | undefined>): boolean {
	return headers["sec-fetch-site"] !== undefined || headers.origin !== undefined;
}

/** Whether a request changes something: anything under `/api/` or `/c/` that is not a read. */
export function isCommand(method: string, path: string): boolean {
	if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
	return path.startsWith("/api/") || path.startsWith("/c/");
}

/** The routes a page with no credentials yet must reach to get some, as before. */
const OPEN = new Set(["/api/pair", "/api/hello", "/api/studio/connect"]);

/** How a request is let give commands: the person's key, a pairing token, or a program on this machine. */
export type Credentials = "key" | "token" | "machine";

export function credentialsOf(
	req: { headers: Record<string, string | string[] | undefined>; url?: string | undefined; originalUrl?: string; socket?: { remoteAddress?: string | undefined } },
	key: PersonKey,
	pairing: Pick<Pairing, "verdict">,
): Credentials | undefined {
	const url = req.originalUrl ?? req.url;
	if (key.matches(personKeyOf(req.headers, url))) return "key";
	if (pairing.verdict(tokenOf(req.headers, url), originOf(req.headers)) === "paired") return "token";
	if (!fromBrowser(req.headers) && fromThisMachine(req.socket?.remoteAddress, req.headers)) return "machine";
	return undefined;
}

/**
 * Whether a command may go on: anything that is not a command does; a command from a program does,
 * as before (`credentialsOf` decides later who it is); one from a browser only with credentials.
 */
export function commandAllowed(
	req: { method: string; path: string; headers: Record<string, string | string[] | undefined>; originalUrl?: string; socket?: { remoteAddress?: string | undefined } },
	key: PersonKey,
	pairing: Pick<Pairing, "verdict">,
): boolean {
	if (!isCommand(req.method, req.path) || OPEN.has(req.path)) return true;
	if (!fromBrowser(req.headers)) return true;
	return credentialsOf(req, key, pairing) !== undefined;
}

/** What a browser without credentials is told. */
export const NO_COMMANDS =
	"This page cannot give Decks commands. A board asks the page it is on, which asks the person; another site pairs with the harness first.";

/**
 * Whether the browser is loading the page into a tab of its own: what it says of a navigation at the
 * top. A frame says `iframe`, a script's fetch `empty`, and neither is given the person key.
 */
export function isTopNavigation(headers: Record<string, string | string[] | undefined>): boolean {
	return headers["sec-fetch-dest"] === "document" && headers["sec-fetch-mode"] === "navigate";
}

/** The Decks page with the person key in it, read once at start by `web/src/lib/person-key.ts`. */
export function withPersonKey(html: string, key: string): string {
	const tag = `<meta name="decks-person-key" content="${key}">`;
	const at = html.search(/<head[^>]*>/i);
	if (at < 0) return `${tag}${html}`;
	const end = html.indexOf(">", at) + 1;
	return `${html.slice(0, end)}${tag}${html.slice(end)}`;
}
