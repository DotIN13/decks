import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Root } from "@decks/protocol";
import { expandUser } from "../config.ts";

/**
 * Which paths may be served, and the one place that decides it.
 *
 * Every route that turns a URL into a file goes through here. Two rules, and
 * they are separate on purpose: a *board* may only come from inside the deck,
 * because a board is part of the deck; a *file* may come from any root the deck
 * declares, because the whole point of an embed is to show a document that lives
 * somewhere else.
 *
 * Symlinks are resolved before the comparison, not after. A link inside the deck
 * pointing at `~/.ssh` is otherwise a path that passes a string test and reads a
 * key — and links inside a directory the agent can write are not hypothetical.
 */

export class PathRefused extends Error {
	constructor(
		readonly requested: string,
		reason: string,
	) {
		super(`Refused ${requested}: ${reason}`);
		this.name = "PathRefused";
	}
}

/**
 * The real path of `target`, even when it does not exist yet.
 *
 * A write goes to a file that is not there, so `realpathSync` on it throws; what
 * matters is that the *directory* it lands in is where it claims to be. So: walk
 * up to the nearest existing ancestor, resolve that, and re-attach the rest.
 */
export function realPathOf(target: string): string {
	let existing = resolve(target);
	const trailing: string[] = [];
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) return resolve(target); // hit the filesystem root
		trailing.unshift(existing.slice(parent.length + 1));
		existing = parent;
	}
	return trailing.length > 0 ? join(realpathSync(existing), ...trailing) : realpathSync(existing);
}

/** Whether `target` is `root` or sits underneath it, both already real. */
export function containedIn(root: string, target: string): boolean {
	if (target === root) return true;
	const rel = relative(root, target);
	return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/**
 * A deck-relative request -> an absolute path inside the deck.
 *
 * The input arrives from a URL, so it may say anything: `../../etc/passwd`, a
 * leading slash, a Windows separator, a percent-encoded traversal that Express
 * has already decoded for us.
 */
export function resolveInDeck(deckRoot: string, requested: string): string {
	const cleaned = requested.split("\\").join("/").replace(/^\/+/, "");
	if (cleaned.length === 0) throw new PathRefused(requested, "no path given");
	if (cleaned.includes("\0")) throw new PathRefused(requested, "the path contains a null byte");
	const real = realPathOf(resolve(deckRoot, cleaned));
	const realRoot = realPathOf(deckRoot);
	if (!containedIn(realRoot, real)) throw new PathRefused(requested, "it resolves outside the deck");
	return real;
}

export interface ResolvedRoots {
	/** The deck itself is always readable — an embed may point at a sibling asset. */
	deck: string;
	roots: Root[];
}

export function resolveRoots(deckRoot: string, declared: Array<{ path: string; writable: boolean }>): ResolvedRoots {
	const seen = new Set<string>();
	const roots: Root[] = [];
	for (const entry of declared) {
		const expanded = expandUser(entry.path);
		const absolute = isAbsolute(expanded) ? expanded : resolve(deckRoot, expanded);
		const real = realPathOf(absolute);
		if (seen.has(real)) continue;
		seen.add(real);
		roots.push({ path: real, writable: entry.writable, exists: existsSync(real) });
	}
	return { deck: realPathOf(deckRoot), roots };
}

/**
 * A file request -> an absolute path inside the deck or a declared root.
 *
 * `from` is the board the request came from, deck-relative, so a path resolves
 * the way it looks like it should: `../docs/notes.md` in `boards/sources.html`
 * means what it would mean in an `<img src>`, because a board is a document and
 * that is a document's rule. Without a `from` a relative path is deck-relative,
 * which is what the agent's own tools use.
 *
 * A root that does not exist cannot satisfy a request — it is listed in the UI so
 * it can be fixed, not treated as a wildcard.
 */
export function resolveFileRequest(
	resolved: ResolvedRoots,
	request: { path: string; from?: string },
): string {
	const cleaned = expandUser(String(request.path ?? "").split("\\").join("/").trim());
	if (cleaned.length === 0) throw new PathRefused(request.path, "no path given");
	if (cleaned.includes("\0")) throw new PathRefused(request.path, "the path contains a null byte");

	const base = request.from
		? dirname(resolve(resolved.deck, request.from.split("\\").join("/").replace(/^\/+/, "")))
		: resolved.deck;

	const candidate = isAbsolute(cleaned) ? cleaned : resolve(base, cleaned);
	const real = realPathOf(candidate);

	if (containedIn(resolved.deck, real)) return real;
	for (const root of resolved.roots) {
		if (root.exists && containedIn(root.path, real)) return real;
	}
	throw new PathRefused(request.path, "it is outside the deck and every declared root");
}

/**
 * The canonical URL for a file that has already been resolved.
 *
 * Absolute and therefore free of `..`, which is the whole reason it exists: a
 * browser silently deletes dot segments from a URL path — including their
 * percent-encoded spellings — so `/api/f/../shared/report.html` never arrives.
 * Serving from the absolute path also means a foreign page's own relative
 * references resolve to siblings under the same guard.
 */
export function fileUrl(absolute: string): string {
	const parts = absolute.split("/").filter(Boolean).map(encodeURIComponent);
	return `/api/f/${parts.join("/")}`;
}
