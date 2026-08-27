import { watch, type FSWatcher } from "node:fs";
import { normalizeBoardPath } from "./schema.ts";

export type DeckChange =
	| { kind: "deck" }
	| { kind: "board"; path: string }
	| { kind: "asset"; path: string };

/**
 * What changed under the deck, coalesced.
 *
 * A single save fires several events — an editor writes a temp file and renames,
 * an agent's `write` truncates then writes — so every path waits out a short
 * quiet period before it is reported. Without that, a board reloads three times
 * per keystroke of the agent's and the flicker is the first thing anyone notices.
 *
 * `.decks/` is ignored, and that is load-bearing rather than tidy: the revision
 * store lives there and is written *in response to* a change, so watching it
 * would make every save a loop.
 */
export function watchDeck(root: string, onChange: (change: DeckChange) => void, quietMs = 80): () => void {
	const pending = new Map<string, NodeJS.Timeout>();
	let watcher: FSWatcher | undefined;

	const report = (relative: string) => {
		const path = normalizeBoardPath(relative);
		if (path.startsWith(".decks/") || path.startsWith(".git/") || path === ".decks" || path.startsWith("node_modules/")) return;

		const existing = pending.get(path);
		if (existing) clearTimeout(existing);
		pending.set(
			path,
			setTimeout(() => {
				pending.delete(path);
				if (path === "deck.json") onChange({ kind: "deck" });
				else if (/^boards\/.+\.html?$/i.test(path)) onChange({ kind: "board", path });
				else onChange({ kind: "asset", path });
			}, quietMs),
		);
	};

	try {
		watcher = watch(root, { recursive: true, persistent: true }, (_event, filename) => {
			if (filename) report(filename.toString());
		});
		watcher.on("error", (error) => {
			// A watcher that has fallen over must say so: the alternative is a UI
			// that silently stops reflecting the disk, which reads as a hang.
			console.error(`[decks] watching ${root} failed: ${(error as Error).message}`);
		});
	} catch (error) {
		console.error(`[decks] cannot watch ${root}: ${(error as Error).message}`);
	}

	return () => {
		for (const timer of pending.values()) clearTimeout(timer);
		pending.clear();
		watcher?.close();
	};
}
