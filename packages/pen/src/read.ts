import { clone, PenError, walk } from "./doc.ts";
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
	/** How many children an item has that a read's `depth` left out. */
	childCount?: number;
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

/** What to read of a document, beyond the whole of it. */
export interface ReadOptions {
	theme: ThemeState;
	measure?: MeasureText;
	/** One item and what is in it, by id; an id inside an instance (`"card-1/label"`) works too. */
	of?: string;
	/** How many levels of children to keep: 0 is the item(s) alone. Cut children are counted in `childCount`. */
	depth?: number;
}

export function read(doc: PenDocument, options: ReadOptions): { version: string; variables?: PenDocument["variables"]; themes?: PenDocument["themes"]; children: ReadItem[] } {
	const placed = placements(doc, options);
	/** An item inside an instance, read from its expanded copy: no file holds it. */
	const annotateCopy = (node: PenNode): ReadItem => {
		const { instanceOf: _instanceOf, ...own } = clone(node) as PenNode;
		const item = own as ReadItem;
		const box = boxOf(placed.get(node.id));
		if (box) item.box = box;
		if (Array.isArray(node.children)) item.children = node.children.map(annotateCopy);
		return item;
	};
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
	let children: ReadItem[];
	if (options.of !== undefined) {
		const of = options.of;
		const own = [...walk(doc.children)].find((node) => node.id === of);
		const copy = own ? undefined : placed.get(of);
		if (own) children = [annotate(own)];
		else if (copy && of.includes("/")) children = [annotateCopy(copy.node)];
		else throw new PenError(`no item "${of}"${of.includes("/") ? ": an id inside an instance is the instance's id, a slash, and the item's id in the reusable frame" : ""}.`);
	} else children = doc.children.map(annotate);
	if (options.depth !== undefined) {
		if (typeof options.depth !== "number" || !Number.isInteger(options.depth) || options.depth < 0) throw new PenError("depth is a whole number of levels, 0 for the item(s) alone.");
		children = children.map((item) => cut(item, options.depth!));
	}
	return {
		version: doc.version,
		...(doc.themes ? { themes: doc.themes } : {}),
		...(doc.variables ? { variables: doc.variables } : {}),
		children,
	};
}

/** An item with its children kept `depth` levels down; below that, their number in `childCount`. */
function cut(item: ReadItem, depth: number): ReadItem {
	if (!Array.isArray(item.children)) return item;
	if (depth <= 0) {
		const { children, ...rest } = item;
		return { ...rest, childCount: children.length } as ReadItem;
	}
	return { ...item, children: (item.children as ReadItem[]).map((child) => cut(child, depth - 1)) };
}
