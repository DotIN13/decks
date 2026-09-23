import type { Fill, Fills, LegacyStroke, PenDocument, PenNode, VariableValue } from "./types.ts";

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
	const def = doc.variables?.[name.replace(/^\$/, "")];
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

/** `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`; undefined for anything else. */
export function parseColor(text: unknown): Rgba | undefined {
	if (typeof text !== "string") return undefined;
	const hex = text.trim().replace(/^#/, "");
	if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;
	const expand = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
	if (expand.length !== 6 && expand.length !== 8) return undefined;
	const at = (i: number) => parseInt(expand.slice(i, i + 2), 16) / 255;
	return [at(0), at(2), at(4), expand.length === 8 ? at(6) : 1];
}

export function color(doc: PenDocument, value: unknown, theme: ThemeState): Rgba | undefined {
	return parseColor(resolve(doc, value, theme));
}

/** A fill list, whatever form the file used: one colour, one object, or several. */
export function fillsOf(fills: Fills | undefined): Fill[] {
	if (fills === undefined || fills === null) return [];
	return Array.isArray(fills) ? fills : [fills];
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
