import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Deck } from "../deck/loader.ts";

/**
 * Every version of every board, content-addressed (DESIGN §6.7).
 *
 * Rewinding a conversation leaves the disk where it is, which is right when the
 * artifact is a repository and wrong when it is the boards. So each new version is
 * stored under `.decks/revisions/<sha>` as it appears — whoever wrote it — and the
 * order they appeared in is kept per board. That one store answers two questions:
 * what ⌘Z should go back to, and what a board looked like at a point in the
 * transcript.
 *
 * Content-addressed rather than git: no repository to interfere with, no history to
 * pollute, and an edit that puts a board back the way it was costs nothing because
 * it is the same sha.
 */
/** One stored version, and when it was stored. */
interface Revision {
	sha: string;
	at: number;
}

export class Revisions {
	/** Per board, oldest first. Persisted, because the sequence is the point. */
	private readonly order = new Map<string, Revision[]>();

	constructor(private deck: Deck) {
		this.load();
	}

	setDeck(deck: Deck): void {
		this.deck = deck;
		this.order.clear();
		this.load();
	}

	private get dir(): string {
		return join(this.deck.path, ".decks", "revisions");
	}

	private get indexFile(): string {
		return join(this.dir, "index.json");
	}

	/**
	 * Read the order back, then take the current state of every board as the newest.
	 *
	 * The order has to be on disk, not only in memory. The files were always durable,
	 * but the *sequence* was not — so a restart made "the oldest version I know of"
	 * mean "the file as it is now", and both undo and the timeline quietly lost
	 * everything from before the restart.
	 *
	 * Recording the current state last is what gives the first edit of a session
	 * something to undo to.
	 */
	private load(): void {
		try {
			const stored = JSON.parse(readFileSync(this.indexFile, "utf8")) as Record<string, unknown>;
			for (const [path, entries] of Object.entries(stored)) {
				if (!Array.isArray(entries)) continue;
				const kept: Revision[] = [];
				for (const entry of entries) {
					// The index used to be a list of shas; keep reading those, dated to
					// zero so they sort before anything with a real timestamp.
					const revision =
						typeof entry === "string"
							? { sha: entry, at: 0 }
							: entry && typeof entry === "object" && typeof (entry as Revision).sha === "string"
								? { sha: (entry as Revision).sha, at: Number((entry as Revision).at) || 0 }
								: undefined;
					if (revision && this.has(revision.sha)) kept.push(revision);
				}
				if (kept.length > 0) this.order.set(path, kept);
			}
		} catch {
			// No index yet, or an unreadable one: start from what is on disk now.
		}

		for (const board of this.deck.boards) {
			try {
				this.record(board.path, readFileSync(this.deck.fileOf(board.path), "utf8"));
			} catch {
				// A board that cannot be read is one the loader will drop anyway.
			}
		}
	}

	/**
	 * Write the order down.
	 *
	 * Called on every change, which is cheap: it is one small JSON file, and losing
	 * it is exactly the bug this exists to fix. Trimmed per board, because a long
	 * session should not make an unbounded index — the files stay, so an older
	 * revision referenced by a session entry is still readable, it just no longer
	 * takes part in undo.
	 */
	private save(): void {
		try {
			mkdirSync(this.dir, { recursive: true });
			const trimmed = Object.fromEntries([...this.order].map(([path, history]) => [path, history.slice(-200)]));
			writeFileSync(this.indexFile, `${JSON.stringify(trimmed, null, 1)}\n`);
		} catch (error) {
			console.error(`[decks] could not write the revision index: ${(error as Error).message}`);
		}
	}

	/** Store a version and return its sha. Recording the same bytes twice is free. */
	record(path: string, content: string, at = Date.now()): string {
		const sha = createHash("sha256").update(content).digest("hex").slice(0, 16);
		const file = join(this.dir, `${sha}.html`);
		if (!existsSync(file)) {
			mkdirSync(this.dir, { recursive: true });
			writeFileSync(file, content);
		}
		const history = this.order.get(path) ?? [];
		// A no-op write should not grow the history — it is the same version.
		if (history.at(-1)?.sha === sha) return sha;
		history.push({ sha, at });
		this.order.set(path, history);
		this.save();
		return sha;
	}

	/** The sha before the current one, if there is one to go back to. */
	previous(path: string): string | undefined {
		const history = this.order.get(path) ?? [];
		return history.length >= 2 ? history[history.length - 2]!.sha : undefined;
	}

	/**
	 * The version a board was at, at a moment in time.
	 *
	 * This is the fallback the timeline needs for a board the conversation has not
	 * written to: the newest version that already existed then. Without the
	 * timestamps it had to fall back to "the oldest version I have", which — once the
	 * index became durable — reached back further than the conversation did and
	 * offered to restore a state from days ago.
	 */
	at(path: string, when: number): string | undefined {
		const history = this.order.get(path) ?? [];
		if (history.length === 0) return undefined;

		/*
		 * Scanned, not bisected: the sequence is in write order, which is *usually*
		 * time order but not reliably. An index migrated from an older build has
		 * entries dated zero, a restored revision is old content written now, and a
		 * laptop that slept through a daylight-saving change has done stranger things
		 * than that. So: the newest revision that is not newer than the moment asked
		 * about, preferring the later write when two share a timestamp.
		 */
		let match: Revision | undefined;
		for (const revision of history) {
			if (revision.at <= when && (!match || revision.at >= match.at)) match = revision;
		}
		// Nothing that old: the board is newer than the moment asked about, so its
		// first version is the closest true answer.
		return (match ?? history[0])!.sha;
	}

	/** Drop the newest entry for one board: after an undo, it is no longer current. */
	pop(path: string): void {
		const history = this.order.get(path);
		if (!history || history.length < 2) return;
		history.pop();
		this.save();
	}

	history(path: string): readonly string[] {
		return (this.order.get(path) ?? []).map((revision) => revision.sha);
	}

	read(sha: string): string {
		if (!/^[0-9a-f]{6,64}$/.test(sha)) throw new Error(`Not a revision id: ${sha}`);
		return readFileSync(join(this.dir, `${sha}.html`), "utf8");
	}

	has(sha: string): boolean {
		return /^[0-9a-f]{6,64}$/.test(sha) && existsSync(join(this.dir, `${sha}.html`));
	}

	/** How much is in the store, for the settings panel to admit to one day. */
	size(): { revisions: number; bytes: number } {
		if (!existsSync(this.dir)) return { revisions: 0, bytes: 0 };
		let bytes = 0;
		const files = readdirSync(this.dir).filter((file) => file.endsWith(".html"));
		for (const file of files) {
			try {
				bytes += readFileSync(join(this.dir, file)).byteLength;
			} catch {
				/* a file that vanished between listing and reading */
			}
		}
		return { revisions: files.length, bytes };
	}
}
