import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Root } from "@decks/protocol";
import { containedIn, PathRefused, realPathOf, type ResolvedRoots } from "../deck/roots.ts";

export interface BrowseEntry {
	name: string;
	path: string;
	kind: "dir" | "file";
	size?: number;
}

export interface BrowseResult {
	/** Absolute, real. Empty string means "the list of roots". */
	path: string;
	/** Where "up" goes, or null at the top of a root. */
	parent: string | null;
	entries: BrowseEntry[];
}

/**
 * What the file picker shows, and only what `/api/file` would agree to serve.
 *
 * A picker that can browse further than the route can serve is a picker that
 * offers you a file and then a broken embed, so both answer to the same roots.
 * With no path, it lists the roots themselves — the deck first, since a board
 * embedding a sibling asset is the common case.
 */
export function browse(roots: ResolvedRoots, requested: string | undefined): BrowseResult {
	if (!requested) {
		const entries: BrowseEntry[] = [
			{ name: `${basename(roots.deck)} (deck)`, path: roots.deck, kind: "dir" },
			...roots.roots
				.filter((root) => root.exists)
				.map((root: Root) => ({ name: root.path, path: root.path, kind: "dir" as const })),
		];
		return { path: "", parent: null, entries };
	}

	const real = realPathOf(requested);
	const inside = containedIn(roots.deck, real) || roots.roots.some((root) => root.exists && containedIn(root.path, real));
	if (!inside) throw new PathRefused(requested, "it is outside the deck and every declared root");
	if (!statSync(real).isDirectory()) throw new PathRefused(requested, "it is not a directory");

	const entries: BrowseEntry[] = [];
	for (const entry of readdirSync(real, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const path = join(real, entry.name);
		if (entry.isDirectory()) {
			entries.push({ name: entry.name, path, kind: "dir" });
			continue;
		}
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		let size: number | undefined;
		try {
			size = statSync(path).size;
		} catch {
			continue; // a broken symlink is not something to offer
		}
		entries.push({ name: entry.name, path, kind: "file", size });
	}
	entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));

	// The top of a root has no "up": the picker must not walk out of what it may serve.
	const parentPath = dirname(real);
	const isTop = real === roots.deck || roots.roots.some((root) => root.path === real);
	return { path: real, parent: isTop ? null : parentPath, entries };
}
