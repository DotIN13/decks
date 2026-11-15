import { shortVariables } from "@decks/pen";
import { events, layout, Refused, type Caller, type Infer, type shapes } from "../../protocol/index.ts";
import { toDeckPath, type Change, type Deck, type DeckPath, type Kernel, type Stop } from "../kernel/types.ts";
import { PenCanvas } from "./doc.ts";
import { Kinds } from "./kinds.ts";

// Every drawing in the deck, kept in memory: each canvas's canvas.pen and
// its frames/*.pen. A change is written through the deck in order; a write
// from outside is read back in. A canvas's title is in its canvas.json.

const EMPTY = `${JSON.stringify({ version: "2.14", children: [] }, null, 2)}\n`;
const SERVER: Caller = { kind: "person", id: "server", name: "Decks" };
const enc = new TextEncoder(), dec = new TextDecoder();

type Kept = { doc: PenCanvas; canvas: string; file: DeckPath; mine: string[]; queue: Promise<unknown> };

export class CanvasStore {
	private kernel!: Kernel;
	private kinds = new Kinds();
	private drawings = new Map<DeckPath, Kept>();
	private titles = new Map<string, string>();
	private stop: Stop | undefined;
	clock: () => number = Date.now;

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
		for (const name of await this.names()) await this.open(name);
		this.stop = this.deck.watch((change) => void this.heard(change.path, change.kind, change.by));
		return () => this.stop?.();
	}

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

	doc(name: string): PenCanvas {
		return this.drawing(this.file(name)).doc;
	}

	/** A frame file's drawing: frames/<name> in a canvas's folder. */
	frame(name: string, frame: string): PenCanvas {
		return this.drawing(this.frameFile(name, frame)).doc;
	}

	frameFile(name: string, frame: string): DeckPath {
		const rel = frame.replace(/\.pen$/, "");
		if (!/^frames\/[A-Za-z0-9][\w.-]*(\/[A-Za-z0-9][\w.-]*)*$/.test(rel)) throw new Refused("invalid", `${frame} is not a frame's path: frames/<name>, as in frames/ui/button.`, "frame.list");
		return toDeckPath(`${layout.canvasFolder(name)}/${rel}.pen`);
	}

	frames(name: string): { path: string; doc: PenCanvas }[] {
		const prefix = `${layout.canvasFolder(name)}/`;
		return [...this.drawings.entries()].filter(([file, kept]) => kept.canvas === name && file !== this.file(name)).map(([file, kept]) => ({ path: file.slice(prefix.length).replace(/\.pen$/, ""), doc: kept.doc }));
	}

	file(name: string): DeckPath {
		return toDeckPath(`${layout.canvasFolder(name)}/canvas.pen`);
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

	/** A new drawing file, written now. */
	async create(file: DeckPath, canvas: string, text: string, by: Caller): Promise<PenCanvas> {
		const kept = this.keep(file, canvas, text);
		kept.mine.push(text);
		await this.deck.write(file, enc.encode(text), by);
		return kept.doc;
	}

	async setTitle(name: string, title: string, by: Caller): Promise<void> {
		await this.deck.write(toDeckPath(`${layout.canvasFolder(name)}/canvas.json`), enc.encode(`${JSON.stringify({ title }, null, "\t")}\n`), by);
		this.titles.set(name, title);
		this.kernel.events.emit(events.canvasChanged, { canvas: name, ids: [name], by: by.id, rev: 0 });
	}

	/** Open a canvas newly made or found: its drawing, its frames, its title. */
	async open(name: string): Promise<void> {
		const folder = layout.canvasFolder(name);
		const meta = await this.text(toDeckPath(`${folder}/canvas.json`));
		this.titles.set(name, readTitle(meta) ?? name);
		this.keep(this.file(name), name, (await this.text(this.file(name))) ?? EMPTY);
		for (const file of await this.penFiles(toDeckPath(`${folder}/frames`))) this.keep(file, name, (await this.text(file)) ?? EMPTY);
	}

	forget(name: string): void {
		this.titles.delete(name);
		for (const [file, kept] of this.drawings) if (kept.canvas === name) this.drawings.delete(file);
	}

	/** Wait for every write to land. */
	async flush(): Promise<void> {
		await Promise.all([...this.drawings.values()].map((kept) => kept.queue));
	}

	private drawing(file: DeckPath): Kept {
		const kept = this.drawings.get(file);
		if (!kept) throw new Refused("not_found", `There is no drawing at ${file}.`, "frame.list");
		return kept;
	}

	private keep(file: DeckPath, canvas: string, text: string): Kept {
		const kept: Kept = { canvas, file, mine: [], queue: Promise.resolve(), doc: undefined as never };
		kept.doc = new PenCanvas(canvas, text, this.kinds, (out, change, ids, by) => this.save(kept, out, change, ids, by), () => this.clock());
		this.drawings.set(file, kept);
		return kept;
	}

	private save(kept: Kept, text: string, change: Change, ids: string[], by: Caller): void {
		kept.mine.push(text);
		if (kept.mine.length > 20) kept.mine.shift();
		const announce = () => this.kernel.events.emit(events.itemChanged, { canvas: kept.canvas, ids, by: change.by, rev: change.rev, base: change.rev - 1, edits: change.ops });
		kept.queue = kept.queue.then(() => this.deck.write(kept.file, enc.encode(text), by)).then(announce, () => undefined);
	}

	private async heard(path: DeckPath, kind: "written" | "deleted", by: string): Promise<void> {
		const at = layout.canvasOfPath(path);
		if (!at || kind === "deleted" || !path.endsWith(".pen")) return;
		const text = await this.text(path);
		const kept = this.drawings.get(path);
		if (text === undefined || kept?.mine.includes(text)) return;
		let change: Change | undefined;
		try {
			change = kept?.doc.reload(text, by);
		} catch {
			return;
		}
		if (change) this.kernel.events.emit(events.itemChanged, { canvas: kept!.canvas, ids: idsOf(change.ops), by, rev: change.rev, base: change.rev - 1, edits: change.ops });
		if (kept) return;
		if (at.rest === "canvas.pen" || at.rest.startsWith("frames/")) {
			if (!this.titles.has(at.name)) this.titles.set(at.name, at.name);
			this.keep(path, at.name, text);
		}
	}

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

export const emptyDrawing = (): string => EMPTY;
export const server = SERVER;

function readTitle(meta: string | undefined): string | undefined {
	if (!meta) return undefined;
	try {
		const title = (JSON.parse(meta) as { title?: unknown }).title;
		return typeof title === "string" && title ? title : undefined;
	} catch {
		return undefined;
	}
}

const idsOf = (ops: Change["ops"]): string[] => ops.flatMap((o) => (o.op === "insert" ? [String(o.item.id)] : o.op === "variables" ? [] : [o.id]));
