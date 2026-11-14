import { token } from "../state/line.ts";

// The page's token, as the line found it (/page.json or ?token=): what makes this
// page the person to the server. It goes only in a header and the socket's hello,
// and on every fetch of the page's own to /api, /files and /compat.

/** The token itself; undefined until the line is open, or on a page with none. */
export function sessionToken(): string | undefined {
	return token();
}

/** The header to send on a request, or nothing on a page with no token. */
export function authHeaders(): Record<string, string> {
	const now = token();
	return now ? { Authorization: `Bearer ${now}` } : {};
}

/** Whether the server no longer takes this page's token: a call answers that instead. */
export async function sessionStale(): Promise<boolean> {
	return false;
}

/** A digest of the token, for the service worker to check a request against without holding it. */
export async function tokenDigest(): Promise<string | undefined> {
	const now = token();
	if (!now || !crypto.subtle) return undefined;
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(now)));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every fetch of the page's own to its server carries the token, unless it says who it is already. */
function carryToken(): void {
	if (typeof window === "undefined" || typeof window.fetch !== "function") return;
	const plain = window.fetch.bind(window);
	window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		const now = token();
		const url = new URL(input instanceof Request ? input.url : String(input), location.href);
		if (!now || url.origin !== location.origin || !/^\/(?:api|c|files|compat)\//.test(url.pathname)) return plain(input, init);
		const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
		if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${now}`);
		return plain(input, { ...init, headers });
	};
}
carryToken();
