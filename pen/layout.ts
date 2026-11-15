import { pathBounds } from "./geometry.ts";
import { frameContent } from "./layout-frame.ts";
import { fixedOr, sizing, visible, type LayoutRun, type Placed } from "./layout-sizing.ts";
import { estimateText, NOTE_PAD, NOTE_WIDTH, TEXTY, textStyleOf, type MeasureText } from "./layout-text.ts";
import { MISSING } from "./refs.ts";
import type { PenDocument, PenNode } from "./types.ts";
import { resolve, type ThemeState, withTheme } from "./values.ts";

/**
 * Where every item is, as pen.dev lays it out.
 *
 * pen's layout is a small flexbox:
 *
 * - a `frame` lays its children in a row by default (`layout: "horizontal"`), or a column, or
 *   not at all (`"none"`, where each child sits at its own `x`, `y` from the frame's corner);
 * - `gap`, `padding`, `justifyContent` and `alignItems` mean what they mean in CSS;
 * - a size is a number, `fit_content` (hug the children; a frame's default), or `fill_container`
 *   (take the parent's room; only inside a layout). Either may carry a number, `fit_content(100)`:
 *   for a hug it is a floor, the least it is however little it holds, and for a fill a fallback;
 * - a child with `layoutPosition: "absolute"` leaves the flow and sits at its `x`, `y`;
 * - a `group` has no size of its own: it is the box around its children;
 * - text sizes itself by `textGrowth`: `auto` is one line as long as it is, `fixed-width` wraps at
 *   its width, `fixed-width-height` is the box it was given.
 *
 * Text is measured by whoever calls: the browser passes its real font engine, and the server a
 * width estimate, which is why a text box read on the server can be a few pixels off the one drawn.
 */

export * from "./layout-kinds.ts";
export { DEFAULT_FONT, DEFAULT_FONT_SIZE, estimateText, NOTE_PAD, NOTE_WIDTH, textStyleOf, type MeasureText, type TextStyle } from "./layout-text.ts";
export type { Frame, Placed } from "./layout-sizing.ts";

/** An item's own size, given what its parent decided for any `fill` dimension. */
function sizeOf(run: LayoutRun, node: PenNode, theme: ThemeState, forcedW?: number, forcedH?: number): { w: number; h: number } {
	const { doc } = run;
	const t = withTheme(theme, node);
	if (node.type === "group") {
		const kids = (node.children ?? []).filter((child) => visible(doc, child, t));
		let w = 0;
		let h = 0;
		for (const child of kids) {
			const size = sizeOf(run, child, t);
			w = Math.max(w, (child.x ?? 0) + size.w);
			h = Math.max(h, (child.y ?? 0) + size.h);
		}
		return { w, h };
	}
	if (TEXTY.has(node.type)) return textSize(run, node, t, forcedW, forcedH);
	if (node.type === "path") {
		const bounds = node.viewBox ? { w: node.viewBox[2], h: node.viewBox[3] } : pathBounds(node.geometry);
		const ws = sizing(doc, node.width, t, { kind: "fixed", value: bounds?.w ?? 0 });
		const hs = sizing(doc, node.height, t, { kind: "fixed", value: bounds?.h ?? 0 });
		return { w: forcedW ?? fixedOr(ws, bounds?.w ?? 0), h: forcedH ?? fixedOr(hs, bounds?.h ?? 0) };
	}
	if (node.type === "frame") {
		const ws = sizing(doc, node.width, t, { kind: "hug" });
		const hs = sizing(doc, node.height, t, { kind: "hug" });
		const inner = frameContent(run, node, t, ws.kind === "fixed" ? ws.value : forcedW, hs.kind === "fixed" ? hs.value : forcedH);
		// A hug's number is its floor: as big as what it holds, and never smaller than that.
		const hug = (s: { fallback?: number }, size: number) => (s.fallback === undefined ? size : inner.count === 0 ? s.fallback : Math.max(s.fallback, size));
		const w = forcedW ?? (ws.kind === "fixed" ? ws.value : ws.kind === "hug" ? hug(ws, inner.w) : (ws.fallback ?? inner.w));
		const h = forcedH ?? (hs.kind === "fixed" ? hs.value : hs.kind === "hug" ? hug(hs, inner.h) : (hs.fallback ?? inner.h));
		return { w, h };
	}
	// Rectangles, ellipses, polygons, browsers, icons, scripts, placeholders: the box they state.
	const fallback = node.type === MISSING ? 120 : node.type === "icon" || node.type === "icon_font" ? 24 : 100;
	const ws = sizing(doc, node.width, t, { kind: "fixed", value: fallback });
	const hs = sizing(doc, node.height, t, { kind: "fixed", value: fallback });
	return { w: forcedW ?? fixedOr(ws, fallback), h: forcedH ?? fixedOr(hs, fallback) };
}

/** The size of a text, a note, a prompt or a context, by its words and its growth. */
function textSize(run: LayoutRun, node: PenNode, t: ThemeState, forcedW?: number, forcedH?: number): { w: number; h: number } {
	const { doc, measure } = run;
	const style = textStyleOf(doc, node, t);
	const content = String(resolve(doc, node.content, t) ?? "");
	if (node.type !== "text") {
		// A note, prompt or context is a card: its width, and a height that holds its words.
		const ws = sizing(doc, node.width, t, { kind: "fixed", value: NOTE_WIDTH });
		const w = forcedW ?? fixedOr(ws, NOTE_WIDTH);
		const hs = sizing(doc, node.height, t, { kind: "hug" });
		const words = measure(content, style, Math.max(1, w - NOTE_PAD * 2), node);
		const h = forcedH ?? (hs.kind === "fixed" ? hs.value : words.h + NOTE_PAD * 2);
		return { w, h };
	}
	const growth = node.textGrowth ?? "auto";
	if (growth === "fixed-width-height") {
		const ws = sizing(doc, node.width, t, { kind: "fixed", value: 100 });
		const hs = sizing(doc, node.height, t, { kind: "fixed", value: 20 });
		return { w: forcedW ?? fixedOr(ws, 100), h: forcedH ?? fixedOr(hs, 20) };
	}
	if (growth === "fixed-width") {
		const ws = sizing(doc, node.width, t, { kind: "fixed", value: 100 });
		const w = forcedW ?? fixedOr(ws, 100);
		return { w, h: forcedH ?? measure(content, style, w, node).h };
	}
	const size = measure(content, style, undefined);
	return { w: forcedW ?? size.w, h: forcedH ?? size.h };
}

/** Place an item at its stage position, then its children. */
function place(run: LayoutRun, node: PenNode, at: { x: number; y: number }, size: { w: number; h: number }, parent: string | undefined, theme: ThemeState): void {
	const t = withTheme(theme, node);
	run.placed.set(node.id, { node, box: { x: at.x, y: at.y, w: size.w, h: size.h }, parent, theme: t, order: run.order++ });
	if (!Array.isArray(node.children) || node.children.length === 0) return;
	if (node.type === "group") return placeGroup(run, node, at, t);
	const { locals } = frameContent(run, node, t, size.w, size.h);
	for (const child of node.children) {
		const local = locals.get(child.id);
		if (!local) continue;
		place(run, child, { x: at.x + local.x, y: at.y + local.y }, { w: local.w, h: local.h }, node.id, t);
	}
}

/** A group's children at their own places; the group is then the box round what is in it. */
function placeGroup(run: LayoutRun, node: PenNode, at: { x: number; y: number }, t: ThemeState): void {
	let x1 = Infinity;
	let y1 = Infinity;
	let x2 = -Infinity;
	let y2 = -Infinity;
	for (const child of node.children ?? []) {
		if (!visible(run.doc, child, withTheme(t, child))) continue;
		place(run, child, { x: at.x + (child.x ?? 0), y: at.y + (child.y ?? 0) }, sizeOf(run, child, t), node.id, t);
		const box = run.placed.get(child.id)!.box;
		x1 = Math.min(x1, box.x);
		y1 = Math.min(y1, box.y);
		x2 = Math.max(x2, box.x + box.w);
		y2 = Math.max(y2, box.y + box.h);
	}
	// A group is the box round what is in it, wherever that starts, not a box from its own corner.
	if (x1 !== Infinity) run.placed.get(node.id)!.box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Lay out the expanded document: every item's box on the stage.
 *
 * `nodes` is the output of `expand`, so instances are already copies and every id is unique.
 */
export function layout(doc: PenDocument, nodes: readonly PenNode[], options: { theme: ThemeState; measure?: MeasureText }): Map<string, Placed> {
	const run: LayoutRun = {
		doc,
		measure: options.measure ?? estimateText,
		placed: new Map(),
		order: 0,
		size: (node, theme, forcedW, forcedH) => sizeOf(run, node, theme, forcedW, forcedH),
	};
	for (const node of nodes) {
		if (!visible(doc, node, withTheme(options.theme, node))) continue;
		place(run, node, { x: node.x ?? 0, y: node.y ?? 0 }, sizeOf(run, node, options.theme), undefined, options.theme);
	}
	return run.placed;
}
