/**
 * This tab's harness token: what makes this page the person to the harness (`server/src/auth/`).
 *
 * Every request to the harness carries a token, and who is calling is that token alone. The harness
 * writes a fresh harness token into this page only when a person opened it in a tab of its own
 * (`server/src/auth/issue.ts`); a frame's copy of the page or a script's fetch of it gets none. It
 * lasts a day unused.
 *
 * Read once, before anything else on the page runs, and the tag taken out of the document straight
 * away, so a script that looks later finds nothing there. From then on this page sends it on every
 * request of its own to the harness, `Authorization: Bearer`, and on its socket (`decks_token`). A
 * card is not given this one: the canvas frame has a canvas pass for its one canvas (`board/canvas-frame.ts`).
 */
const tag = typeof document === "undefined" ? null : document.querySelector<HTMLMetaElement>('meta[name="decks-session"]');
const token = tag?.content || undefined;
tag?.remove();

/** The token itself, for the SDK; nothing on a page the harness did not give one (a frame, the public Decks). */
export function sessionToken(): string | undefined {
	return token;
}

/** The header to send on a request, or nothing on a page with no token. */
export function authHeaders(): Record<string, string> {
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The socket's address with the token in it, since a socket cannot carry headers. */
export function withToken(url: string): string {
	if (!token) return url;
	const given = new URL(url);
	given.searchParams.set("decks_token", token);
	return given.toString();
}

/**
 * Whether the harness no longer takes this page's token: it went unused too long, or was taken back.
 * Only a reload gets a new one, as only a tab the person opened is given one.
 */
export async function sessionStale(): Promise<boolean> {
	if (!token) return false;
	try {
		return (await fetch("/api/session", { method: "POST", headers: authHeaders() })).status === 401;
	} catch {
		return false;
	}
}

/** A digest of the token, for the service worker to check a request against without holding the token itself (`public/sw.js`). */
export async function tokenDigest(): Promise<string | undefined> {
	if (!token || !crypto.subtle) return undefined;
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Every `fetch` this page makes to its own harness carries the token: the API (`/api/…`) and another
 * server passed through this one (`/c/…`), unless the request already says who it is. A picture or a
 * new tab cannot carry a header, so this page reads those with fetch too and shows them from memory
 * (`lib/authed.tsx`): the harness reads no file or picture without a credential (`server/src/auth/guard.ts`).
 */
function carryToken(): void {
	if (!token || typeof window === "undefined" || typeof window.fetch !== "function") return;
	const plain = window.fetch.bind(window);
	window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input), location.href);
		if (url.origin !== location.origin || !/^\/(?:api|c)\//.test(url.pathname)) return plain(input, init);
		const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
		if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
		return plain(input, { ...init, headers });
	};
}
carryToken();
