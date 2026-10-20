/**
 * The person key: what makes this page the person to the harness (`server/src/share/person-key.ts`).
 *
 * The harness writes it into this page only when a person opened it in a tab, and asks for it on
 * every command from a browser: each request that changes something, and the socket. A board is a
 * page on the same address, so it could otherwise send any command the person could; without the key
 * it can only ask this page, which names it by its frame (`board/stage-call.ts`).
 *
 * Read once, before anything else on the page runs, and the tag taken out of the document straight
 * away, so a script that looks later finds nothing there.
 */
const tag = typeof document === "undefined" ? null : document.querySelector<HTMLMetaElement>('meta[name="decks-person-key"]');
const key = tag?.content || undefined;
tag?.remove();

/** The header to send on a command, or nothing on a page the harness did not give a key (a frame, the public Decks). */
export function keyHeaders(): Record<string, string> {
	return key ? { "X-Decks-Key": key } : {};
}

/** The socket's address with the key in it, since a socket cannot carry headers. */
export function withKey(url: string): string {
	if (!key) return url;
	const keyed = new URL(url);
	keyed.searchParams.set("decks_key", key);
	return keyed.toString();
}

/**
 * Whether the harness no longer takes this page's key: it was started again since the page loaded,
 * and made a new one. Only a reload gets the new one, as only a tab the person opened is given it.
 */
export async function keyStale(): Promise<boolean> {
	if (!key) return false;
	try {
		return (await fetch("/api/person-key", { method: "POST", headers: keyHeaders() })).status === 401;
	} catch {
		return false;
	}
}

/** A digest of the key, for the service worker to check a command against without holding the key itself (`public/sw.js`). */
export async function keyDigest(): Promise<string | undefined> {
	if (!key || !crypto.subtle) return undefined;
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
