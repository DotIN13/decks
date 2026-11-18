import { serveKept } from "@decks/frame";
import { EMOJI_URL, FONT_CDN } from "../../look/font-files.ts";

/**
 * What this page fetches and keeps for its frames (`@decks/frame`, `kept.ts`): the unchanging files a
 * frame would otherwise fetch whole each time one starts, since a sandboxed frame has no cache.
 *
 * - **The app's own built files** (`/assets/…`, named by their contents): the drawing engine's
 *   module above all, 4 MB as built.
 * - **The fonts a canvas draws its words with**, from the font CDN: a few megabytes for a canvas
 *   with Chinese on it, eleven with emoji.
 * - **Icons**, from the package CDN.
 *
 * All of them anyone may read, and all asked for with no login: anything in a frame can ask, a
 * card's script too, so nothing of the harness's own (a drawing, a card's file, a picture, which
 * need a pass) is ever fetched this way.
 */
const PUBLIC = [`${FONT_CDN}/`, "https://cdn.jsdelivr.net/npm/"];

const allowed = (url: URL): boolean => {
	if (url.origin === location.origin) return url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/");
	return url.href === EMOJI_URL || PUBLIC.some((prefix) => url.href.startsWith(prefix));
};

/** Serve this page's frames what it keeps: asked by whatever makes a frame, done once. */
export const keepForFrames = (): void => serveKept(allowed);
