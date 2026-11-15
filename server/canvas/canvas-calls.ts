import { calls, events, layout, Refused, type Caller } from "../../protocol/index.ts";
import { handleAll, toDeckPath, type Context, type Deck, type DeckPath } from "../kernel/types.ts";
import { canvasOf } from "./item-calls.ts";
import { emptyDrawing, type CanvasStore } from "./store.ts";

// The canvas calls this feature answers, named one by one so a call added to
// the protocol (screenshot, export, versions) is another feature's until
// named here. A canvas's name is its folder and never changes; its title can.

const { list, get, here, create, update, remove, copy, undo } = calls.canvas;
const mine = { list, get, here, create, update, remove, copy, undo };

/** A folder name from a title: lower case words joined by dashes, made unique. */
export function nameFor(title: string, taken: (name: string) => boolean): string {
	const base = title.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "") || "canvas";
	for (let n = 1; ; n++) {
		const name = n === 1 ? base : `${base}-${n}`;
		if (!taken(name)) return name;
	}
}

export function canvasCalls(store: CanvasStore) {
	const named = (ctx: Context, canvas: string | undefined) => canvasOf(store, ctx, canvas);
	const changed = (ctx: Context, name: string) => ctx.events.emit(events.canvasChanged, { canvas: name, ids: [name], by: ctx.caller.id, rev: 0 });
	return handleAll(mine, {
		list: () => store.list().map((name) => store.describe(name)),
		get: (ctx, a) => store.describe(named(ctx, a.canvas)),
		here: (ctx) => store.describe(named(ctx, undefined)),
		create: async (ctx, { title }) => {
			const name = await make(store, title, ctx.caller);
			changed(ctx, name);
			return store.describe(name);
		},
		update: async (ctx, { title, canvas }) => {
			const name = named(ctx, canvas);
			await store.setTitle(name, title, ctx.caller);
			return store.describe(name);
		},
		remove: async (ctx, { canvas }) => {
			const name = named(ctx, canvas);
			await store.flush();
			await ctx.deck.remove(toDeckPath(layout.canvasFolder(name)), ctx.caller);
			store.forget(name);
			changed(ctx, name);
			return { deleted: name };
		},
		copy: async (ctx, { canvas, title }) => {
			const from = named(ctx, canvas);
			await store.flush();
			const name = nameFor(title ?? `Copy of ${store.title(from)}`, (n) => store.list().includes(n));
			await copyFolder(ctx.deck, toDeckPath(layout.canvasFolder(from)), toDeckPath(layout.canvasFolder(name)), ctx.caller);
			await store.open(name);
			await store.setTitle(name, title ?? `Copy of ${store.title(from)}`, ctx.caller);
			return store.describe(name);
		},
		undo: async (ctx, { redo, canvas }) => {
			const name = named(ctx, canvas);
			if (ctx.caller.kind !== "person" && ctx.caller.kind !== "card") throw new Refused("refused", "Only the person's own edits are undone.", "item.batch");
			store.doc(name).undo(ctx.caller, redo ?? false);
			await store.flush();
			return store.describe(name);
		},
	});
}

async function make(store: CanvasStore, title: string, by: Caller): Promise<string> {
	if (!title.trim()) throw new Refused("invalid", "A canvas needs a title.", "canvas.create");
	const name = nameFor(title, (n) => store.list().includes(n));
	await store.create(store.file(name), name, emptyDrawing(), by);
	await store.setTitle(name, title.trim(), by);
	return name;
}

async function copyFolder(deck: Deck, from: DeckPath, to: DeckPath, by: Caller): Promise<void> {
	for (const entry of await deck.list(from)) {
		const target = toDeckPath(`${to}${entry.path.slice(from.length)}`);
		if (entry.kind === "dir") await copyFolder(deck, entry.path, target, by);
		else await deck.write(target, await deck.read(entry.path), by);
	}
}
