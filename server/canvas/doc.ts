import { baseTheme, parse, PenError, read as penRead, themeFrom, type PenDocument, type PenNode } from "@decks/pen";
import { Refused, type Caller } from "../../protocol/index.ts";
import type { CanvasDoc, Change, Item, ItemOp, ItemQuery } from "../kernel/types.ts";
import type { Kinds } from "./kinds.ts";
import { Log, opsBetween } from "./log.ts";
import { findId as findIn, routeArrows, step } from "./ops.ts";
import { sourceOf, writeLike, type Source } from "./spans.ts";

// One drawing in memory: read, changed only by apply (all or none), and
// written back through `saved` so untouched items keep their bytes.

export type Saved = (text: string, change: Change, ids: string[], by: Caller) => void;
export type ReadOptions = ItemQuery & { resolve?: { variables?: boolean; instances?: boolean; geometry?: boolean }; theme?: Record<string, string> };

export class PenCanvas implements CanvasDoc {
	private doc: PenDocument;
	private source: Source | undefined;
	private log = new Log();
	rev = 0;

	constructor(readonly name: string, text: string, private kinds: Kinds, private saved: Saved, private clock: () => number = Date.now) {
		this.doc = parseOrRefuse(text, name);
		this.source = sourceOf(text);
	}

	/** The drawing as pen.dev keeps it, a copy. */
	pen(): PenDocument {
		return structuredClone(this.doc);
	}

	read(query: ReadOptions = {}): Item[] {
		const theme = query.theme ? themeFrom(this.doc, query.theme) : baseTheme(this.doc, "light");
		const options = { theme, ...(query.depth !== undefined ? { depth: query.depth } : {}), ...(query.resolve ? { resolve: query.resolve } : {}) };
		try {
			if (!query.ids) return this.items(penRead(this.doc, options).children);
			return query.ids.flatMap((ref) => this.items(penRead(this.doc, { ...options, of: this.idOf(ref) }).children));
		} catch (error) {
			throw new Refused(error instanceof Refused ? error.code : "invalid", error instanceof Error ? error.message : String(error), "item.list");
		}
	}

	/** An id from an id or a card's path; refused when nothing has it. */
	idOf(ref: string): string {
		const where = { canvas: this.name, kinds: this.kinds };
		const found = findIn(this.doc, ref, where);
		if (!found) throw new Refused("not_found", `Nothing called ${ref} is on ${this.name}.`, "item.list");
		return found;
	}

	apply(ops: ItemOp[], by: Caller): { items: Item[]; rev: number } {
		if (!Array.isArray(ops) || !ops.length) throw new Refused("invalid", "Give at least one op.", "item.batch");
		let work = this.doc;
		const written: ItemOp[] = [];
		const ids: string[] = [];
		ops.forEach((op, i) => {
			try {
				const done = step(work, op, { canvas: this.name, kinds: this.kinds });
				work = done.doc;
				written.push(done.op);
				if (done.id) ids.push(done.id);
			} catch (error) {
				throw failed(error, i, op);
			}
		});
		ids.push(...routeArrows(work, this.name));
		const before = this.doc;
		this.commit(work, written, by, ids);
		if (by.kind === "person") this.log.edited(before, work);
		const kept = [...new Set(ids)].filter((id) => findIn(this.doc, id, { canvas: this.name, kinds: this.kinds }));
		return { items: kept.flatMap((id) => this.read({ ids: [id] })), rev: this.rev };
	}

	since(rev: number): Change[] {
		return this.log.since(rev);
	}

	steps(): { undo: boolean; redo: boolean } {
		return this.log.can();
	}

	/** Take back the person's last edit, or put it back. */
	undo(by: Caller, redo = false): number {
		const taken = this.log.take(redo);
		const ops = opsBetween(this.doc, taken.doc);
		this.commit(taken.doc, ops, by, ops.flatMap((o) => (o.op === "insert" ? [String(o.item.id)] : o.op === "variables" ? [] : [o.id])), true);
		taken.done();
		return this.rev;
	}

	/** The file changed from outside: take it in as one change by whoever wrote it. */
	reload(text: string, by: string): Change | undefined {
		if (this.source?.text === text) return undefined;
		const next = parseOrRefuse(text, this.name);
		const ops = opsBetween(this.doc, next);
		this.source = sourceOf(text);
		this.doc = next;
		this.rev++;
		const change = { rev: this.rev, ops, by, at: this.clock() };
		this.log.add(change, false);
		return change;
	}

	private commit(next: PenDocument, ops: ItemOp[], by: Caller, ids: string[], own = by.kind === "person"): void {
		this.doc = next;
		this.rev++;
		const change: Change = { rev: this.rev, ops, by: by.id, at: this.clock() };
		this.log.add(change, own || by.kind === "card");
		const text = writeLike(this.source, next as unknown as Record<string, unknown>);
		this.source = sourceOf(text);
		this.saved(text, change, [...new Set(ids)], by);
	}

	private items(nodes: PenNode[]): Item[] {
		return nodes.map((node) => {
			const item = this.kinds.toItem(node, this.name);
			if (item !== (node as Item)) return { ...item, box: (node as Item).box };
			const kids = (node as { children?: PenNode[] }).children;
			return Array.isArray(kids) ? { ...item, children: this.items(kids) } : item;
		});
	}
}

function parseOrRefuse(text: string, name: string): PenDocument {
	try {
		return parse(text);
	} catch (error) {
		throw new Refused("invalid", `${name}'s drawing cannot be read: ${(error as Error).message}`, "file.read");
	}
}

function failed(error: unknown, i: number, op: ItemOp): Refused {
	const raw = error instanceof Error ? error.message : String(error);
	const why = raw.replace(/^Edit \d+ \(\w+\) failed, and nothing was saved: /, "");
	const code = error instanceof Refused ? error.code : error instanceof PenError ? "invalid" : "invalid";
	const hint = error instanceof Refused ? error.hint : "item.batch";
	return new Refused(code, `Op ${i + 1} (${(op as { op?: string })?.op ?? "?"}) failed, so nothing changed: ${why}`, hint);
}
