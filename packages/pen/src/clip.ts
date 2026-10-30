import { arrowEndItem, arrowPoints, isArrow, isPointEnd } from "./arrows.ts";
import { clone, idFor, walk } from "./doc.ts";
import type { Frame, Placed } from "./layout.ts";
import type { PenDocument, PenNode } from "./types.ts";

/**
 * Copy and paste of a drawing's items, the parts that are only the drawing's: which items a copy
 * takes and where they are, and the copies a paste puts in, with ids of their own.
 *
 * The clip is what a copy puts on the clipboard (`application/x-decks-clip`, and the same JSON in the
 * `text/html`): the items whole, the canvas and the place they came from, and the harness or Studio
 * that keeps that canvas. Within one harness a paste is the harness's (`canvas.paste`), which copies
 * the files the items need; on Studio a paste puts in what needs no file.
 */
export interface Clip {
	v: 1;
	/** Who keeps the canvas it came from: a harness's id, or `studio:<address>`. */
	harness: string;
	canvas: string;
	/** The copy as the harness holds it (`canvas.clip`), which a paste names. */
	id?: string;
	box: { x: number; y: number; w: number; h: number };
	items: PenNode[];
}

/** The clipboard type a clip is written as. */
export const CLIP_TYPE = "application/x-decks-clip";

/** A page item's path (a card's, a board's, a document's): what an arrow's end may name instead of an id. */
const pathOf = (node: PenNode): string | undefined => {
	const path = (node.metadata as { path?: unknown } | undefined)?.path;
	return node.type === "browser" && typeof path === "string" ? path : undefined;
};

/**
 * What a copy of `ids` takes: each selected item whole, in the drawing's order, and none that is inside
 * another one taken. An item taken out of a frame is placed where it is drawn, as an item of the
 * canvas. An arrow's end on anything left behind becomes the point it is drawn at, so the copy is a
 * free arrow there rather than one joined to whatever has that id where it lands.
 */
export function clipItems(doc: PenDocument, ids: readonly string[], placed: ReadonlyMap<string, Placed>): { items: PenNode[]; box: Clip["box"] } | undefined {
	const wanted = new Set(ids);
	const taken: Array<{ node: PenNode; nested: boolean }> = [];
	const visit = (nodes: readonly PenNode[], nested: boolean) => {
		for (const node of nodes) {
			if (wanted.has(node.id)) taken.push({ node, nested });
			else if (node.children) visit(node.children, true);
		}
	};
	visit(doc.children, false);
	if (!taken.length) return undefined;
	// What an arrow's end may name inside the copy: the ids, and the paths of the pages, of everything taken.
	const inside = new Set<string>();
	for (const one of walk(taken.map((t) => t.node))) {
		inside.add(one.id);
		const path = pathOf(one);
		if (path) inside.add(path);
	}
	const byPath = new Map<string, Frame>();
	for (const [id, at] of placed) {
		const path = pathOf(at.node);
		if (path) byPath.set(path, placed.get(id)!.box);
	}
	const items = taken.map(({ node, nested }) => {
		const copy = clone(node);
		const box = placed.get(node.id)?.box;
		if (box && (nested || typeof copy.x !== "number" || typeof copy.y !== "number")) {
			copy.x = Math.round(box.x);
			copy.y = Math.round(box.y);
			if (nested && typeof copy.width !== "number") copy.width = Math.round(box.w);
			if (nested && typeof copy.height !== "number" && copy.type !== "text" && copy.type !== "note") copy.height = Math.round(box.h);
		}
		for (const one of walk([copy])) {
			if (!isArrow(one)) continue;
			const meta = one.metadata as Record<string, unknown>;
			const left = [meta.from, meta.to].map((end) => !isPointEnd(end) && !inside.has(arrowEndItem(end) ?? ""));
			if (!left[0] && !left[1]) continue;
			const points = arrowPoints(meta, placed, (path) => byPath.get(path));
			if (!points?.length) continue;
			one.metadata = { ...meta, ...(left[0] ? { from: points[0] } : {}), ...(left[1] ? { to: points[points.length - 1] } : {}) } as PenNode["metadata"];
		}
		return copy;
	});
	const boxes = taken.map(({ node }) => placed.get(node.id)?.box).filter((box): box is Frame => !!box);
	if (!boxes.length) return { items, box: { x: 0, y: 0, w: 0, h: 0 } };
	const x = Math.min(...boxes.map((b) => b.x));
	const y = Math.min(...boxes.map((b) => b.y));
	const w = Math.max(...boxes.map((b) => b.x + b.w)) - x;
	const h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
	return { items, box: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } };
}

/**
 * Copies of clipped items for a drawing whose ids are `taken`: each item and everything in it given a
 * new id (from its name when it has one, as an insert gives them), arrows joined to the copies of what
 * they joined, a page's path renamed as `paths` says (a card copied to `cards/sales-2/`), and all of it
 * moved by `dx`, `dy`. Answers the copies and each old id's new one.
 */
export function pastedItems(items: readonly PenNode[], taken: Set<string>, options: { dx: number; dy: number; paths?: ReadonlyMap<string, string> }): { items: PenNode[]; ids: Map<string, string> } {
	const ids = new Map<string, string>();
	const copies = items.map((item) => clone(item));
	for (const one of walk(copies)) {
		const id = idFor(one.name, taken);
		taken.add(id);
		if (typeof one.id === "string") ids.set(one.id, id);
		one.id = id;
	}
	const paths = options.paths ?? new Map<string, string>();
	const renamed = (name: string) => ids.get(name) ?? paths.get(name) ?? name;
	const end = (value: unknown): unknown => {
		if (isPointEnd(value)) return [Math.round(value[0] + options.dx), Math.round(value[1] + options.dy)];
		if (typeof value === "string") return renamed(value);
		if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as { item?: unknown }).item === "string") return { ...(value as object), item: renamed((value as { item: string }).item) };
		return value;
	};
	for (const one of walk(copies)) {
		if (isArrow(one)) {
			const meta = one.metadata as Record<string, unknown>;
			one.metadata = { ...meta, ...("from" in meta ? { from: end(meta.from) } : {}), ...("to" in meta ? { to: end(meta.to) } : {}) } as PenNode["metadata"];
		}
	}
	for (const copy of copies) {
		if (typeof copy.x === "number") copy.x = Math.round(copy.x + options.dx);
		if (typeof copy.y === "number") copy.y = Math.round(copy.y + options.dy);
	}
	return { items: copies, ids };
}

/** The words of clipped items, for an app that takes only text: notes' and texts' words, and cards' and boards' titles. */
export function clipText(items: readonly PenNode[]): string {
	const lines: string[] = [];
	for (const one of walk(items)) {
		if ((one.type === "note" || one.type === "text") && typeof one.content === "string" && one.content.trim()) lines.push(one.content.trim());
		else if (one.type === "browser" && typeof one.name === "string" && one.name.trim()) lines.push(one.name.trim());
	}
	return lines.join("\n\n");
}

/** A clip read back from JSON, or undefined when it is not one: what any page may have put on a clipboard. */
export function parseClip(text: string | undefined | null): Clip | undefined {
	if (!text) return undefined;
	try {
		const clip = JSON.parse(text) as Partial<Clip>;
		if (clip?.v !== 1 || typeof clip.harness !== "string" || typeof clip.canvas !== "string" || !Array.isArray(clip.items) || !clip.box || typeof clip.box !== "object") return undefined;
		return clip as Clip;
	} catch {
		return undefined;
	}
}

/** The clip as the `text/html` a clipboard keeps where its own type does not survive, and the clip read back out of one. */
export function clipHtml(clip: Clip, text: string): string {
	const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return `<meta name="decks-clip" content="${escape(JSON.stringify(clip))}"><div>${escape(text).replace(/\n/g, "<br>")}</div>`;
}

export function clipFromHtml(html: string | undefined | null): Clip | undefined {
	const found = html ? /<meta\s+name=["']?decks-clip["']?\s+content="([^"]*)"/i.exec(html) : null;
	if (!found) return undefined;
	const text = found[1]!.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
	return parseClip(text);
}
