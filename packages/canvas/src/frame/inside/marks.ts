import { createSignal } from "solid-js";
import type { PenEdit } from "@decks/pen";

/** One item's box on the canvas, as the engine laid it out. */
export interface ItemBox {
	x: number;
	y: number;
	w: number;
	h: number;
	parent?: string | undefined;
}

/** What an agent did to an item, for the mark drawn over it. */
export type MarkKind = "insert" | "update" | "move" | "delete";

/** A mark on the canvas: the box an agent's edit touched, in its colour, drawn for a moment. */
export interface Mark {
	key: string;
	kind: MarkKind;
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
}

/** How long a mark is kept: past its animation (820 ms at most, `styles/marks.css`), so it has ended, not been cut. */
export const MARK_MS = 900;
/** Marks past this many in one change are a canvas changing whole, not an edit: none are drawn. */
export const MOST_MARKED = 40;

/** The kind an edit's ops make of an item; a later, stronger op wins. */
const RANK: Record<MarkKind, number> = { move: 0, update: 1, delete: 2, insert: 3 };

/**
 * What an agent's change touched, from its ops: each item once, with what was done to it. An item
 * whose ancestor was touched too is left out, since the ancestor's mark covers it (a frame inserted
 * with its children is one mark). `before` answers a deleted item's box, read before the ops were
 * applied; `after` answers the others', read after.
 */
export function touchedBy(edits: readonly PenEdit[], before: (id: string) => ItemBox | undefined, after: (id: string) => ItemBox | undefined): Array<{ id: string; kind: MarkKind; box: ItemBox }> {
	const kinds = new Map<string, MarkKind>();
	const gone = new Map<string, ItemBox>();
	const keep = (id: string, kind: MarkKind) => {
		const held = kinds.get(id);
		if (held === undefined || RANK[kind] > RANK[held]) kinds.set(id, kind);
	};
	for (const edit of edits) {
		if (edit.op === "meta") continue;
		if (edit.op === "insert") keep(edit.id, "insert");
		else if (edit.op === "remove") {
			const box = before(edit.id);
			if (box) gone.set(edit.id, box);
			keep(edit.id, "delete");
		} else if (edit.op === "set") keep(edit.id, edit.key === "x" || edit.key === "y" ? "move" : "update");
		else keep(edit.id, "move");
	}
	const out: Array<{ id: string; kind: MarkKind; box: ItemBox }> = [];
	for (const [id, kind] of kinds) {
		const box = kind === "delete" ? gone.get(id) : after(id);
		if (!box) continue;
		let under = false;
		for (let up = box.parent; up; up = after(up)?.parent) {
			if (kinds.has(up)) {
				under = true;
				break;
			}
		}
		if (!under) out.push({ id, kind, box });
	}
	return out;
}

/**
 * Marks over what agents draw: each change by an agent puts a mark on every item it touched, in the
 * agent's colour, for `MARK_MS`; a second change to the same item starts its mark again. Drawn in the
 * stage's world (`frame.tsx`), in canvas units.
 */
export function installMarks() {
	const [list, setList] = createSignal<Mark[]>([]);
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	return {
		list,
		/** Mark these, as `agentId` in `color`. */
		add(agentId: string, color: string, touched: ReadonlyArray<{ id: string; kind: MarkKind; box: ItemBox }>): void {
			if (!touched.length || touched.length > MOST_MARKED) return;
			const made: Mark[] = touched.map((one) => ({ key: `${agentId}/${one.id}`, kind: one.kind, x: one.box.x, y: one.box.y, w: one.box.w, h: one.box.h, color }));
			setList((all) => [...all.filter((one) => !made.some((mark) => mark.key === one.key)), ...made]);
			for (const mark of made) {
				clearTimeout(timers.get(mark.key));
				timers.set(mark.key, setTimeout(() => {
					timers.delete(mark.key);
					setList((all) => all.filter((one) => one.key !== mark.key));
				}, MARK_MS));
			}
		},
		dispose(): void {
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		},
	};
}
