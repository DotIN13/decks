import { bool, color, fillsOf, isCard, isMarkdown, mediaOf, num, radiiOf, resolve, strokeOf, withTheme, type Fill, type PenDocument, type PenNode, type Rgba, type ThemeState } from "@decks/pen";
import { CARD_PALETTE } from "./markdown-layout.ts";

/**
 * An item's paint record for the C++ painter (`packages/engine/cpp/paint.cpp`): what `paint.ts` would
 * draw for it, resolved to numbers. The same rules: a card's paper when it has no fill of its own, a
 * sound on the paper whatever its fill, fills in order, the stroke's first fill that draws, outer
 * shadows. What the painter cannot draw yet is marked so (kind 99), and the tile goes to CanvasKit.
 */

const NONE = 0, RECT = 1, ELLIPSE = 2, NOTE = 6, GROUP = 7, UNSUPPORTED = 99;
const NOTE_COLORS: Record<string, string> = { note: "#fde68a", prompt: "#ddd6fe", context: "#bfdbfe" };
const ALIGN = { inner: 0, center: 1, outer: 2 } as const;

/** A fill's colour when it is a plain colour that draws; `false` when it draws something else; undefined when it draws nothing. */
function solid(doc: PenDocument, fill: Fill, theme: ThemeState): Rgba | false | undefined {
	if (typeof fill === "string") return color(doc, fill, theme);
	if (!fill || typeof fill !== "object") return undefined;
	if (!bool(doc, (fill as { enabled?: unknown }).enabled, theme, true)) return undefined;
	if (fill.type === "color") return color(doc, (fill as { color?: unknown }).color, theme);
	if (fill.type === "gradient" || fill.type === "image") return false;
	return undefined;
}

export function paintRecord(doc: PenDocument, node: PenNode, theme: ThemeState, scheme: "light" | "dark"): number[] {
	const head = [num(doc, node.opacity, theme, 1), num(doc, node.rotation, theme, 0), bool(doc, node.flipX, theme, false) ? 1 : 0, bool(doc, node.flipY, theme, false) ? 1 : 0];
	const unsupported = () => [UNSUPPORTED, ...head];
	const shape = (kind: number, paper: boolean, sound: boolean, paperColor: string, fillList: Fill[], radii: number[]) => {
		const fills: Rgba[] = [];
		for (const fill of fillList) {
			const one = solid(doc, fill, theme);
			if (one === false) return unsupported();
			if (one) fills.push(one);
		}
		const stroke = strokeOf(doc, node, theme);
		let strokeColor: Rgba | undefined;
		if (stroke) {
			if (node.strokeDash === "dashed" || node.strokeDash === "dotted") return unsupported();
			for (const fill of stroke.fills) {
				const one = solid(doc, fill, theme);
				if (one === false) return unsupported();
				if (one) {
					strokeColor = one;
					break;
				}
			}
		}
		const effects = node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect];
		const shadows: number[][] = [];
		for (const effect of effects) {
			if (!effect || effect.type !== "shadow" || effect.shadowType === "inner" || !bool(doc, effect.enabled, theme, true)) continue;
			const rgba = color(doc, effect.color ?? "#00000040", theme);
			if (rgba) shadows.push([...rgba, num(doc, effect.blur, theme, 0), num(doc, effect.offset?.x, theme, 0), num(doc, effect.offset?.y, theme, 0)]);
		}
		const paperRgba = color(doc, paperColor, {}) ?? [1, 1, 1, 1];
		return [
			kind, ...head,
			bool(doc, node.clip, theme, false) ? 1 : 0, paper ? 1 : 0, sound ? 1 : 0, ...paperRgba,
			...radii,
			fills.length, ...fills.flat(),
			strokeColor ? 1 : 0, ...(strokeColor ?? [0, 0, 0, 0]), ...(stroke?.widths ?? [0, 0, 0, 0]), stroke ? ALIGN[stroke.align] : 1,
			shadows.length, ...shadows.flat(),
		];
	};
	switch (node.type) {
		case "frame":
		case "rectangle": {
			const media = mediaOf(node);
			// A film's badge and a sound's card are drawn in words and waves this painter does not draw yet.
			if (media) return unsupported();
			const paper = isCard(node) && !fillsOf(node.fill).length;
			return shape(RECT, paper, false, CARD_PALETTE[scheme].paper, fillsOf(node.fill), radiiOf(doc, node, theme));
		}
		case "ellipse": {
			const inner = num(doc, node.innerRadius, theme, 0);
			const sweep = num(doc, node.sweepAngle, theme, 360);
			if (inner > 0 || Math.abs(sweep) < 360) return unsupported();
			return shape(ELLIPSE, false, false, "#ffffff", fillsOf(node.fill), [0, 0, 0, 0]);
		}
		case "note":
		case "prompt":
		case "context": {
			// The words on a note are not painted yet; an empty note is.
			const content = String(resolve(doc, node.content, withTheme(theme, node)) ?? "");
			if (content || (node.type === "prompt" && typeof node.model === "string" && node.model.trim())) return unsupported();
			const markdown = isMarkdown(node);
			return shape(NOTE, false, false, markdown ? CARD_PALETTE[scheme].paper : (NOTE_COLORS[node.type] ?? NOTE_COLORS.note!), fillsOf(node.fill), [12, 12, 12, 12]);
		}
		case "group":
			return [GROUP, ...head];
		case "browser":
			if (node.metadata && node.metadata.type === "decks.board") return [NONE, ...head];
			return unsupported();
		default:
			return unsupported();
	}
}
