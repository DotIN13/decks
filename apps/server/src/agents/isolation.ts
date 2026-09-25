import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Isolated mode: an agent that works on a copy of its stage, in a folder of its own.
 *
 * When isolation begins, the stage's boards are copied into the stage's own board folder,
 * `stages/<name>/boards/`, and the stage points at those copies (`localize` in `session.ts`,
 * `deck/stage-boards.ts`). The originals in the deck's `boards/` are never written by this agent,
 * and the copies stay with the stage when isolation ends.
 *
 * The agent itself runs in a temporary folder, `<tmp>/decks-isolation/<id>`, laid out with the
 * deck's paths but holding only its stage: the stage's boards at the same deck-relative paths, its
 * `stage.pen`, the assets those boards use, and `lib` pointing at the deck's. So a path the canvas
 * tool gives is a path in the folder. It is told it works there and must leave the Decks data
 * alone (`isolationNote` in `context.ts`); nothing is fenced.
 *
 * The boards go both ways: `sync` compares each copy with its board by modification time against
 * what it last copied, and carries whichever side changed to the other. When both changed, the
 * newer wins. Writes into the deck are in place, so its watchers keep watching. The stage file and
 * the assets are copied in and never back. A new file the agent writes in the stage's board folder,
 * or in a `boards/` of its own, joins the stage's board folder and the stage (`adopt`); a board that
 * leaves the stage leaves the folder, never the deck.
 */

export interface IsolationOptions {
	/** The temporary folder the copy lives in. */
	root: string;
	/** The deck. */
	deck: string;
	/** The boards on the stage, deck-relative: after `localize`, all in the stage's board folder. */
	boards: () => readonly string[];
	/** The stage's board folder, deck-relative (`stages/<name>/boards`), where new boards go. */
	folder: () => string | undefined;
	/** The stage's folder name, when it has one, so its `stage.pen` is copied in too. */
	stage: () => string | undefined;
	/** A board the agent wrote as a new file: put it on the stage. */
	adopt: (path: string) => void;
	/** Something the person should hear about, in the agent's column. */
	notice: (text: string) => void;
}

const ASSET = /(?:src|href|data-embed|poster)\s*=\s*["']((?:\.\.\/)+assets\/[^"'?#]+)/g;

/** What was last copied for one file: both sides' modification times just after the copy. */
interface Copied {
	deck: number;
	view: number;
}

export class IsolatedView {
	private watcher: FSWatcher | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private pending: ReturnType<typeof setTimeout> | undefined;
	private copied = new Map<string, Copied>();
	private clashes = new Set<string>();
	private syncing = false;

	constructor(private readonly options: IsolationOptions) {}

	/** The folder the agent runs in. */
	get dir(): string {
		return this.options.root;
	}

	/** Make the copy, and keep it and the deck in step until `close`. */
	open(): void {
		mkdirSync(this.dir, { recursive: true });
		this.sync();
		try {
			this.watcher = watch(this.dir, { recursive: true }, () => this.soon());
		} catch {
			// A platform without recursive watching still has the interval below.
		}
		// The interval also carries the person's edits in the deck into the copy.
		this.timer = setInterval(() => this.sync(), 1500);
		this.timer.unref?.();
	}

	/** Stop, carry any last edit back into the deck, and remove the copy. */
	close(): void {
		this.watcher?.close();
		this.watcher = undefined;
		if (this.timer) clearInterval(this.timer);
		if (this.pending) clearTimeout(this.pending);
		this.timer = this.pending = undefined;
		this.sync();
		rmSync(this.dir, { recursive: true, force: true });
	}

	/** A change in the folder: sync shortly, so a burst of writes is one pass. */
	private soon(): void {
		if (this.pending) return;
		this.pending = setTimeout(() => {
			this.pending = undefined;
			this.sync();
		}, 150);
		this.pending.unref?.();
	}

	/** What the stage holds now, deck-relative: its boards (both ways), its drawing and the assets its boards use (in only). */
	private wanted(): { boards: string[]; readable: string[] } {
		const deck = this.options.deck;
		const boards = this.options.boards().filter((path) => existsSync(join(deck, path)));
		const readable = new Set<string>();
		const stage = this.options.stage();
		if (stage && existsSync(join(deck, "stages", stage, "stage.pen"))) readable.add(`stages/${stage}/stage.pen`);
		for (const path of boards) {
			let text = "";
			try {
				text = readFileSync(join(deck, path), "utf8");
			} catch {
				continue;
			}
			for (const match of text.matchAll(ASSET)) {
				const asset = relative(deck, resolve(deck, dirname(path), match[1]!)).split("\\").join("/");
				if (asset.startsWith("assets/") && existsSync(join(deck, asset)) && statSync(join(deck, asset)).isFile()) readable.add(asset);
			}
		}
		return { boards, readable: [...readable] };
	}

	/** Bring the copy and the deck into step: see the module comment for the rules. */
	sync(): void {
		if (this.syncing) return;
		this.syncing = true;
		try {
			const before = this.wanted();
			this.adoptNewBoards(new Set(before.boards));
			// Again after adopting: a board just taken in is on the stage now, not leaving it.
			const { boards, readable } = this.wanted();
			for (const path of boards) this.reconcile(path, true);
			for (const path of readable) this.reconcile(path, false);
			const all = new Set([...boards, ...readable]);
			for (const path of [...this.copied.keys()]) {
				if (all.has(path)) continue;
				// Leaving the stage: carry a last edit back first, then take the copy out.
				this.reconcile(path, true);
				rmSync(join(this.dir, path), { force: true });
				this.copied.delete(path);
			}
			const lib = join(this.dir, "lib");
			if (!existsSync(lib) && existsSync(join(this.options.deck, "lib"))) symlinkSync(join(this.options.deck, "lib"), lib, "dir");
		} catch (error) {
			this.options.notice(`Isolation could not update its folder: ${(error as Error).message}`);
		} finally {
			this.syncing = false;
		}
	}

	/** One file, the same path in the folder and the deck. Only a board carries the agent's edit back. */
	private reconcile(path: string, writable: boolean): void {
		const deckFile = join(this.options.deck, path);
		const viewFile = join(this.dir, path);
		if (!existsSync(deckFile)) return;
		const last = this.copied.get(path);
		if (!existsSync(viewFile)) {
			mkdirSync(dirname(viewFile), { recursive: true });
			copyFileSync(deckFile, viewFile);
			this.remember(path);
			return;
		}
		const deckTime = statSync(deckFile).mtimeMs;
		const viewTime = statSync(viewFile).mtimeMs;
		const deckChanged = !last || deckTime !== last.deck;
		const viewChanged = !last || viewTime !== last.view;
		if (!deckChanged && !viewChanged) return;
		if (!readFileSync(deckFile).equals(readFileSync(viewFile))) {
			const agentWins = writable && viewChanged && (!deckChanged || viewTime >= deckTime);
			if (agentWins) writeFileSync(deckFile, readFileSync(viewFile));
			else writeFileSync(viewFile, readFileSync(deckFile));
		}
		this.remember(path);
	}

	private remember(path: string): void {
		this.copied.set(path, { deck: statSync(join(this.options.deck, path)).mtimeMs, view: statSync(join(this.dir, path)).mtimeMs });
	}

	/**
	 * A board file in the folder that is not a copy of one on the stage: a board the agent made.
	 * Looked for in the stage's board folder and in a `boards/` of the folder's own, and taken into
	 * the stage's board folder under its name (or `-2`, `-3` when taken), moved there in the folder
	 * too so the two paths match from then on.
	 */
	private adoptNewBoards(known: Set<string>): void {
		const folder = this.options.folder();
		if (!folder) return;
		for (const from of [folder, "boards"]) {
			const dir = join(this.dir, from);
			if (!existsSync(dir)) continue;
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				if (!entry.isFile() || !/\.(html|md)$/.test(entry.name)) continue;
				const path = `${from}/${entry.name}`;
				if (known.has(path) || this.copied.has(path) || this.clashes.has(path)) continue;
				const dot = entry.name.lastIndexOf(".");
				const [stem, ext] = [entry.name.slice(0, dot), entry.name.slice(dot)];
				let into = `${folder}/${entry.name}`;
				for (let n = 2; existsSync(join(this.options.deck, into)); n++) {
					into = `${folder}/${stem}-${n}${ext}`;
					if (n > 200) {
						this.clashes.add(path);
						this.options.notice(`${path} was written in the isolated folder, but no free name was left for it in ${folder}.`);
						break;
					}
				}
				if (this.clashes.has(path)) continue;
				mkdirSync(join(this.options.deck, folder), { recursive: true });
				writeFileSync(join(this.options.deck, into), readFileSync(join(dir, entry.name)));
				if (into !== path) {
					mkdirSync(dirname(join(this.dir, into)), { recursive: true });
					renameSync(join(dir, entry.name), join(this.dir, into));
				}
				this.remember(into);
				this.options.adopt(into);
			}
		}
	}
}
