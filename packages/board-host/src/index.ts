import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export { cardModuleOf, cardModules, runsInCard, unstampCard } from "./cards.ts";

/**
 * What a board needs to run anywhere. A board is a standalone HTML page that loads `../lib/board.css`
 * and `../lib/board.js`; whoever serves boards (a harness, Decks Studio, your sharing site) serves
 * this `lib/` beside them. Served to someone else's boards, it goes with `LIVE_BOARD_POLICY`, and
 * the address that opens a board is a signed, expiring read pass (`passes`).
 */

/** The board runtime's folder: board.css, board.js, their fonts and libraries. */
export function libDir(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "lib");
}

/**
 * The sandbox a board from someone else runs in, as a Content-Security-Policy: scripts, forms,
 * pop-ups, dialogs and downloads, in an opaque origin of its own, so it can reach nothing of the
 * page that shows it and no cookie of the address it came from.
 */
export const LIVE_BOARD_POLICY = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads allow-modals";

/** The headers every live board's file goes out with. */
export const LIVE_BOARD_HEADERS: Readonly<Record<string, string>> = { "Content-Security-Policy": LIVE_BOARD_POLICY, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

const TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", mjs: "text/javascript", wasm: "application/wasm", gif: "image/gif", webm: "video/webm", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", pdf: "application/pdf", html: "text/html; charset=utf-8", webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", json: "application/json", css: "text/css", js: "text/javascript", mp4: "video/mp4", mp3: "audio/mpeg" };

/** The Content-Type a board's file is served with, from its extension. */
export function contentType(path: string): string {
	return TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** A file of `lib/` by its path inside it (`board.css`, `fonts/x.woff2`), or nothing for one that is not there or climbs out. */
export function libFile(path: string): { bytes: Uint8Array; type: string } | undefined {
	const root = libDir();
	const full = join(root, normalize(path));
	if (!full.startsWith(root + sep) || !existsSync(full) || !statSync(full).isFile()) return undefined;
	return { bytes: readFileSync(full), type: contentType(full) };
}

/**
 * Signed, expiring read passes: what goes in a live board's address so the address alone opens it.
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
