import { calls, Refused } from "../../protocol/index.ts";
import { handleAll, type Context, type Item } from "../kernel/types.ts";
import type { PenCanvas } from "./doc.ts";
import type { CanvasStore } from "./store.ts";

// Frame files: frames/<name>.pen in a canvas's folder, each holding one
// reusable item, placed on a canvas as { type: ref, ref: frames/<name> }.

type FrameShape = { path: string; id: string; ref?: string };

export function frameCalls(store: CanvasStore) {
	const create = async (ctx: Context, name: string, path: string, item: Item | undefined): Promise<FrameShape> => {
		const file = store.frameFile(name, path);
		if ((await store.text(file)) !== undefined) throw new Refused("conflict", `${path} already exists on ${name}.`, "frame.get");
		const rel = path.replace(/\.pen$/, "");
		return shape(rel, await store.create(file, name, frameText(item), ctx.caller));
	};
	return handleAll(calls.frame, {
		list: (ctx, a) => store.frames(ctx.canvasName(a.canvas)).map((f) => shape(f.path, f.doc)),
		get: (ctx, a) => {
			const name = ctx.canvasName(a.canvas);
			return shape(a.path.replace(/\.pen$/, ""), store.frame(name, a.path));
		},
		create: (ctx, a) => create(ctx, ctx.canvasName(a.canvas), a.path, a.item),
		save: async (ctx, { id, path, replace, canvas }) => {
			const name = ctx.canvasName(canvas);
			const doc = store.doc(name);
			const real = doc.idOf(id);
			const node = doc.pen().children.find((n) => n.id === real) ?? findDeep(doc, real);
			const { x, y, ...rest } = node as Item & { x?: number; y?: number };
			const made = await create(ctx, name, path, rest as Item);
			if (replace !== false) doc.apply([{ op: "replace", id: real, item: { type: "ref", ref: made.ref, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) } }], ctx.caller);
			return made;
		},
	});
}

function shape(path: string, doc: PenCanvas): FrameShape {
	const first = doc.read({ depth: 0 })[0];
	return { path, id: first?.id ?? "", ref: path };
}

/** A frame file's text: one item, marked reusable. */
function frameText(item: Item | undefined): string {
	const children = item ? [{ ...stripBox(item), reusable: true }] : [];
	return `${JSON.stringify({ version: "2.14", children }, null, 2)}\n`;
}

function stripBox(item: Item): Item {
	const { box: _box, ...rest } = item;
	return { ...rest, ...(Array.isArray(rest.children) ? { children: (rest.children as Item[]).map(stripBox) } : {}) } as Item;
}

function findDeep(doc: PenCanvas, id: string): Item {
	const item = doc.read({ ids: [id] })[0];
	if (!item) throw new Refused("not_found", `Nothing called ${id} is on this canvas.`, "item.list");
	return item;
}
