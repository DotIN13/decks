/** A scene built by hand for core's tests: no engine, no document file, just boxes. */
import type { PenNode, Placed } from "@decks/pen";
import type { PageBox, Rect } from "./model.ts";
import type { SceneQuery } from "./scene.ts";

export type FakeItem = { id: string; box: Rect; parent?: string; type?: string; layout?: string; padding?: unknown; drawn?: Rect; extra?: Record<string, unknown>; line?: boolean; undrawn?: boolean };

/** How far round its box a fake item is found under a point, as a press's reach is in the engine. */
export const FAKE_REACH = 4;

export function fakeScene(list: FakeItem[], boards: PageBox[] = []): SceneQuery {
	const nodes = new Map<string, PenNode>();
	for (const one of list) nodes.set(one.id, { id: one.id, type: one.type ?? "rectangle", layout: one.layout, padding: one.padding, children: [], ...one.extra } as unknown as PenNode);
	for (const one of list) if (one.parent) (nodes.get(one.parent)!.children as PenNode[]).push(nodes.get(one.id)!);
	const placed = new Map<string, Placed>(list.map((one, order) => [one.id, { node: nodes.get(one.id)!, box: one.box, parent: one.parent, theme: {} as Placed["theme"], order }]));
	return {
		items: () => placed.values(),
		item: (id) => placed.get(id),
		box: (id) => list.find((one) => one.id === id)?.drawn ?? placed.get(id)?.box,
		drawn: (id) => {
			const one = list.find((candidate) => candidate.id === id);
			return one && !one.undrawn ? (one.drawn ?? one.box) : undefined;
		},
		node: (id) => nodes.get(id),
		parent: (id) => {
			const up = placed.get(id)?.parent;
			return up ? nodes.get(up) : undefined;
		},
		boards: () => boards,
		// Topmost first: the last painted on top. Every box is found a little beyond its edge.
		under: (point) =>
			list
				.filter((one) => {
					const box = one.drawn ?? one.box;
					return point.x >= box.x - FAKE_REACH && point.x <= box.x + box.w + FAKE_REACH && point.y >= box.y - FAKE_REACH && point.y <= box.y + box.h + FAKE_REACH;
				})
				.map((one) => one.id)
				.reverse(),
		// A fake line says whether the point is on it with `line`; anything else cannot tell.
		onLine: (id) => list.find((one) => one.id === id)?.line,
	};
}
