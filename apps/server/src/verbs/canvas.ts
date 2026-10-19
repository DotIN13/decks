import { apply, ARROW, baseTheme, ids, placements, walk, type Op, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import { canvasFile } from "../stage/canvas-files.ts";
import { markIsolated } from "../stage/isolated-stages.ts";
import { BOARD_ITEM, boardOf } from "../stage/pens.ts";
import { serverText } from "../stage/text.ts";
import { slug } from "../agents/slug.ts";
import type { ShotFormat, ShotOf } from "../stage/shots.ts";
import { fitOn } from "./boards.ts";
import { shootOn } from "./stage.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/**
 * The canvas calls: everything on one canvas, boards included, read and changed as items.
 *
 * A board on a canvas is pen's own `browser` item tagged `{ type: "decks.board", path }`
 * (`stage/pens.ts`); here it reads and is written as `{ type: "board", board: <path>, width? }`,
 * and anywhere an item's id is taken a board's path is taken too. Every call names its canvas or
 * means `decks.here()`; none changes which canvas anybody is on. Every change is one edit of the
 * canvas's file, all of a batch or none of it.
 */

/** How far clear of another item `beside` and `below` put one. */
export const GAP = 160;

type Corner = { x1: number; y1: number } | { x: number; y: number };
type ItemIn = { type: string; [key: string]: unknown };
export type CanvasOpIn =
	| { op: "insert"; item: ItemIn; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }
	| { op: "update"; id: string; set?: Record<string, unknown>; at?: Corner; size?: { w?: number; h?: number } }
	| { op: "replace"; id: string; item: ItemIn }
	| { op: "delete"; id: string }
	| { op: "move"; id: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }
	| { op: "copy"; id: string; as?: string; at?: Corner; parent?: string | null }
	| { op: "variables"; set: Record<string, unknown>; themes?: Record<string, string[]> | null };

/** A pen item as a caller reads it: a board as `{ type: "board", board }`, everything else as pen has it. */
export function toItem(node: Record<string, unknown>): Record<string, unknown> {
	const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]).map(toItem) : undefined;
	const path = boardOf(node as unknown as PenNode);
	if (path) {
		const { type: _type, url: _url, metadata: _metadata, name, children: _children, ...rest } = node;
		return { type: "board", ...rest, board: path, ...(typeof name === "string" ? { title: name } : {}), ...(children ? { children } : {}) };
	}
	return { ...node, ...(children ? { children } : {}) };
}

/** The corner a caller gave, `{ x1, y1 }` or `{ x, y }`, as two numbers. */
function cornerOf(at: unknown): { x1: number; y1: number } | undefined {
	if (at === undefined || at === null) return undefined;
	const raw = at as { x1?: unknown; y1?: unknown; x?: unknown; y?: unknown };
	const x = raw.x1 ?? raw.x;
	const y = raw.y1 ?? raw.y;
	if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("at is a top-left corner on the canvas, as in at: { x1: 1160, y1: 0 }.");
	return { x1: Math.round(x), y1: Math.round(y) };
}

/** The box `beside` or `below` an item's box: 160 px clear, tops (beside) or lefts (below) aligned. */
export function placeBy(box: { x: number; y: number; w: number; h: number }, how: "beside" | "below"): { x1: number; y1: number } {
	return how === "beside" ? { x1: Math.round(box.x + box.w + GAP), y1: Math.round(box.y) } : { x1: Math.round(box.x), y1: Math.round(box.y + box.h + GAP) };
}

export function canvasVerbs(ctx: VerbContext): Pick<Stage, "canvas"> {
	const { service, agent, notes, needPens, canvasOf, canvasRow, byName, isolated } = ctx;
	const measure = serverText.measure;

	/** Lay a document out as the canvas would: what `beside` and every answered box are measured on. */
	const layoutOf = (name: string, doc: PenDocument): Map<string, Placed> => placements(needPens().withImported(name, doc), { theme: baseTheme(doc, "light"), measure });

	/** An item's id, or a board's path on this document turned into its item's id. */
	const idIn = (doc: PenDocument, ref: unknown, what = "id"): string => {
		if (typeof ref !== "string" || !ref.trim()) throw new Error(`${what} names an item: its id from decks canvas read, or a board's path.`);
		for (const node of walk(doc.children)) if (boardOf(node) === ref) return node.id;
		return ref;
	};

	/** A caller's item as pen's: a board becomes its `browser` item, sized as its file says unless told. */
	const fromItem = (raw: unknown, taken: Set<string>): Record<string, unknown> => {
		if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") throw new Error('An item has a type: { type: "note", content: "…" }, or { type: "board", board: "boards/plan.html" }.');
		const item = raw as Record<string, unknown>;
		const { box: _box, children: kids, ...rest } = item;
		const children = Array.isArray(kids) ? kids.map((one) => fromItem(one, taken)) : undefined;
		if (item.type !== "board") return { ...rest, ...(children ? { children } : {}) };
		const { type: _type, board, title: _title, ...own } = rest as Record<string, unknown>;
		if (typeof board !== "string" || !board) throw new Error('A board item names its file: { type: "board", board: "boards/plan.html" }.');
		const file = service.fileBoard(board);
		if (!file) throw new Error(`There is no board ${board} in the deck. decks board create makes one; decks board list lists them.`);
		let id = typeof own.id === "string" && own.id ? own.id : undefined;
		if (!id) {
			const base = slug(board.replace(/^boards\//, "").replace(/\.[^.]+$/, ""), 40) || "board";
			id = base;
			for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
		}
		taken.add(id);
		return { ...own, id, type: "browser", name: file.title, url: `../../${board}`, width: own.width ?? file.w, height: own.height ?? file.h, metadata: { type: BOARD_ITEM, path: board }, ...(children ? { children } : {}) };
	};

	/** Where an op puts its item: a corner, or beside or below another item on the document as it is now. */
	const placeOf = (doc: PenDocument, placed: Map<string, Placed>, op: { at?: unknown; beside?: string; below?: string }): { x1: number; y1: number } | undefined => {
		const given = [op.at !== undefined && op.at !== null, !!op.beside, !!op.below].filter(Boolean).length;
		if (given > 1) throw new Error("Say one place: at, beside or below.");
		const ref = op.beside ?? op.below;
		if (ref) {
			const id = idIn(doc, ref, op.beside ? "beside" : "below");
			const box = placed.get(id)?.box;
			if (!box) throw new Error(`Nothing called ${ref} is on this canvas to go ${op.beside ? "beside" : "below"}: decks canvas read lists what is.`);
			return placeBy(box, op.beside ? "beside" : "below");
		}
		return cornerOf(op.at);
	};

	/**
	 * Turn the caller's ops into pen's, one at a time against the document as the earlier ones left it,
	 * so a later op can be beside an item an earlier one made. Nothing is written here.
	 */
	const translate = (name: string, ops: readonly CanvasOpIn[]): { penOps: Op[]; sized: Array<{ path: string; w?: number; h?: number }>; deleted: Set<string>; placedFor: string[] } => {
		const pens = needPens();
		const entry = pens.get(name);
		if (entry.error) throw new Error(`${entry.error}. Fix the file, or replace it whole, before editing it.`);
		let doc = entry.doc;
		const theme = baseTheme(doc, "light");
		const penOps: Op[] = [];
		const sized: Array<{ path: string; w?: number; h?: number }> = [];
		const deleted = new Set<string>();
		const placedFor: string[] = [];
		if (!Array.isArray(ops) || ops.length === 0) throw new Error('A batch is a list of ops: [{ op: "insert", item: { type: "note", content: "…" } }].');
		ops.forEach((op, index) => {
			const where = ops.length > 1 ? `Op ${index + 1} (${op?.op ?? "?"}): ` : "";
			try {
				const placed = layoutOf(name, doc);
				let pen: Op;
				switch (op?.op) {
					case "insert": {
						const node = fromItem(op.item, ids(doc));
						const path = boardOf(node as unknown as PenNode);
						if (path) {
							const there = [...walk(doc.children)].find((one) => boardOf(one) === path);
							if (there) throw new Error(`${path} is already on this canvas, as ${there.id}: move it with decks canvas move.`);
						}
						let box = placeOf(doc, placed, op);
						if (!box && (op.parent === undefined || op.parent === null)) {
							// Nowhere said: beside the newest thing on the canvas, and the caller is told so.
							const newest = [...doc.children].reverse().find((one) => one.metadata?.type !== ARROW && placed.get(one.id));
							box = newest ? placeBy(placed.get(newest.id)!.box, "beside") : { x1: 0, y1: 0 };
							placedFor.push(`${path ?? (typeof node.id === "string" ? node.id : "the new item")} went ${newest ? `beside ${boardOf(newest) ?? newest.id}` : "at the canvas's corner"}, at x1 ${box.x1}, y1 ${box.y1}: say where with at, beside or below.`);
						}
						pen = { op: "insert", node: node as Op extends { node: infer N } ? N : never, ...(op.parent !== undefined ? { parent: op.parent } : {}), ...(op.index !== undefined ? { index: op.index } : {}), ...(box ? { box } : {}) } as Op;
						break;
					}
					case "update": {
						const id = idIn(doc, op.id);
						const node = [...walk(doc.children)].find((one) => one.id === id);
						const path = node ? boardOf(node) : undefined;
						const set: Record<string, unknown> = { ...(op.set ?? {}) };
						if (path && typeof set.board === "string") {
							const file = service.fileBoard(set.board);
							if (!file) throw new Error(`There is no board ${set.board} in the deck.`);
							set.url = `../../${set.board}`;
							set.metadata = { ...(node?.metadata ?? {}), type: BOARD_ITEM, path: set.board };
							set.name = file.title;
							delete set.board;
						}
						if (op.size) {
							const round = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined);
							const w = round(op.size.w);
							const h = round(op.size.h);
							if (w === undefined && h === undefined) throw new Error("size is a width, a height or both, as numbers: { w: 1000, h: 700 }.");
							if (w !== undefined) set.width = w;
							if (h !== undefined) set.height = h;
							if (path) sized.push({ path, ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) });
						}
						const box = cornerOf(op.at);
						pen = { op: "update", id, set, ...(box ? { box } : {}) };
						break;
					}
					case "replace": {
						const id = idIn(doc, op.id);
						const taken = ids(doc);
						taken.delete(id);
						const node = fromItem({ ...op.item, id }, taken);
						pen = { op: "replace", id, node: node as never };
						break;
					}
					case "delete": {
						const id = idIn(doc, op.id);
						deleted.add(id);
						pen = { op: "delete", id };
						break;
					}
					case "move": {
						const id = idIn(doc, op.id);
						const box = placeOf(doc, placed, op);
						pen = { op: "move", id, ...(op.parent !== undefined ? { parent: op.parent === null ? null : idIn(doc, op.parent, "parent") } : {}), ...(op.index !== undefined ? { index: op.index } : {}), ...(box ? { box } : {}) };
						break;
					}
					case "copy": {
						const id = idIn(doc, op.id);
						const node = [...walk(doc.children)].find((one) => one.id === id);
						if (node && boardOf(node)) throw new Error(`${op.id} is a board, and a canvas holds a board once: make another board, or copy its file.`);
						const box = cornerOf(op.at);
						pen = { op: "copy", id, ...(op.as !== undefined ? { as: op.as } : {}), ...(op.parent !== undefined ? { parent: op.parent } : {}), ...(box ? { box } : {}) };
						break;
					}
					case "variables":
						pen = { op: "variables", set: op.set as never, ...(op.themes !== undefined ? { themes: op.themes } : {}) };
						break;
					default:
						throw new Error(`there is no op "${(op as { op?: unknown })?.op}": insert, update, replace, delete, move, copy or variables.`);
				}
				doc = apply(doc, [pen], { theme, measure }).doc;
				penOps.push(pen);
			} catch (error) {
				throw new Error(`${where}${error instanceof Error ? error.message : String(error)}${ops.length > 1 ? " Nothing was changed." : ""}`);
			}
		});
		return { penOps, sized, deleted, placedFor };
	};

	/**
	 * Apply ops to a canvas, all or nothing, and answer with each item as it now is.
	 * The canvas first, then a board's file when a board was sized, as a person's resize does.
	 */
	const change = (name: string, ops: readonly CanvasOpIn[]): Array<Record<string, unknown>> => {
		const pens = needPens();
		const { penOps, sized, deleted, placedFor } = translate(name, ops);
		service.watches?.writing(name, byName());
		const { entry, results } = pens.edit(name, penOps, undefined, agent.person ? { undoable: true } : undefined);
		notes.push(...placedFor);
		for (const result of results) if (result.note) notes.push(result.note);
		for (const one of sized) {
			const file = service.fileBoard(one.path);
			if (!file || file.fills) continue;
			if (file.format === "slides") {
				if (one.w !== undefined) service.resize(one.path, { w: one.w });
			} else service.resize(one.path, { ...(one.w !== undefined ? { w: one.w } : {}), ...(one.h !== undefined ? { h: one.h } : {}) });
			if (agent.person) service.wrote(one.path, "you");
		}
		const read = pens.read(name);
		const byId = new Map<string, Record<string, unknown>>();
		const index = (list: readonly Record<string, unknown>[]) => {
			for (const node of list) {
				if (typeof node.id === "string") byId.set(node.id, node);
				if (Array.isArray(node.children)) index(node.children as Record<string, unknown>[]);
			}
		};
		index(read.children as unknown as Record<string, unknown>[]);
		const drawn: string[] = [];
		const boxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
		const answer = results.map((result) => {
			if (result.op === "delete" || deleted.has(result.id)) return { type: "deleted", id: result.id };
			if (result.op === "variables") return { type: "variables", id: result.id, variables: entry.doc.variables ?? {} };
			const node = byId.get(result.id);
			if (!node) return { type: "unknown", id: result.id };
			const item = toItem(node);
			const box = node.box as { x1: number; y1: number; x2: number; y2: number } | undefined;
			if (item.type === "board") agent.acted?.(result.op === "insert" ? "show" : "move", item.board as string);
			else if (box) {
				drawn.push(result.id);
				boxes.push(box);
			}
			return item;
		});
		if (drawn.length) agent.drew?.(name, drawn, boxes);
		return answer;
	};
	const one = (name: string, op: CanvasOpIn) => change(name, [op])[0]!;

	return {
		canvas: {
			read: async (options?: { canvas?: string }) => {
				const name = canvasOf(options?.canvas);
				const pens = needPens();
				const { stage: _stage, file: _file, children, ...rest } = pens.read(name);
				return { canvas: name, title: pens.titleOf(name), rev: pens.get(name).rev, ...rest, items: (children as unknown as Record<string, unknown>[]).map(toItem) } as never;
			},
			insert: async (item: ItemIn, options?: { canvas?: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }) => {
				const { canvas, ...place } = options ?? {};
				return one(canvasOf(canvas), { op: "insert", item, ...place }) as never;
			},
			update: async (id: string, changeOf: { set?: Record<string, unknown>; at?: Corner; size?: { w?: number; h?: number } }, options?: { canvas?: string }) =>
				one(canvasOf(options?.canvas), { op: "update", id, ...(changeOf ?? {}) }) as never,
			replace: async (id: string, item: ItemIn, options?: { canvas?: string }) => one(canvasOf(options?.canvas), { op: "replace", id, item }) as never,
			delete: async (id: string, options?: { canvas?: string }) => {
				const name = canvasOf(options?.canvas);
				one(name, { op: "delete", id });
				return { deleted: id };
			},
			move: async (id: string, options?: { canvas?: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }) => {
				const { canvas, ...place } = options ?? {};
				return one(canvasOf(canvas), { op: "move", id, ...place }) as never;
			},
			copy: async (id: string, options?: { canvas?: string; as?: string; at?: Corner; parent?: string | null }) => {
				const { canvas, ...rest } = options ?? {};
				return one(canvasOf(canvas), { op: "copy", id, ...rest }) as never;
			},
			variables: async (set: Record<string, unknown>, options?: { canvas?: string; themes?: Record<string, string[]> | null }) => {
				const name = canvasOf(options?.canvas);
				one(name, { op: "variables", set, ...(options?.themes !== undefined ? { themes: options.themes } : {}) });
				const doc = needPens().get(name).doc;
				return { variables: (doc.variables ?? {}) as Record<string, unknown>, ...(doc.themes ? { themes: doc.themes as Record<string, unknown> } : {}) };
			},
			batch: async (ops: readonly CanvasOpIn[], options?: { canvas?: string }) => change(canvasOf(options?.canvas), ops) as never,
			fit: async (board: string, options?: { canvas?: string; margin?: number }) => {
				const name = canvasOf(options?.canvas);
				const { board: sized, canvas, said } = await fitOn(ctx, board, name, options?.margin);
				return { board: sized.path, canvas, w: sized.w, h: sized.h, notes: said };
			},
			save: async (id: string, frame: string, options?: { canvas?: string; replace?: boolean }) => {
				const name = canvasOf(options?.canvas);
				const pens = needPens();
				const entry = pens.get(name);
				service.watches?.writing(name, byName());
				return pens.saveFrame(name, idIn(entry.doc, id), frame, options?.replace !== false);
			},
			screenshot: async (options?: { canvas?: string; of?: ShotOf; scale?: number; format?: ShotFormat; to?: string; scheme?: "light" | "dark" }) => {
				const { canvas, ...rest } = options ?? {};
				return shootOn(ctx, canvasOf(canvas), rest) as never;
			},
			rename: async (title: string, options?: { canvas?: string }) => {
				if (typeof title !== "string" || !title.trim()) throw new Error('rename takes the canvas\'s new name, as in decks canvas rename "Launch plan".');
				const folder = service.retitle(canvasOf(options?.canvas), title);
				service.stagesChanged();
				return canvasRow(folder);
			},
			file: async (options?: { canvas?: string }) => canvasFile(canvasOf(options?.canvas)),
			watch: async (options?: { canvas?: string; off?: boolean }) => {
				const name = canvasOf(options?.canvas);
				const watches = service.watches;
				if (!watches) throw new Error("This server keeps no watches.");
				if (agent.board || agent.person) throw new Error("Only an agent can watch a canvas: the events go to its inbox.");
				if (options?.off) return watches.unwatch(agent.id, name);
				const revs = Object.fromEntries(needPens().boards(name).map((one) => [one.path, service.fileBoard(one.path)?.rev ?? 0]));
				return watches.watch(agent.id, name, needPens().get(name).doc, revs);
			},
			list: async () => {
				const pens = needPens();
				const { isIsolatedStage } = await import("../stage/isolated-stages.ts");
				return pens.names().filter((name) => !isolated() || isIsolatedStage(pens, name)).map(canvasRow);
			},
			create: async (title: string) => {
				if (typeof title !== "string" || !title.trim()) throw new Error('canvas create takes a title, as in decks canvas create "Launch plan".');
				const pens = needPens();
				const name = pens.claim(title.trim());
				if (isolated()) markIsolated(pens, name);
				service.stagesChanged();
				notes.push(`${name} is made and empty. Nobody is on it yet: decks agent update --canvas ${name} makes it your home, decks view goto ${name} shows it.`);
				return canvasRow(name);
			},
		},
	};
}
