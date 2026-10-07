import { IMPORTED, type Fill, type Fills, type LegacyStroke, type PenDocument, type PenNode, type VariableValue } from "./types.ts";

/**
 * What a property means once its variables are resolved.
 *
 * A `.pen` value may be `$name`, bound to a document variable whose value can differ by theme:
 * `{ "--card": { type: "color", value: [{ value: "#fff" }, { value: "#1c1c1e", theme: { Mode: "Dark" } }] } }`.
 * The theme in force is the nearest `theme` on the item or its ancestors, over the stage's own
 * (light or dark, from the app), over the first value of each axis.
 */

export type ThemeState = Record<string, string>;

/** The starting theme for a document shown in light or dark: each axis whose values name the mode takes it. */
export function baseTheme(doc: PenDocument, mode: "light" | "dark"): ThemeState {
	const state: ThemeState = {};
	for (const [axis, values] of Object.entries(doc.themes ?? {})) {
		const match = values.find((value) => value.toLowerCase() === mode);
		const first = values[0];
		if (match) state[axis] = match;
		else if (first !== undefined) state[axis] = first;
	}
	return state;
}

export function withTheme(theme: ThemeState, node: PenNode): ThemeState {
	return node.theme && typeof node.theme === "object" ? { ...theme, ...node.theme } : theme;
}

export function isVariable(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("$") && value.length > 1;
}

/** A variable's value in this theme, following `$a` → `$b` chains; undefined when it does not exist. */
export function variable(doc: PenDocument, name: string, theme: ThemeState, depth = 0): VariableValue | undefined {
	const key = name.replace(/^\$/, "");
	// This file's own first, then an imported file's: a component from another file keeps its colours.
	let def = doc.variables?.[key];
	if (!def) for (const other of Object.values(doc[IMPORTED] ?? {})) if ((def = other?.variables?.[key])) break;
	if (!def || depth > 8) return undefined;
	let value: VariableValue | undefined;
	if (Array.isArray(def.value)) {
		const entries = def.value;
		const fits = (entry: { theme?: Record<string, string> }) => !entry.theme || Object.entries(entry.theme).every(([axis, v]) => theme[axis] === v);
		// The most specific entry that fits: a themed match beats the plain default.
		const themed = entries.filter((entry) => entry.theme && fits(entry));
		const plain = entries.find((entry) => !entry.theme);
		value = (themed[themed.length - 1] ?? plain ?? entries[0])?.value;
	} else value = def.value;
	return isVariable(value) ? variable(doc, value, theme, depth + 1) : value;
}

export function resolve(doc: PenDocument, value: unknown, theme: ThemeState): unknown {
	return isVariable(value) ? variable(doc, value, theme) : value;
}

export function num(doc: PenDocument, value: unknown, theme: ThemeState, fallback = 0): number {
	const got = resolve(doc, value, theme);
	if (typeof got === "number" && Number.isFinite(got)) return got;
	if (typeof got === "string" && got.trim() !== "" && Number.isFinite(Number(got))) return Number(got);
	return fallback;
}

export function bool(doc: PenDocument, value: unknown, theme: ThemeState, fallback: boolean): boolean {
	const got = resolve(doc, value, theme);
	return typeof got === "boolean" ? got : fallback;
}

/** RGBA, each 0 to 1. */
export type Rgba = [number, number, number, number];

/**
 * The 148 colour names CSS knows, because people and agents write `"lightblue"` far sooner than
 * they write `"#add8e6"` — and a colour this file cannot read is a fill that silently does not
 * happen. Only the names; the notations are parsed below.
 */
const NAMED: Record<string, string> = {
	aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff", beige: "f5f5dc", bisque: "ffe4c4", black: "000000",
	blanchedalmond: "ffebcd", blue: "0000ff", blueviolet: "8a2be2", brown: "a52a2a", burlywood: "deb887", cadetblue: "5f9ea0", chartreuse: "7fff00",
	chocolate: "d2691e", coral: "ff7f50", cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c", cyan: "00ffff", darkblue: "00008b",
	darkcyan: "008b8b", darkgoldenrod: "b8860b", darkgray: "a9a9a9", darkgreen: "006400", darkgrey: "a9a9a9", darkkhaki: "bdb76b", darkmagenta: "8b008b",
	darkolivegreen: "556b2f", darkorange: "ff8c00", darkorchid: "9932cc", darkred: "8b0000", darksalmon: "e9967a", darkseagreen: "8fbc8f",
	darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f", darkturquoise: "00ced1", darkviolet: "9400d3", deeppink: "ff1493",
	deepskyblue: "00bfff", dimgray: "696969", dimgrey: "696969", dodgerblue: "1e90ff", firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22",
	fuchsia: "ff00ff", gainsboro: "dcdcdc", ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080", green: "008000",
	greenyellow: "adff2f", grey: "808080", honeydew: "f0fff0", hotpink: "ff69b4", indianred: "cd5c5c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c",
	lavender: "e6e6fa", lavenderblush: "fff0f5", lawngreen: "7cfc00", lemonchiffon: "fffacd", lightblue: "add8e6", lightcoral: "f08080",
	lightcyan: "e0ffff", lightgoldenrodyellow: "fafad2", lightgray: "d3d3d3", lightgreen: "90ee90", lightgrey: "d3d3d3", lightpink: "ffb6c1",
	lightsalmon: "ffa07a", lightseagreen: "20b2aa", lightskyblue: "87cefa", lightslategray: "778899", lightslategrey: "778899", lightsteelblue: "b0c4de",
	lightyellow: "ffffe0", lime: "00ff00", limegreen: "32cd32", linen: "faf0e6", magenta: "ff00ff", maroon: "800000", mediumaquamarine: "66cdaa",
	mediumblue: "0000cd", mediumorchid: "ba55d3", mediumpurple: "9370db", mediumseagreen: "3cb371", mediumslateblue: "7b68ee",
	mediumspringgreen: "00fa9a", mediumturquoise: "48d1cc", mediumvioletred: "c71585", midnightblue: "191970", mintcream: "f5fffa", mistyrose: "ffe4e1",
	moccasin: "ffe4b5", navajowhite: "ffdead", navy: "000080", oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23", orange: "ffa500",
	orangered: "ff4500", orchid: "da70d6", palegoldenrod: "eee8aa", palegreen: "98fb98", paleturquoise: "afeeee", palevioletred: "db7093",
	papayawhip: "ffefd5", peachpuff: "ffdab9", peru: "cd853f", pink: "ffc0cb", plum: "dda0dd", powderblue: "b0e0e6", purple: "800080",
	rebeccapurple: "663399", red: "ff0000", rosybrown: "bc8f8f", royalblue: "4169e1", saddlebrown: "8b4513", salmon: "fa8072", sandybrown: "f4a460",
	seagreen: "2e8b57", seashell: "fff5ee", sienna: "a0522d", silver: "c0c0c0", skyblue: "87ceeb", slateblue: "6a5acd", slategray: "708090",
	slategrey: "708090", snow: "fffafa", springgreen: "00ff7f", steelblue: "4682b4", tan: "d2b48c", teal: "008080", thistle: "d8bfd8", tomato: "ff6347",
	turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff", whitesmoke: "f5f5f5", yellow: "ffff00", yellowgreen: "9acd32",
};

/** `hsl` to `rgb`, each 0 to 1. */
function fromHsl(h: number, s: number, l: number): [number, number, number] {
	const turn = ((h % 360) + 360) % 360;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((turn / 60) % 2) - 1));
	const m = l - c / 2;
	const band: [number, number, number] = turn < 60 ? [c, x, 0] : turn < 120 ? [x, c, 0] : turn < 180 ? [0, c, x] : turn < 240 ? [0, x, c] : turn < 300 ? [x, 0, c] : [c, 0, x];
	return [band[0] + m, band[1] + m, band[2] + m];
}

/**
 * A colour, in any notation a person or an agent is likely to write: `#RGB`, `#RGBA`, `#RRGGBB`,
 * `#RRGGBBAA`, a CSS name, `rgb()`, `rgba()`, `hsl()`, `hsla()` or `transparent`. Undefined for
 * anything else.
 *
 * Hex alone is what pen.dev writes, and hex alone is what this read for a long time — so a card
 * filled `"lightblue"` drew its default paper with nothing said, which reads as "fill is ignored
 * here" and got worked around rather than reported.
 */
export function parseColor(text: unknown): Rgba | undefined {
	if (typeof text !== "string") return undefined;
	const value = text.trim().toLowerCase();
	if (!value) return undefined;
	if (value === "transparent") return [0, 0, 0, 0];
	const hex = (NAMED[value] ?? value).replace(/^#/, "");
	if (/^[0-9a-f]+$/.test(hex)) {
		const expand = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
		if (expand.length !== 6 && expand.length !== 8) return undefined;
		const at = (i: number) => parseInt(expand.slice(i, i + 2), 16) / 255;
		return [at(0), at(2), at(4), expand.length === 8 ? at(6) : 1];
	}
	const call = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(value);
	if (!call) return undefined;
	const parts = call[2]!.split(/[\s,/]+/).filter(Boolean);
	if (parts.length < 3) return undefined;
	// A percentage is of its own axis; an alpha of 0 to 1, or a percentage of it.
	const n = (at: number, of: number) => {
		const part = parts[at]!;
		const value = Number.parseFloat(part);
		if (!Number.isFinite(value)) return undefined;
		return part.endsWith("%") ? (value / 100) * of : value;
	};
	const alpha = parts.length > 3 ? n(3, 1) : 1;
	if (alpha === undefined) return undefined;
	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	if (call[1]!.startsWith("rgb")) {
		const r = n(0, 255);
		const g = n(1, 255);
		const b = n(2, 255);
		if (r === undefined || g === undefined || b === undefined) return undefined;
		return [clamp(r / 255), clamp(g / 255), clamp(b / 255), clamp(alpha)];
	}
	// `hsl` is a hue in degrees and two percentages, whether or not the per cent signs are there.
	const plain = (at: number) => {
		const value = Number.parseFloat(parts[at]!);
		return Number.isFinite(value) ? value : undefined;
	};
	const h = plain(0);
	const s = plain(1);
	const l = plain(2);
	if (h === undefined || s === undefined || l === undefined) return undefined;
	const [r, g, b] = fromHsl(h, clamp(s / 100), clamp(l / 100));
	return [clamp(r), clamp(g), clamp(b), clamp(alpha)];
}

/** A colour back as `#rrggbb`, for the fields and swatches that only speak hex. */
export function toHex(rgba: Rgba | undefined): string | undefined {
	if (!rgba) return undefined;
	const two = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
	return `#${two(rgba[0])}${two(rgba[1])}${two(rgba[2])}`;
}

export function color(doc: PenDocument, value: unknown, theme: ThemeState): Rgba | undefined {
	return parseColor(resolve(doc, value, theme));
}

/**
 * A fill list, whatever form the file used: one colour, one object, or several.
 *
 * `{ type: "solid", color }` is read as pen's own `{ type: "color", color }`. It is not pen's
 * spelling, but it is the one everybody reaches for — and a fill nobody can read is a fill that
 * silently does not happen.
 */
export function fillsOf(fills: Fills | undefined): Fill[] {
	const list = fills === undefined || fills === null ? [] : Array.isArray(fills) ? fills : [fills];
	return list.map((fill) => (fill && typeof fill === "object" && (fill as { type?: string }).type === "solid" ? ({ ...(fill as object), type: "color" } as Fill) : fill));
}

export interface StrokeSpec {
	fills: Fill[];
	/** Per side, top right bottom left. Uniform strokes have four equal numbers. */
	widths: [number, number, number, number];
	align: "inner" | "center" | "outer";
	cap: "butt" | "round" | "square";
	join: "miter" | "bevel" | "round";
}

const isLegacyStroke = (stroke: unknown): stroke is LegacyStroke =>
	!!stroke && typeof stroke === "object" && !Array.isArray(stroke) && !("type" in (stroke as object)) && ("thickness" in (stroke as object) || "align" in (stroke as object) || "fill" in (stroke as object));

/**
 * The stroke an item draws, from either spelling pen.dev has used.
 *
 * The published form is `stroke` (fills) plus `strokeWidth` and friends; older files have one
 * object, `{ align, thickness, fill }`. No stroke, or a zero width, is `undefined`.
 */
export function strokeOf(doc: PenDocument, node: PenNode, theme: ThemeState): StrokeSpec | undefined {
	const legacy = isLegacyStroke(node.stroke) ? node.stroke : undefined;
	const fills = legacy ? fillsOf(legacy.fill) : fillsOf(node.stroke as Fills | undefined);
	if (fills.length === 0) return undefined;
	const rawWidth = legacy ? legacy.thickness : node.strokeWidth;
	let widths: [number, number, number, number];
	if (rawWidth && typeof rawWidth === "object") {
		const w = rawWidth as Record<string, unknown>;
		widths = [num(doc, w.top, theme), num(doc, w.right, theme), num(doc, w.bottom, theme), num(doc, w.left, theme)];
	} else {
		const uniform = num(doc, rawWidth, theme, 1);
		widths = [uniform, uniform, uniform, uniform];
	}
	if (widths.every((w) => w <= 0)) return undefined;
	const legacyAlign = legacy?.align === "inside" ? "inner" : legacy?.align === "outside" ? "outer" : legacy?.align === "center" ? "center" : undefined;
	const align = node.strokeAlignment ?? legacyAlign ?? "center";
	const cap = (node.strokeLinecap ?? (legacy?.cap as StrokeSpec["cap"] | undefined) ?? "butt") as StrokeSpec["cap"];
	const join = (node.strokeLinejoin ?? (legacy?.join as StrokeSpec["join"] | undefined) ?? "miter") as StrokeSpec["join"];
	return { fills, widths, align, cap: cap === "round" || cap === "square" ? cap : "butt", join: join === "round" || join === "bevel" ? join : "miter" };
}

/** Padding as top, right, bottom, left, from any of pen's three forms. */
export function paddingOf(doc: PenDocument, node: PenNode, theme: ThemeState): [number, number, number, number] {
	const p = node.padding;
	if (Array.isArray(p)) {
		const v = p.map((value) => num(doc, value, theme));
		if (v.length === 2) return [v[0] ?? 0, v[1] ?? 0, v[0] ?? 0, v[1] ?? 0];
		return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];
	}
	const all = num(doc, p, theme);
	return [all, all, all, all];
}

/** Corner radii as top-left, top-right, bottom-right, bottom-left. */
export function radiiOf(doc: PenDocument, node: PenNode, theme: ThemeState): [number, number, number, number] {
	const r = node.cornerRadius;
	if (Array.isArray(r)) {
		const v = r.map((value) => num(doc, value, theme));
		return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];
	}
	const all = num(doc, r, theme);
	return [all, all, all, all];
}

const WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, normal: 400, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };

export function fontWeightOf(doc: PenDocument, node: PenNode, theme: ThemeState): number {
	const raw = resolve(doc, node.fontWeight, theme);
	if (typeof raw === "number") return raw;
	if (typeof raw === "string") return WEIGHTS[raw.toLowerCase()] ?? (Number.isFinite(Number(raw)) ? Number(raw) : 400);
	return 400;
}
