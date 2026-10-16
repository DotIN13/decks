import { arrowLabel, arrowStyle, bool, color, fillsOf, isArrow, isCard, isMarkdown, isMarkdownText, mediaOf, MISSING, NOTE_PAD, num, pathBounds, radiiOf, resolve, strokeOf, textStyleOf, withTheme, type Fill, type PenDocument, type PenNode, type Rgba, type ThemeState } from "@decks/pen";
import type { IconShape } from "./icons.ts";
import { clockOf, filmLayout, playTriangle, SOUND_INK, soundLayout, waveBars } from "./media-look.ts";
import { fontChain } from "./fonts.ts";
import { CARD_PALETTE } from "./markdown-layout.ts";
import { formulaText } from "./math.ts";

/**
 * An item's paint record for the C++ painter (`packages/engine/cpp/paint.cpp`): what `paint.ts` would
 * draw for it, resolved to numbers. The same rules: a card's paper when it has no fill of its own, a
 * sound on the paper whatever its fill, fills in order, the stroke's first fill that draws, outer
 * shadows. What the painter cannot draw yet is marked so (kind 99), and the tile goes to CanvasKit.
 */

const NONE = 0, RECT = 1, ELLIPSE = 2, PATH = 3, NOTE = 6, GROUP = 7, TEXT = 8, OPS = 9, UNSUPPORTED = 99;
const NOTE_COLORS: Record<string, string> = { note: "#fde68a", prompt: "#ddd6fe", context: "#bfdbfe" };
const ALIGN = { inner: 0, center: 1, outer: 2 } as const;
const CAP = { butt: 0, round: 1, square: 2 } as const;
const JOIN = { miter: 0, round: 1, bevel: 2 } as const;

/** `paint.ts`'s `dashOf`: a line in dashes or dots, from `strokeDash`. */
function dashOf(node: PenNode, width: number): number[] {
	const w = Math.max(1, width);
	if (node.strokeDash === "dashed") return [w * 4, w * 3];
	if (node.strokeDash === "dotted") return [0.01, w * 2.5];
	return [];
}

/** SVG geometry and the viewBox it is fitted from, as `geometryPath` reads them: [x, y, w, h, length, ...char codes]. */
function geometryOf(node: PenNode, geometry: string): number[] {
	const vb = node.viewBox ?? (() => {
		const b = pathBounds(geometry);
		return b ? [b.x, b.y, b.w, b.h] : [0, 0, 0, 0];
	})();
	const codes: number[] = [];
	for (let i = 0; i < geometry.length; i++) codes.push(geometry.charCodeAt(i) & 0x7f);
	return [vb[0] ?? 0, vb[1] ?? 0, vb[2] ?? 0, vb[3] ?? 0, codes.length, ...codes];
}

const encoder = new TextEncoder();
const ALIGN_TEXT: Record<string, number> = { left: 0, right: 1, center: 2 };
const VERTICAL: Record<string, number> = { top: 0, middle: 1, bottom: 2 };

/**
 * An item's words as `paintText` sets them: [has words, pad, colour, align, vertical, underline,
 * strike, grow, size, weight, italic, spacing, line height or NaN, bytes, ...UTF-8, chain bytes,
 * ...chain]. `false` when they need what the painter does not draw yet (justified lines, a text's
 * own shadows).
 */
function wordsOf(doc: PenDocument, node: PenNode, theme: ThemeState, scheme: "light" | "dark", pad: number, fallbackColor?: string): number[] | false {
	const content = String(resolve(doc, node.content, withTheme(theme, node)) ?? "");
	if (!content) return [0];
	const style = textStyleOf(doc, node, theme);
	const textFill = node.type === "text" ? fillsOf(node.fill).map((f) => (typeof f === "string" ? f : f && f.type === "color" ? (f as { color: string }).color : undefined)).find(Boolean) : undefined;
	const rgba = (textFill ? color(doc, textFill, theme) : undefined) ?? color(doc, fallbackColor ?? (scheme === "dark" ? "#e6e6e6" : "#1f2328"), theme)!;
	const align = node.textAlign ?? "left";
	if (!(align in ALIGN_TEXT)) return false;
	if (node.type === "text") {
		const effects = node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect];
		if (effects.some((e) => e && e.type === "shadow" && e.shadowType !== "inner" && bool(doc, e.enabled, theme, true))) return false;
	}
	// Formulas as the characters they travel as, which the scene was handed when it measured these words (`math.ts`).
	const bytes = encoder.encode(formulaText(content));
	const chain = encoder.encode(fontChain(style.fontFamily).join("\n"));
	return [
		1, pad, ...rgba, ALIGN_TEXT[align]!, VERTICAL[node.textAlignVertical ?? "top"] ?? 0, bool(doc, node.underline, theme, false) ? 1 : 0, bool(doc, node.strikethrough, theme, false) ? 1 : 0,
		node.type === "text" && (node.textGrowth ?? "auto") === "auto" ? 1 : 0,
		style.fontSize, style.fontWeight, style.fontStyle === "italic" ? 1 : 0, style.letterSpacing, style.lineHeight ?? NaN,
		bytes.length, ...bytes, chain.length, ...chain,
	];
}

/** Markdown, drawn by the painter from the card the scene was handed (`card-wire.ts`): [2, pad], or [0] when empty. */
function markdownOf(doc: PenDocument, node: PenNode, theme: ThemeState, pad: number): number[] {
	const content = String(resolve(doc, node.content, withTheme(theme, node)) ?? "");
	return content ? [2, pad] : [0];
}

/** A fill's colour when it is a plain colour that draws; `false` when it draws something else; undefined when it draws nothing. */
/**
 * A fill as the painter reads it: [0, rgba] a colour; [1, type (0 linear, 1 radial, 2 sweep), centre x,
 * centre y, size w, size h (each a fraction of the box), rotation, opacity, stops, ...(rgba, at)] a
 * gradient, which the painter places in the box as `gradientShader` does; [2, picture, mode (0 cover,
 * 1 fit, 2 stretch), opacity] a picture, which draws nothing until it has arrived, as in `fillPaint`.
 */
/** What the painter has been handed: a picture's id and size once it has arrived (`painter.image`). */
export interface PaintEnv {
	picture?(url: string): { id: number; width: number; height: number } | undefined;
}

function paintOf(doc: PenDocument, fill: Fill, theme: ThemeState, env: PaintEnv): number[] | false | undefined {
	if (typeof fill === "string") {
		const rgba = color(doc, fill, theme);
		return rgba ? [0, ...rgba] : undefined;
	}
	if (!fill || typeof fill !== "object") return undefined;
	if (!bool(doc, (fill as { enabled?: unknown }).enabled, theme, true)) return undefined;
	if (fill.type === "color") {
		const rgba = color(doc, (fill as { color?: unknown }).color, theme);
		return rgba ? [0, ...rgba] : undefined;
	}
	if (fill.type === "gradient") {
		const g = fill as Extract<Fill, { type: "gradient" }>;
		const stops = (g.colors ?? [])
			.map((stop) => ({ color: color(doc, stop.color, theme), at: num(doc, stop.position, theme, 0) }))
			.filter((stop): stop is { color: Rgba; at: number } => !!stop.color)
			.sort((a, b) => a.at - b.at);
		if (stops.length === 0) return undefined;
		if (stops.length === 1) stops.push({ ...stops[0]! });
		const kind = g.gradientType === "radial" ? 1 : g.gradientType === "angular" ? 2 : 0;
		return [
			1, kind,
			num(doc, g.center?.x, theme, 0.5), num(doc, g.center?.y, theme, 0.5), num(doc, g.size?.width, theme, 1), num(doc, g.size?.height, theme, 1),
			num(doc, g.rotation, theme, 0), num(doc, (fill as { opacity?: unknown }).opacity, theme, 1),
			stops.length, ...stops.flatMap((stop) => [...stop.color, stop.at]),
		];
	}
	if (fill.type === "image") {
		const url = (fill as { url?: unknown }).url;
		const picture = typeof url === "string" ? env.picture?.(url) : undefined;
		if (!picture) return undefined;
		const mode = (fill as { mode?: unknown }).mode;
		return [2, picture.id, mode === "fit" ? 1 : mode === "stretch" ? 2 : 0, num(doc, (fill as { opacity?: unknown }).opacity, theme, 1)];
	}
	return undefined;
}

/** Why the last record was refused, for tallying what the painter still lacks. */
export let lastRefusal = "";

export function paintRecord(doc: PenDocument, node: PenNode, theme: ThemeState, scheme: "light" | "dark", env: PaintEnv = {}): number[] {
	const head = [num(doc, node.opacity, theme, 1), num(doc, node.rotation, theme, 0), bool(doc, node.flipX, theme, false) ? 1 : 0, bool(doc, node.flipY, theme, false) ? 1 : 0];
	const unsupported = (reason: string) => {
		lastRefusal = reason;
		return [UNSUPPORTED, ...head];
	};
	const shape = (kind: number, paper: boolean, sound: boolean, paperColor: string, fillList: Fill[], radii: number[], tail: number[] = []) => {
		const fills: number[][] = [];
		for (const fill of fillList) {
			const one = paintOf(doc, fill, theme, env);
			if (one === false) return unsupported("fill");
			if (one) fills.push(one);
		}
		const stroke = strokeOf(doc, node, theme);
		let strokePaint: number[] | undefined;
		if (stroke) {
			for (const fill of stroke.fills) {
				const one = paintOf(doc, fill, theme, env);
				if (one === false) return unsupported("stroke");
				if (one) {
					strokePaint = one;
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
		const dash = stroke && !isArrow(node) ? dashOf(node, stroke.widths[0]) : [];
		return [
			kind, ...head,
			bool(doc, node.clip, theme, false) ? 1 : 0, paper ? 1 : 0, sound ? 1 : 0, ...paperRgba,
			...radii,
			fills.length, ...fills.flat(),
			strokePaint ? 1 : 0, ...(strokePaint ?? []), ...(stroke?.widths ?? [0, 0, 0, 0]), stroke ? ALIGN[stroke.align] : 1,
			shadows.length, ...shadows.flat(),
			stroke ? CAP[stroke.cap] : 0, stroke ? JOIN[stroke.join] : 0, dash.length, ...dash,
			...tail,
		];
	};
	switch (node.type) {
		case "frame":
		case "rectangle": {
			const media = mediaOf(node);
			// A film's badge and a sound's card are drawing ops (`opsOf`).
			// A sound is on the card's paper whatever its fill, as `paint.ts` sets it.
			const sound = media?.kind === "audio";
			const paper = (isCard(node) && !fillsOf(node.fill).length) || sound;
			return shape(RECT, paper, sound, CARD_PALETTE[scheme].paper, fillsOf(node.fill), radiiOf(doc, node, theme));
		}
		case "ellipse": {
			const inner = Math.max(0, Math.min(1, num(doc, node.innerRadius, theme, 0)));
			const start = num(doc, node.startAngle, theme, 0);
			const sweep = Math.max(-360, Math.min(360, num(doc, node.sweepAngle, theme, 360)));
			if (inner <= 0 && Math.abs(sweep) >= 360) return shape(ELLIPSE, false, false, "#ffffff", fillsOf(node.fill), [0, 0, 0, 0]);
			// [path kind, even-odd, sides, corner radius, inner radius, start, sweep, arrow, dashed arrow, has a fill, geometries]
			return shape(PATH, false, false, "#ffffff", fillsOf(node.fill), [0, 0, 0, 0], [2, inner > 0 && Math.abs(sweep) >= 360 ? 1 : 0, 3, 0, inner, start, sweep, 0, 0, 1, 0]);
		}
		case "polygon": {
			const sides = Math.max(3, Math.round(num(doc, node.polygonCount, theme, 3)));
			return shape(PATH, false, false, "#ffffff", fillsOf(node.fill), [0, 0, 0, 0], [1, 0, sides, radiiOf(doc, node, theme)[0] ?? 0, 0, 0, 360, 0, 0, 1, 0]);
		}
		case "path": {
			if (typeof node.geometry !== "string" || !node.geometry.trim()) return [NONE, ...head];
			// An arrow's words are drawing ops (`opsOf`).
			const arrow = isArrow(node);
			const arrowDash = arrow && arrowStyle(node.metadata).dash;
			const geometries = [geometryOf(node, node.geometry)];
			if (arrowDash) {
				const [line = "", ...heads] = node.geometry.split(/(?=M)/);
				geometries.push(geometryOf(node, line), geometryOf(node, heads.join("")));
			}
			const hasFill = fillsOf(node.fill).length > 0;
			return shape(PATH, false, false, "#ffffff", fillsOf(node.fill), [0, 0, 0, 0], [0, node.fillRule === "evenodd" ? 1 : 0, 3, 0, 0, 0, 360, arrow ? 1 : 0, arrowDash ? 1 : 0, hasFill ? 1 : 0, geometries.length, ...geometries.flat()]);
		}
		case "note":
		case "prompt":
		case "context": {
			// A card's markdown and a prompt's model name are not painted yet; plain words are.
			const markdown = isMarkdown(node);
			// A card's markdown is drawn from the card the scene holds; a note's words are dark on its light colour, whatever the stage's scheme.
			const words = markdown ? markdownOf(doc, node, theme, NOTE_PAD) : wordsOf(doc, node, theme, scheme, NOTE_PAD, "#1f2328");
			if (!words) return unsupported("note words: underline, strike, justify");
			return shape(NOTE, false, false, markdown ? CARD_PALETTE[scheme].paper : (NOTE_COLORS[node.type] ?? NOTE_COLORS.note!), fillsOf(node.fill), [12, 12, 12, 12], words);
		}
		case "text": {
			const words = isMarkdownText(node) ? markdownOf(doc, node, theme, 0) : wordsOf(doc, node, theme, scheme, 0);
			if (!words) return unsupported("text: underline, strike, justify or shadow");
			return [TEXT, ...head, ...words];
		}
		case "group":
			return [GROUP, ...head];
		case "browser":
			if (node.metadata && node.metadata.type === "decks.board") return [NONE, ...head];
			return [OPS, ...head];
		default:
			// An icon, or a placeholder for what is not drawn: drawing ops (`opsOf`).
			return [OPS, ...head];
	}
}

// --- drawing ops ---------------------------------------------------------------------------------

/**
 * What else an item draws, once its box is known, reduced to the painter's drawing ops (`paint.cpp`,
 * `paintOps`): an icon's paths, a film's or a sound's badge, a placeholder's dashed box and label, an
 * arrow's words, a prompt's model name. The same shapes `paint.ts` draws, in the same order.
 */
export interface OpsEnv {
	/** An icon's shape once it has arrived (`icons.ts`). */
	icon?(library: string, name: string, weight: number): IconShape | undefined;
}

const str = (text: string): number[] => {
	const bytes = encoder.encode(text);
	return [bytes.length, ...bytes];
};
const INTER = fontChain("Inter").join("\n");
const NOTHING = [0, 0, 0, 0];
const CAPS = { butt: 0, round: 1, square: 2 } as const;
const JOINS = { miter: 0, round: 1, bevel: 2 } as const;
const pathOp = (d: string, affine: number[], fill: number[] | undefined, evenOdd: boolean, stroke?: { colour: number[]; width: number; cap?: number; join?: number; dash?: number[] }) => [
	1, ...str(d), ...affine, ...(fill ?? NOTHING), evenOdd ? 1 : 0, ...(stroke?.colour ?? NOTHING), stroke?.width ?? 0, stroke?.cap ?? 0, stroke?.join ?? 0, stroke?.dash?.length ?? 0, ...(stroke?.dash ?? []),
];
const rrectOp = (x: number, y: number, w: number, h: number, r: number, fill: number[] | undefined, stroke?: { colour: number[]; width: number; dash?: number[] }) => [
	2, x, y, w, h, r, ...(fill ?? NOTHING), ...(stroke?.colour ?? NOTHING), stroke?.width ?? 0, stroke?.dash?.length ?? 0, ...(stroke?.dash ?? []),
];
const wordsOp = (x: number, y: number, band: number, width: number, align: number, oneLine: boolean, size: number, weight: number, colour: number[], text: string) => [
	3, x, y, band, width, align, oneLine ? 1 : 0, size, weight, 0, ...colour, ...str(text), ...str(INTER),
];
const hexRgba = (hex: string): number[] => {
	const n = parseInt(hex.slice(1), 16);
	const a = hex.length > 7 ? (n & 0xff) / 255 : 1;
	const rgb = hex.length > 7 ? n >>> 8 : n;
	return [((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255, a];
};
const IDENTITY = [1, 0, 0, 1, 0, 0];
const polygonD = (points: number[]) => points.reduce((d, v, i) => d + (i % 2 === 0 ? `${i === 0 ? "M" : "L"}${v} ` : `${v} `), "") + "Z";

export function opsOf(doc: PenDocument, node: PenNode, theme: ThemeState, scheme: "light" | "dark", box: { x: number; y: number; w: number; h: number }, env: OpsEnv = {}): number[] | undefined {
	const { x, y, w, h } = box;
	const dark = scheme === "dark";
	switch (node.type) {
		case "frame":
		case "rectangle": {
			const media = mediaOf(node);
			if (!media) return undefined;
			const ops: number[] = [];
			if (media.kind === "audio") {
				const ink = SOUND_INK[scheme];
				const look = soundLayout(box);
				ops.push(...rrectOp(look.disc.cx - look.disc.r, look.disc.cy - look.disc.r, look.disc.r * 2, look.disc.r * 2, look.disc.r, hexRgba(ink.disc)));
				ops.push(...pathOp(polygonD(playTriangle(look.disc.cx, look.disc.cy, look.disc.r * 0.62)), IDENTITY, hexRgba(ink.glyph), false));
				ops.push(...wordsOp(look.name.x, look.name.y, 0, look.name.w, 0, true, look.name.size, 600, hexRgba(ink.fg), String(node.name ?? media.file.split("/").pop() ?? "Sound")));
				if (media.seconds !== undefined) ops.push(...wordsOp(look.time.right - 120, look.time.y, 0, 120, 1, true, look.time.size, 500, hexRgba(ink.muted), clockOf(Math.round(media.seconds))));
				const bars = waveBars(look.wave, media.peaks);
				if (bars.length) for (const one of bars) ops.push(...rrectOp(one.x, one.y, one.w, one.h, one.w / 2, hexRgba(ink.bar)));
				else {
					const thick = Math.max(2, 3 * look.k);
					ops.push(...rrectOp(look.wave.x, look.wave.y + look.wave.h / 2 - thick / 2, look.wave.w, thick, thick / 2, hexRgba(ink.bar)));
				}
				return ops;
			}
			// A film: a dark glass disc in the middle, the triangle in white, and its length on a pill.
			const look = filmLayout(box);
			const { cx, cy, r } = look.disc;
			ops.push(...rrectOp(cx - r, cy - r, r * 2, r * 2, r, [0, 0, 0, 0.5]));
			ops.push(...pathOp(polygonD(playTriangle(cx, cy, r * 0.62)), IDENTITY, [1, 1, 1, 0.96], false));
			if (media.seconds !== undefined && h >= 60) {
				const { pill } = look;
				ops.push(4, pill.right, pill.bottom, pill.padX, pill.padY, 2.6, 0, 0, 0, 0.62, pill.size, 600, 1, 1, 1, 0.96, ...str(clockOf(Math.round(media.seconds))), ...str(INTER));
			}
			return ops;
		}
		case "path": {
			const label = isArrow(node) ? arrowLabel(node.metadata) : undefined;
			if (!label || typeof node.geometry !== "string") return undefined;
			const [line = ""] = node.geometry.split(/(?=M)/);
			const vb = node.viewBox ?? (() => {
				const b = pathBounds(line);
				return b ? [b.x, b.y, b.w, b.h] : undefined;
			})();
			const sx = vb && vb[2] ? w / vb[2] : 1;
			const sy = vb && vb[3] ? h / vb[3] : 1;
			const affine = [sx, 0, 0, sy, x - (vb?.[0] ?? 0) * sx, y - (vb?.[1] ?? 0) * sy];
			return [5, ...str(line), ...affine, 13, 500, ...(dark ? [0.82, 0.82, 0.85, 1] : [0.27, 0.29, 0.33, 1]), ...(dark ? [0.11, 0.11, 0.12, 1] : [0.96, 0.96, 0.97, 1]), ...str(label), ...str(INTER)];
		}
		case "prompt": {
			if (typeof node.model !== "string" || !node.model.trim()) return undefined;
			// Small, in the top padding's right corner, clear of its words.
			return wordsOp(x + NOTE_PAD, y, NOTE_PAD, Math.max(20, w - NOTE_PAD * 2), 1, false, 11, 500, [0.25, 0.2, 0.45, 0.75], node.model.trim());
		}
		case "icon":
		case "icon_font": {
			const library = String(resolve(doc, node.type === "icon_font" ? node.iconFontFamily : node.library, theme) ?? "lucide");
			const name = String(resolve(doc, node.type === "icon_font" ? node.iconFontName : node.icon, theme) ?? "");
			const weight = num(doc, node.weight, theme, 400);
			const shape = name ? env.icon?.(library, name, weight) : undefined;
			if (!shape) return undefined;
			const first = fillsOf(node.fill).map((f) => (typeof f === "string" ? f : f && f.type === "color" ? (f as { color: string }).color : undefined)).find(Boolean);
			const rgba = (first ? color(doc, first, theme) : undefined) ?? color(doc, dark ? "#e6e6e6" : "#1f2328", theme)!;
			const [vx, vy, vw, vh] = shape.viewBox;
			const scale = Math.min(w / vw, h / vh);
			const affine = [scale, 0, 0, scale, x + (w - vw * scale) / 2 - vx * scale, y + (h - vh * scale) / 2 - vy * scale];
			const ops: number[] = [];
			for (const part of shape.parts) ops.push(...pathOp(part.d, affine, part.fill ? rgba : undefined, part.evenOdd, part.stroke ? { colour: rgba, width: part.strokeWidth, cap: CAPS[part.cap], join: JOINS[part.join] } : undefined));
			return ops;
		}
		case "group":
		case "ellipse":
		case "polygon":
		case "text":
		case "note":
		case "context":
			return undefined;
		default: {
			if (node.type === "browser" && node.metadata && node.metadata.type === "decks.board") return undefined;
			// A placeholder: a dashed box, and what it stands for.
			const missing = node.type === MISSING;
			const label = missing ? `missing: ${String(node.why ?? node.id)}` : node.type === "browser" ? String(node.url ?? "web page") : `${node.type}${node.name ? `: ${String(node.name)}` : ""}`;
			return [
				...rrectOp(x, y, w, h, 6, undefined, { colour: missing ? [0.86, 0.2, 0.2, 0.9] : [0.5, 0.5, 0.55, 0.8], width: 1.5, dash: [6, 4] }),
				...wordsOp(x + 8, y + 8, 0, Math.max(20, w - 16), 0, false, 13, 400, dark ? [0.75, 0.75, 0.78, 1] : [0.4, 0.4, 0.45, 1], label),
			];
		}
	}
}

/** The ink still under the pen (`LiveInk` in scene.ts), as drawing ops in stage pixels. */
export function inkOps(strokes: ReadonlyArray<{ d: string; filled: boolean; color: string; size: number; opacity: number }>, doc: PenDocument, theme: ThemeState): number[] {
	const ops: number[] = [];
	for (const stroke of strokes) {
		if (!stroke.d) continue;
		const rgba = color(doc, stroke.color, theme) ?? [0, 0, 0, 1];
		const colour = [rgba[0], rgba[1], rgba[2], rgba[3] * stroke.opacity];
		ops.push(...(stroke.filled ? pathOp(stroke.d, IDENTITY, colour, false) : pathOp(stroke.d, IDENTITY, undefined, false, { colour, width: stroke.size, cap: 1, join: 1 })));
	}
	return ops;
}
