import { basename } from "node:path";
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
 *
 * The item calls (read, insert, update, replace, delete, move, copy, variables, batch) take
 * `{ frame: "frames/<name>" }` instead to act on a frame file, with the same items and answers; the
 * change shows on every canvas placing the frame. A frame holds drawn items, never a board.
 */

/** How far clear of another item `beside` and `below` put one. */
export const GAP = 160;

type Corner = { x1: number; y1: number } | { x: number; y: number };
/** What an item call acts on: a canvas by its folder name, or a frame file by its ref. */
type Target = { canvas: string; frame?: undefined } | { frame: string; canvas?: undefined };
/** The options every item call takes to say what it acts on. */
type On = { canvas?: string; frame?: string };
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
	const { service, agent, notes, needPens, canvasOf, canvasRow, isolated } = ctx;
	const measure = serverText.measure;

	/** A canvas, or a frame file when the caller says `frame`; both at once is a mistake worth saying. */
	const targetOf = (options?: On): Target => {
		const frame = options?.frame;
		if (frame === undefined || frame === null) return { canvas: canvasOf(options?.canvas) };
		if (options?.canvas !== undefined && options.canvas !== null) throw new Error("Say a canvas or a frame, not both: { frame } edits the frame file itself, and that shows on every canvas placing it.");
		if (typeof frame !== "string" || !frame.trim()) throw new Error('frame names a frame file, as in { frame: "frames/agent-card" }.');
		// `frames/<name>`: the agent's own canvas's copy when it has one (`StagePens.frameOn`), else the deck's.
		let home: string | undefined;
		try {
			home = canvasOf(undefined);
		} catch {
			/* no canvas of its own: the deck's frames/ */
		}
		return { frame: needPens().framePen(needPens().frameOn(frame, home)).shown };
	};

	/**
	 * What a target holds, read fresh, and how to lay a version of it out as the canvas would: what
	 * `beside` and every answered box are measured on. A frame's refs resolve from its own folder.
	 */
	const surfaceOf = (target: Target): { doc: PenDocument; layout: (doc: PenDocument) => Map<string, Placed> } => {
		const pens = needPens();
		const lay = (doc: PenDocument, imported: PenDocument) => placements(imported, { theme: baseTheme(doc, "light"), measure });
		if (target.frame !== undefined) {
			const frame = pens.framePen(target.frame);
			return { doc: frame.doc, layout: (doc) => lay(doc, frame.imported(doc)) };
		}
		const entry = pens.get(target.canvas);
		if (entry.error) throw new Error(`${entry.error}. Fix the file, or replace it whole, before editing it.`);
		return { doc: entry.doc, layout: (doc) => lay(doc, pens.withImported(target.canvas, doc)) };
	};

	/** An item's id, or a board's path on this document turned into its item's id. */
	const idIn = (doc: PenDocument, ref: unknown, what = "id"): string => {
		if (typeof ref !== "string" || !ref.trim()) throw new Error(`${what} names an item: its id from decks canvas read, or a board's path.`);
		for (const node of walk(doc.children)) if (boardOf(node) === ref) return node.id;
		return ref;
	};

	/** A caller's item as pen's: a board becomes its `browser` item, sized as its file says unless told. */
	const fromItem = (raw: unknown, taken: Set<string>, frame?: string): Record<string, unknown> => {
		if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string") throw new Error('An item has a type: { type: "note", content: "…" }, or { type: "board", board: "boards/plan.html" }.');
		const item = raw as Record<string, unknown>;
		const { box: _box, children: kids, ...rest } = item;
		const children = Array.isArray(kids) ? kids.map((one) => fromItem(one, taken, frame)) : undefined;
		if (item.type !== "board") return { ...rest, ...(children ? { children } : {}) };
		if (frame) throw new Error(`${frame} is a frame, and a frame holds drawn items, not boards: place the board on a canvas, beside the frame.`);
		const { type: _type, board, title: _title, ...own } = rest as Record<string, unknown>;
		if (typeof board !== "string" || !board) throw new Error('A board item names its file: { type: "board", board: "boards/plan.html" }.');
		const file = service.fileBoard(board);
		if (!file) throw new Error(`There is no board ${board} in the deck. decks board create makes one; decks board list lists them.`);
		let id = typeof own.id === "string" && own.id ? own.id : undefined;
		if (!id) {
			const base = slug(basename(board).replace(/\.[^.]+$/, ""), 40) || "board";
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
	const translate = (target: Target, ops: readonly CanvasOpIn[]): { penOps: Op[]; sized: Array<{ path: string; w?: number; h?: number }>; deleted: Set<string>; placedFor: string[] } => {
		const surface = surfaceOf(target);
		const frame = target.frame;
		let doc = surface.doc;
		const theme = baseTheme(doc, "light");
		const penOps: Op[] = [];
		const sized: Array<{ path: string; w?: number; h?: number }> = [];
		const deleted = new Set<string>();
		const placedFor: string[] = [];
		if (!Array.isArray(ops) || ops.length === 0) throw new Error('A batch is a list of ops: [{ op: "insert", item: { type: "note", content: "…" } }].');
		ops.forEach((op, index) => {
			const where = ops.length > 1 ? `Op ${index + 1} (${op?.op ?? "?"}): ` : "";
			try {
				const placed = surface.layout(doc);
				let pen: Op;
				// pen.dev's own form (what the canvas editor sends): taken as it is, with a board's path for an id.
				const raw = op as unknown as Record<string, unknown>;
				if (raw && ("node" in raw || "box" in raw)) {
					const given = { ...raw } as Record<string, unknown>;
					if (typeof given.id === "string") given.id = idIn(doc, given.id);
					if (typeof given.parent === "string") given.parent = idIn(doc, given.parent, "parent");
					if (given.node && (given.node as { type?: unknown }).type === "board") given.node = fromItem(given.node, ids(doc), frame);
					pen = given as unknown as Op;
					doc = apply(doc, [pen], { theme, measure }).doc;
					penOps.push(pen);
					return;
				}
				switch (op?.op) {
					case "insert": {
						const node = fromItem(op.item, ids(doc), frame);
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
							// A board is held to the sizes a resize always allowed: a resize is not the place to find a typo.
							const round = (value: unknown, low: number, high: number) => (typeof value === "number" && Number.isFinite(value) ? (path ? Math.min(high, Math.max(low, Math.round(value))) : Math.round(value)) : undefined);
							const w = round(op.size.w, 320, 4000);
							const h = round(op.size.h, 200, 8000);
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
						const node = fromItem({ ...op.item, id }, taken, frame);
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
	 * Apply ops to a canvas or a frame, all or nothing, and answer with each item as it now is.
	 * The canvas first, then a board's file when a board was sized, as a person's resize does. A
	 * frame's file is written once, and every canvas placing it is sent it again (`StagePens.editFile`).
	 */
	const change = (target: Target, ops: readonly CanvasOpIn[]): Array<Record<string, unknown>> => {
		const pens = needPens();
		const { penOps, sized, deleted, placedFor } = translate(target, ops);
		let results: ReadonlyArray<{ op: string; id: string; note?: string }>;
		let variables: () => Record<string, unknown>;
		let children: Record<string, unknown>[];
		if (target.frame !== undefined) {
			results = pens.editFile(target.frame, penOps).results;
			variables = () => (pens.framePen(target.frame).doc.variables ?? {}) as Record<string, unknown>;
			children = pens.readFile(target.frame).children as unknown as Record<string, unknown>[];
		} else {
			const name = target.canvas;
			const edited = pens.edit(name, penOps, undefined, agent.person ? { undoable: true } : undefined);
			results = edited.results;
			variables = () => (edited.entry.doc.variables ?? {}) as Record<string, unknown>;
			for (const one of sized) {
				const file = service.fileBoard(one.path);
				if (!file || file.fills) continue;
				if (file.format === "slides") {
					if (one.w !== undefined) service.resize(one.path, { w: one.w });
				} else service.resize(one.path, { ...(one.w !== undefined ? { w: one.w } : {}), ...(one.h !== undefined ? { h: one.h } : {}) });
				if (agent.person) service.wrote(one.path, "you");
			}
			children = pens.read(name).children as unknown as Record<string, unknown>[];
		}
		notes.push(...placedFor);
		for (const result of results) if (result.note) notes.push(result.note);
		const byId = new Map<string, Record<string, unknown>>();
		const index = (list: readonly Record<string, unknown>[]) => {
			for (const node of list) {
				if (typeof node.id === "string") byId.set(node.id, node);
				if (Array.isArray(node.children)) index(node.children as Record<string, unknown>[]);
			}
		};
		index(children);
		const drawn: string[] = [];
		const boxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
		const answer = results.map((result) => {
			if (result.op === "delete" || deleted.has(result.id)) return { type: "deleted", id: result.id };
			if (result.op === "variables") return { type: "variables", id: result.id, variables: variables() };
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
		// What an agent drew is marked on its canvas; a frame is drawn wherever it is placed, so it is not.
		if (drawn.length && target.canvas !== undefined) agent.drew?.(target.canvas, drawn, boxes);
		return answer;
	};
	const one = (target: Target, op: CanvasOpIn) => change(target, [op])[0]!;

	return {
		canvas: {
			read: async (options?: On) => {
				const target = targetOf(options);
				const pens = needPens();
				if (target.frame !== undefined) {
					const { file, children, ...rest } = pens.readFile(target.frame) as { file: string; children: unknown[]; ref?: string; stage?: string };
					delete rest.ref;
					delete rest.stage;
					return { frame: target.frame, file, ...rest, items: (children as unknown as Record<string, unknown>[]).map(toItem) } as never;
				}
				const name = target.canvas;
				const { stage: _stage, file: _file, children, ...rest } = pens.read(name);
				return { canvas: name, title: pens.titleOf(name), rev: pens.get(name).rev, ...rest, items: (children as unknown as Record<string, unknown>[]).map(toItem) } as never;
			},
			insert: async (item: ItemIn, options?: On & { at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }) => {
				const { canvas, frame, ...place } = options ?? {};
				return one(targetOf({ canvas, frame }), { op: "insert", item, ...place }) as never;
			},
			update: async (id: string, changeOf: { set?: Record<string, unknown>; at?: Corner; size?: { w?: number; h?: number } }, options?: On) =>
				one(targetOf(options), { op: "update", id, ...(changeOf ?? {}) }) as never,
			replace: async (id: string, item: ItemIn, options?: On) => one(targetOf(options), { op: "replace", id, item }) as never,
			delete: async (id: string, options?: On) => {
				one(targetOf(options), { op: "delete", id });
				return { deleted: id };
			},
			move: async (id: string, options?: On & { at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }) => {
				const { canvas, frame, ...place } = options ?? {};
				return one(targetOf({ canvas, frame }), { op: "move", id, ...place }) as never;
			},
			copy: async (id: string, options?: On & { as?: string; at?: Corner; parent?: string | null }) => {
				const { canvas, frame, ...rest } = options ?? {};
				return one(targetOf({ canvas, frame }), { op: "copy", id, ...rest }) as never;
			},
			variables: async (set: Record<string, unknown>, options?: On & { themes?: Record<string, string[]> | null }) => {
				const target = targetOf(options);
				one(target, { op: "variables", set, ...(options?.themes !== undefined ? { themes: options.themes } : {}) });
				const doc = target.frame !== undefined ? needPens().framePen(target.frame).doc : needPens().get(target.canvas).doc;
				return { variables: (doc.variables ?? {}) as Record<string, unknown>, ...(doc.themes ? { themes: doc.themes as Record<string, unknown> } : {}) };
			},
			batch: async (ops: readonly unknown[], options?: On) => change(targetOf(options), ops as readonly CanvasOpIn[]) as never,
			fit: async (board: string, options?: { canvas?: string; margin?: number }) => {
				const name = canvasOf(options?.canvas);
				const { board: sized, canvas, said } = await fitOn(ctx, board, name, options?.margin);
				return { board: sized.path, canvas, w: sized.w, h: sized.h, notes: said };
			},
			save: async (id: string, frame: string, options?: { canvas?: string; replace?: boolean }) => {
				const name = canvasOf(options?.canvas);
				const pens = needPens();
				const entry = pens.get(name);
						return pens.saveFrame(name, idIn(entry.doc, id), frame, options?.replace !== false);
			},
			screenshot: async (options?: { canvas?: string; of?: ShotOf; scale?: number; format?: ShotFormat; to?: string; scheme?: "light" | "dark"; live?: boolean }) => {
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
