/**
 * A link in the drawing, or on a card, that names a board or card of the deck: opened beside what is
 * already up, on the canvas, never as a navigation of the app's own page.
 */

/**
 * Check a path a link names against the deck.
 *
 * A card's content is a file, and a file can carry a script, so what arrives here is
 * somebody else's string: it has to name one path inside the deck and nothing else. The
 * lookup in the app is the real authority — a path this deck does not hold is a broken link,
 * and it says so rather than opening anything — and this is what keeps a lookup from being
 * asked about `../../etc/passwd`.
 */
export function deckPath(path: string): string | undefined {
	if (!path || path.startsWith("~") || path.includes("\\") || path.includes("\0")) return undefined;
	const parts = path.split("/");
	if (parts.some((part) => part === "" || part === "." || part === "..")) return undefined;
	return path;
}

/**
 * The deck board a link **in the drawing** points at, or nothing.
 *
 * A markdown card on the stage can carry links like any other markdown, and a link from one to
 * a board of this deck means what the same link on a board means: open that board here, beside
 * what is already up. Left to `window.open` it would put the board's bare file in a tab, with
 * no canvas, no title bar and no way back.
 *
 * The stage's own folder is the base every relative link in it is read against — `/api/f/<deck
 * path>/canvases/<name>/` — so the deck's prefix is that with the last two segments taken off. A
 * link that lands inside it and names a board file (`.html`, `.md`) is a board; everything
 * else, including an asset in the deck, is a tab, which is the same rule `lib/board.js` applies
 * on a board.
 */
export function deckBoardLink(href: string, base: string): string | undefined {
	let url: URL;
	let from: URL;
	try {
		// A page to read both against: the app's own, or a stand-in where there is no page.
		const here = typeof location === "undefined" ? "http://deck.invalid/" : location.href;
		from = new URL(base || "/", here);
		url = new URL(href, from);
	} catch {
		return undefined;
	}
	if (url.origin !== from.origin) return undefined;
	let parts = from.pathname.split("/").filter(Boolean);
	// On another connection the same path is under `/c/<id>` (`connections/connection.ts`).
	const prefix = parts[0] === "c" && parts.length > 2 ? `/c/${parts[1]}` : "";
	if (prefix) parts = parts.slice(2);
	// `/api/f/<deck>/canvases/<name>/` — the deck is everything before the last two.
	if (parts.length < 4 || parts[0] !== "api" || parts[1] !== "f") return undefined;
	const root = `${prefix}/${parts.slice(0, -2).join("/")}/`;
	if (!url.pathname.startsWith(root)) return undefined;
	const path = url.pathname
		.slice(root.length)
		.split("/")
		.map((part) => {
			try {
				return decodeURIComponent(part);
			} catch {
				return part;
			}
		})
		.join("/");
	if (!/\.(html|md)$/i.test(path)) return undefined;
	return deckPath(path);
}
