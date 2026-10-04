import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A board's runtime, cached by the browser for as long as it does not change.
 *
 * Every board asks for `../lib/board.css` and `../lib/board.js`, and through them the theme, four
 * fonts and the maths library. Served `no-cache`, each new page asked again for every one of them,
 * and each answer was a "not modified" that first waited for one of the browser's six connections to
 * the server: about 200 ms of a zoom in, before a single board could show. Cached outright, a deploy
 * that changes `board.js` would go unseen.
 *
 * So the address carries the version. A board is served with its references to `lib/` rewritten to
 * `lib/~<version>/`, where the version is a hash of what `lib/` holds; an address with the current
 * version is cached for a year, and a new `lib/` is a new address. `board.js` finds its libraries
 * beside itself, so they come from the same versioned address. The file on disk is never changed:
 * only what is sent.
 */

/** How long a computed version is trusted before `lib/` is looked at again. */
const TRUST_MS = 2000;
const known = new Map<string, { version: string; at: number }>();

/** A short hash of the names, sizes and times of every file under a deck's `lib/`. */
export function libVersion(deckPath: string, now = Date.now()): string {
	const was = known.get(deckPath);
	if (was && now - was.at < TRUST_MS) return was.version;
	const hash = createHash("sha1");
	const walk = (dir: string, prefix: string) => {
		let names: string[];
		try {
			names = readdirSync(dir).sort();
		} catch {
			return;
		}
		for (const name of names) {
			const path = join(dir, name);
			let stat;
			try {
				stat = statSync(path);
			} catch {
				continue;
			}
			if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
			else hash.update(`${prefix}${name}:${stat.size}:${Math.floor(stat.mtimeMs)}\n`);
		}
	};
	walk(join(deckPath, "lib"), "");
	const version = hash.digest("hex").slice(0, 10);
	known.set(deckPath, { version, at: now });
	return version;
}

/**
 * A board's markup with its `href` and `src` references into `lib/` given the version: the relative
 * `../lib/` a board writes, at any depth, and the absolute `/api/lib/` a rendered shell uses. Only
 * attributes are touched, so a board that shows `href="../lib/board.css"` as text, escaped, keeps it.
 */
export function versionLibRefs(html: string, version: string): string {
	return html.replace(/(\b(?:href|src)\s*=\s*["'])((?:\.\.\/)+lib\/|\/api\/lib\/)(?!~)/gi, `$1$2~${version}/`);
}

/** A path under `lib/` that names a version, split into the version and the file: `~ab12/board.css`. */
export function splitLibVersion(path: string): { version: string; file: string } | undefined {
	const match = /^~([0-9a-f]+)\/(.+)$/.exec(path);
	return match ? { version: match[1]!, file: match[2]! } : undefined;
}

/** The answer's cache header: a year for the current version, and asking again for any other. */
export const LIB_FOREVER = "public, max-age=31536000, immutable";
