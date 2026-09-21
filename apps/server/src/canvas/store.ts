import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { slug } from "../agents/slug.ts";

/**
 * Canvases: the thing that holds the boards.
 *
 * A canvas is a named arrangement — which boards are on it, where each one sits, the arrows
 * and groups drawn between them — and it belongs to the *deck*, not to a conversation. Two
 * agents working on the same thing are on the same canvas and see one arrangement; a board an
 * agent puts up is up for everybody there. What stays with the agent is what it has *read*
 * (`AgentRecord.context`), which is private to its transcript.
 *
 * **One file per canvas**, `.decks/canvases/<name>.json`, for the reason the agents' own
 * records are one file each: the whole file is rewritten every time a board is dragged, and a
 * single file for every canvas would mean two canvases writing over one another. The file name
 * is the canvas's name, so the folder is readable and a rename is a rename; the `id` inside it
 * never changes, and that is what an agent and a task store.
 *
 * **Places outlive membership.** `boards` is what is on the canvas; `places` remembers where a
 * board sat even after it is taken off, so hiding one and showing it again puts it back rather
 * than dropping it wherever the auto-layout has room. This is the pair that used to be
 * `AgentRecord.inPlay` and `AgentRecord.positions`, one per chat.
 *
 * No sizes: a board's width is in its own file and its height is measured in the browser, so a
 * copy here would go stale the first time a board grew.
 */

/** An arrow from one board to another, drawn on the canvas rather than inside a board. */
export interface CanvasLink {
	from: string;
	to: string;
	/** A word or two on the line. Absent is a plain arrow. */
	label?: string;
}

/** Boards fenced together with a dashed border, because they are one piece of work. */
export interface CanvasGroup {
	name: string;
	boards: string[];
}

export interface CanvasRecord {
	/** Stable for the canvas's life. The file name is not: it follows the name. */
	id: string;
	name: string;
	/** On the canvas, in the order they joined. */
	boards: string[];
	/** Where each board sits, including boards that have been taken off. */
	places: Record<string, { x: number; y: number }>;
	links: CanvasLink[];
	groups: CanvasGroup[];
	/** When a board on it was last written. Half of the changed mark. */
	changedAt: number;
	/** When you last opened it. The other half: newer than `changedAt` means nothing is new. */
	openedAt?: number;
}

/** The same cap a workspace had: a name read in a card and a tab, and elided in both past this. */
export const MAX_CANVAS_NAME = 40;

const VERSION = 1;

export class CanvasStore {
	/** By id, in the order they were read or made. */
	private canvases = new Map<string, CanvasRecord>();
	/** id -> the file it was read from, so a rename knows what to delete. */
	private files = new Map<string, string>();
	private loaded = false;

	constructor(
		private deckPath: string,
		private readonly warn: (text: string) => void = () => {},
	) {}

	/** A different deck is a different set of canvases. */
	setDeck(deckPath: string): void {
		this.deckPath = deckPath;
		this.canvases.clear();
		this.files.clear();
		this.loaded = false;
	}

	private dir(): string {
		return join(this.deckPath, ".decks", "canvases");
	}

	private load(): void {
		if (this.loaded) return;
		this.loaded = true;
		const dir = this.dir();
		if (!existsSync(dir)) return;
		let names: string[];
		try {
			names = readdirSync(dir).filter((name) => name.endsWith(".json"));
		} catch {
			return;
		}
		for (const name of names.sort()) {
			const file = join(dir, name);
			try {
				const record = validate(JSON.parse(readFileSync(file, "utf8")) as unknown, name);
				/*
				 * Two files claiming one id is a folder somebody copied a file inside. The first
				 * read wins and the second is left alone on disk: dropping it silently would be
				 * this store deciding which of two arrangements a person meant.
				 */
				if (this.canvases.has(record.id)) {
					this.warn(`Two canvases share the id ${record.id}; ${name} was not opened.`);
					continue;
				}
				this.canvases.set(record.id, record);
				this.files.set(record.id, file);
			} catch {
				this.warn(`${name} in .decks/canvases could not be read.`);
			}
		}
	}

	/** Every canvas, by name. */
	list(): CanvasRecord[] {
		this.load();
		return [...this.canvases.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	get(id: string | undefined): CanvasRecord | undefined {
		if (!id) return undefined;
		this.load();
		return this.canvases.get(id);
	}

	/** The canvas with this name, matched as a slug so "Political LLM" finds `political-llm`. */
	byName(name: string): CanvasRecord | undefined {
		this.load();
		const wanted = slug(name, MAX_CANVAS_NAME);
		if (!wanted) return undefined;
		return [...this.canvases.values()].find((canvas) => slug(canvas.name, MAX_CANVAS_NAME) === wanted);
	}

	/**
	 * A name no canvas has yet: `name`, else `name 2`, `name 3`…
	 *
	 * For a canvas that belongs to one chat. Six chats called "Agent" are six arrangements, and
	 * matching by name would fold them onto one canvas and lose five of them.
	 */
	freeName(name: string): string {
		const base = name.trim().slice(0, MAX_CANVAS_NAME - 4) || "Canvas";
		if (!this.byName(base)) return base;
		for (let n = 2; ; n += 1) if (!this.byName(`${base} ${n}`)) return `${base} ${n}`;
	}

	/** The canvas with this name, made if there is not one. */
	ensure(name: string): CanvasRecord {
		return this.byName(name) ?? this.create({ name });
	}

	create(options: { name: string; id?: string; boards?: string[]; places?: Record<string, { x: number; y: number }> }): CanvasRecord {
		this.load();
		const record: CanvasRecord = {
			id: options.id ?? `cv_${randomUUID().slice(0, 8)}`,
			name: options.name.trim().slice(0, MAX_CANVAS_NAME) || "Canvas",
			boards: [...(options.boards ?? [])],
			places: { ...(options.places ?? {}) },
			links: [],
			groups: [],
			changedAt: Date.now(),
		};
		this.canvases.set(record.id, record);
		this.save(record);
		return record;
	}

	rename(id: string, name: string): CanvasRecord | undefined {
		const record = this.get(id);
		const clean = name.trim().slice(0, MAX_CANVAS_NAME);
		if (!record || !clean || clean === record.name) return undefined;
		record.name = clean;
		this.save(record);
		return record;
	}

	remove(id: string): boolean {
		const record = this.get(id);
		if (!record) return false;
		this.canvases.delete(id);
		const file = this.files.get(id);
		this.files.delete(id);
		try {
			if (file && existsSync(file)) rmSync(file);
		} catch {
			/* a read-only deck keeps the file; the canvas is gone from this run either way */
		}
		return true;
	}

	/** What is on the canvas, in the order the boards joined. */
	boards(id: string): string[] {
		return [...(this.get(id)?.boards ?? [])];
	}

	/** Where the canvas has put its boards — including ones currently off it. */
	places(id: string): Record<string, { x: number; y: number }> {
		return { ...(this.get(id)?.places ?? {}) };
	}

	/**
	 * Set what is on the canvas.
	 *
	 * Places are left alone: a board taken off keeps the spot it had, which is what makes
	 * showing it again put it back where it was.
	 */
	setBoards(id: string, paths: string[]): CanvasRecord | undefined {
		const record = this.get(id);
		if (!record) return undefined;
		const wanted = paths.filter((path, index) => paths.indexOf(path) === index);
		if (wanted.length === record.boards.length && wanted.every((path, index) => record.boards[index] === path)) return undefined;
		record.boards = wanted;
		this.save(record);
		return record;
	}

	/** Move one board on this canvas. */
	place(id: string, path: string, x: number, y: number): CanvasRecord | undefined {
		const record = this.get(id);
		if (!record || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
		const at = { x: Math.round(x), y: Math.round(y) };
		const was = record.places[path];
		if (was && was.x === at.x && was.y === at.y) return undefined;
		record.places[path] = at;
		this.save(record);
		return record;
	}

	/** An arrow, and nothing added twice: one arrow per pair per direction. */
	link(id: string, from: string, to: string, label?: string): CanvasRecord | undefined {
		const record = this.get(id);
		if (!record || from === to || !from || !to) return undefined;
		const existing = record.links.find((link) => link.from === from && link.to === to);
		if (existing) {
			if ((existing.label ?? "") === (label ?? "")) return undefined;
			if (label) existing.label = label;
			else delete existing.label;
		} else {
			record.links.push({ from, to, ...(label ? { label } : {}) });
		}
		this.save(record);
		return record;
	}

	unlink(id: string, from: string, to: string): CanvasRecord | undefined {
		const record = this.get(id);
		if (!record) return undefined;
		const before = record.links.length;
		record.links = record.links.filter((link) => !(link.from === from && link.to === to));
		if (record.links.length === before) return undefined;
		this.save(record);
		return record;
	}

	/** A dashed fence round some boards. A group of fewer than two is not a group. */
	group(id: string, name: string, paths: string[]): CanvasRecord | undefined {
		const record = this.get(id);
		const clean = name.trim().slice(0, MAX_CANVAS_NAME);
		const boards = paths.filter((path, index) => paths.indexOf(path) === index);
		if (!record || !clean || boards.length < 2) return undefined;
		const existing = record.groups.find((group) => group.name === clean);
		if (existing) existing.boards = boards;
		else record.groups.push({ name: clean, boards });
		this.save(record);
		return record;
	}

	ungroup(id: string, name: string): CanvasRecord | undefined {
		const record = this.get(id);
		if (!record) return undefined;
		const before = record.groups.length;
		record.groups = record.groups.filter((group) => group.name !== name);
		if (record.groups.length === before) return undefined;
		this.save(record);
		return record;
	}

	/** A board on this canvas was written: the canvas is news until it is opened. */
	changed(id: string, at = Date.now()): CanvasRecord | undefined {
		const record = this.get(id);
		if (!record) return undefined;
		record.changedAt = at;
		this.save(record);
		return record;
	}

	/** You opened it: the mark clears, for this canvas only. */
	opened(id: string, at = Date.now()): CanvasRecord | undefined {
		const record = this.get(id);
		if (!record || (record.openedAt ?? 0) >= at) return undefined;
		record.openedAt = at;
		this.save(record);
		return record;
	}

	/** Every canvas holding this board, for "which canvas is this work on". */
	holding(path: string): CanvasRecord[] {
		return this.list().filter((canvas) => canvas.boards.includes(path));
	}

	/**
	 * A board left the deck: it leaves every canvas, with its arrows and its place.
	 *
	 * The board's *versions* stay on disk (`.decks/revisions`), as they do today — what goes
	 * is the arrangement, which means nothing without the file.
	 */
	boardRemoved(path: string): void {
		for (const record of this.list()) {
			const had = record.boards.includes(path) || record.places[path] !== undefined;
			if (!had) continue;
			record.boards = record.boards.filter((board) => board !== path);
			delete record.places[path];
			record.links = record.links.filter((link) => link.from !== path && link.to !== path);
			record.groups = record.groups
				.map((group) => ({ ...group, boards: group.boards.filter((board) => board !== path) }))
				.filter((group) => group.boards.length > 1);
			this.save(record);
		}
	}

	/** Write one canvas to its file, renaming the file when the name has moved. */
	private save(record: CanvasRecord): void {
		const wanted = join(this.dir(), `${slug(record.name, MAX_CANVAS_NAME) || record.id}.json`);
		const previous = this.files.get(record.id);
		try {
			mkdirSync(this.dir(), { recursive: true });
			const temporary = `${wanted}.tmp`;
			writeFileSync(temporary, `${JSON.stringify({ version: VERSION, ...record }, null, 2)}\n`);
			renameSync(temporary, wanted);
			if (previous && previous !== wanted && existsSync(previous)) rmSync(previous);
			this.files.set(record.id, wanted);
		} catch {
			/*
			 * A read-only deck, or a full disk. The canvas is still the canvas for this run —
			 * the same trade the agent store makes, for the same reason: losing the arrangement
			 * is not worth refusing to draw the boards.
			 */
		}
	}
}

/** Take only what is the right shape, and supply the rest. A hand-edited file is the normal case. */
function validate(raw: unknown, fileName: string): CanvasRecord {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not a canvas");
	const source = raw as Record<string, unknown>;
	const id = typeof source.id === "string" && source.id ? source.id : `cv_${slug(fileName.replace(/\.json$/, ""), MAX_CANVAS_NAME)}`;
	const name = typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, MAX_CANVAS_NAME) : fileName.replace(/\.json$/, "");
	const boards = strings(source.boards);
	const places: Record<string, { x: number; y: number }> = {};
	if (source.places && typeof source.places === "object" && !Array.isArray(source.places)) {
		for (const [path, value] of Object.entries(source.places as Record<string, unknown>)) {
			const at = value as { x?: unknown; y?: unknown } | null;
			const x = Number(at?.x);
			const y = Number(at?.y);
			// One unreadable entry costs that board its place, never the canvas its arrangement.
			if (path && Number.isFinite(x) && Number.isFinite(y)) places[path] = { x, y };
		}
	}
	const links: CanvasLink[] = [];
	if (Array.isArray(source.links)) {
		for (const value of source.links) {
			const link = value as { from?: unknown; to?: unknown; label?: unknown };
			if (typeof link?.from !== "string" || typeof link?.to !== "string" || !link.from || !link.to) continue;
			links.push({ from: link.from, to: link.to, ...(typeof link.label === "string" && link.label ? { label: link.label } : {}) });
		}
	}
	const groups: CanvasGroup[] = [];
	if (Array.isArray(source.groups)) {
		for (const value of source.groups) {
			const group = value as { name?: unknown; boards?: unknown };
			const boardsOf = strings(group?.boards);
			if (typeof group?.name !== "string" || !group.name || boardsOf.length < 2) continue;
			groups.push({ name: group.name.slice(0, MAX_CANVAS_NAME), boards: boardsOf });
		}
	}
	const changedAt = Number(source.changedAt);
	const openedAt = Number(source.openedAt);
	return {
		id,
		name,
		boards,
		places,
		links,
		groups,
		changedAt: Number.isFinite(changedAt) ? changedAt : Date.now(),
		...(Number.isFinite(openedAt) ? { openedAt } : {}),
	};
}

function strings(raw: unknown): string[] {
	return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
}
