import { calls, Refused } from "../../protocol/index.ts";
import { handleAll, type Context, type Item, type ItemOp } from "../kernel/types.ts";
import type { Clips } from "./clips.ts";
import type { PenCanvas } from "./doc.ts";
import { boxes } from "./ops.ts";
import { freeCorner } from "./place.ts";
import type { CanvasStore } from "./store.ts";

// The thirteen item calls. Each finds its drawing (a canvas, or a frame
// file in one) and applies one op, or reads.

type On = { canvas?: string; frame?: string };

/** The canvas a call means: the one named, or the caller's here. */
export function canvasOf(store: CanvasStore, ctx: Context, named: string | undefined): string {
	const name = named ?? ctx.caller.canvas;
	if (!name) throw new Refused("invalid", "Name a canvas; this caller has no here.", "canvas.list");
	return store.name(name);
}

function drawingOf(store: CanvasStore, ctx: Context, on: On): PenCanvas {
	const name = canvasOf(store, ctx, on.canvas);
	return on.frame ? store.frame(name, on.frame) : store.doc(name);
}

const one = (doc: PenCanvas, op: ItemOp, ctx: Context): Item => {
	const items = doc.apply([op], ctx.caller).items;
	if (!items[0]) throw new Refused("not_found", "The item is not on the canvas after the change.", "item.list");
	return items[0];
};

const isArrow = (item: Item) => (item as { metadata?: { type?: unknown } }).metadata?.type === "decks.arrow";

export function itemCalls(store: CanvasStore, clips: Clips) {
	const at = (ctx: Context, on: On) => drawingOf(store, ctx, on);
	return handleAll(calls.item, {
		list: (ctx, a) => at(ctx, a).read({ ...(a.depth !== undefined ? { depth: a.depth } : {}), ...(a.resolve ? { resolve: a.resolve } : {}), ...(a.theme ? { theme: a.theme } : {}) }),
		get: (ctx, a) => at(ctx, a).read({ ids: [a.id], ...(a.depth !== undefined ? { depth: a.depth } : {}), ...(a.resolve ? { resolve: a.resolve } : {}) })[0]!,
		insert: (ctx, { item, at: corner, beside, below, parent, index, ...on }) => one(at(ctx, on), { op: "insert", item, ...defined({ at: corner, beside, below, parent, index }) }, ctx),
		update: (ctx, { id, set, at: corner, size, ...on }) => one(at(ctx, on), { op: "update", id, ...defined({ set, at: corner, size }) }, ctx),
		replace: (ctx, { id, item, ...on }) => one(at(ctx, on), { op: "replace", id, item }, ctx),
		remove: (ctx, { id, ...on }) => {
			const doc = at(ctx, on);
			const found = doc.idOf(id);
			doc.apply([{ op: "delete", id: found }], ctx.caller);
			return { deleted: id };
		},
		move: (ctx, { id, at: corner, beside, below, parent, index, ...on }) => one(at(ctx, on), { op: "move", id, ...defined({ at: corner, beside, below, parent, index }) }, ctx),
		copy: (ctx, { id, as, at: corner, parent, ...on }) => one(at(ctx, on), { op: "copy", id, ...defined({ as, at: corner, parent }) }, ctx),
		batch: (ctx, { ops, for: _for, ...on }) => at(ctx, on).apply(ops, ctx.caller).items,
		clip: (ctx, a) => clips.clip(canvasOf(store, ctx, a.canvas), a.ids, a.id),
		paste: (ctx, a) => clips.paste(a.clip.id, canvasOf(store, ctx, a.canvas), a.at, ctx.caller),
		space: (ctx, a) => {
			const doc = at(ctx, a);
			const all = boxes(doc.pen());
			const tops = doc.read({ depth: 0 }).filter((item) => !isArrow(item) && item.box).map((item) => item.box!);
			const near = a.near ? all.get(doc.idOf(a.near)) : undefined;
			return freeCorner(tops, a.size, { ...(near ? { near } : {}), ...(a.side ? { side: a.side } : {}), ...(a.margin !== undefined ? { margin: a.margin } : {}) });
		},
		variables: (ctx, { set, themes, ...on }) => {
			const name = canvasOf(store, ctx, on.canvas);
			at(ctx, on).apply([{ op: "variables", set, ...(themes !== undefined ? { themes } : {}) }], ctx.caller);
			return store.describe(name);
		},
	});
}

/** Only the fields that were given, so an op carries no undefined. */
function defined<T extends Record<string, unknown>>(fields: T): Partial<T> {
	return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<T>;
}
