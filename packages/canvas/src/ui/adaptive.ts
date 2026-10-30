import { DECKS_COLORS, decksColorOf } from "@decks/pen";

/**
 * The adaptive colours on offer, by name, a row per role: text, line and surface; the neutral fills;
 * the soft fills, each above its accent of the same hue.
 */
export const ADAPTIVE: readonly (readonly string[])[] = [
	["decks-text", "decks-text-muted", "decks-line", "decks-line-strong", "decks-line-subtle", "decks-surface"],
	["decks-fill-slate", "decks-fill-sky", "decks-fill-gray"],
	["decks-fill-red", "decks-fill-orange", "decks-fill-yellow", "decks-fill-green", "decks-fill-blue", "decks-fill-purple"],
	["decks-accent-red", "decks-accent-orange", "decks-accent-yellow", "decks-accent-green", "decks-accent-blue", "decks-accent-purple"],
];

/** Whether two colour values are the same colour: a Decks colour by what it is now, so a stored old name (`"$decks-ink"`) is its new one (`"$decks-text"`). */
export function sameColor(a: unknown, b: unknown): boolean {
	const decks = decksColorOf(a);
	return decks ? decks === decksColorOf(b) : a === b;
}

/** A swatch's paint: an adaptive colour split corner to corner, light over dark; any other colour as it is. */
export function swatchPaint(color: string): string {
	const decks = DECKS_COLORS[decksColorOf(color) ?? ""];
	return decks ? `linear-gradient(135deg, ${decks.light} 0 50%, ${decks.dark} 50% 100%)` : color;
}

/** An adaptive colour's tooltip: its name and its two values. */
export function adaptiveTitle(name: string): string {
	const decks = DECKS_COLORS[name]!;
	return `${decks.name} (adaptive): ${decks.light} in light, ${decks.dark} in dark`;
}
