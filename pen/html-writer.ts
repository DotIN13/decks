import type { HtmlOptions } from "./html.ts";
import type { Frame, Placed } from "./layout.ts";
import type { PenDocument, PenNode, SizeValue } from "./types.ts";
import { baseTheme, isVariable, num, parseColor, resolve, variable, withTheme, type Rgba, type ThemeState } from "./values.ts";

/** One page being written: the document, where pen lays each item, the theme, and the fonts and gradients used so far. */
export interface Writer {
	doc: PenDocument;
	placed: Map<string, Placed>;
	theme: ThemeState;
	options: HtmlOptions;
	families: Map<string, Set<string>>;
	tailwind: boolean;
	gradients: number;
}

export function makeWriter(doc: PenDocument, placed: Map<string, Placed>, theme: ThemeState, options: HtmlOptions): Writer {
	return { doc, placed, theme, options, families: new Map(), tailwind: options.format === "tailwind", gradients: 0 };
}

export const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");
export const r2 = (n: number) => {
	const v = Math.round(n * 100) / 100;
	return Object.is(v, -0) ? "0" : String(v);
};
export const px = (n: number) => `${r2(n)}px`;

/** A variable's CSS name: `$--card` and `$card` are both `--card`. */
export function cssName(name: string): string {
	const bare = name.replace(/^\$/, "").replace(/^--/, "");
	return `--${bare.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export type Decl = [string, string];

export const DEFAULT_INK = "#1f2328";
export const NOTE_PAPER: Record<string, string> = { note: "#fde68a", prompt: "#ddd6fe", context: "#bfdbfe" };
const FONT_CDN = "https://cdn.jsdelivr.net/fontsource/fonts";

export type Sizing = { kind: "fixed"; value: number } | { kind: "hug" } | { kind: "fill" };

export const TEXTY = new Set(["text", "note", "prompt", "context"]);

export const layoutOf = (node: PenNode): "none" | "vertical" | "horizontal" => (node.layout === "vertical" || node.layout === "horizontal" || node.layout === "none" ? node.layout : node.type === "frame" ? "horizontal" : "none");

export function rgbaText([r, g, b, a]: Rgba, alpha = 1): string {
	const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
	return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${r2(a * alpha)})`;
}


export function itemBox(w: Writer, node: PenNode): Frame {
	return w.placed.get(node.id)?.box ?? { x: 0, y: 0, w: 0, h: 0 };
}

export function themeOf(w: Writer, node: PenNode): ThemeState {
	return w.placed.get(node.id)?.theme ?? withTheme(w.theme, node);
}

/** A colour as CSS: a variable is its custom property, a literal its own spelling; undefined when it is no colour. */
export function toColour(w: Writer, value: unknown, theme: ThemeState, alpha = 1): string | undefined {
	if (isVariable(value)) {
		if (!parseColor(resolve(w.doc, value, theme))) return undefined;
		const name = cssName(value);
		return alpha >= 1 ? `var(${name})` : `color-mix(in srgb, var(${name}) ${r2(alpha * 100)}%, transparent)`;
	}
	const rgba = parseColor(value);
	if (!rgba) return undefined;
	if (alpha >= 1 && typeof value === "string") return value.trim();
	return rgbaText(rgba, alpha);
}

/** A number in px: a variable's custom property times 1px. */
export function cssLength(w: Writer, value: unknown, theme: ThemeState, fallback = 0): string {
	if (isVariable(value) && w.doc.variables?.[value.slice(1)]?.type === "number") return `calc(var(${cssName(value)}) * 1px)`;
	return px(num(w.doc, value, theme, fallback));
}

/** A variable's value in a theme, as CSS writes it: a colour as it is, a number as a plain number. */
export function literalOf(w: Writer, name: string, state: ThemeState): string | undefined {
	const value = variable(w.doc, `$${name.replace(/^\$/, "")}`, state);
	if (value === undefined) return undefined;
	return typeof value === "number" ? r2(value) : String(value);
}

/** `:root` custom properties for every colour and number variable, the dark theme's where they differ. */
export function variables(w: Writer): string {
	const vars = Object.entries(w.doc.variables ?? {}).filter(([, def]) => def.type === "color" || def.type === "number");
	if (vars.length === 0) return "";
	const dark = baseTheme(w.doc, "dark");
	const line = (state: ThemeState, only?: (name: string, value: string) => boolean) =>
		vars
			.map(([name]) => {
				const value = literalOf(w, name, state);
				return value === undefined || (only && !only(name, value)) ? "" : `  ${cssName(name)}: ${value};`;
			})
			.filter(Boolean)
			.join("\n");
	const light = line(w.theme);
	const darker = line(dark, (name, value) => value !== literalOf(w, name, w.theme));
	return [`:root {\n${light}\n}`, ...(darker ? [`@media (prefers-color-scheme: dark) {\n:root {\n${darker}\n}\n}`, `:root[data-theme="dark"] {\n${darker}\n}`] : [])].join("\n");
}

/** `@font-face` rules for each family and weight the page's words are set in, from the files the canvas uses. */
export function fontFaces(w: Writer): string {
	const rules: string[] = [];
	for (const [family, faces] of w.families) {
		const id = family.trim().toLowerCase().replace(/\s+/g, "-");
		for (const face of faces) {
			const [weight, style] = face.split(" ");
			rules.push(`@font-face { font-family: "${family}"; font-weight: ${weight}; font-style: ${style}; font-display: block; src: url("${FONT_CDN}/${id}@latest/latin-${weight}-${style}.woff2") format("woff2"), url("${FONT_CDN}/${id}@latest/latin-${weight}-${style}.ttf") format("truetype"); }`);
		}
	}
	return rules.join("\n");
}

/** An item with a theme of its own sets the variables that differ under it. */
export function themeVars(w: Writer, node: PenNode, parent: PenNode | undefined, css: Decl[]): void {
	if (!node.theme || typeof node.theme !== "object") return;
	const mine = themeOf(w, node);
	const theirs = parent ? themeOf(w, parent) : w.theme;
	for (const [name, def] of Object.entries(w.doc.variables ?? {})) {
		if (def.type !== "color" && def.type !== "number") continue;
		const value = literalOf(w, name, mine);
		if (value !== undefined && value !== literalOf(w, name, theirs)) css.push([cssName(name), value]);
	}
}

export function sizingOf(w: Writer, value: SizeValue | undefined, theme: ThemeState, node: PenNode, axis?: "width" | "height"): Sizing {
	if (value === undefined || value === null) {
		// A note is as wide as pen makes it (240) unless told, and as tall as its words.
		if (TEXTY.has(node.type) && node.type !== "text" && axis === "width") return { kind: "fixed", value: 0 };
		return node.type === "frame" || node.type === "group" || TEXTY.has(node.type) ? { kind: "hug" } : { kind: "fixed", value: 0 };
	}
	if (typeof value === "number") return { kind: "fixed", value };
	const text = String(value).trim();
	if (/^fill_container/.test(text)) return { kind: "fill" };
	if (/^(fit_content|hug_content)/.test(text)) return { kind: "hug" };
	return { kind: "fixed", value: num(w.doc, text, theme, 0) };
}

/** Whether a text's own growth sizes it along an axis, so no size is written. */
export function textSizes(w: Writer, node: PenNode, axis: "width" | "height"): boolean {
	if (node.type === "text") {
		const growth = node.textGrowth ?? "auto";
		return growth === "auto" || (growth === "fixed-width" && axis === "height");
	}
	return TEXTY.has(node.type) && axis === "height" && sizingOf(w, node.height, themeOf(w, node), node).kind === "hug";
}

/** Declarations as the page writes them: a `style` attribute, or Tailwind classes. */
export function styleAttr(w: Writer, css: Decl[]): string {
	if (css.length === 0) return "";
	if (!w.tailwind) return ` style="${escapeAttr(css.map(([k, v]) => `${k}: ${v}`).join("; "))}"`;
	return ` class="${escapeAttr(css.map(([k, v]) => tailwindClass(k, v)).join(" "))}"`;
}

/** Spaces in an arbitrary value are underscores to Tailwind; an underscore of its own is escaped. */
const arbitrary = (value: string) => value.replace(/_/g, "\\_").replace(/\s*,\s*/g, ",").replace(/\s+/g, "_");
const simple = (value: string) => !/[\s(),"']/.test(value);

/** One declaration as a Tailwind class: its own utility where Tailwind has one, an arbitrary property otherwise. */
export function tailwindClass(property: string, value: string): string {
	const named: Record<string, Record<string, string>> = {
		display: { flex: "flex", block: "block" },
		"flex-direction": { row: "flex-row", column: "flex-col" },
		position: { relative: "relative", absolute: "absolute" },
		"justify-content": { "flex-start": "justify-start", center: "justify-center", "flex-end": "justify-end", "space-between": "justify-between", "space-around": "justify-around" },
		"align-items": { "flex-start": "items-start", center: "items-center", "flex-end": "items-end" },
		"align-self": { stretch: "self-stretch" },
		"flex-shrink": { "0": "shrink-0" },
		overflow: { hidden: "overflow-hidden" },
		"white-space": { pre: "whitespace-pre", "pre-wrap": "whitespace-pre-wrap" },
		"text-align": { center: "text-center", right: "text-right", justify: "text-justify", left: "text-left" },
		"font-style": { italic: "italic" },
		"pointer-events": { none: "pointer-events-none" },
		"border-style": { solid: "border-solid", dashed: "border-dashed", dotted: "border-dotted" },
		"min-width": { "0": "min-w-0" },
		"min-height": { "0": "min-h-0" },
	};
	const word = named[property]?.[value];
	if (word) return word;
	const prefixed: Record<string, string> = { width: "w", height: "h", gap: "gap", left: "left", top: "top", right: "right", bottom: "bottom", padding: "p", opacity: "opacity", "background-color": "bg", "border-radius": "rounded", "font-size": "text", "border-color": "border", "letter-spacing": "tracking", "line-height": "leading" };
	const prefix = prefixed[property];
	if (prefix && simple(value) && !property.startsWith("--")) {
		// A colour or a length can read as either to Tailwind: say which.
		const hint = property === "background-color" || property === "border-color" ? "color:" : property === "font-size" ? "length:" : "";
		return `${prefix}-[${hint}${arbitrary(value)}]`;
	}
	return `[${property}:${arbitrary(value)}]`;
}
