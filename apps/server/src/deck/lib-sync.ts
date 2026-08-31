import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Bring a deck's `lib/` up to the primitives this build ships (DESIGN §2).
 *
 * `lib/` is a *copy* — that is the point of it, and not negotiable: a board is a
 * standalone document, so its stylesheet and its runtime have to be files sitting
 * beside it rather than a route this server serves. But a copy made once at
 * `Deck.create` and never touched again is a deck frozen at the version of Decks
 * that happened to create it, and that had a real cost: the editor's vocabulary
 * could only ever be the vocabulary of the *oldest* `board.css` in the wild, since
 * a class this build invented would render as an unstyled box in a deck made last
 * month. So the copy is refreshed every time a deck is opened, and `lib/` is this
 * application's directory rather than the user's.
 *
 * **Content-compared, not copied wholesale.** A restart that changes nothing must
 * write nothing — 82 files landing on disk would wake the watcher, and every board
 * on the canvas would reload for no reason (`App.watch`, the `asset` case). So a
 * file is written only when its bytes actually differ, which makes the ordinary
 * restart a read-only operation and the summary below honestly empty.
 *
 * **Stale files are removed**, and that is the part worth arguing about, because it
 * is the one that can delete something a person put there. It earns its keep: the
 * vendored libraries rename files between versions (pdf.js moved its decoders into
 * `wasm/`), and a `pdf.worker.min.mjs` left over from an older pdf.js beside a
 * newer `pdf.min.mjs` is not a tidiness problem — it is a board that fails to open
 * a paper with a version-mismatch error nobody can place. Every removal is logged
 * by the caller for that reason. `lib/` is documented as managed, and a file of
 * your own belongs in `assets/`.
 */

export interface LibSync {
	/** Deck-relative paths under `lib/` whose bytes changed, or that were missing. */
	written: string[];
	/** Paths that this build no longer ships, and which have been deleted. */
	removed: string[];
	/** How many files were already identical — the whole directory, on a normal restart. */
	same: number;
}

export const NOTHING_TO_DO: LibSync = { written: [], removed: [], same: 0 };

/**
 * A missing source is a refusal, not an empty sync.
 *
 * `runtimeLib` is resolved relative to this file, so it is absent only in a broken
 * install or a partial build — and in exactly that case, pruning "everything this
 * build ships" against an empty list would wipe a working deck's primitives. The
 * one situation where doing nothing is obviously right.
 */
export function syncRuntimeLib(runtimeLib: string, deckLib: string): LibSync {
	if (!existsSync(runtimeLib)) return NOTHING_TO_DO;

	const result: LibSync = { written: [], removed: [], same: 0 };
	mkdirSync(deckLib, { recursive: true });
	copyChanged(runtimeLib, deckLib, deckLib, result);
	prune(runtimeLib, deckLib, deckLib, result);
	return result;
}

function copyChanged(from: string, to: string, deckLib: string, result: LibSync): void {
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		const source = join(from, entry.name);
		const target = join(to, entry.name);
		if (entry.isDirectory()) {
			copyChanged(source, target, deckLib, result);
			continue;
		}
		if (!entry.isFile()) continue;
		const bytes = readFileSync(source);
		if (identical(target, bytes)) {
			result.same++;
			continue;
		}
		writeFileSync(target, bytes);
		result.written.push(slash(relative(deckLib, target)));
	}
}

/**
 * Size first, then bytes.
 *
 * Not an mtime comparison, which is the usual shortcut and wrong here: a fresh
 * clone, an `npm ci` or a `cp -r` of a data directory all rewrite mtimes without
 * changing a byte, and each would then rewrite the whole of `lib/` and reload every
 * board on screen. Reading 9MB twice at startup is cheaper than being wrong about
 * that, and the size check means the read almost never happens.
 */
function identical(target: string, bytes: Buffer): boolean {
	try {
		if (statSync(target).size !== bytes.length) return false;
		return readFileSync(target).equals(bytes);
	} catch {
		return false; // not there, or not readable as a file
	}
}

function prune(from: string, to: string, deckLib: string, result: LibSync): void {
	for (const entry of readdirSync(to, { withFileTypes: true })) {
		const target = join(to, entry.name);
		const source = join(from, entry.name);
		const here = slash(relative(deckLib, target));
		if (entry.isDirectory()) {
			// A directory this build no longer has goes whole, and its contents are
			// reported one by one: "removed wasm/" is not something anybody can check.
			if (!existsSync(source) || !statSync(source).isDirectory()) {
				for (const gone of filesUnder(target, deckLib)) result.removed.push(gone);
				rmSync(target, { recursive: true, force: true });
				continue;
			}
			prune(source, target, deckLib, result);
			continue;
		}
		if (existsSync(source)) continue;
		rmSync(target, { force: true });
		result.removed.push(here);
	}
}

function filesUnder(dir: string, deckLib: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...filesUnder(path, deckLib));
		else found.push(slash(relative(deckLib, path)));
	}
	return found;
}

/** Deck-relative paths are forward-slashed everywhere else in the app. */
const slash = (path: string) => path.split("\\").join("/");

/** One line for the log, or nothing when a restart changed nothing. */
export function describeSync(sync: LibSync): string | undefined {
	const parts: string[] = [];
	if (sync.written.length > 0) parts.push(`${sync.written.length} updated`);
	if (sync.removed.length > 0) parts.push(`${sync.removed.length} no longer shipped`);
	if (parts.length === 0) return undefined;
	return `${parts.join(", ")} (${sync.same} already current)`;
}
