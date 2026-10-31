import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** One small JSON map keyed by board path, under `.decks/`. Both notes above are this. */
class PathNotes<T> {
	private map = new Map<string, T>();

	constructor(
		private deckPath: string,
		private readonly name: string,
		private readonly valid: (value: unknown) => T | undefined,
	) {
		this.load();
	}

	setDeck(deckPath: string): void {
		this.deckPath = deckPath;
		this.load();
	}

	get(path: string): T | undefined {
		return this.map.get(path);
	}

	entries(): Array<[string, T]> {
		return [...this.map.entries()];
	}

	/** Returns whether anything changed, so a caller can skip a broadcast that says nothing. */
	set(path: string, value: T): boolean {
		if (this.map.get(path) === value) return false;
		this.map.set(path, value);
		this.persist();
		return true;
	}

	forget(path: string): void {
		if (this.map.delete(path)) this.persist();
	}

	private file(): string {
		return join(this.deckPath, ".decks", this.name);
	}

	private load(): void {
		this.map = new Map();
		try {
			if (!existsSync(this.file())) return;
			const raw: unknown = JSON.parse(readFileSync(this.file(), "utf8"));
			if (!raw || typeof raw !== "object") return;
			for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
				const kept = this.valid(value);
				if (kept !== undefined) this.map.set(path, kept);
			}
		} catch {
			/* an unreadable file is an empty map: a byline is not worth refusing to start over */
		}
	}

	private persist(): void {
		try {
			mkdirSync(dirname(this.file()), { recursive: true });
			writeFileSync(this.file(), `${JSON.stringify(Object.fromEntries(this.map), null, "\t")}\n`);
		} catch {
			/* a byline that cannot be saved is still true until the restart */
		}
	}
}

/**
 * Who last named each board, and when: `.decks/authors.json`, a map of board path to the writer
 * and the moment they said it.
 *
 * A file event cannot say who wrote a file, so authorship is never read off the disk. It is
 * *said*: an agent that fits, shows or reports a board through the stage tool is its writer, and
 * the canvas editor's patch is the person's. This is where those statements are kept, so the
 * byline survives a restart — and so does the time, which is what tells the canvas that a
 * board a person read is news again.
 *
 * A file written by an older version holds a bare `"agent-1"`, which reads as *the writer, at a
 * time nobody recorded*: the byline comes back and the act has no date, so the board is timed off
 * the file exactly as it was before this existed.
 */
export interface Author {
	who: string;
	/** When they said it, or `0` for a byline written before the time was kept. */
	at: number;
}

export class Authors extends PathNotes<Author> {
	constructor(deckPath: string) {
		super(deckPath, "authors.json", (value) => {
			if (typeof value === "string") return value ? { who: value, at: 0 } : undefined;
			if (!value || typeof value !== "object") return undefined;
			const { who, at } = value as { who?: unknown; at?: unknown };
			if (typeof who !== "string" || !who) return undefined;
			return { who, at: typeof at === "number" && Number.isFinite(at) ? at : 0 };
		});
	}

	/** Say who named it, and when. True when either moved, so a caller can skip a broadcast that says nothing. */
	say(path: string, who: string, at: number): boolean {
		const was = this.get(path);
		if (was && was.who === who && was.at === at) return false;
		return this.set(path, { who, at });
	}
}

/**
 * When the person last looked at each board: `.decks/seen.json`, board path to a timestamp.
 *
 * The canvas marks a board "changed" only while the newest act on it is newer than this, so
 * reading a board clears its mark and the next act brings it back.
 */
export class Seen extends PathNotes<number> {
	constructor(deckPath: string) {
		super(deckPath, "seen.json", (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined));
	}
}
