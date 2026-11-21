import { DECKS_COLORS, decksColorOf } from "@decks/pen";
import { m } from "@decks/i18n";

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
	return m.canvas_color_adaptive_title({ name: adaptiveName(name), light: decks.light, dark: decks.dark });
}

/** An adaptive colour's name in the person's language; `@decks/pen`'s English one for a colour not listed here. */
export function adaptiveName(name: string): string {
	const names: Record<string, () => string> = {
		"decks-text": m.canvas_color_text,
		"decks-text-muted": m.canvas_color_text_muted,
		"decks-line": m.canvas_color_line,
		"decks-line-strong": m.canvas_color_line_strong,
		"decks-line-subtle": m.canvas_color_line_subtle,
		"decks-surface": m.canvas_color_surface,
		"decks-fill-slate": m.canvas_color_fill_slate,
		"decks-fill-sky": m.canvas_color_fill_sky,
		"decks-fill-gray": m.canvas_color_fill_gray,
		"decks-fill-red": m.canvas_color_fill_red,
		"decks-fill-orange": m.canvas_color_fill_orange,
		"decks-fill-yellow": m.canvas_color_fill_yellow,
		"decks-fill-green": m.canvas_color_fill_green,
		"decks-fill-blue": m.canvas_color_fill_blue,
		"decks-fill-purple": m.canvas_color_fill_purple,
		"decks-accent-red": m.canvas_color_accent_red,
		"decks-accent-orange": m.canvas_color_accent_orange,
		"decks-accent-yellow": m.canvas_color_accent_yellow,
		"decks-accent-green": m.canvas_color_accent_green,
		"decks-accent-blue": m.canvas_color_accent_blue,
		"decks-accent-purple": m.canvas_color_accent_purple,
	};
	return names[name]?.() ?? DECKS_COLORS[name]?.name ?? name;
}
