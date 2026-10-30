import type { PenDocument, PenVariable } from "./types.ts";

/**
 * The colours Decks gives what its tools make, as the drawing's own colour variables, each with a
 * light value and a dark one, so a rectangle drawn on a dark canvas is not a pale slab on it (and an
 * icon not dark ink on dark). An item refers to one as `"$decks-shape"`; the insert that makes it
 * also defines whichever of them the drawing does not have yet (`withDecksColors`). Light values are
 * what the tools always made; dark ones sit on the dark canvas (`#242424`) beside the app's dark
 * palette (`canvas/render/look.ts`).
 */
export const DECKS_COLORS: Readonly<Record<string, { light: string; dark: string; /** What a picker's tooltip calls it. */ name: string }>> = {
	/** A rectangle's fill. */
	"decks-shape": { light: "#dbe4f0", dark: "#34404f", name: "Shape" },
	/** An ellipse's fill. */
	"decks-shape-2": { light: "#c7ddf7", dark: "#2b4766", name: "Shape, second" },
	/** A frame's fill and its edge. */
	"decks-frame": { light: "#ffffff", dark: "#2b2b2b", name: "Paper" },
	"decks-frame-line": { light: "#d0d7de", dark: "#ffffff29", name: "Edge" },
	/** Ink: an icon, a shape's label, a file card's name, the pen's black-or-white. */
	"decks-ink": { light: "#1f2328", dark: "#e6e6e6", name: "Ink" },
	/** Quieter words: a file card's kind. */
	"decks-muted": { light: "#6b7280", dark: "#a3a3a3", name: "Muted" },
	/** A library shape's fill and line (`makeShape`). */
	"decks-figure": { light: "#ffffff", dark: "#2e2e2e", name: "Figure" },
	"decks-figure-line": { light: "#1f2328", dark: "#d4d4d4", name: "Figure line" },
	/** A file card's paper and edge. */
	"decks-card": { light: "#ffffff", dark: "#2e2e2e", name: "Card" },
	"decks-card-line": { light: "#0000001f", dark: "#ffffff24", name: "Card edge" },
	/** An arrow's line. */
	"decks-line": { light: "#8a8f98", dark: "#9ba1a9", name: "Line" },
	/** The pen's and the marker's colours (`canvas/model/ink.ts`), and accents that read on both grounds. */
	"decks-red": { light: "#e5484d", dark: "#ff6369", name: "Red" },
	"decks-blue": { light: "#3b82f6", dark: "#60a5fa", name: "Blue" },
	"decks-green": { light: "#2f9e62", dark: "#3dd68c", name: "Green" },
	"decks-yellow": { light: "#f2b200", dark: "#ffc53d", name: "Yellow" },
};

/** Whether a colour value is a Decks colour (`"$decks-ink"`), and which. */
export function decksColorOf(value: unknown): string | undefined {
	return typeof value === "string" && value.startsWith("$") && DECKS_COLORS[value.slice(1)] ? value.slice(1) : undefined;
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
			if (DECKS_COLORS[name] && !doc.variables?.[name] && !given.has(name)) wanted.add(name);
		}
	}
	if (wanted.size === 0) return [...ops];
	const themes = doc.themes ?? {};
	let axis = Object.keys(themes).find((name) => (themes[name] ?? []).some((value) => value.toLowerCase() === "dark"));
	let added: Record<string, string[]> | undefined;
	if (axis === undefined) {
		axis = Object.keys(themes).find((name) => name.toLowerCase() === "mode") ?? "mode";
		const values = themes[axis] ?? [];
		added = { ...themes, [axis]: [...(values.length ? values : ["light"]), "dark"] };
	}
	const darkName = (added ?? themes)[axis]!.find((value) => value.toLowerCase() === "dark")!;
	const set: Record<string, PenVariable> = {};
	for (const name of wanted) {
		const color = DECKS_COLORS[name]!;
		set[name] = { type: "color", value: [{ value: color.light }, { value: color.dark, theme: { [axis]: darkName } }] } as PenVariable;
	}
	return [{ op: "variables", set, ...(added ? { themes: added } : {}) }, ...ops];
}
