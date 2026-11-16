import { baseTheme, clipItems, ids as idsOf, pastedItems, placements, type PenNode } from "@decks/pen";
import { layout, Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Item, type ItemOp } from "../kernel/types.ts";
import type { CanvasStore } from "./store.ts";

// item.clip keeps a copy of items for a day; item.paste puts it in as one
// change, with new ids, arrows joined to the copies, and the files each
// item's kind names copied into the canvas they land on.

/** How long a clip is kept: a day. */
export const CLIP_LIFE = 24 * 60 * 60 * 1000;

type Held = { canvas: string; items: PenNode[]; box: { x: number; y: number; w: number; h: number }; at: number };

export class Clips {
	private held = new Map<string, Held>();
	constructor(private store: CanvasStore) {}

	clip(canvas: string, ids: string[], id: string): { id: string; canvas: string; box: { x1: number; y1: number; x2: number; y2: number }; items: number } {
		if (!id) throw new Refused("invalid", "Give the clip a fresh random id.", "item.clip");
		const doc = this.store.doc(canvas);
		const pen = doc.pen();
		const found = ids.map((ref) => doc.idOf(ref));
		const taken = clipItems(pen, found, placements(pen, { theme: baseTheme(pen, "light") }));
		if (!taken) throw new Refused("not_found", "None of those items is on this canvas.", "item.list");
		this.sweep();
		this.held.set(id, { canvas, items: taken.items, box: taken.box, at: this.store.clock() });
		const b = taken.box;
		return { id, canvas, box: { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h }, items: taken.items.length };
	}

	async paste(clipId: string, to: string, at: { x: number; y: number } | undefined, by: Caller, edit?: string, scoped = false): Promise<Item[]> {
		this.sweep();
		const held = this.held.get(clipId);
		if (!held) throw new Refused("not_found", `No clip called ${clipId} is held; clips last a day.`, "item.clip");
		const doc = this.store.doc(to);
		const dx = at ? at.x - held.box.x : held.canvas === to ? 40 : 0;
		const dy = at ? at.y - held.box.y : held.canvas === to ? 40 : 0;
		const paths = await this.carryFiles(held, to, by);
		const copies = pastedItems(held.items, idsOf(doc.pen()), { dx, dy }).items.map((node) => this.repath(node, held.canvas, to, paths));
		const ops: ItemOp[] = copies.map((item) => ({ op: "insert", item, parent: null }));
		return doc.apply(ops, by, edit, scoped).items;
	}

	/** Copy each file an item needs into the target canvas; old deck path to new. */
	private async carryFiles(held: Held, to: string, by: Caller): Promise<Map<string, string>> {
		const moved = new Map<string, string>();
		if (held.canvas === to) return moved;
		const kinds = this.store.kindsOf();
		const files = held.items.flatMap((node) => [node, ...((node.children as PenNode[] | undefined) ?? [])]).flatMap((node) => kinds.filesOf(node, held.canvas));
		for (const file of files) {
			const at = layout.canvasOfPath(file);
			if (!at || at.name !== held.canvas) continue;
			const target = await this.freePath(`${layout.canvasFolder(to)}/${at.rest}`);
			await this.store.deck.write(toDeckPath(target), await this.store.deck.read(toDeckPath(file)), by);
			const [oldTop, newTop] = [file, target].map((p) => p.split("/").slice(0, -1).join("/"));
			moved.set(file, target);
			if (oldTop && newTop) moved.set(oldTop, newTop);
		}
		return moved;
	}

	private async freePath(path: string): Promise<string> {
		const parts = path.split("/");
		const at = parts.length - 2;
		for (let n = 1; ; n++) {
			const name = n === 1 ? parts[at] : `${parts[at]}-${n}`;
			const candidate = [...parts.slice(0, at), name, ...parts.slice(at + 1)].join("/");
			if ((await this.store.text(toDeckPath(candidate))) === undefined) return candidate;
		}
	}

	/** An item whose kind names deck paths, with those paths moved. */
	private repath(node: PenNode, from: string, to: string, paths: Map<string, string>): Item {
		const kinds = this.store.kindsOf();
		const item = kinds.toItem(node, from);
		if (item === (node as Item)) return item;
		const { x, y, width, height } = node as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
		const box = typeof x === "number" && typeof y === "number" && typeof width === "number" && typeof height === "number" ? { box: { x1: x, y1: y, x2: x + width, y2: y + height } } : {};
		if (from === to) return { ...item, ...box };
		const moved = (p: unknown) => (typeof p === "string" ? (paths.get(p) ?? [...paths].reduce((acc, [a, b]) => (acc.startsWith(`${a}/`) ? b + acc.slice(a.length) : acc), p)) : p);
		return { ...item, ...box, ...(item.card ? { card: moved(item.card) as string } : {}), ...(item.path ? { path: moved(item.path) as string } : {}) };
	}

	private sweep(): void {
		const now = this.store.clock();
		for (const [id, held] of this.held) if (now - held.at > CLIP_LIFE) this.held.delete(id);
	}
}
