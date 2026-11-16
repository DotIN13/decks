import { shortVariables } from "@decks/pen";
import { events, idsOf, layout, Refused, type Caller, type Infer, type Payload, type shapes } from "../../protocol/index.ts";
import { toDeckPath, type Change, type Deck, type DeckPath, type Kernel, type Stop } from "../kernel/types.ts";
import { PenCanvas, type Told } from "./doc.ts";
import { Kinds } from "./kinds.ts";

// Every drawing in the deck, kept in memory: each canvas's canvas.pen and
// its frames/*.pen. A change is written through the deck in order; a write
// from outside is read back in. A canvas's title is in its canvas.json.

const EMPTY = `${JSON.stringify({ version: "2.14", children: [] }, null, 2)}\n`;
export const emptyDrawing = (): string => EMPTY;
const enc = new TextEncoder(), dec = new TextDecoder();

/** mine: what this server wrote and has not yet heard back, oldest first; told: what item.changed said, last 500. */
type Kept = { doc: PenCanvas; canvas: string; file: DeckPath; mine: string[]; told: Payload<typeof events.itemChanged>[]; queue: Promise<unknown> };

/** How many item.changed a drawing keeps for a watcher catching up. */
const TOLD = 500;

export class CanvasStore {
	private kernel!: Kernel;
	private kinds = new Kinds();
	private drawings = new Map<DeckPath, Kept>();
	private titles = new Map<string, string>();
	private stop: Stop | undefined;
	clock: () => number = Date.now;

	// Binding to the kernel, loading, waiting for writes
	bind(kernel: Kernel): this {
		this.kernel = kernel;
		this.kinds = new Kinds(kernel.kinds);
		return this;
	}

	kindsOf(): Kinds {
		return this.kinds;
	}

	get deck(): Deck {
		return this.kernel.deck;
	}

	/** Read every canvas and frame, and listen for writes from outside. */
	async load(): Promise<Stop> {
		this.kernel.places((canvas, path) => this.places(canvas, path));
		for (const name of await this.names()) await this.open(name);
		this.stop = this.deck.watch((change) => void this.heard(change.path, change.kind, change.by));
		return () => this.stop?.();
	}

	/** Wait for every write to land. */
	async flush(): Promise<void> {
		await Promise.all([...this.drawings.values()].map((kept) => kept.queue));
	}

	// Names and titles
	/** Every canvas's name, own and shared, sorted. */
	list(): string[] {
		return [...this.titles.keys()].sort();
	}

	title(name: string): string {
		return this.titles.get(name) ?? name;
	}

	/** A canvas's name from its name or its title. */
	name(nameOrTitle: string): string {
		if (this.titles.has(nameOrTitle)) return nameOrTitle;
		const byTitle = [...this.titles].filter(([, title]) => title === nameOrTitle);
		if (byTitle.length === 1) return byTitle[0]![0];
		if (byTitle.length > 1) throw new Refused("conflict", `${byTitle.length} canvases are titled ${nameOrTitle}; name one by its folder.`, "canvas.list");
		throw new Refused("not_found", `There is no canvas called ${nameOrTitle}.`, "canvas.list");
	}

	async setTitle(name: string, title: string, by: Caller): Promise<void> {
		this.titles.set(name, title);
		await this.deck.write(this.metaFile(name), enc.encode(`${JSON.stringify({ title }, null, "\t")}\n`), by);
		this.kernel.events.emit(events.canvasChanged, { canvas: name, ids: [name], by: by.id, rev: 0 });
	}

	private metaFile(name: string): DeckPath {
		return toDeckPath(`${layout.canvasFolder(name)}/canvas.json`);
	}

	/** The Canvas shape the calls answer. */
	describe(name: string): Infer<typeof shapes.Canvas> {
		const doc = this.doc(name);
		const pen = doc.pen();
		const cards = doc.read({ depth: 0 }).filter((item) => item.type === "card").length;
		const steps = doc.steps();
		const shared = layout.sharedParts(name);
		return {
			name, title: this.title(name), open: [], cards, file: this.file(name), rev: doc.rev,
			...(pen.variables ? { variables: shortVariables(pen) } : {}), undo: steps.undo, redo: steps.redo,
			...(shared ? { shared: { owner: shared.owner, role: "edit" as const } } : {}),
		};
	}

	/** Kernel.places: whether a canvas places an item at a deck path; false for an unknown canvas. */
	places(canvas: string, path: string): boolean {
		try {
			return this.doc(this.name(canvas)).places(path);
		} catch {
			return false;
		}
	}

	/** canvas.drawing: the document as the file holds it, its revision, and where its paths are read from. */
	drawingOf(name: string): { doc: Record<string, unknown>; rev: number; base: string } {
		const doc = this.doc(name);
		return { doc: doc.pen() as unknown as Record<string, unknown>, rev: doc.rev, base: `/files/${layout.canvasFolder(name)}/` };
	}

	// Finding a drawing
	file(name: string): DeckPath {
		return toDeckPath(`${layout.canvasFolder(name)}/canvas.pen`);
	}

	frameFile(name: string, frame: string): DeckPath {
		const rel = frame.replace(/\.pen$/, "");
		if (!/^frames\/[A-Za-z0-9][\w.-]*(\/[A-Za-z0-9][\w.-]*)*$/.test(rel)) throw new Refused("invalid", `${frame} is not a frame's path: frames/<name>, as in frames/ui/button.`, "frame.list");
		return toDeckPath(`${layout.canvasFolder(name)}/${rel}.pen`);
	}

	doc(name: string): PenCanvas {
		return this.drawing(this.file(name)).doc;
	}

	/** A frame file's drawing: frames/<name> in a canvas's folder. */
	frame(name: string, frame: string): PenCanvas {
		return this.drawing(this.frameFile(name, frame)).doc;
	}

	frames(name: string): { path: string; doc: PenCanvas }[] {
		const prefix = `${layout.canvasFolder(name)}/`;
		return [...this.drawings.entries()].filter(([file, kept]) => kept.canvas === name && file !== this.file(name)).map(([file, kept]) => ({ path: file.slice(prefix.length).replace(/\.pen$/, ""), doc: kept.doc }));
	}

	private drawing(file: DeckPath): Kept {
		const kept = this.drawings.get(file);
		if (!kept) throw new Refused("not_found", `There is no drawing at ${file}.`, "frame.list");
		return kept;
	}

	// Opening and forgetting a drawing
	/** A new drawing file, written now. */
	async create(file: DeckPath, canvas: string, text: string, by: Caller): Promise<PenCanvas> {
		const kept = this.keep(file, canvas, text);
		kept.mine.push(text);
		await this.deck.write(file, enc.encode(text), by);
		return kept.doc;
	}

	/** Open a canvas newly made or found: its drawing, its frames, its title. */
	async open(name: string): Promise<void> {
		const folder = layout.canvasFolder(name);
		const meta = await this.text(this.metaFile(name));
		this.titles.set(name, readTitle(meta) ?? name);
		this.keep(this.file(name), name, (await this.text(this.file(name))) ?? EMPTY);
		for (const file of await this.penFiles(toDeckPath(`${folder}/frames`))) this.keep(file, name, (await this.text(file)) ?? EMPTY);
	}

	forget(name: string): void {
		this.titles.delete(name);
		for (const [file, kept] of this.drawings) if (kept.canvas === name) this.drawings.delete(file);
	}

	private keep(file: DeckPath, canvas: string, text: string): Kept {
		const kept: Kept = { canvas, file, mine: [], told: [], queue: Promise.resolve(), doc: undefined as never };
		kept.doc = new PenCanvas(canvas, text, this.kinds, (out, change, ids, by, told) => this.save(kept, out, change, ids, by, told), () => this.clock());
		this.drawings.set(file, kept);
		return kept;
	}

	// Writing a change, and hearing one from outside
	private save(kept: Kept, text: string, change: Change, ids: string[], by: Caller, told: Told): void {
		kept.mine.push(text);
		if (kept.mine.length > 20) kept.mine.shift();
		const announce = () => this.announce(kept, change, ids, told);
		kept.queue = kept.queue.then(() => this.deck.write(kept.file, enc.encode(text), by)).then(announce, () => undefined);
	}

	/** A change, told as item.changed once it is on disk. */
	private announce(kept: Kept, change: Change, ids: string[], told: Told): void {
		const payload = { canvas: kept.canvas, ids, by: change.by, rev: change.rev, base: change.rev - 1, edits: change.ops, pen: told.pen as never, ...(told.made ? { made: told.made } : {}) };
		kept.told.push(payload);
		if (kept.told.length > TOLD) kept.told.shift();
		this.kernel.events.emit(events.itemChanged, payload);
	}

	/** A watcher catching up: what item.changed said after since, oldest first, or missed when the log no longer reaches it. */
	replay(name: string, since: number): Payload<typeof events.itemChanged>[] | { missed: true } {
		const kept = this.drawing(this.file(this.name(name)));
		if (since === kept.doc.rev) return [];
		const first = kept.told[0];
		if (since > kept.doc.rev || !first || first.rev > since + 1) return { missed: true };
		return kept.told.filter((one) => one.rev > since);
	}

	private async heard(path: DeckPath, kind: "written" | "deleted", by: string): Promise<void> {
		const at = layout.canvasOfPath(path);
		if (at?.rest === "canvas.json" && kind === "written") return this.titleHeard(at.name, by);
		if (!at || kind === "deleted" || !path.endsWith(".pen")) return;
		const text = await this.text(path);
		const kept = this.drawings.get(path);
		if (text === undefined) return;
		const echo = kept ? kept.mine.indexOf(text) : -1;
		if (kept && echo >= 0) return void kept.mine.splice(0, echo + 1);
		let read: ReturnType<PenCanvas["reload"]>;
		try {
			read = kept?.doc.reload(text, by);
		} catch {
			return;
		}
		if (read) this.announce(kept!, read.change, read.change.ops.flatMap(idsOf), { pen: read.pen });
		if (kept) return;
		if (at.rest === "canvas.pen" || at.rest.startsWith("frames/")) {
			if (!this.titles.has(at.name)) this.titles.set(at.name, readTitle(await this.text(this.metaFile(at.name))) ?? at.name);
			this.keep(path, at.name, text);
		}
	}

	/** A canvas.json written by someone else: its title, told as canvas.changed when it differs. */
	private async titleHeard(name: string, by: string): Promise<void> {
		if (!this.titles.has(name)) return;
		const title = readTitle(await this.text(this.metaFile(name))) ?? name;
		if (title === this.titles.get(name)) return;
		this.titles.set(name, title);
		this.kernel.events.emit(events.canvasChanged, { canvas: name, ids: [name], by, rev: 0 });
	}

	// History: a drawing's versions, from the deck's record of its file
	/** canvas.pen's revisions, newest first. */
	async versions(name: string): Promise<{ rev: number; by: string; at: number; items: number }[]> {
		const revs = (await this.history().revisions!(this.file(name))) ?? [];
		return revs.map(({ rev, by, at }) => ({ rev, by, at, items: 0 })).reverse();
	}

	/** canvas.pen's text at one revision of the deck. */
	async version(name: string, rev: number): Promise<string> {
		return dec.decode(await this.history().readAt!(this.file(name), rev));
	}

	/** The drawing as it was at rev, read in now and written as a new change. */
	async restore(name: string, rev: number, by: Caller): Promise<void> {
		const text = await this.version(name, rev);
		const kept = this.drawing(this.file(name));
		const read = kept.doc.reload(text, by.id);
		if (!read) return;
		kept.mine.push(text);
		kept.queue = kept.queue.then(() => this.deck.write(kept.file, enc.encode(text), by)).then(() => this.announce(kept, read.change, read.change.ops.flatMap(idsOf), { pen: read.pen }), () => undefined);
		await kept.queue;
	}

	private history(): Deck {
		if (!this.deck.revisions || !this.deck.readAt) throw new Refused("unavailable", "This server keeps no history of its files.", "canvas.get");
		return this.deck;
	}

	// Reading the deck
	private async names(): Promise<string[]> {
		const own = (await this.dirs(toDeckPath(layout.CANVASES))).map((dir) => dir.split("/").pop()!);
		const shared: string[] = [];
		for (const owner of await this.dirs(toDeckPath(layout.SHARED_CANVASES))) {
			for (const dir of await this.dirs(owner)) shared.push(layout.sharedName(owner.split("/").pop()!, dir.split("/").pop()!));
		}
		return [...own, ...shared];
	}

	private async dirs(path: DeckPath): Promise<DeckPath[]> {
		try {
			return (await this.deck.list(path)).filter((e) => e.kind === "dir").map((e) => e.path);
		} catch {
			return [];
		}
	}

	private async penFiles(path: DeckPath): Promise<DeckPath[]> {
		let entries;
		try { entries = await this.deck.list(path); } catch { return []; }
		const out: DeckPath[] = [];
		for (const e of entries) {
			if (e.kind === "dir") out.push(...(await this.penFiles(e.path)));
			else if (e.path.endsWith(".pen")) out.push(e.path);
		}
		return out;
	}

	async text(path: DeckPath): Promise<string | undefined> {
		try {
			return dec.decode(await this.deck.read(path));
		} catch {
			return undefined;
		}
	}
}

function readTitle(meta: string | undefined): string | undefined {
	if (!meta) return undefined;
	try {
		const title = (JSON.parse(meta) as { title?: unknown }).title;
		return typeof title === "string" && title ? title : undefined;
	} catch {
		return undefined;
	}
}
