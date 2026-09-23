import { pathBounds } from "./geometry.ts";
import { MISSING } from "./refs.ts";
import type { PenDocument, PenNode, SizeValue } from "./types.ts";
import { bool, fontWeightOf, num, paddingOf, resolve, type ThemeState, withTheme } from "./values.ts";

/**
 * Where every item is, as pen.dev lays it out.
 *
 * pen's layout is a small flexbox:
 *
 * - a `frame` lays its children in a row by default (`layout: "horizontal"`), or a column, or
 *   not at all (`"none"`, where each child sits at its own `x`, `y` from the frame's corner);
 * - `gap`, `padding`, `justifyContent` and `alignItems` mean what they mean in CSS;
 * - a size is a number, `fit_content` (hug the children; a frame's default), or `fill_container`
 *   (take the parent's room; only inside a layout). Either may carry a fallback, `fit_content(100)`;
 * - a child with `layoutPosition: "absolute"` leaves the flow and sits at its `x`, `y`;
 * - a `group` has no size of its own: it is the box around its children;
 * - text sizes itself by `textGrowth`: `auto` is one line as long as it is, `fixed-width` wraps at
 *   its width, `fixed-width-height` is the box it was given.
 *
 * Text is measured by whoever calls: the browser passes its real font engine, and the server a
 * width estimate, which is why a text box read on the server can be a few pixels off the one drawn.
 */

export interface Frame {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Measure text: one line when `maxWidth` is undefined, wrapped at it otherwise. */
export type MeasureText = (text: string, style: TextStyle, maxWidth: number | undefined) => { w: number; h: number };

export interface TextStyle {
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	fontStyle: string;
	letterSpacing: number;
	/** A multiplier of the font size; undefined is the font's own, as pen.dev draws it. */
	lineHeight: number | undefined;
}

export interface Placed {
	node: PenNode;
	/** Box on the stage, in stage pixels. */
	box: Frame;
	/** The parent item, undefined at the top. */
	parent: string | undefined;
	/** The theme in force here, for resolving variables when drawing. */
	theme: ThemeState;
	/** Depth-first order, which is paint order. */
	order: number;
}

export const DEFAULT_FONT = "Inter";
export const DEFAULT_FONT_SIZE = 14;
/** The note's padding and default width: pen.dev draws a note as a card with its text inside. */
export const NOTE_PAD = 16;
export const NOTE_WIDTH = 240;

/** A rough measure for the server, where there is no font engine: 0.55 em a character, 1 em for wide scripts. */
export const estimateText: MeasureText = (text, style, maxWidth) => {
	const em = style.fontSize;
	const charWidth = (ch: string) => (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? em : em * 0.55) + style.letterSpacing;
	const lineHeight = em * (style.lineHeight ?? 1.2);
	const lines: number[] = [];
	for (const paragraph of text.split("\n")) {
		if (maxWidth === undefined) {
			lines.push([...paragraph].reduce((sum, ch) => sum + charWidth(ch), 0));
			continue;
		}
		let line = 0;
		for (const word of paragraph.split(/(\s+)/)) {
			const width = [...word].reduce((sum, ch) => sum + charWidth(ch), 0);
			if (line > 0 && line + width > maxWidth && word.trim()) {
				lines.push(line);
				line = width;
			} else line += width;
		}
		lines.push(line);
	}
	const widest = Math.max(0, ...lines);
	return { w: maxWidth === undefined ? widest : Math.min(maxWidth, widest), h: Math.max(1, lines.length) * lineHeight };
};

type Sizing = { kind: "fixed"; value: number } | { kind: "hug"; fallback?: number } | { kind: "fill"; fallback?: number };

function sizing(doc: PenDocument, value: SizeValue | undefined, theme: ThemeState, whenMissing: Sizing): Sizing {
	if (value === undefined || value === null) return whenMissing;
	if (typeof value === "number") return { kind: "fixed", value };
	const text = String(value).trim();
	const behaviour = /^(fit_content|hug_content|fill_container)(?:\(\s*(-?[\d.]+)\s*\))?$/.exec(text);
	if (behaviour) {
		const fallback = behaviour[2] === undefined ? undefined : Number(behaviour[2]);
		const kind = behaviour[1] === "fill_container" ? "fill" : "hug";
		return fallback === undefined ? { kind } : { kind, fallback };
	}
	return { kind: "fixed", value: num(doc, text, theme, 0) };
}

const isFlowFrame = (node: PenNode) => node.type === "frame";
const layoutOf = (node: PenNode): "none" | "vertical" | "horizontal" =>
	node.layout === "vertical" || node.layout === "horizontal" || node.layout === "none" ? node.layout : isFlowFrame(node) ? "horizontal" : "none";

const visible = (doc: PenDocument, node: PenNode, theme: ThemeState) => bool(doc, node.enabled, theme, true);

export function textStyleOf(doc: PenDocument, node: PenNode, theme: ThemeState): TextStyle {
	const family = resolve(doc, node.fontFamily, theme);
	const style = resolve(doc, node.fontStyle, theme);
	return {
		fontFamily: typeof family === "string" && family ? family : DEFAULT_FONT,
		fontSize: num(doc, node.fontSize, theme, DEFAULT_FONT_SIZE),
		fontWeight: fontWeightOf(doc, node, theme),
		fontStyle: typeof style === "string" ? style : "normal",
		letterSpacing: num(doc, node.letterSpacing, theme, 0),
		lineHeight: node.lineHeight === undefined ? undefined : num(doc, node.lineHeight, theme, 1.2),
	};
}

const TEXTY = new Set(["text", "note", "prompt", "context"]);

/**
 * Lay out the expanded document: every item's box on the stage.
 *
 * `nodes` is the output of `expand`, so instances are already copies and every id is unique.
 */
export function layout(doc: PenDocument, nodes: readonly PenNode[], options: { theme: ThemeState; measure?: MeasureText }): Map<string, Placed> {
	const measure = options.measure ?? estimateText;
	const placed = new Map<string, Placed>();
	let order = 0;

	/** An item's own size, given what its parent decided for any `fill` dimension. */
	const sizeOf = (node: PenNode, theme: ThemeState, forcedW?: number, forcedH?: number): { w: number; h: number } => {
		const t = withTheme(theme, node);
		if (node.type === "group") {
			const kids = (node.children ?? []).filter((child) => visible(doc, child, t));
			let w = 0;
			let h = 0;
			for (const child of kids) {
				const size = sizeOf(child, t);
				w = Math.max(w, (child.x ?? 0) + size.w);
				h = Math.max(h, (child.y ?? 0) + size.h);
			}
			return { w, h };
		}
		if (TEXTY.has(node.type)) return textSize(node, t, forcedW, forcedH);
		if (node.type === "path") {
			const bounds = node.viewBox ? { w: node.viewBox[2], h: node.viewBox[3] } : pathBounds(node.geometry);
			const ws = sizing(doc, node.width, t, { kind: "fixed", value: bounds?.w ?? 0 });
			const hs = sizing(doc, node.height, t, { kind: "fixed", value: bounds?.h ?? 0 });
			return { w: forcedW ?? fixedOr(ws, bounds?.w ?? 0), h: forcedH ?? fixedOr(hs, bounds?.h ?? 0) };
		}
		if (node.type === "frame") {
			const ws = sizing(doc, node.width, t, { kind: "hug" });
			const hs = sizing(doc, node.height, t, { kind: "hug" });
			const inner = frameContent(node, t, ws.kind === "fixed" ? ws.value : forcedW, hs.kind === "fixed" ? hs.value : forcedH);
			const w = forcedW ?? (ws.kind === "fixed" ? ws.value : ws.kind === "hug" ? (inner.count === 0 && ws.fallback !== undefined ? ws.fallback : inner.w) : (ws.fallback ?? inner.w));
			const h = forcedH ?? (hs.kind === "fixed" ? hs.value : hs.kind === "hug" ? (inner.count === 0 && hs.fallback !== undefined ? hs.fallback : inner.h) : (hs.fallback ?? inner.h));
			return { w, h };
		}
		// Rectangles, ellipses, polygons, browsers, icons, scripts, placeholders: the box they state.
		const fallback = node.type === MISSING ? 120 : node.type === "icon" || node.type === "icon_font" ? 24 : 100;
		const ws = sizing(doc, node.width, t, { kind: "fixed", value: fallback });
		const hs = sizing(doc, node.height, t, { kind: "fixed", value: fallback });
		return { w: forcedW ?? fixedOr(ws, fallback), h: forcedH ?? fixedOr(hs, fallback) };
	};

	const fixedOr = (s: Sizing, fallback: number) => (s.kind === "fixed" ? s.value : (s.fallback ?? fallback));

	const textSize = (node: PenNode, t: ThemeState, forcedW?: number, forcedH?: number) => {
		const style = textStyleOf(doc, node, t);
		const content = String(resolve(doc, node.content, t) ?? "");
		if (node.type !== "text") {
			// A note, prompt or context is a card: its width, and a height that holds its words.
			const ws = sizing(doc, node.width, t, { kind: "fixed", value: NOTE_WIDTH });
			const w = forcedW ?? fixedOr(ws, NOTE_WIDTH);
			const hs = sizing(doc, node.height, t, { kind: "hug" });
			const words = measure(content, style, Math.max(1, w - NOTE_PAD * 2));
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
			return { w, h: forcedH ?? measure(content, style, w).h };
		}
		const size = measure(content, style, undefined);
		return { w: forcedW ?? size.w, h: forcedH ?? size.h };
	};

	/**
	 * The content box a frame's children need, and where each goes, relative to the frame.
	 *
	 * `w` and `h` are the frame's own size when it is known (fixed or forced) and undefined when it
	 * hugs; the returned `w`/`h` are the size the frame would hug to.
	 */
	const frameContent = (node: PenNode, t: ThemeState, w: number | undefined, h: number | undefined) => {
		const kids = (node.children ?? []).filter((child) => visible(doc, child, withTheme(t, child)));
		const mode = layoutOf(node);
		const locals = new Map<string, Frame>();
		if (mode === "none") {
			let right = 0;
			let bottom = 0;
			for (const child of kids) {
				const size = sizeOf(child, t);
				const box = { x: child.x ?? 0, y: child.y ?? 0, w: size.w, h: size.h };
				locals.set(child.id, box);
				right = Math.max(right, box.x + box.w);
				bottom = Math.max(bottom, box.y + box.h);
			}
			return { w: right, h: bottom, count: kids.length, locals };
		}
		const [pt, pr, pb, pl] = paddingOf(doc, node, t);
		const gap = num(doc, node.gap, t, 0);
		const row = mode === "horizontal";
		const flow = kids.filter((child) => child.layoutPosition !== "absolute");
		const floating = kids.filter((child) => child.layoutPosition === "absolute");
		const innerMain = row ? (w === undefined ? undefined : w - pl - pr) : h === undefined ? undefined : h - pt - pb;
		const innerCross = row ? (h === undefined ? undefined : h - pt - pb) : w === undefined ? undefined : w - pl - pr;

		const mainOf = (child: PenNode) => sizing(doc, row ? child.width : child.height, withTheme(t, child), defaultSizing(child));
		const crossOf = (child: PenNode) => sizing(doc, row ? child.height : child.width, withTheme(t, child), defaultSizing(child));

		// First pass: every child that is not filling the main axis, at its own size.
		const sizes = new Map<string, { w: number; h: number }>();
		let used = 0;
		const fillers: PenNode[] = [];
		for (const child of flow) {
			const main = mainOf(child);
			if (main.kind === "fill" && innerMain !== undefined) {
				fillers.push(child);
				continue;
			}
			const cross = crossOf(child);
			const forcedCross = cross.kind === "fill" && innerCross !== undefined ? Math.max(0, innerCross) : undefined;
			const size = row ? sizeOf(child, t, undefined, forcedCross) : sizeOf(child, t, forcedCross, undefined);
			sizes.set(child.id, size);
			used += row ? size.w : size.h;
		}
		const gaps = Math.max(0, flow.length - 1) * gap;
		if (fillers.length > 0 && innerMain !== undefined) {
			const share = Math.max(0, (innerMain - used - gaps) / fillers.length);
			for (const child of fillers) {
				const cross = crossOf(child);
				const forcedCross = cross.kind === "fill" && innerCross !== undefined ? Math.max(0, innerCross) : undefined;
				const size = row ? sizeOf(child, t, share, forcedCross) : sizeOf(child, t, forcedCross, share);
				sizes.set(child.id, size);
				used += row ? size.w : size.h;
			}
		}
		const contentMain = used + gaps;
		const contentCross = Math.max(0, ...flow.map((child) => {
			const size = sizes.get(child.id)!;
			return row ? size.h : size.w;
		}));
		const mainBox = innerMain ?? contentMain;
		const crossBox = innerCross ?? contentCross;

		// Second pass: positions along the main axis, then the cross.
		const free = Math.max(0, mainBox - contentMain);
		const justify = node.justifyContent ?? "start";
		let cursor = 0;
		let between = gap;
		if (justify === "center") cursor = free / 2;
		else if (justify === "end") cursor = free;
		else if (justify === "space_between" && flow.length > 1) between = gap + free / (flow.length - 1);
		else if (justify === "space_around" && flow.length > 0) {
			cursor = free / flow.length / 2;
			between = gap + free / flow.length;
		}
		const align = node.alignItems ?? "start";
		for (const child of flow) {
			const size = sizes.get(child.id)!;
			const childMain = row ? size.w : size.h;
			const childCross = row ? size.h : size.w;
			const crossAt = align === "center" ? (crossBox - childCross) / 2 : align === "end" ? crossBox - childCross : 0;
			const box = row
				? { x: pl + cursor, y: pt + crossAt, w: size.w, h: size.h }
				: { x: pl + crossAt, y: pt + cursor, w: size.w, h: size.h };
			locals.set(child.id, box);
			cursor += childMain + between;
		}
		for (const child of floating) {
			const size = sizeOf(child, t);
			locals.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, w: size.w, h: size.h });
		}
		const hugW = row ? contentMain + pl + pr : contentCross + pl + pr;
		const hugH = row ? contentCross + pt + pb : contentMain + pt + pb;
		return { w: hugW, h: hugH, count: flow.length, locals };
	};

	/** Place an item at its stage position, then its children. */
	const place = (node: PenNode, at: { x: number; y: number }, size: { w: number; h: number }, parent: string | undefined, theme: ThemeState) => {
		const t = withTheme(theme, node);
		placed.set(node.id, { node, box: { x: at.x, y: at.y, w: size.w, h: size.h }, parent, theme: t, order: order++ });
		if (!Array.isArray(node.children) || node.children.length === 0) return;
		if (node.type === "group") {
			for (const child of node.children) {
				if (!visible(doc, child, withTheme(t, child))) continue;
				const childSize = sizeOf(child, t);
				place(child, { x: at.x + (child.x ?? 0), y: at.y + (child.y ?? 0) }, childSize, node.id, t);
			}
			return;
		}
		const { locals } = frameContent(node, t, size.w, size.h);
		for (const child of node.children) {
			const local = locals.get(child.id);
			if (!local) continue;
			place(child, { x: at.x + local.x, y: at.y + local.y }, { w: local.w, h: local.h }, node.id, t);
		}
	};

	for (const node of nodes) {
		if (!visible(doc, node, withTheme(options.theme, node))) continue;
		const size = sizeOf(node, options.theme);
		place(node, { x: node.x ?? 0, y: node.y ?? 0 }, size, undefined, options.theme);
	}
	return placed;
}

/** What an absent width or height means for each kind of item. */
function defaultSizing(node: PenNode): Sizing {
	if (node.type === "frame" || node.type === "group") return { kind: "hug" };
	if (TEXTY.has(node.type)) return { kind: "hug" };
	if (node.type === "icon" || node.type === "icon_font") return { kind: "fixed", value: 24 };
	return { kind: "fixed", value: 100 };
}
