import { isMarkdown, NOTE_PAD, textStyleOf } from "./layout.ts";
import { outlineOf } from "./outline.ts";
import type { PenDocument, PenNode } from "./types.ts";
import { bool, fillsOf, isVariable, num, resolve, strokeOf, type ThemeState } from "./values.ts";
import { styleAttr, itemBox, toColour, DEFAULT_INK, escapeAttr, escapeText, cssLength, NOTE_PAPER, px, r2, type Decl, type Writer } from "./html-writer.ts";
import { strokeOutline, paintBox, svgPaint } from "./html-paint.ts";

export function iconOf(doc: PenDocument, node: PenNode, theme: ThemeState): { library: string; name: string; weight: number } | undefined {
	if (node.type !== "icon" && node.type !== "icon_font") return undefined;
	const font = node.type === "icon_font";
	const library = String(resolve(doc, font ? node.iconFontFamily : node.library, theme) ?? "lucide") || "lucide";
	const name = String(resolve(doc, font ? node.iconFontName : node.icon, theme) ?? "");
	if (!name) return undefined;
	return { library, name, weight: num(doc, node.weight, theme, 400) };
}

/** A rectangle, or a whole ellipse: a box with its paint and its outline. */
export function shapeElement(w: Writer, node: PenNode, theme: ThemeState, css: Decl[], attrs: string, round = false): string {
	if (!css.some(([k]) => k === "position")) css.push(["position", "relative"]);
	paintBox(w, node, theme, css, round);
	const outline = strokeOutline(w, node, theme, round);
	return `<div ${attrs}${styleAttr(w, css)}>${outline}</div>`;
}

/** A path, a polygon, or an arc or ring: inline SVG of the outline the canvas draws. */
export function svgShape(w: Writer, node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
	const box = itemBox(w, node);
	const d = outlineOf(w.doc, node, box.w, box.h, theme);
	if (!d) return `<div ${attrs}${styleAttr(w, css)}></div>`;
	const even = node.fillRule === "evenodd" || (node.type === "ellipse" && num(w.doc, node.innerRadius, theme, 0) > 0);
	const defs: string[] = [];
	const fill = svgPaint(w, fillsOf(node.fill), theme, box, defs);
	const stroke = strokeOf(w.doc, node, theme);
	const line = stroke ? svgPaint(w, stroke.fills, theme, box, defs) : undefined;
	const dash = node.strokeDash === "dashed" ? ` stroke-dasharray="${r2(stroke!.widths[0] * 4)} ${r2(stroke!.widths[0] * 3)}"` : node.strokeDash === "dotted" ? ` stroke-dasharray="0.01 ${r2(stroke!.widths[0] * 2.5)}" stroke-linecap="round"` : "";
	const strokeAttrs = line && stroke ? ` stroke="${escapeAttr(line)}" stroke-width="${r2(stroke.widths[0])}" stroke-linecap="${stroke.cap}" stroke-linejoin="${stroke.join}"${dash}` : "";
	const svg = `<svg ${attrs} xmlns="http://www.w3.org/2000/svg" width="${r2(box.w)}" height="${r2(box.h)}" viewBox="0 0 ${r2(box.w)} ${r2(box.h)}"${styleAttr(w, css)}>${defs.length ? `<defs>${defs.join("")}</defs>` : ""}<path d="${escapeAttr(d)}" fill="${escapeAttr(fill ?? "none")}"${even ? ' fill-rule="evenodd"' : ""}${strokeAttrs}/></svg>`;
	return svg;
}

/** The words' font, as CSS sets it, and the face asked for, so the page loads it. */
export function setFont(w: Writer, node: PenNode, theme: ThemeState, css: Decl[]): void {
	const style = textStyleOf(w.doc, node, theme);
	const italic = style.fontStyle.toLowerCase() === "italic";
	const faces = w.families.get(style.fontFamily) ?? new Set<string>();
	faces.add(`${style.fontWeight} ${italic ? "italic" : "normal"}`);
	w.families.set(style.fontFamily, faces);
	const family = style.fontFamily.replace(/["\\]/g, "");
	css.push(["font-family", `${/^[A-Za-z][\w-]*$/.test(family) ? family : `"${family}"`}, Inter, sans-serif`]);
	css.push(["font-size", isVariable(node.fontSize) ? cssLength(w, node.fontSize, theme, 14) : px(style.fontSize)]);
	css.push(["font-weight", String(style.fontWeight)]);
	if (italic) css.push(["font-style", "italic"]);
	css.push(["line-height", style.lineHeight === undefined ? "normal" : r2(style.lineHeight)]);
	if (style.letterSpacing) css.push(["letter-spacing", isVariable(node.letterSpacing) ? cssLength(w, node.letterSpacing, theme) : px(style.letterSpacing)]);
}

export function inkOf(w: Writer, node: PenNode, theme: ThemeState): string {
	for (const fill of fillsOf(node.fill)) {
		const colour = typeof fill === "string" ? toColour(w, fill, theme) : fill?.type === "color" ? toColour(w, (fill as { color?: unknown }).color, theme) : undefined;
		if (colour) return colour;
	}
	return DEFAULT_INK;
}

export function textElement(w: Writer, node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
	const content = String(resolve(w.doc, node.content, theme) ?? "");
	setFont(w, node, theme, css);
	css.push(["color", inkOf(w, node, theme)]);
	const growth = node.textGrowth ?? "auto";
	css.push(["white-space", growth === "auto" ? "pre" : "pre-wrap"]);
	if (growth !== "auto") css.push(["overflow-wrap", "break-word"]);
	const align = node.textAlign ?? "left";
	if (align !== "left") css.push(["text-align", align]);
	const lines = [bool(w.doc, node.underline, theme, false) ? "underline" : "", bool(w.doc, node.strikethrough, theme, false) ? "line-through" : ""].filter(Boolean);
	if (lines.length) css.push(["text-decoration", lines.join(" ")]);
	const words = escapeText(content);
	const href = typeof node.href === "string" && node.href ? node.href : undefined;
	const inner = href ? `<a href="${escapeAttr(href)}" style="color: inherit">${words}</a>` : words;
	if (growth === "fixed-width-height" && node.textAlignVertical && node.textAlignVertical !== "top") {
		css.push(["display", "flex"], ["flex-direction", "column"], ["justify-content", node.textAlignVertical === "middle" ? "center" : "flex-end"]);
		return `<div ${attrs}${styleAttr(w, css)}><span>${inner}</span></div>`;
	}
	return `<div ${attrs}${styleAttr(w, css)}>${inner}</div>`;
}

/** A note, prompt or context: its paper and its words, as the canvas draws one. */
export function noteElement(w: Writer, node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
	const content = String(resolve(w.doc, node.content, theme) ?? "");
	const paper = isMarkdown(node) ? "#ffffff" : (NOTE_PAPER[node.type] ?? "#fde68a");
	css.push(["background-color", paper], ["border-radius", "12px"], ["padding", px(NOTE_PAD)], ["box-shadow", "0 1px 2px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.1)"]);
	setFont(w, node, theme, css);
	css.push(["color", "#1f2328"], ["white-space", "pre-wrap"], ["overflow-wrap", "break-word"]);
	return `<div ${attrs}${styleAttr(w, css)}>${escapeText(content)}</div>`;
}

export function iconElement(w: Writer, node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
	const box = itemBox(w, node);
	const asked = iconOf(w.doc, node, theme);
	const shape = asked ? w.options.icons?.(asked.library, asked.name, asked.weight) : undefined;
	if (!shape) return `<div ${attrs}${styleAttr(w, css)}></div>`;
	const ink = inkOf(w, node, theme);
	const parts = shape.parts
		.map((part) => {
			const fill = part.fill ? ink : "none";
			const stroke = part.stroke ? ` stroke="${escapeAttr(ink)}" stroke-width="${r2(part.strokeWidth)}" stroke-linecap="${part.cap}" stroke-linejoin="${part.join}"` : "";
			return `<path d="${escapeAttr(part.d)}" fill="${escapeAttr(fill)}"${part.evenOdd ? ' fill-rule="evenodd"' : ""}${stroke}/>`;
		})
		.join("");
	return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg" width="${r2(box.w)}" height="${r2(box.h)}" viewBox="${shape.viewBox.map(r2).join(" ")}"${styleAttr(w, css)}>${parts}</svg>`;
}
