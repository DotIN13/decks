import { walk } from "./doc.ts";
import { PenError } from "./doc.ts";
import { estimateText, layout, MEDIA, type MeasureText } from "./layout.ts";
import { expand, MISSING } from "./refs.ts";
import type { PenDocument, PenNode } from "./types.ts";
import { baseTheme, bool, isVariable, num, paddingOf, type ThemeState } from "./values.ts";
import { styleAttr, itemBox, escapeAttr, escapeText, fontFaces, layoutOf, cssLength, makeWriter, px, r2, sizingOf, TEXTY, textSizes, themeOf, themeVars, variables, type Decl, type Writer } from "./html-writer.ts";
import { blurRadius, strokeOutline, paintBox, cornerRadius } from "./html-paint.ts";
import { iconElement, iconOf, noteElement, shapeElement, svgShape, textElement } from "./html-items.ts";

export { cssName, tailwindClass } from "./html-writer.ts";

/**
 * Frames as one HTML page (`decks.canvas.export`): the items asked for, each with what is in it,
 * written the way a person would write them by hand rather than as boxes at fixed places.
 *
 * - a frame with a layout is a flexbox: `layout` the direction, `gap`, `padding`, `justifyContent`
 *   and `alignItems` as CSS has them; `fill_container` is `flex: 1` along the row or column and
 *   `align-self: stretch` across it, `fit_content` is the size the content gives, a number is px;
 * - a frame with no layout, a group, and an item placed `absolute` hold their children at the
 *   places pen lays them out at, relative to themselves;
 * - text is set in its family, size, weight, line height, letter spacing and colour, on one line
 *   (`auto`), wrapping at its width (`fixed-width`), or in its box (`fixed-width-height`);
 * - fills are a colour, a linear, radial or angular (conic) gradient, or a picture (its address as
 *   `url` gives it);
 *   strokes are an outline over the children on the side pen strokes (inside, centred, outside),
 *   with the item's corners; shadows (inner ones inset), blurs, opacity and turns are CSS's own;
 * - icons are inline SVG of the icon sets the stage draws them from, as `icons` hands them over;
 *   paths, polygons and arcs are inline SVG of the outline the stage draws;
 * - variables are CSS custom properties, with the dark theme's values in a `prefers-color-scheme:
 *   dark` block (and under `data-theme="dark"`), and an item with a theme of its own sets its own.
 *
 * `format: "tailwind"` writes the same page with Tailwind classes (arbitrary values where Tailwind
 * has no name for one) and Tailwind's browser build from its CDN in place of inline styles.
 *
 * What the stage keeps but does not draw (shader and mesh fills, background blurs, inner shadows off
 * boxes, scripts) is left out here too. A note is its paper with its words; a markdown card's words
 * are written as they are.
 */

/** An icon's shapes, as the canvas reads them (`icons.ts` in `@decks/canvas`). */
export interface HtmlIcon {
	viewBox: [number, number, number, number];
	parts: Array<{ d: string; fill: boolean; stroke: boolean; strokeWidth: number; cap: string; join: string; evenOdd: boolean }>;
}

export interface HtmlOptions {
	format: "html" | "tailwind";
	/** The light theme's starting state; the document's own light theme when left out. */
	theme?: ThemeState;
	/** Text is laid out by this where pen's layout needs a size (absolute children's places). */
	measure?: MeasureText;
	/** An icon's shapes by library, name and weight, fetched beforehand (`iconsIn`); none: the icon is left out. */
	icons?: (library: string, name: string, weight: number) => HtmlIcon | undefined;
	/** An image fill's address as the page reads it: relative to where the page is written. Left as it is when absent. */
	url?: (url: string) => string;
	/** A board's address (a `browser` item's), shown in an iframe; none: a grey box with its name. */
	board?: (node: PenNode) => string | undefined;
	/** The page's title. */
	title?: string;
}

/** The icons the items asked for use, to fetch before writing the page. */
export function iconsIn(doc: PenDocument, ids: readonly string[]): Array<{ library: string; name: string; weight: number }> {
	const theme = baseTheme(doc, "light");
	const out = new Map<string, { library: string; name: string; weight: number }>();
	for (const root of rootsOf(doc, expand(doc), ids)) {
		for (const node of walk([root])) {
			const icon = iconOf(doc, node, theme);
			if (icon) out.set(`${icon.library}|${icon.name}|${icon.weight}`, icon);
		}
	}
	return [...out.values()];
}

/** The page, whole: one HTML document of the items `ids` names, in that order. */
export function toHtml(doc: PenDocument, ids: readonly string[], options: HtmlOptions): string {
	const theme = options.theme ?? baseTheme(doc, "light");
	const nodes = expand(doc);
	const placed = layout(doc, nodes, { theme, measure: options.measure ?? estimateText });
	const roots = rootsOf(doc, nodes, ids);
	const writer = makeWriter(doc, placed, theme, options);
	const body = roots.map((root) => element(writer, root, undefined)).join("\n");
	const tailwind = options.format === "tailwind";
	const head = [
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escapeText(options.title ?? roots.map((root) => root.name ?? root.id).join(", "))}</title>`,
		...(tailwind ? ['<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>'] : []),
		`<style>\n${[fontFaces(writer), variables(writer), BASE].filter(Boolean).join("\n")}\n</style>`,
	];
	const page = tailwind ? ' class="m-0 flex flex-col items-start gap-[48px] p-[24px]"' : "";
	return `<!doctype html>\n<html lang="en">\n<head>\n${head.join("\n")}\n</head>\n<body${page}>\n${body}\n</body>\n</html>\n`;
}

/** What every page starts from: no margins, sizes include padding, the canvas's paper and ink. */
const BASE = `*, *::before, *::after { box-sizing: border-box; margin: 0; }
body { margin: 0; padding: 24px; display: flex; flex-direction: column; align-items: flex-start; gap: 48px; background: #f1f1f3; color: #1f2328; font-family: Inter, sans-serif; -webkit-font-smoothing: antialiased; }
@media (prefers-color-scheme: dark) { body { background: #101010; color: #e6e6e6; } }
svg { display: block; overflow: visible; }`;

function rootsOf(doc: PenDocument, nodes: readonly PenNode[], ids: readonly string[]): PenNode[] {
	if (ids.length === 0) throw new PenError("Say what to export: an item's id, or a list of them.");
	const all = [...walk(nodes)];
	return ids.map((id) => {
		const found = all.find((node) => node.id === id);
		if (!found) throw new PenError(`There is no item ${id} to export: read the canvas for the ids there are.`);
		return found;
	});
}



/** One item as an element, with what is in it. */
export function element(w: Writer, node: PenNode, parent: PenNode | undefined): string {
	const theme = themeOf(w, node);
	if (!bool(w.doc, node.enabled, theme, true)) return "";
	const css: Decl[] = [];
	placeItem(w, node, parent, css);
	themeVars(w, node, parent, css);
	const opacity = num(w.doc, node.opacity, theme, 1);
	if (opacity < 1) css.push(["opacity", r2(Math.max(0, opacity))]);
	// pen's blur radius is two of the Gaussian's sigmas, as the canvas draws it; CSS's is one.
	const blur = blurRadius(w, node, theme);
	if (blur > 0) css.push(["filter", `blur(${px(blur / 2)})`]);
	const turn = num(w.doc, node.rotation, theme, 0);
	if (turn) css.push(["transform", `rotate(${r2(-turn)}deg)`], ["transform-origin", "0 0"]);
	const flipX = bool(w.doc, node.flipX, theme, false);
	const flipY = bool(w.doc, node.flipY, theme, false);
	if (flipX || flipY) css.push(["scale", `${flipX ? -1 : 1} ${flipY ? -1 : 1}`]);
	const attrs = `data-pen-id="${escapeAttr(node.id)}"`;
	switch (node.type) {
		case "frame":
		case "group":
			return frameElement(w, node, theme, css, attrs);
		case "rectangle":
			return shapeElement(w, node, theme, css, attrs);
		case "ellipse": {
			const inner = num(w.doc, node.innerRadius, theme, 0);
			const sweep = num(w.doc, node.sweepAngle, theme, 360);
			if (inner <= 0 && Math.abs(sweep) >= 360) return shapeElement(w, node, theme, css, attrs, true);
			return svgShape(w, node, theme, css, attrs);
		}
		case "polygon":
		case "path":
			return svgShape(w, node, theme, css, attrs);
		case "text":
			return textElement(w, node, theme, css, attrs);
		case "note":
		case "prompt":
		case "context":
			return noteElement(w, node, theme, css, attrs);
		case "icon":
		case "icon_font":
			return iconElement(w, node, theme, css, attrs);
		case "browser":
			return browserElement(w, node, theme, css, attrs);
		default: {
			// What the canvas cannot draw either: a dashed box saying what it is.
			css.push(["border", `1.5px dashed ${node.type === MISSING ? "#dc3333" : "#8c8c94"}`], ["border-radius", "6px"], ["color", "#666670"], ["font-size", "13px"], ["padding", "8px"]);
			return `<div ${attrs}${styleAttr(w, css)}>${escapeText(node.type === MISSING ? `missing: ${String(node.why ?? node.id)}` : node.type)}</div>`;
		}
	}
}

/** Where an item sits and how big it is: in its parent's flow, or at its place in a parent with no layout. */
export function placeItem(w: Writer, node: PenNode, parent: PenNode | undefined, css: Decl[]): void {
	const box = itemBox(w, node);
	const theme = themeOf(w, node);
	const inFlow = parent !== undefined && parent.type === "frame" && layoutOf(parent) !== "none" && node.layoutPosition !== "absolute";
	const frameHugs = (axis: "width" | "height") => node.type === "frame" && layoutOf(node) !== "none" && sizingOf(w, node[axis], theme, node).kind === "hug";
	if (!inFlow) {
		if (parent) {
			const at = itemBox(w, parent);
			css.push(["position", "absolute"], ["left", px(box.x - at.x)], ["top", px(box.y - at.y)]);
		} else css.push(["position", "relative"]);
		// Hugging frames size to what they hold; anything else is the size pen gives it.
		for (const axis of ["width", "height"] as const) {
			if (frameHugs(axis)) {
				if (axis === "width") css.push(["width", "max-content"]);
			} else if (!textSizes(w, node, axis)) css.push([axis, px(axis === "width" ? box.w : box.h)]);
		}
		return;
	}
	const row = layoutOf(parent!) === "horizontal";
	const parentTheme = themeOf(w, parent!);
	const parentMain = sizingOf(w, row ? parent!.width : parent!.height, parentTheme, parent!);
	const parentCross = sizingOf(w, row ? parent!.height : parent!.width, parentTheme, parent!);
	for (const axis of ["width", "height"] as const) {
		const main = (axis === "width") === row;
		const sizing = sizingOf(w, node[axis], theme, node, axis);
		const size = axis === "width" ? box.w : box.h;
		if (sizing.kind === "fill" && main && parentMain.kind !== "hug") {
			css.push(["flex", "1 1 0px"], [axis === "width" ? "min-width" : "min-height", "0"]);
		} else if (sizing.kind === "fill" && !main && parentCross.kind !== "hug") {
			css.push(["align-self", "stretch"]);
		} else if (sizing.kind === "hug" && (node.type === "frame" || node.type === "group" || TEXTY.has(node.type))) {
			if (main) css.push(["flex-shrink", "0"]);
		} else {
			// A fixed size, or a fill with nothing to fill: the size pen gives it.
			if (!textSizes(w, node, axis)) css.push([axis, px(size)]);
			if (main) css.push(["flex-shrink", "0"]);
		}
	}
}

/** A frame or a group: its paint, its layout, its children, and its outline over them. */
export function frameElement(w: Writer, node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
	const mode = node.type === "frame" ? layoutOf(node) : "none";
	if (!css.some(([k]) => k === "position")) css.push(["position", "relative"]);
	if (mode !== "none") {
		const [pt, pr, pb, pl] = paddingOf(w.doc, node, theme);
		css.push(["display", "flex"], ["flex-direction", mode === "horizontal" ? "row" : "column"]);
		if (node.gap !== undefined) css.push(["gap", cssLength(w, node.gap, theme)]);
		if (pt || pr || pb || pl) css.push(["padding", Array.isArray(node.padding) || isVariable(node.padding) ? [pt, pr, pb, pl].map(px).join(" ") : px(pt)]);
		const justify = { start: "flex-start", center: "center", end: "flex-end", space_between: "space-between", space_around: "space-around" }[node.justifyContent ?? "start"] ?? "flex-start";
		const align = { start: "flex-start", center: "center", end: "flex-end" }[node.alignItems ?? "start"] ?? "flex-start";
		css.push(["justify-content", justify], ["align-items", align]);
	}
	if (node.type === "frame") paintBox(w, node, theme, css);
	if (node.type === "frame" && bool(w.doc, node.clip, theme, false)) css.push(["overflow", "hidden"]);
	const kids = (node.children ?? []).map((child) => element(w, child, node)).filter(Boolean);
	const outline = node.type === "frame" ? strokeOutline(w, node, theme) : "";
	return `<div ${attrs}${styleAttr(w, css)}>${kids.length || outline ? "\n" : ""}${kids.join("\n")}${outline ? `\n${outline}` : ""}${kids.length || outline ? "\n" : ""}</div>`;
}

/** A board: its page in a frame, as the canvas shows it; a grey box with its name when there is no address. */
export function browserElement(w: Writer, node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
	const address = w.options.board?.(node);
	const radius = cornerRadius(w, node, theme, false) ?? "12px";
	css.push(["border", "0"], ["border-radius", radius], ["background-color", "#ffffff"], ["box-shadow", "0 0 0 1px rgba(0, 0, 0, 0.1)"]);
	if (node.metadata?.type === MEDIA) return `<div ${attrs}${styleAttr(w, css)}></div>`;
	if (address) return `<iframe ${attrs} src="${escapeAttr(address)}" title="${escapeAttr(node.name ?? node.id)}" loading="lazy"${styleAttr(w, css)}></iframe>`;
	return `<div ${attrs}${styleAttr(w, css)}>${escapeText(node.name ?? node.id)}</div>`;
}
