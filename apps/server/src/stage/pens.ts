import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { apply, baseTheme, emptyDocument, parse, PenError, placements, read, reroute, serialize, type Frame, type Op, type OpResult, type PenDocument } from "@decks/pen";
import { slug } from "../agents/slug.ts";

/**
 * Stages as `.pen` files: `stages/<name>/stage.pen` in the deck.
 *
 * A stage's drawing — notes, shapes, arrows, text, frames — is a native pen.dev document, saved as
 * pen.dev saves one, so the folder opens in pen.dev as it is. This service is the one writer the
 * server has: edits come in as pen operations (`@decks/pen`'s `apply`), are checked, and are
 * written whole. An agent may also edit the file with its own tools; the watcher picks that up,
 * and a file that no longer parses is reported rather than drawn half-broken — the last good
 * document stays on screen until the file is fixed.
 *
 * A stage is named when it is first used and keeps that name, so its folder does not move when
 * the agent renames itself.
 */

export interface PenEntry {
	doc: PenDocument;
	/** Bumped on every change the server saw, its own or a hand edit. */
	rev: number;
	/** Why the file on disk is not what is shown, when it does not parse. */
	error?: string;
}

const FILE = "stage.pen";

export class StagePens {
	private readonly cache = new Map<string, PenEntry & { mtime: number; text: string }>();
	private watcher: FSWatcher | undefined;
	private pending = new Map<string, NodeJS.Timeout>();

	constructor(
		private deckPath: string,
		private readonly changed: (name: string, entry: PenEntry) => void,
	) {}

	get dir(): string {
		return join(this.deckPath, "stages");
	}

	fileOf(name: string): string {
		return join(this.dir, name, FILE);
	}

	/** Every stage folder, drawn on or only claimed. */
	names(): string[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	}

	/** Take a folder for a new stage, named from a title; made now, so two agents cannot take one name. */
	claim(title: string): string {
		const name = this.freshName(title);
		mkdirSync(join(this.dir, name), { recursive: true });
		if (!this.watcher) this.watch();
		return name;
	}

	/** A folder name for a new stage, from a title, not already taken by a file or by `alsoTaken`. */
	freshName(title: string, alsoTaken: Iterable<string> = []): string {
		const base = slug(title, 40) || "stage";
		const taken = new Set([...this.names(), ...alsoTaken]);
		if (!taken.has(base)) return base;
		for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
	}

	/** The document as it stands, read from disk when the file changed. A stage with no file is empty. */
	get(name: string): PenEntry {
		const file = this.fileOf(name);
		const cached = this.cache.get(name);
		if (!existsSync(file)) return cached ?? { doc: emptyDocument(), rev: 0 };
		const mtime = statSync(file).mtimeMs;
		if (cached && cached.mtime === mtime) return cached;
		const text = readFileSync(file, "utf8");
		if (cached && cached.text === text) {
			cached.mtime = mtime;
			return cached;
		}
		try {
			const doc = parse(text);
			const entry = { doc, rev: (cached?.rev ?? 0) + 1, mtime, text };
			this.cache.set(name, entry);
			return entry;
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			const kept = { doc: cached?.doc ?? emptyDocument(), rev: (cached?.rev ?? 0) + 1, mtime, text, error: `${file} does not parse, so the last good version is shown: ${why}` };
			this.cache.set(name, kept);
			return kept;
		}
	}

	/**
	 * Apply edits together, write the file, and say so. Nothing is written if any edit fails.
	 *
	 * Arrows are redrawn after the edits, so one that joins something that moved follows it
	 * (`@decks/pen`'s `reroute`). `boards` finds a board by path, for an arrow that ends on one.
	 */
	edit(name: string, ops: readonly Op[], boards?: (path: string) => Frame | undefined): { entry: PenEntry; results: OpResult[] } {
		const current = this.get(name);
		if (current.error) throw new PenError(`${current.error}. Fix the file, or replace it whole, before editing it.`);
		const theme = baseTheme(current.doc, "light");
		const { doc, results } = apply(current.doc, ops, { theme });
		reroute(doc, placements(doc, { theme }), boards);
		return { entry: this.write(name, doc), results };
	}

	/**
	 * Redraw a stage's arrows because something outside the file moved — a board an arrow ends on.
	 * Written only when an arrow actually changed.
	 */
	follow(name: string, boards: (path: string) => Frame | undefined): void {
		const current = this.get(name);
		if (current.error || !existsSync(this.fileOf(name))) return;
		const doc = structuredClone(current.doc);
		if (reroute(doc, placements(doc, { theme: baseTheme(doc, "light") }), boards)) this.write(name, doc);
	}

	/** Replace the document whole, from text that must parse. */
	replace(name: string, text: string): PenEntry {
		return this.write(name, parse(text));
	}

	/** What an agent reads: the file's items, each with its box on the stage. */
	read(name: string) {
		const entry = this.get(name);
		return { stage: name, file: this.fileOf(name), ...(entry.error ? { error: entry.error } : {}), ...read(entry.doc, { theme: baseTheme(entry.doc, "light") }) };
	}

	private write(name: string, doc: PenDocument): PenEntry {
		const file = this.fileOf(name);
		mkdirSync(join(this.dir, name), { recursive: true });
		if (!this.watcher) this.watch();
		const text = serialize(doc);
		writeFileSync(file, text);
		const previous = this.cache.get(name);
		const entry = { doc, rev: (previous?.rev ?? 0) + 1, mtime: statSync(file).mtimeMs, text };
		this.cache.set(name, entry);
		this.changed(name, entry);
		return entry;
	}

	/**
	 * Notice hand edits: an agent writing `stage.pen` with its own tools, or a person saving from
	 * pen.dev. Debounced per stage, and a write that matches what the server wrote is not news.
	 */
	watch(): void {
		this.close();
		// No folder yet is no stage yet: `claim` and `write` start watching when they make one.
		if (!existsSync(this.dir)) return;
		try {
			this.watcher = watch(this.dir, { recursive: true }, (_event, file) => {
				if (!file) return;
				const parts = String(file).split(/[\\/]/);
				if (parts.length !== 2 || parts[1] !== FILE) return;
				const name = parts[0]!;
				clearTimeout(this.pending.get(name));
				this.pending.set(
					name,
					setTimeout(() => {
						this.pending.delete(name);
						const before = this.cache.get(name);
						const after = this.get(name);
						if (after !== before || after.rev !== before?.rev) this.changed(name, after);
					}, 80),
				);
			});
		} catch {
			// A platform without recursive watching still works: edits through the tool are announced
			// by `write`, and a hand edit is read the next time anything asks.
		}
	}

	setDeck(deckPath: string): void {
		this.deckPath = deckPath;
		this.cache.clear();
		this.watch();
	}

	close(): void {
		this.watcher?.close();
		this.watcher = undefined;
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}
}
