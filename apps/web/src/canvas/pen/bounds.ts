import { pathBounds, type Frame, type PenNode, type Placed } from "@decks/pen";

/**
 * What each item looks like it covers, which is not always the box it was given.
 *
 * A path fills its box with its `viewBox`, so a petal drawn in one corner of a 600 by 700 viewBox
 * has a 600 by 700 box; what it covers is its geometry, mapped into that box, and widened by half
 * its stroke. A group covers what its children cover. Everything else covers its box.
 */
export function boundsOf(placed: ReadonlyMap<string, Placed>): Map<string, Frame> {
	const out = new Map<string, Frame>();
	const children = new Map<string, Placed[]>();
	for (const item of placed.values()) if (item.parent) (children.get(item.parent) ?? children.set(item.parent, []).get(item.parent)!).push(item);
	const visit = (item: Placed): Frame => {
		const known = out.get(item.node.id);
		if (known) return known;
		const { node, box } = item;
		let bounds: Frame = box;
		if (node.type === "path" && typeof node.geometry === "string") {
			const drawn = pathBounds(node.geometry);
			const vb = node.viewBox;
			if (drawn && vb && vb[2] > 0 && vb[3] > 0) {
				const sx = box.w / vb[2];
				const sy = box.h / vb[3];
				const pad = (typeof node.strokeWidth === "number" && node.stroke !== undefined ? node.strokeWidth : 0) / 2;
				bounds = { x: box.x + (drawn.x - vb[0]) * sx - pad, y: box.y + (drawn.y - vb[1]) * sy - pad, w: drawn.w * sx + pad * 2, h: drawn.h * sy + pad * 2 };
			}
		} else if (node.type === "group") {
			const kids = (children.get(node.id) ?? []).map(visit);
			if (kids.length) {
				const x1 = Math.min(...kids.map((k) => k.x));
				const y1 = Math.min(...kids.map((k) => k.y));
				bounds = { x: x1, y: y1, w: Math.max(...kids.map((k) => k.x + k.w)) - x1, h: Math.max(...kids.map((k) => k.y + k.h)) - y1 };
			}
		}
		out.set(node.id, bounds);
		return bounds;
	};
	for (const item of placed.values()) visit(item);
	return out;
}
