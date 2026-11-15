import type { PenDocument, PenNode, SizeValue } from "./types.ts";
import { TEXTY, type MeasureText } from "./layout-text.ts";
import { bool, num, type ThemeState } from "./values.ts";

export interface Frame {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Placed {
	node: PenNode;
	/** Box on the canvas, in canvas pixels. */
	box: Frame;
	/** The parent item, undefined at the top. */
	parent: string | undefined;
	/** The theme in force here, for resolving variables when drawing. */
	theme: ThemeState;
	/** Depth-first order, which is paint order. */
	order: number;
}

/** One run of `layout`: the document, how words are measured, and what is placed so far. */
export interface LayoutRun {
	doc: PenDocument;
	measure: MeasureText;
	placed: Map<string, Placed>;
	order: number;
	/** An item's own size, given what its parent decided for any `fill` dimension. */
	size(node: PenNode, theme: ThemeState, forcedW?: number, forcedH?: number): { w: number; h: number };
}

export type Sizing = { kind: "fixed"; value: number } | { kind: "hug"; fallback?: number } | { kind: "fill"; fallback?: number };

export function sizing(doc: PenDocument, value: SizeValue | undefined, theme: ThemeState, whenMissing: Sizing): Sizing {
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

export const fixedOr = (s: Sizing, fallback: number) => (s.kind === "fixed" ? s.value : (s.fallback ?? fallback));

const isFlowFrame = (node: PenNode) => node.type === "frame";
export const layoutOf = (node: PenNode): "none" | "vertical" | "horizontal" =>
	node.layout === "vertical" || node.layout === "horizontal" || node.layout === "none" ? node.layout : isFlowFrame(node) ? "horizontal" : "none";

export const visible = (doc: PenDocument, node: PenNode, theme: ThemeState) => bool(doc, node.enabled, theme, true);

/** What an absent width or height means for each kind of item. */
export function defaultSizing(node: PenNode): Sizing {
	if (node.type === "frame" || node.type === "group") return { kind: "hug" };
	if (TEXTY.has(node.type)) return { kind: "hug" };
	if (node.type === "icon" || node.type === "icon_font") return { kind: "fixed", value: 24 };
	return { kind: "fixed", value: 100 };
}
