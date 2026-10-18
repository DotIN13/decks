/** A scene built by hand for core's tests: no engine, no document file, just boxes. */
import type { PenNode, Placed } from "@decks/pen";
import type { BoardBox, Rect } from "./model.ts";
import type { SceneQuery } from "./scene.ts";

export type FakeItem = { id: string; box: Rect; parent?: string; type?: string; layout?: string; padding?: unknown; drawn?: Rect; extra?: Record<string, unknown> };

export function fakeScene(list: FakeItem[], boards: BoardBox[] = []): SceneQuery {
	const nodes = new Map<string, PenNode>();
	for (const one of list) nodes.set(one.id, { id: one.id, type: one.type ?? "rectangle", layout: one.layout, padding: one.padding, children: [], ...one.extra } as unknown as PenNode);
	for (const one of list) if (one.parent) (nodes.get(one.parent)!.children as PenNode[]).push(nodes.get(one.id)!);
	const placed = new Map<string, Placed>(list.map((one, order) => [one.id, { node: nodes.get(one.id)!, box: one.box, parent: one.parent, theme: {} as Placed["theme"], order }]));
	return {
		items: () => placed.values(),
		item: (id) => placed.get(id),
		box: (id) => list.find((one) => one.id === id)?.drawn ?? placed.get(id)?.box,
		node: (id) => nodes.get(id),
		boards: () => boards,
	};
}
