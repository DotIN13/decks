import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CARD_SANDBOX } from "./sandbox.ts";

export { cardModuleOf, cardModules, runsInCard, unstampCard } from "./cards.ts";
export { CARD_SANDBOX } from "./sandbox.ts";

/**
 * What a card needs to run anywhere. A card is an HTML page (`cards/<name>/index.html`) that loads
 * the card runtime, `lib/card.css` and `lib/card.js`; whoever serves cards (a harness, Decks Studio, your sharing site)
 * serves this `lib/` beside them. Served to someone else's cards, it goes with `LIVE_CARD_POLICY`,
 * and the address that opens a card is a signed, expiring read pass (`passes`).
 */

/** The card runtime's folder: card.css, theme.css, card.js, the live pages, their fonts and libraries. */
export function libDir(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "lib");
}

/** The sandbox a card from someone else runs in (`CARD_SANDBOX`), as a Content-Security-Policy. */
export const LIVE_CARD_POLICY = `sandbox ${CARD_SANDBOX}`;

/** The headers every live card's file goes out with. */
export const LIVE_CARD_HEADERS: Readonly<Record<string, string>> = { "Content-Security-Policy": LIVE_CARD_POLICY, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

const TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", mjs: "text/javascript", wasm: "application/wasm", gif: "image/gif", webm: "video/webm", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", pdf: "application/pdf", html: "text/html; charset=utf-8", webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", json: "application/json", css: "text/css", js: "text/javascript", mp4: "video/mp4", mp3: "audio/mpeg" };

/** The Content-Type a card's file is served with, from its extension. */
export function contentType(path: string): string {
	return TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/**
 * The file a page asks `lib/` for: `board.css` and `board.js`, which pages written before cards
 * (a friend's leftover board, a card written then) ask for by name, are `card.css` and `card.js`.
 */
export function libName(path: string): string {
	return path.replace(/(^|\/)board\.(css|js)$/, "$1card.$2");
}

/** A file of `lib/` by its path inside it (`card.css`, `fonts/x.woff2`), or nothing for one that is not there or climbs out. */
export function libFile(path: string): { bytes: Uint8Array; type: string } | undefined {
	const root = libDir();
	const full = join(root, normalize(libName(path)));
	if (!full.startsWith(root + sep) || !existsSync(full) || !statSync(full).isFile()) return undefined;
	return { bytes: readFileSync(full), type: contentType(full) };
}

/**
 * Signed, expiring read passes: what goes in a live card's address so the address alone opens it.
 * `make` signs any JSON value with an expiry; `read` gives it back only when the signature holds and
 * it has not expired. What the value means (a canvas and a person, say) is the server's.
 */
export function passes(key: string) {
	const sign = (text: string) => createHmac("sha256", key).update(text).digest("base64url");
	return {
		make(value: unknown, expires: number): string {
			const body = Buffer.from(JSON.stringify([value, expires])).toString("base64url");
			return `${body}.${sign(body)}`;
		},
		read<T = unknown>(pass: string, now = Date.now()): T | undefined {
			const [body, sig] = pass.split(".");
			if (!body || !sig) return undefined;
			const want = Buffer.from(sign(body));
			const got = Buffer.from(sig);
			if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
			try {
				const [value, expires] = JSON.parse(Buffer.from(body, "base64url").toString()) as [T, number];
				return expires >= now ? value : undefined;
			} catch {
				return undefined;
			}
		},
	};
}
