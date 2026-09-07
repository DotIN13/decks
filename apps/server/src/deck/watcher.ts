import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { isBoardFile } from "./kinds.ts";
import { join } from "node:path";
import { normalizeBoardPath } from "./schema.ts";

export type DeckChange =
	| { kind: "deck" }
	| { kind: "board"; path: string }
	| { kind: "asset"; path: string }
	/**
	 * "Stop trusting what you were told and look." Sent when a file under the deck was
	 * renamed — which is how most editors save — and when the watcher had to be replaced.
	 */
	| { kind: "rescan" };

/** `.decks/` is the revision store, written *in response to* a change; watching it loops. */
function ignored(path: string): boolean {
	return (
		path === ".decks" ||
		path.startsWith(".decks/") ||
		path.startsWith(".git/") ||
		path.startsWith("node_modules/")
	);
}

/**
 * What changed under the deck, coalesced.
 *
 * A single save fires several events — an editor writes a temp file and renames,
 * an agent's `write` truncates then writes — so every path waits out a short
 * quiet period before it is reported. Without that, a board reloads three times
 * per keystroke of the agent's and the flicker is the first thing anyone notices.
 *
 * **A replaced file gets a second answer as well**, and that is the interesting part. The
 * recursive watcher arms itself against the files it has seen, so a save that replaces a
 * board's inode — `sed -i`, `vim`, `git checkout`, any atomic write — is the *last* event
 * that board ever produces: the arm points at an inode nobody will write to again, and
 * the board goes quiet forever while its file carries on changing. That is worse than a
 * missed event, because nothing looks wrong.
 *
 * The trigger is the **inode**, not the event type, and that is not fussiness: the same
 * write-and-rename arrives as `rename` when the watcher had the file armed and as
 * `change` when it did not, so an event-type test is right about half the time. A path
 * whose inode is not the one it had a moment ago means whatever we were holding is stale,
 * whatever we were told it was called. Then the watcher is replaced outright and the deck
 * is asked to re-read itself — debounced, because a `git checkout` is a thousand of these
 * and one re-arm covers all of them, and cheap, because the re-read is a `stat` per board
 * (`Deck.resync`).
 */
export function watchDeck(root: string, onChange: (change: DeckChange) => void, quietMs = 80): () => void {
	const pending = new Map<string, NodeJS.Timeout>();
	let watcher: FSWatcher | undefined;
	let rearming: NodeJS.Timeout | undefined;
	let closed = false;

	/** The inode each path last had, so a file being *replaced* can be told from being written. */
	const inodes = new Map<string, number>();

	/**
	 * Learn the inode of every board *before* the first event, so the very first save can
	 * be recognised as a replacement.
	 *
	 * Only `boards/`, and that is the whole of the judgement: it is the set whose silence
	 * costs something (a board that stops tracking its file looks fine and is wrong), it
	 * is bounded by the number of boards, and it is walked again on every re-arm. An
	 * assets directory can hold ten thousand files and none of them has a record here to
	 * go stale.
	 */
	const seed = () => {
		const walk = (directory: string, prefix: string) => {
			let entries;
			try {
				entries = readdirSync(directory, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith(".")) continue;
				const path = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory()) walk(join(directory, entry.name), path);
				else {
					try {
						inodes.set(path, statSync(join(directory, entry.name)).ino);
					} catch {
						/* it went away mid-walk; the next event will say so */
					}
				}
			}
		};
		walk(join(root, "boards"), "boards");
	};

	/** True when this path is not the file it was — replaced, or gone. Unknown paths are not news. */
	const replaced = (path: string): boolean => {
		let inode = 0;
		try {
			inode = statSync(join(root, path)).ino;
		} catch {
			// Deleted between the event and the stat, which breaks an arm just as thoroughly.
		}
		const previous = inodes.get(path);
		inodes.set(path, inode);
		return previous !== undefined && previous !== inode;
	};

	const report = (path: string) => {
		const existing = pending.get(path);
		if (existing) clearTimeout(existing);
		pending.set(
			path,
			setTimeout(() => {
				pending.delete(path);
				if (replaced(path)) rearm();
				if (path === "deck.json") onChange({ kind: "deck" });
				// Every format the loader lists, so a saved `.md` reloads its frame like a `.html`.
				else if (/^boards\/.+/i.test(path) && isBoardFile(path)) onChange({ kind: "board", path });
				else onChange({ kind: "asset", path });
			}, quietMs),
		);
	};

	/**
	 * Throw the watcher away and start another, then tell the deck to look at itself.
	 *
	 * The order matters: re-arm first, so an edit landing during the re-read is heard by
	 * the new watcher, and the `rescan` that follows would catch it anyway.
	 */
	const rearm = () => {
		if (closed || rearming) return;
		rearming = setTimeout(() => {
			rearming = undefined;
			if (closed) return;
			watcher?.close();
			arm();
			onChange({ kind: "rescan" });
		}, quietMs * 2);
	};

	const arm = () => {
		seed();
		try {
			watcher = watch(root, { recursive: true, persistent: true }, (event, filename) => {
				// No name is rare and uninformative on Linux, and the honest reading of it
				// is "something moved under the deck" — which is what a rescan answers.
				if (!filename) {
					rearm();
					return;
				}
				const path = normalizeBoardPath(filename.toString());
				if (ignored(path)) return;
				// A rename is *sometimes* how a replacement announces itself, and the
				// cheapest half of the answer; `replaced()` in `report` is the other half.
				if (event === "rename") rearm();
				report(path);
			});
			watcher.on("error", (error) => {
				// A watcher that has fallen over must say so: the alternative is a UI
				// that silently stops reflecting the disk, which reads as a hang.
				console.error(`[decks] watching ${root} failed: ${(error as Error).message}`);
			});
		} catch (error) {
			console.error(`[decks] cannot watch ${root}: ${(error as Error).message}`);
		}
	};

	arm();

	return () => {
		closed = true;
		if (rearming) clearTimeout(rearming);
		rearming = undefined;
		for (const timer of pending.values()) clearTimeout(timer);
		pending.clear();
		watcher?.close();
	};
}
