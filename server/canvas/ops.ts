import { apply as penApply, baseTheme, expandVariables, indexOf, isArrow, reroute, boxOf as penBox, placements, walk, withDecksColors, type Op as PenOp, type PenDocument, type PenNode } from "@decks/pen";
import { Refused } from "../../protocol/index.ts";
import type { ItemOp } from "../kernel/types.ts";
import { sizedOnly, type Kinds } from "./kinds.ts";
import { cornerOf, joinCorner, type Box, type Corner } from "./place.ts";

// One protocol op on a working copy of a drawing: found, placed, turned into
// pen's own edit and applied. The op comes back as written down, with the ids
// it made, so replaying the log makes the same drawing.

export type Step = { doc: PenDocument; op: ItemOp; id: string };
export type Where = { canvas: string; kinds: Kinds };

/** Every item's box in the light theme, by id. */
export function boxes(doc: PenDocument): Map<string, Box> {
	const out = new Map<string, Box>();
	for (const [id, placed] of placements(doc, { theme: baseTheme(doc, "light") })) {
		const box = penBox(placed);
		if (box) out.set(id, box);
	}
	return out;
}

/** An id as the file has it, from an id or a card's path. */
export function findId(doc: PenDocument, ref: string, where: Where): string | undefined {
	const nodes = [...walk(doc.children)];
	if (nodes.some((n) => n.id === ref)) return ref;
	const want = pageKey(ref, where.canvas);
	for (const node of nodes) {
		const item = where.kinds.toItem(node, where.canvas);
		for (const path of [item.card, item.path, (item as { board?: unknown }).board]) if (typeof path === "string" && pageKey(path, where.canvas) === want) return node.id;
	}
	if (ref.includes("/") && boxes(doc).has(ref)) return ref;
	return undefined;
}

/** A page's path in one spelling: no canvas prefix, no trailing /index.html, so its folder names it too. */
function pageKey(path: string, canvas: string): string {
	const prefix = `canvases/${canvas}/`;
	const local = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	return local.replace(/\/+$/, "").replace(/\/index\.html$/i, "");
}

function must(doc: PenDocument, ref: string, where: Where): string {
	const id = findId(doc, ref, where);
	if (!id) throw new Refused("not_found", `Nothing called ${ref} is on this canvas.`, "item.list");
	return id;
}

/** Top-level boxes, arrows aside. */
function tops(doc: PenDocument): Box[] {
	const all = boxes(doc);
	return doc.children.filter((n) => !isArrow(n)).map((n) => all.get(n.id)).filter((b): b is Box => !!b);
}

/** The newest top-level item a kind owns (a page: a card, a document, an app), else the newest one drawn. */
function newestPage(doc: PenDocument, where: Where): Box | undefined {
	const all = boxes(doc);
	const items = [...doc.children].reverse().filter((n) => !isArrow(n) && all.has(n.id));
	const page = items.find((n) => where.kinds.of(n)) ?? items[0];
	return page ? all.get(page.id) : undefined;
}

const sizeOf = (node: Partial<PenNode>, given: Box | undefined): { w: number; h: number } =>
	given ? { w: given.x2 - given.x1, h: given.y2 - given.y1 } : { w: typeof node.width === "number" ? node.width : 240, h: typeof node.height === "number" ? node.height : 120 };

/** Apply one op to doc (unchanged) and give the new copy. */
export function step(doc: PenDocument, op: ItemOp, where: Where): Step {
	const all = boxes(doc);
	const boxOf = (ref: string) => { const id = findId(doc, ref, where); return id ? all.get(id) : undefined; };
	const { pen, written } = toPen(doc, op, where, all, boxOf);
	const ops = withDecksColors(doc, [pen]) as PenOp[];
	const result = penApply(doc, ops, { theme: baseTheme(doc, "light") });
	const made = op.op === "variables" ? "" : result.results[result.results.length - 1]!.id;
	if (written.op === "insert") written.item = { ...written.item, id: made };
	if (written.op === "copy") written.as = made;
	return { doc: result.doc, op: written, id: made };
}

type Found = (ref: string) => Box | undefined;

function toPen(doc: PenDocument, op: ItemOp, where: Where, all: Map<string, Box>, boxOf: Found): { pen: PenOp; written: ItemOp } {
	switch (op.op) {
		case "insert": return insertOf(doc, op, where, boxOf);
		case "update": {
			const id = must(doc, op.id, where);
			const now = all.get(id);
			const box: Partial<Box> = {};
			if (op.at) Object.assign(box, { x1: op.at.x, y1: op.at.y });
			if (op.size && now) {
				const x1 = box.x1 ?? now.x1, y1 = box.y1 ?? now.y1;
				Object.assign(box, { x1, y1, ...(op.size.w !== undefined ? { x2: x1 + op.size.w } : {}), ...(op.size.h !== undefined ? { y2: y1 + op.size.h } : {}) });
			}
			const pen: PenOp = { op: "update", id, ...(op.set ? { set: op.set } : {}), ...(Object.keys(box).length ? { box } : {}) };
			return { pen, written: { ...op, id } };
		}
		case "replace": {
			const id = must(doc, op.id, where);
			const node = where.kinds.toNode({ ...op.item, id }, where.canvas);
			return { pen: { op: "replace", id, node }, written: { op: "replace", id, item: { ...op.item, id } } };
		}
		case "delete": {
			const id = must(doc, op.id, where);
			return { pen: { op: "delete", id }, written: { op: "delete", id } };
		}
		case "move": {
			const id = must(doc, op.id, where);
			const corner = cornerOf(op, boxOf);
			const pen: PenOp = { op: "move", id, ...inside(op), ...movedBox(doc, id, op.parent, corner, all.get(id)) };
			return { pen, written: { op: "move", id, ...inside(op), ...(corner ? { at: corner } : {}) } };
		}
		case "copy": {
			const id = must(doc, op.id, where);
			const pen: PenOp = { op: "copy", id, ...(op.as ? { as: op.as } : {}), ...inside(op), ...(op.at ? { box: { x1: op.at.x, y1: op.at.y } } : {}) };
			return { pen, written: { ...op, id } };
		}
		case "variables": {
			const themes = op.themes === null ? undefined : (op.themes ?? doc.themes);
			const wide = expandVariables(op.set, themes);
			const axes = wide.themes ?? op.themes;
			const pen = { op: "variables", set: wide.set, ...(axes !== undefined ? { themes: axes } : {}) } as PenOp;
			return { pen, written: op };
		}
	}
	throw new Refused("invalid", `${(op as { op?: unknown }).op} is not an op: insert, update, replace, delete, move or copy.`, "item.batch");
}

/** A move's box: its corner, and its drawn size too when it changes parent, so it keeps that size. */
function movedBox(doc: PenDocument, id: string, parent: string | null | undefined, corner: Corner | undefined, now: Box | undefined): { box?: Partial<Box> } {
	const was = indexOf(doc).get(id)?.parent?.id ?? null;
	const leaves = parent !== undefined && parent !== was && now;
	if (!leaves) return corner ? { box: { x1: corner.x, y1: corner.y } } : {};
	const x1 = corner?.x ?? now.x1, y1 = corner?.y ?? now.y1;
	return { box: { x1, y1, x2: x1 + now.x2 - now.x1, y2: y1 + now.y2 - now.y1 } };
}

const inside = (op: { parent?: string | null; index?: number }) => ({ ...(op.parent !== undefined ? { parent: op.parent } : {}), ...(op.index !== undefined ? { index: op.index } : {}) });

function insertOf(doc: PenDocument, op: Extract<ItemOp, { op: "insert" }>, where: Where, boxOf: Found): { pen: PenOp; written: ItemOp } {
	if (!op.item || typeof op.item.type !== "string") throw new Refused("invalid", "insert needs an item with a type, as in { type: note, content: Hi }.", "item.insert");
	if (op.item.id && findId(doc, op.item.id, where)) throw new Refused("conflict", `An item called ${op.item.id} is already on this canvas.`, "item.update");
	for (const page of [op.item.card, op.item.path]) {
		const there = typeof page === "string" ? findId(doc, page, where) : undefined;
		if (there) throw new Refused("conflict", `${page} is already on this canvas, as ${there}: item.move moves it.`, "item.move");
	}
	let corner: Corner | undefined = cornerOf(op, boxOf);
	const given = op.item.box;
	if (!corner && given && !sizedOnly.has(op.item)) corner = { x: given.x1, y: given.y1 };
	const ownXY = typeof op.item.x === "number" && typeof op.item.y === "number";
	const node0 = where.kinds.toNode(op.item, where.canvas);
	if (!corner && !ownXY && op.parent == null && !isArrow(node0 as PenNode)) corner = joinCorner(sizeOf(node0, given), newestPage(doc, where), tops(doc));
	const box = corner ? { x1: corner.x, y1: corner.y, ...(given ? { x2: corner.x + given.x2 - given.x1, y2: corner.y + given.y2 - given.y1 } : {}) } : undefined;
	const node = node0 as Partial<PenNode> & { type: string };
	const { box: _drop, ...item } = op.item;
	const pen: PenOp = { op: "insert", node, ...inside(op), ...(box ? { box } : {}) };
	return { pen, written: { op: "insert", item: given ? { ...item, box: given } : item, ...inside(op), ...(corner ? { at: corner } : {}) } };
}

/** Route every joined arrow again between its ends, in place; the ids of those that moved. */
export function routeArrows(doc: PenDocument, canvas: string): string[] {
	const arrows = [...walk(doc.children)].filter(isArrow);
	if (!arrows.length) return [];
	const was = new Map(arrows.map((a) => [a.id, JSON.stringify(a)] as const));
	const placed = placements(doc, { theme: baseTheme(doc, "light") });
	const byPath = (name: string) => {
		const local = name.startsWith(`canvases/${canvas}/`) ? name.slice(`canvases/${canvas}/`.length) : name;
		const node = [...walk(doc.children)].find((n) => (n.metadata as { path?: unknown } | undefined)?.path === local);
		return node ? placed.get(node.id)?.box : undefined;
	};
	reroute(doc, placed, byPath);
	return arrows.filter((a) => was.get(a.id) !== JSON.stringify(a)).map((a) => a.id);
}
