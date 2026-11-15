import type { PenDocument, PenVariable } from "./types.ts";

/**
 * The colours Decks gives what its tools make, as the drawing's own colour variables, each with a
 * light value and a dark one, so a rectangle drawn on a dark canvas is not a pale slab on it (and an
 * icon not dark ink on dark). An item refers to one as `"$decks-fill-slate"`; the insert that makes it
 * also defines whichever of them the drawing does not have yet (`withDecksColors`). Light values are
 * what the tools always made; dark ones sit on the dark canvas (`#242424`) beside the app's dark
 * palette (`canvas/render/look.ts`).
 *
 * Named `decks-<role>[-<variant>]`, in five roles, in this order: text, line, surface, fill, accent.
 */
export const DECKS_COLORS: Readonly<Record<string, { light: string; dark: string; /** What a picker's tooltip calls it. */ name: string }>> = {
	/** Words, icons, a shape's label, the pen's black-or-white. */
	"decks-text": { light: "#1f2328", dark: "#e6e6e6", name: "Text" },
	/** Quieter words: a file card's kind. */
	"decks-text-muted": { light: "#6b7280", dark: "#a3a3a3", name: "Text, muted" },
	/** An arrow's line, a connector. */
	"decks-line": { light: "#8a8f98", dark: "#9ba1a9", name: "Line" },
	/** A dark line: a library shape's outline (`makeShape`). */
	"decks-line-strong": { light: "#1f2328", dark: "#d4d4d4", name: "Line, strong" },
	/** A frame's and a file card's edge, a divider. */
	"decks-line-subtle": { light: "#d0d7de", dark: "#ffffff29", name: "Line, subtle" },
	/** Paper: a frame's, a file card's, a library shape's. */
	"decks-surface": { light: "#ffffff", dark: "#2e2e2e", name: "Surface" },
	/** A rectangle's fill. */
	"decks-fill-slate": { light: "#dbe4f0", dark: "#34404f", name: "Fill, slate" },
	/** An ellipse's fill. */
	"decks-fill-sky": { light: "#c7ddf7", dark: "#2b4766", name: "Fill, sky" },
	/**
	 * Soft fills for shapes, frames and areas: a pastel on the light ground, a deep tint of the same hue
	 * on the dark one, each with the text still readable on it.
	 */
	"decks-fill-gray": { light: "#e5e7eb", dark: "#3a3d42", name: "Fill, grey" },
	"decks-fill-red": { light: "#fecaca", dark: "#5a2626", name: "Fill, red" },
	"decks-fill-orange": { light: "#fed7aa", dark: "#5a3517", name: "Fill, orange" },
	"decks-fill-yellow": { light: "#fde68a", dark: "#4a3f14", name: "Fill, yellow" },
	"decks-fill-green": { light: "#bbf7d0", dark: "#1f4730", name: "Fill, green" },
	"decks-fill-blue": { light: "#bfdbfe", dark: "#1e3a5f", name: "Fill, blue" },
	"decks-fill-purple": { light: "#e9d5ff", dark: "#3f2d5c", name: "Fill, purple" },
	/** The pen's and the marker's colours (`canvas/model/ink.ts`), and accents that read on both grounds. */
	"decks-accent-red": { light: "#e5484d", dark: "#ff6369", name: "Accent, red" },
	"decks-accent-orange": { light: "#f97316", dark: "#fb923c", name: "Accent, orange" },
	"decks-accent-yellow": { light: "#f2b200", dark: "#ffc53d", name: "Accent, yellow" },
	"decks-accent-green": { light: "#2f9e62", dark: "#3dd68c", name: "Accent, green" },
	"decks-accent-blue": { light: "#3b82f6", dark: "#60a5fa", name: "Accent, blue" },
	"decks-accent-purple": { light: "#8b5cf6", dark: "#a78bfa", name: "Accent, purple" },
};

/**
 * The palette's names before it was ordered by role, and what each is now. Nothing writes them any
 * more, but a drawing keeps its own definitions, so a stored `"$decks-ink"` still resolves there; it
 * shows as its new colour, and an edit that uses one where the drawing lacks it (a stale client, an
 * agent following old docs) still defines it, with its new colour's values.
 */
export const DECKS_LEGACY: Readonly<Record<string, string>> = {
	"decks-ink": "decks-text",
	"decks-muted": "decks-text-muted",
	"decks-figure-line": "decks-line-strong",
	"decks-frame-line": "decks-line-subtle",
	"decks-card-line": "decks-line-subtle",
	"decks-frame": "decks-surface",
	"decks-card": "decks-surface",
	"decks-figure": "decks-surface",
	"decks-shape": "decks-fill-slate",
	"decks-shape-2": "decks-fill-sky",
	"decks-gray-fill": "decks-fill-gray",
	...Object.fromEntries(["red", "orange", "yellow", "green", "blue", "purple"].flatMap((hue) => [
		[`decks-${hue}-fill`, `decks-fill-${hue}`],
		[`decks-${hue}`, `decks-accent-${hue}`],
	])),
};

/** A Decks colour's name as it is now: an old one (`DECKS_LEGACY`) mapped, a current one as it is, anything else undefined. */
function current(name: string): string | undefined {
	return DECKS_COLORS[name] ? name : DECKS_LEGACY[name];
}

/** Whether a colour value is a Decks colour (`"$decks-text"`), and which, an old name given as its new one. */
export function decksColorOf(value: unknown): string | undefined {
	return typeof value === "string" && value.startsWith("$") ? current(value.slice(1)) : undefined;
}

const REF = /"\$(decks-[a-z0-9-]+)"/g;

/**
 * `ops` with a `variables` op in front defining each Decks colour they refer to that `doc` does
 * not have yet, and the light/dark theme axis the dark values are keyed to: the drawing's own axis
 * that has a dark value (`Mode: ["Light", "Dark"]`), or `mode: ["light", "dark"]` added beside its
 * others. A variable the drawing already has is left as it is, so a person's own choice wins.
 * `ops` as they are when they need nothing.
 */
export function withDecksColors(doc: PenDocument, ops: readonly unknown[]): unknown[] {
	const wanted = new Set<string>();
	// What a `variables` op in the same edit sets counts as there: run again on an edit that already
	// has them (the canvas adds them, then the server does), nothing is added twice.
	const given = new Set<string>();
	for (const op of ops) {
		if (op && typeof op === "object" && (op as { op?: unknown }).op === "variables") for (const name of Object.keys((op as { set?: object }).set ?? {})) given.add(name);
	}
	for (const op of ops) {
		if (op && typeof op === "object" && (op as { op?: unknown }).op === "variables") continue;
		for (const match of JSON.stringify(op ?? null).matchAll(REF)) {
			const name = match[1]!;
			if (current(name) && !doc.variables?.[name] && !given.has(name)) wanted.add(name);
		}
	}
	if (wanted.size === 0) return [...ops];
	const { axis, dark, added } = darkAxis(doc.themes);
	const set: Record<string, PenVariable> = {};
	for (const name of wanted) {
		const color = DECKS_COLORS[current(name)!]!;
		set[name] = { type: "color", value: [{ value: color.light }, { value: color.dark, theme: { [axis]: dark } }] } as PenVariable;
	}
	return [{ op: "variables", set, ...(added ? { themes: added } : {}) }, ...ops];
}

/**
 * The light/dark theme axis a drawing's dark values are keyed to: its own axis that has a dark value
 * (`Mode: ["Light", "Dark"]`), or `mode: ["light", "dark"]` (or a dark value on its own `mode` axis)
 * added beside its others, with the themes as they are then in `added`.
 */
export function darkAxis(themes: Readonly<Record<string, readonly string[]>> | undefined): { axis: string; dark: string; added?: Record<string, string[]> } {
	const now = themes ?? {};
	let axis = Object.keys(now).find((name) => (now[name] ?? []).some((value) => value.toLowerCase() === "dark"));
	let added: Record<string, string[]> | undefined;
	if (axis === undefined) {
		axis = Object.keys(now).find((name) => name.toLowerCase() === "mode") ?? "mode";
		const values = now[axis] ?? [];
		added = { ...Object.fromEntries(Object.entries(now).map(([name, list]) => [name, [...list]])), [axis]: [...(values.length ? values : ["light"]), "dark"] };
	}
	const dark = (added ?? now)[axis]!.find((value) => value.toLowerCase() === "dark")!;
	return { axis, dark, ...(added ? { added } : {}) };
}

/** A variable's value given short: one for both schemes, or `{ light, dark }`. */
type Short = string | number | boolean | { light?: string | number | boolean; dark?: string | number | boolean };
const typeOf = (value: unknown): PenVariable["type"] => (typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : typeof value === "string" && !/^#[0-9a-f]{3,8}$/i.test(value) ? "string" : "color");

/**
 * Variables an agent sets, each in pen's own form (`{ type, value }`, kept as it is), `null` (to
 * remove it), or short: `"#4f46e5"` (a colour the same in both schemes), `16` (a number), `true`,
 * `"Inter"` (a string), or `{ light: "#4f46e5", dark: "#818cf8" }` (one that follows the canvas
 * between light and dark), expanded to pen's form with the dark value keyed to the drawing's own
 * light/dark axis (`darkAxis`), and `themes` to set beside them when that axis had to be added.
 */
export function expandVariables(set: Readonly<Record<string, unknown>>, themes: Readonly<Record<string, readonly string[]>> | undefined): { set: Record<string, unknown>; themes?: Record<string, string[]> } {
	const out: Record<string, unknown> = {};
	let added: Record<string, string[]> | undefined;
	for (const [name, given] of Object.entries(set ?? {})) {
		const short = given as Short | null;
		if (short === null || (typeof short === "object" && "type" in short)) out[name] = short;
		else if (typeof short !== "object") out[name] = { type: typeOf(short), value: short };
		else {
			const light = short.light ?? short.dark;
			const dark = short.dark ?? short.light;
			if (light === undefined) throw new Error(`${name} is { light, dark }: give a value for either or both, as { light: "#4f46e5", dark: "#818cf8" }.`);
			if (light === dark) out[name] = { type: typeOf(light), value: light };
			else {
				const axis = darkAxis(added ?? themes);
				added ??= axis.added;
				out[name] = { type: typeOf(light), value: [{ value: light }, { value: dark, theme: { [axis.axis]: axis.dark } }] };
			}
		}
	}
	return { set: out, ...(added ? { themes: added } : {}) };
}

/**
 * A drawing's variables read back short, as `expandVariables` takes them: one value when it is the
 * same in both schemes, `{ light, dark }` when it follows the light/dark axis. One keyed to another
 * axis (a brand, a density) is left out: its full form is in `variables`.
 */
export function shortVariables(doc: Pick<PenDocument, "variables" | "themes">): Record<string, Short> {
	const out: Record<string, Short> = {};
	const axis = Object.keys(doc.themes ?? {}).find((name) => (doc.themes![name] ?? []).some((value) => value.toLowerCase() === "dark"));
	for (const [name, variable] of Object.entries(doc.variables ?? {})) {
		if (!Array.isArray(variable.value)) {
			out[name] = variable.value as Short;
			continue;
		}
		const plain = variable.value.find((one) => !one.theme || Object.keys(one.theme).length === 0);
		const others = variable.value.filter((one) => one !== plain);
		const darkOne = others.find((one) => axis !== undefined && Object.keys(one.theme!).length === 1 && one.theme![axis]?.toLowerCase() === "dark");
		const lightOne = others.find((one) => axis !== undefined && Object.keys(one.theme!).length === 1 && one.theme![axis] !== undefined && one.theme![axis]!.toLowerCase() !== "dark");
		if (others.some((one) => one !== darkOne && one !== lightOne)) continue;
		const light = (lightOne ?? plain)?.value;
		const dark = (darkOne ?? plain)?.value;
		if (light === undefined || dark === undefined) continue;
		out[name] = light === dark ? (light as Short) : ({ light, dark } as Short);
	}
	return out;
}
