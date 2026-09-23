import { clone } from "./doc.ts";
import { layout, type MeasureText, type Placed } from "./layout.ts";
import { expand } from "./refs.ts";
import type { Box, PenDocument, PenNode } from "./types.ts";
import type { ThemeState } from "./values.ts";

/**
 * A document as an agent reads it: the file's own items, each with its box on the stage.
 *
 * The items are exactly what is in the file — the same fields, the same nesting — plus one field
 * that is never saved, `box: { x1, y1, x2, y2 }`, so a reader knows where everything is without
 * adding a parent's corner to a child's `x`. An instance also lists what is inside its copy,
 * `inside: [{ id: "card-1/label", type, content, box }]`, because those id paths are what an update
 * inside the instance is addressed by, and they appear nowhere in the file.
 */

export interface ReadItem extends PenNode {
	box: Box;
	inside?: Array<{ id: string; type: string; name?: string; content?: string; box: Box }>;
}

export function boxOf(placed: Placed | undefined): Box | undefined {
	if (!placed) return undefined;
	const { x, y, w, h } = placed.box;
	const r = (n: number) => Math.round(n * 10) / 10;
	return { x1: r(x), y1: r(y), x2: r(x + w), y2: r(y + h) };
}

export function placements(doc: PenDocument, options: { theme: ThemeState; measure?: MeasureText }): Map<string, Placed> {
	return layout(doc, expand(doc), options);
}

export function read(doc: PenDocument, options: { theme: ThemeState; measure?: MeasureText }): { version: string; variables?: PenDocument["variables"]; themes?: PenDocument["themes"]; children: ReadItem[] } {
	const placed = placements(doc, options);
	const annotate = (node: PenNode): ReadItem => {
		const item = clone(node) as ReadItem;
		const box = boxOf(placed.get(node.id));
		if (box) item.box = box;
		if (Array.isArray(node.children)) item.children = node.children.map(annotate);
		if (node.type === "ref") {
			const inside = [...placed.values()]
				.filter((p) => p.node.id.startsWith(`${node.id}/`))
				.map((p) => ({
					id: p.node.id,
					type: p.node.type,
					...(typeof p.node.name === "string" ? { name: p.node.name } : {}),
					...(typeof p.node.content === "string" ? { content: p.node.content } : {}),
					box: boxOf(p)!,
				}));
			if (inside.length) item.inside = inside;
		}
		return item;
	};
	return {
		version: doc.version,
		...(doc.themes ? { themes: doc.themes } : {}),
		...(doc.variables ? { variables: doc.variables } : {}),
		children: doc.children.map(annotate),
	};
}
