// What the properties panel reads from the selected items: their kinds, colours, fills and lines,
// and one value shared by all of them, or Mixed.
import { isArrow, isShape, parseColor, toHex, type PenNode } from "@decks/pen";
import type { LucideIcon } from "lucide-solid";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import FrameIcon from "lucide-solid/icons/frame";
import Layers from "lucide-solid/icons/layers";
import Shapes from "lucide-solid/icons/shapes";
import SmilePlus from "lucide-solid/icons/smile-plus";
import Spline from "lucide-solid/icons/spline";
import Square from "lucide-solid/icons/square";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";

/*
 * The quick swatches. The neutrals, and the accents that have a dark twin, are the drawing's own
 * light/dark colours (`@decks/pen` `DECKS_COLORS`, drawn split light over dark), so what is picked
 * here reads on a dark canvas too, the soft fills included: a pastel in light, a deep tint in dark.
 */
export const SWATCHES = ["$decks-surface", "$decks-fill-slate", "$decks-fill-yellow", "$decks-fill-green", "$decks-fill-blue", "$decks-fill-red", "$decks-fill-purple", "$decks-text"];
export const LINES = ["$decks-text", "$decks-text-muted", "$decks-line", "$decks-accent-blue", "$decks-accent-green", "$decks-accent-yellow", "$decks-accent-orange", "$decks-accent-red", "$decks-accent-purple", "$decks-surface"];
export const TEXTY = new Set(["text", "note", "prompt", "context"]);
export const FONTS = ["Inter", "JetBrains Mono", "Source Serif 4", "Merriweather", "Caveat", "Space Grotesk", "IBM Plex Sans", "Noto Sans SC"];
export const WEIGHTS = [300, 400, 500, 600, 700, 800];
export const MIXED = "Mixed";

export type Kind = "shape" | "arrow" | "text" | "note" | "icon" | "frame" | "rectangle" | "ellipse" | "polygon" | "path" | "group" | "other";
export function kindOf(node: PenNode): Kind {
	if (isShape(node)) return "shape";
	if (isArrow(node)) return "arrow";
	if (node.type === "text") return "text";
	if (TEXTY.has(node.type)) return "note";
	if (node.type === "icon" || node.type === "icon_font") return "icon";
	if (["frame", "rectangle", "ellipse", "polygon", "path", "group"].includes(node.type)) return node.type as Kind;
	return "other";
}
export const KIND_ICON: Record<Kind, LucideIcon> = { shape: Shapes, arrow: ArrowUpRight, text: Type, note: StickyNote, icon: SmilePlus, frame: FrameIcon, rectangle: Square, ellipse: Square, polygon: Shapes, path: Spline, group: Layers, other: Square };

/** The colour a value names, for the colour input: a hex colour, or undefined for a variable or a gradient. */
export const hexOf = (value: unknown): string | undefined => {
	const first = Array.isArray(value) ? value[0] : value;
	const type = first && typeof first === "object" ? (first as { type?: string }).type : undefined;
	const text = typeof first === "string" ? first : type === "color" || type === "solid" ? (first as { color?: unknown }).color : undefined;
	// Whatever notation it is written in: the swatches and the field speak hex (`@decks/pen`).
	return typeof text === "string" ? toHex(parseColor(text)) : undefined;
};
/** The colour a value names, for the panel: a variable as it is written (`"$decks-text"`), anything else as hex (`hexOf`). */
export const colorOf = (value: unknown): string | undefined => {
	const first = Array.isArray(value) ? value[0] : value;
	const type = first && typeof first === "object" ? (first as { type?: string }).type : undefined;
	const text = typeof first === "string" ? first : type === "color" || type === "solid" ? (first as { color?: unknown }).color : undefined;
	return typeof text === "string" && /^\$[\w-]+$/.test(text) ? text : hexOf(value);
};
export type FillMode = "none" | "solid" | "linear" | "radial";
export const gradientOf = (value: unknown): { type: "gradient"; gradientType?: string; rotation?: unknown; colors?: Array<{ color: string; position: number }> } | undefined => {
	const first = Array.isArray(value) ? value[0] : value;
	return first && typeof first === "object" && (first as { type?: string }).type === "gradient" ? (first as never) : undefined;
};
export const fillModeOf = (node: PenNode): FillMode => {
	if (node.fill === undefined || node.fill === null || (Array.isArray(node.fill) && node.fill.length === 0)) return "none";
	const gradient = gradientOf(node.fill);
	if (gradient) return gradient.gradientType === "radial" ? "radial" : "linear";
	return "solid";
};
/** A stroke written in pen's older one-object spelling, which is changed in that spelling. */
export const legacyStroke = (node: PenNode) => (node.stroke && typeof node.stroke === "object" && !Array.isArray(node.stroke) && !("type" in node.stroke) ? (node.stroke as Record<string, unknown>) : undefined);
export const lineWidthOf = (node: PenNode): number => {
	if (node.stroke === undefined || node.stroke === null) return 0;
	const legacy = legacyStroke(node);
	const width = legacy ? legacy.thickness : node.strokeWidth;
	return typeof width === "number" ? width : 1;
};
export const lineColorOf = (node: PenNode): string | undefined => {
	const legacy = legacyStroke(node);
	return colorOf(legacy ? legacy.fill : node.stroke);
};
export const numberOf = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
/** One value for every item, or Mixed. */
export function shared<T>(list: readonly PenNode[], read: (node: PenNode) => T): T | typeof MIXED | undefined {
	if (list.length === 0) return undefined;
	const first = read(list[0]!);
	return list.every((node) => read(node) === first) ? first : MIXED;
}
