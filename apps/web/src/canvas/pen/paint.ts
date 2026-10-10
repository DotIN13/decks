import type { Canvas, CanvasKit, Image, Paint, Path, Shader } from "canvaskit-wasm";
import { arrowLabel, arrowStyle, bool, color, fillsOf, isArrow, isCard, isMarkdown, isMarkdownText, mediaOf, MISSING, NOTE_PAD, num, pathBounds, radiiOf, resolve, strokeOf, textStyleOf, withTheme, type Fill, type PenDocument, type PenNode, type Placed, type Rgba, type ThemeState } from "@decks/pen";
import type { PenFonts } from "./fonts.ts";
import { CARD_PALETTE } from "./markdown-layout.ts";
import { clockOf, filmLayout, playTriangle, SOUND_INK, soundLayout, waveBars } from "./media-look.ts";
import type { IconShape } from "./icons.ts";

/**
 * Drawing a laid-out `.pen` document with CanvasKit.
 *
 * Each item is drawn in stage coordinates at the box `layout` gave it, children inside their
 * parent's clip and opacity, in the document's order (first is underneath). The rules are pen's:
 *
 * - `opacity` fades the item and everything in it; `rotation` turns it counter-clockwise about its
 *   top-left corner; `flipX`/`flipY` mirror it in its box;
 * - `fill` is a list drawn in order — colours, gradients and images — and `stroke` is drawn over
 *   it, inside, centred on or outside the edge by `strokeAlignment`;
 * - a `path`'s geometry is fitted from its `viewBox` (or its own bounds) onto its box, with the
 *   stroke width left unscaled;
 * - a `note` is a card with its words inside; `prompt` and `context`, which pen.dev keeps for its
 *   own agent, are drawn the same way in their own colours.
 *
 * What is not drawn yet is drawn as what it is — a dashed box with its type — rather than dropped:
 * scripts, and web pages other than the deck's own boards.
 */

export interface PaintContext {
	ck: CanvasKit;
	fonts: PenFonts;
	doc: PenDocument;
	placed: ReadonlyMap<string, Placed>;
	scheme: "light" | "dark";
	/** An image fill's picture, once loaded; undefined asks for it and draws nothing this time. */
	image(url: string): Image | undefined;
	/** An icon's shapes, once fetched; undefined asks for it and draws nothing this time. */
	icon(library: string, name: string, weight: number): IconShape | undefined;
	/** Items left out, with everything inside them: the ones a drag is carrying on a picture of their own. */
	skip?: ReadonlySet<string>;
	/** Items drawn without their words: the ones being typed into, where the editor shows the words. */
	mute?: ReadonlySet<string>;
	/**
	 * Items drawn as a hole: a file shown live by an element under the sheet (`Stage.tsx`, file
	 * items), which shows through here as a board's page does. What is drawn after it still covers it.
	 */
	holes?: ReadonlySet<string>;
	/** How far a card's wide table has been scrolled sideways, by the card and the table's place in it. */
	scroll?(id: string, index: number): number;
}

const NOTE_COLORS: Record<string, string> = { note: "#fde68a", prompt: "#ddd6fe", context: "#bfdbfe" };
/** A board's corner on the canvas (`--radius-panel`). */
export const NOTE_RADIUS = 12;
/** The app's `--shadow`, light and dark (`index.css`): each layer's drop, blur and darkness. */
export const SHADOWS = {
	light: [{ y: 1, blur: 2, alpha: 0.06 }, { y: 4, blur: 12, alpha: 0.05 }],
	dark: [{ y: 1, blur: 2, alpha: 0.4 }, { y: 6, blur: 18, alpha: 0.3 }],
} as const;

export function paintDocument(canvas: Canvas, nodes: readonly PenNode[], ctx: PaintContext): void {
	for (const node of nodes) paintNode(canvas, node, ctx);
}

function paintNode(canvas: Canvas, node: PenNode, ctx: PaintContext): void {
	if (ctx.skip?.has(node.id)) return;
	const placed = ctx.placed.get(node.id);
	if (!placed) return;
	const { ck, doc } = ctx;
	if (ctx.holes?.has(node.id)) {
		const clear = new ck.Paint();
		clear.setBlendMode(ck.BlendMode.Clear);
		clear.setAntiAlias(true);
		canvas.drawRRect(rrectOf(ck, placed, doc), clear);
		clear.delete();
		return;
	}
	const theme = placed.theme;
	const { x, y, w, h } = placed.box;
	const opacity = Math.max(0, Math.min(1, num(doc, node.opacity, theme, 1)));
	if (opacity <= 0) return;
	const rotation = num(doc, node.rotation, theme, 0);
	const flipX = bool(doc, node.flipX, theme, false);
	const flipY = bool(doc, node.flipY, theme, false);

	if (opacity < 1) {
		const layer = new ck.Paint();
		layer.setAlphaf(opacity);
		canvas.saveLayer(layer);
		layer.delete();
	} else canvas.save();
	if (rotation) canvas.rotate(-rotation, x, y);
	if (flipX || flipY) {
		canvas.translate(x + w / 2, y + h / 2);
		canvas.scale(flipX ? -1 : 1, flipY ? -1 : 1);
		canvas.translate(-(x + w / 2), -(y + h / 2));
	}

	switch (node.type) {
		case "frame":
		case "rectangle": {
			const rrect = rrectOf(ck, placed, doc);
			// A card with no fill of its own is on the card's paper, as a note card is (`CARD`).
			// A sound is on the same paper, whatever fill it was given: its card follows the scheme (`paintMedia`).
			const sound = mediaOf(node)?.kind === "audio";
			const paper = (isCard(node) && !fillsOf(node.fill).length) || sound;
			if (paper) paintCardPaper(canvas, ctx, rrect, CARD_PALETTE[ctx.scheme].paper);
			paintShadows(canvas, ctx, node, theme, (paint) => canvas.drawRRect(rrect, paint));
			if (!sound) paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawRRect(rrect, paint));
			if (node.type === "frame" && Array.isArray(node.children) && node.children.length) {
				const clip = bool(doc, node.clip, theme, false);
				canvas.save();
				if (clip) canvas.clipRRect(rrect, ck.ClipOp.Intersect, true);
				for (const child of node.children) paintNode(canvas, child, ctx);
				canvas.restore();
			}
			paintStroke(canvas, ctx, node, theme, placed, (paint) => canvas.drawRRect(rrect, paint), (op) => canvas.clipRRect(rrect, op, true));
			if (paper) paintCardEdge(canvas, ctx, placed, radiiOf(doc, node, theme)[0] ?? NOTE_RADIUS);
			// A film or a sound (`@decks/pen`, `MEDIA`): the still is its fill, and this is the badge on it.
			paintMedia(canvas, ctx, node, placed);
			break;
		}
		case "ellipse": {
			const path = ellipsePath(ck, placed, doc, theme);
			paintShadows(canvas, ctx, node, theme, (paint) => canvas.drawPath(path, paint));
			paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawPath(path, paint));
			paintStroke(canvas, ctx, node, theme, placed, (paint) => canvas.drawPath(path, paint), (op) => canvas.clipPath(path, op, true));
			path.delete();
			break;
		}
		case "polygon": {
			const path = polygonPath(ck, placed, Math.max(3, Math.round(num(doc, node.polygonCount, theme, 3))), radiiOf(doc, node, theme)[0] ?? 0);
			paintShadows(canvas, ctx, node, theme, (paint) => canvas.drawPath(path, paint));
			paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawPath(path, paint));
			paintStroke(canvas, ctx, node, theme, placed, (paint) => canvas.drawPath(path, paint), (op) => canvas.clipPath(path, op, true));
			path.delete();
			break;
		}
		case "path": {
			const path = geometryPath(ck, node, placed);
			if (!path) break;
			// A shadow of what the path draws: its fill's area, or its line when it has only a stroke.
			const hasFill = fillsOf(node.fill).length > 0;
			const lineWidth = strokeOf(doc, node, theme)?.widths[0] ?? 0;
			paintShadows(canvas, ctx, node, theme, (paint) => {
				if (!hasFill && lineWidth > 0) {
					paint.setStyle(ck.PaintStyle.Stroke);
					paint.setStrokeWidth(lineWidth);
				}
				canvas.drawPath(path, paint);
			});
			paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawPath(path, paint));
			// An arrow is a line: its stroke is centred however it was aligned, or its head would be clipped away.
			const stroke = strokeOf(doc, node, theme);
			if (stroke) {
				const paint = strokePaint(ctx, stroke.fills, theme, placed.box, stroke.widths[0], stroke, isArrow(node) ? undefined : dashOf(node, stroke.widths[0]));
				if (paint) {
					if (isArrow(node) && arrowStyle(node.metadata).dash && typeof node.geometry === "string") {
						// Dashed on the line alone, the geometry's first subpath; the heads after it stay solid.
						const [line = "", ...heads] = node.geometry.split(/(?=M)/);
						const width = stroke.widths[0] ?? 2;
						const dashed = paint.copy();
						const effect = ck.PathEffect.MakeDash([width * 3, width * 2.5], 0);
						dashed.setPathEffect(effect);
						const linePath = geometryPath(ck, { ...node, geometry: line }, placed);
						if (linePath) canvas.drawPath(linePath, dashed);
						const headPath = heads.length ? geometryPath(ck, { ...node, geometry: heads.join("") }, placed) : null;
						if (headPath) canvas.drawPath(headPath, paint);
						linePath?.delete();
						headPath?.delete();
						effect?.delete();
						dashed.delete();
					} else if (isArrow(node) || stroke.align === "center") canvas.drawPath(path, paint);
					else paintAligned(canvas, ck, stroke.align, paint, stroke.widths[0], (p) => canvas.drawPath(path, p), (op) => canvas.clipPath(path, op, true));
					paint.delete();
				}
			}
			if (isArrow(node)) paintArrowLabel(canvas, ctx, node, placed);
			path.delete();
			break;
		}
		case "text":
			// One block of a card, or markdown words on their own: drawn as a card draws them, without paper.
			if (isMarkdownText(node)) paintMarkdown(canvas, ctx, node, theme, placed, 0);
			else paintText(canvas, ctx, node, theme, placed, 0);
			break;
		case "note":
		case "prompt":
		case "context": {
			const fills = fillsOf(node.fill);
			/*
			 * Shaped as a board is on the canvas (`canvas.css`, `.board-node > .shade`): the panel radius,
			 * the app's two-layer shadow for the scheme, and a hairline edge in the app's line colour.
			 */
			const rrect = ck.RRectXY(ck.LTRBRect(x, y, x + w, y + h), NOTE_RADIUS, NOTE_RADIUS);
			for (const layer of SHADOWS[ctx.scheme]) {
				const shadow = new ck.Paint();
				shadow.setAntiAlias(true);
				shadow.setColor(ck.Color4f(0, 0, 0, layer.alpha));
				shadow.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, layer.blur / 2, true));
				canvas.save();
				canvas.translate(0, layer.y);
				canvas.drawRRect(rrect, shadow);
				canvas.restore();
				shadow.delete();
			}
			const markdown = isMarkdown(node);
			if (fills.length) paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawRRect(rrect, paint));
			else {
				const paint = new ck.Paint();
				paint.setAntiAlias(true);
				// A markdown card is the app's panel, light or dark; a note is its sticky colour.
				paint.setColor(colorOf(ck, markdown ? CARD_PALETTE[ctx.scheme].paper : (NOTE_COLORS[node.type] ?? NOTE_COLORS.note!)));
				canvas.drawRRect(rrect, paint);
				paint.delete();
			}
			const edge = new ck.Paint();
			edge.setAntiAlias(true);
			edge.setStyle(ck.PaintStyle.Stroke);
			edge.setStrokeWidth(1);
			edge.setColor(ctx.scheme === "dark" ? ck.Color4f(1, 1, 1, 0.12) : ck.Color4f(0, 0, 0, 0.1));
			// Outside the box, as a CSS outline is.
			canvas.drawRRect(ck.RRectXY(ck.LTRBRect(x - 0.5, y - 0.5, x + w + 0.5, y + h + 0.5), NOTE_RADIUS + 0.5, NOTE_RADIUS + 0.5), edge);
			edge.delete();
			if (markdown) {
				paintMarkdown(canvas, ctx, node, theme, placed);
				break;
			}
			// A card's words are dark on its light colour, whatever the stage's scheme.
			paintText(canvas, ctx, node, theme, placed, NOTE_PAD, "#1f2328");
			// A prompt names the model it is for: small, in the top padding's right corner, clear of its words.
			if (node.type === "prompt" && typeof node.model === "string" && node.model.trim()) {
				const label = ctx.fonts.paragraph(node.model.trim(), { fontFamily: "Inter", fontSize: 11, fontWeight: 500, fontStyle: "normal", letterSpacing: 0, lineHeight: undefined }, { color: ck.Color4f(0.25, 0.2, 0.45, 0.75), align: "right", width: Math.max(20, w - NOTE_PAD * 2) });
				canvas.drawParagraph(label, x + NOTE_PAD, y + Math.max(1, (NOTE_PAD - label.getHeight()) / 2));
				label.delete();
			}
			break;
		}
		case "group":
			for (const child of node.children ?? []) paintNode(canvas, child, ctx);
			break;
		case "icon":
		case "icon_font":
			paintIcon(canvas, ctx, node, theme, placed);
			break;
		case "browser":
			// A deck board: the stage draws the board itself in this box, over the drawing.
			if (node.metadata && node.metadata.type === "decks.board") break;
			paintPlaceholder(canvas, ctx, node, placed);
			break;
		default:
			paintPlaceholder(canvas, ctx, node, placed);
	}
	canvas.restore();
}

// --- shapes ------------------------------------------------------------------------------------

function rrectOf(ck: CanvasKit, placed: Placed, doc: PenDocument): Float32Array {
	const { x, y, w, h } = placed.box;
	const [tl, tr, br, bl] = radiiOf(doc, placed.node, placed.theme).map((r) => Math.max(0, Math.min(r, w / 2, h / 2)));
	return Float32Array.of(x, y, x + w, y + h, tl!, tl!, tr!, tr!, br!, br!, bl!, bl!);
}

function ellipsePath(ck: CanvasKit, placed: Placed, doc: PenDocument, theme: ThemeState): Path {
	const { x, y, w, h } = placed.box;
	const node = placed.node;
	const inner = Math.max(0, Math.min(1, num(doc, node.innerRadius, theme, 0)));
	const start = num(doc, node.startAngle, theme, 0);
	const sweep = Math.max(-360, Math.min(360, num(doc, node.sweepAngle, theme, 360)));
	const oval = ck.LTRBRect(x, y, x + w, y + h);
	const builder = new ck.PathBuilder();
	if (Math.abs(sweep) >= 360) {
		builder.addOval(oval);
		if (inner > 0) {
			const cx = x + w / 2;
			const cy = y + h / 2;
			builder.addOval(ck.LTRBRect(cx - (w / 2) * inner, cy - (h / 2) * inner, cx + (w / 2) * inner, cy + (h / 2) * inner), true);
			builder.setFillType(ck.FillType.EvenOdd);
		}
	} else {
		// pen's angles run counter-clockwise from the right; Skia's run clockwise.
		const cx = x + w / 2;
		const cy = y + h / 2;
		if (inner > 0) {
			const innerOval = ck.LTRBRect(cx - (w / 2) * inner, cy - (h / 2) * inner, cx + (w / 2) * inner, cy + (h / 2) * inner);
			builder.arcToOval(oval, -start, -sweep, true);
			builder.arcToOval(innerOval, -start - sweep, sweep, false);
			builder.close();
		} else {
			builder.moveTo(cx, cy);
			builder.arcToOval(oval, -start, -sweep, false);
			builder.close();
		}
	}
	return builder.detachAndDelete();
}

/** A regular polygon in its box, its corners rounded by `cornerRadius` (pen's polygons take one). */
function polygonPath(ck: CanvasKit, placed: Placed, sides: number, radius = 0): Path {
	const { x, y, w, h } = placed.box;
	const points: Array<[number, number]> = [];
	for (let i = 0; i < sides; i++) {
		// The first corner at the top, as pen.dev draws a triangle point-up.
		const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
		points.push([x + w / 2 + (w / 2) * Math.cos(angle), y + h / 2 + (h / 2) * Math.sin(angle)]);
	}
	const builder = new ck.PathBuilder();
	if (radius <= 0) {
		builder.addPolygon(points.flat(), true);
		return builder.detachAndDelete();
	}
	// Each corner an arc tangent to its two edges, no wider than half the shorter edge allows.
	const edge = Math.min(...points.map(([px, py], i) => Math.hypot(points[(i + 1) % sides]![0] - px, points[(i + 1) % sides]![1] - py)));
	const r = Math.min(radius, edge / 2);
	const [lx, ly] = points[sides - 1]!;
	const [fx, fy] = points[0]!;
	builder.moveTo((lx + fx) / 2, (ly + fy) / 2);
	for (let i = 0; i < sides; i++) {
		const [cx, cy] = points[i]!;
		const [nx, ny] = points[(i + 1) % sides]!;
		builder.arcToTangent(cx, cy, nx, ny, r);
	}
	builder.close();
	return builder.detachAndDelete();
}

function geometryPath(ck: CanvasKit, node: PenNode, placed: Placed): Path | null {
	if (typeof node.geometry !== "string" || !node.geometry.trim()) return null;
	const parsed = ck.Path.MakeFromSVGString(node.geometry);
	if (!parsed) return null;
	const vb = node.viewBox ?? (() => {
		const b = pathBounds(node.geometry);
		return b ? ([b.x, b.y, b.w, b.h] as [number, number, number, number]) : undefined;
	})();
	const { x, y, w, h } = placed.box;
	const sx = vb && vb[2] ? w / vb[2] : 1;
	const sy = vb && vb[3] ? h / vb[3] : 1;
	const builder = new ck.PathBuilder(parsed);
	parsed.delete();
	builder.transform([sx, 0, x - (vb?.[0] ?? 0) * sx, 0, sy, y - (vb?.[1] ?? 0) * sy, 0, 0, 1]);
	if (node.fillRule === "evenodd") builder.setFillType(ck.FillType.EvenOdd);
	return builder.detachAndDelete();
}

// --- fills and strokes -------------------------------------------------------------------------

function colorOf(ck: CanvasKit, hex: string): Float32Array {
	const rgba = color({ version: "", children: [] }, hex, {}) ?? [0, 0, 0, 1];
	return ck.Color4f(...rgba);
}

function rgbaColor(ck: CanvasKit, rgba: Rgba): Float32Array {
	return ck.Color4f(rgba[0], rgba[1], rgba[2], rgba[3]);
}

/** A paint for one fill, or undefined when it draws nothing. The caller deletes it. */
function fillPaint(ctx: PaintContext, fill: Fill, theme: ThemeState, box: Placed["box"]): Paint | undefined {
	const { ck, doc } = ctx;
	const paint = new ck.Paint();
	paint.setAntiAlias(true);
	if (typeof fill === "string") {
		const rgba = color(doc, fill, theme);
		if (!rgba) return void paint.delete();
		paint.setColor(rgbaColor(ck, rgba));
		return paint;
	}
	if (!fill || typeof fill !== "object") return void paint.delete();
	if (!bool(doc, (fill as { enabled?: unknown }).enabled, theme, true)) return void paint.delete();
	if (fill.type === "color") {
		const rgba = color(doc, (fill as { color?: unknown }).color, theme);
		if (!rgba) return void paint.delete();
		paint.setColor(rgbaColor(ck, rgba));
		return paint;
	}
	if (fill.type === "gradient") {
		const shader = gradientShader(ctx, fill as Extract<Fill, { type: "gradient" }>, theme, box);
		if (!shader) return void paint.delete();
		paint.setShader(shader);
		shader.delete();
		const alpha = num(doc, (fill as { opacity?: unknown }).opacity, theme, 1);
		if (alpha < 1) paint.setAlphaf(alpha);
		return paint;
	}
	if (fill.type === "image") {
		const url = (fill as { url?: unknown }).url;
		const image = typeof url === "string" ? ctx.image(url) : undefined;
		if (!image) return void paint.delete();
		const mode = (fill as { mode?: unknown }).mode;
		const iw = image.width();
		const ih = image.height();
		const scaleX = box.w / iw;
		const scaleY = box.h / ih;
		const cover = Math.max(scaleX, scaleY);
		const contain = Math.min(scaleX, scaleY);
		const [sx, sy] = mode === "stretch" ? [scaleX, scaleY] : mode === "fit" ? [contain, contain] : [cover, cover];
		const matrix = [sx, 0, box.x + (box.w - iw * sx) / 2, 0, sy, box.y + (box.h - ih * sy) / 2, 0, 0, 1];
		/*
		 * Past its edge a picture that fills its box repeats its last row and column. Read as transparent
		 * there (Decal), every scaled step blended the edge with nothing, and the item wore a faint grey
		 * rim on all four sides whenever it was drawn smaller than the picture, as it is through a zoom.
		 * A picture fitted inside its box keeps Decal, so the margin round it stays empty.
		 */
		const tile = mode === "fit" ? ck.TileMode.Decal : ck.TileMode.Clamp;
		const shader = image.makeShaderOptions(tile, tile, ck.FilterMode.Linear, ck.MipmapMode.Linear, matrix);
		paint.setShader(shader);
		shader.delete();
		const alpha = num(doc, (fill as { opacity?: unknown }).opacity, theme, 1);
		if (alpha < 1) paint.setAlphaf(alpha);
		return paint;
	}
	return void paint.delete();
}

function gradientShader(ctx: PaintContext, fill: Extract<Fill, { type: "gradient" }>, theme: ThemeState, box: Placed["box"]): Shader | undefined {
	const { ck, doc } = ctx;
	const stops = (fill.colors ?? [])
		.map((stop) => ({ color: color(doc, stop.color, theme), at: num(doc, stop.position, theme, 0) }))
		.filter((stop): stop is { color: Rgba; at: number } => !!stop.color)
		.sort((a, b) => a.at - b.at);
	if (stops.length === 0) return undefined;
	if (stops.length === 1) stops.push({ ...stops[0]! });
	const colors = stops.map((stop) => rgbaColor(ck, stop.color));
	const positions = stops.map((stop) => stop.at);
	const cx = box.x + box.w * num(doc, fill.center?.x, theme, 0.5);
	const cy = box.y + box.h * num(doc, fill.center?.y, theme, 0.5);
	const sw = box.w * num(doc, fill.size?.width, theme, 1);
	const sh = box.h * num(doc, fill.size?.height, theme, 1);
	const kind = fill.gradientType ?? "linear";
	if (kind === "radial") {
		const r = Math.max(1, sw / 2);
		const local = [1, 0, 0, 0, sh / Math.max(1, sw), cy - (cy * sh) / Math.max(1, sw), 0, 0, 1];
		return ck.Shader.MakeRadialGradient([cx, cy], r, colors, positions, ck.TileMode.Clamp, local);
	}
	if (kind === "angular") return ck.Shader.MakeSweepGradient(cx, cy, colors, positions, ck.TileMode.Clamp);
	// Linear: 0° points up, angles run counter-clockwise; the length is the size's height.
	const rad = (num(doc, fill.rotation, theme, 0) * Math.PI) / 180;
	const dx = -Math.sin(rad);
	const dy = -Math.cos(rad);
	const half = sh / 2;
	return ck.Shader.MakeLinearGradient([cx - dx * half, cy - dy * half], [cx + dx * half, cy + dy * half], colors, positions, ck.TileMode.Clamp);
}

function paintFills(canvas: Canvas, ctx: PaintContext, fills: PenNode["fill"], theme: ThemeState, box: Placed["box"], draw: (paint: Paint) => void): void {
	for (const fill of fillsOf(fills)) {
		const paint = fillPaint(ctx, fill, theme, box);
		if (!paint) continue;
		draw(paint);
		paint.delete();
	}
	void canvas;
}

function strokePaint(ctx: PaintContext, fills: Fill[], theme: ThemeState, box: Placed["box"], width: number, spec: { cap: string; join: string }, dash?: number[]): Paint | undefined {
	const { ck } = ctx;
	// A stroke takes its first fill that draws; several stroke fills are rare enough to take one.
	for (const fill of fills) {
		const paint = fillPaint(ctx, fill, theme, box);
		if (!paint) continue;
		paint.setStyle(ck.PaintStyle.Stroke);
		paint.setStrokeWidth(width);
		paint.setStrokeCap(spec.cap === "round" ? ck.StrokeCap.Round : spec.cap === "square" ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
		paint.setStrokeJoin(spec.join === "round" ? ck.StrokeJoin.Round : spec.join === "bevel" ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter);
		if (dash) {
			const effect = ck.PathEffect.MakeDash(dash, 0);
			if (effect) {
				paint.setPathEffect(effect);
				effect.delete();
			}
		}
		return paint;
	}
	return undefined;
}

/**
 * A line drawn in dashes or dots, from `strokeDash` (`"dashed"` or `"dotted"`): a field of ours
 * that pen.dev carries and draws solid. Arrows keep their own `dash`, in their metadata.
 */
function dashOf(node: PenNode, width: number): number[] | undefined {
	const w = Math.max(1, width);
	if (node.strokeDash === "dashed") return [w * 4, w * 3];
	if (node.strokeDash === "dotted") return [0.01, w * 2.5];
	return undefined;
}

/**
 * An arrow's words (`metadata.label`), at the middle of its line, on a patch of the canvas's own
 * colour so the line does not run through them.
 */
function paintArrowLabel(canvas: Canvas, ctx: PaintContext, node: PenNode, placed: Placed): void {
	const label = arrowLabel(node.metadata);
	if (!label || typeof node.geometry !== "string") return;
	const { ck } = ctx;
	const [line = ""] = node.geometry.split(/(?=M)/);
	const path = geometryPath(ck, { ...node, geometry: line }, placed);
	if (!path) return;
	const measure = new ck.ContourMeasureIter(path, false, 1);
	const contour = measure.next();
	const at = contour ? contour.getPosTan(contour.length() / 2) : undefined;
	contour?.delete();
	measure.delete();
	path.delete();
	if (!at) return;
	const ax = at[0] ?? 0;
	const ay = at[1] ?? 0;
	const dark = ctx.scheme === "dark";
	const paragraph = ctx.fonts.paragraph(label, { fontFamily: "Inter", fontSize: 13, fontWeight: 500, fontStyle: "normal", letterSpacing: 0, lineHeight: undefined }, { color: dark ? ck.Color4f(0.82, 0.82, 0.85, 1) : ck.Color4f(0.27, 0.29, 0.33, 1), align: "center", width: 400 });
	const w = Math.min(400, paragraph.getLongestLine());
	const h = paragraph.getHeight();
	const patch = new ck.Paint();
	patch.setColor(dark ? ck.Color4f(0.11, 0.11, 0.12, 1) : ck.Color4f(0.96, 0.96, 0.97, 1));
	canvas.drawRRect(ck.RRectXY(ck.LTRBRect(ax - w / 2 - 5, ay - h / 2 - 2, ax + w / 2 + 5, ay + h / 2 + 2), 5, 5), patch);
	patch.delete();
	canvas.drawParagraph(paragraph, ax - 200, ay - h / 2);
	paragraph.delete();
}

/** Inside or outside the edge: clip to the shape (or out of it) and draw the stroke twice as wide. */
function paintAligned(canvas: Canvas, ck: CanvasKit, align: "inner" | "center" | "outer", paint: Paint, width: number, draw: (paint: Paint) => void, clip: (op: typeof ck.ClipOp.Intersect) => void): void {
	if (align === "center") return draw(paint);
	canvas.save();
	clip(align === "inner" ? ck.ClipOp.Intersect : ck.ClipOp.Difference);
	paint.setStrokeWidth(width * 2);
	draw(paint);
	canvas.restore();
}

function paintStroke(canvas: Canvas, ctx: PaintContext, node: PenNode, theme: ThemeState, placed: Placed, draw: (paint: Paint) => void, clip: (op: typeof ctx.ck.ClipOp.Intersect) => void): void {
	const { ck, doc } = ctx;
	const stroke = strokeOf(doc, node, theme);
	if (!stroke) return;
	const [top, right, bottom, left] = stroke.widths;
	const uniform = top === right && right === bottom && bottom === left;
	if (uniform) {
		const paint = strokePaint(ctx, stroke.fills, theme, placed.box, top, stroke, dashOf(node, top));
		if (!paint) return;
		paintAligned(canvas, ck, stroke.align, paint, top, draw, clip);
		paint.delete();
		return;
	}
	// Per side: bars along the edges, inside the box (the common case is one border line).
	const fill = stroke.fills.map((f) => fillPaint(ctx, f, theme, placed.box)).find(Boolean);
	if (!fill) return;
	const { x, y, w, h } = placed.box;
	canvas.save();
	clip(ck.ClipOp.Intersect);
	if (top) canvas.drawRect(ck.LTRBRect(x, y, x + w, y + top), fill);
	if (bottom) canvas.drawRect(ck.LTRBRect(x, y + h - bottom, x + w, y + h), fill);
	if (left) canvas.drawRect(ck.LTRBRect(x, y, x + left, y + h), fill);
	if (right) canvas.drawRect(ck.LTRBRect(x + w - right, y, x + w, y + h), fill);
	canvas.restore();
	fill.delete();
}

function paintShadows(canvas: Canvas, ctx: PaintContext, node: PenNode, theme: ThemeState, draw: (paint: Paint) => void): void {
	const { ck, doc } = ctx;
	const effects = node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect];
	for (const effect of effects) {
		if (!effect || effect.type !== "shadow" || effect.shadowType === "inner") continue;
		if (!bool(doc, effect.enabled, theme, true)) continue;
		const rgba = color(doc, effect.color ?? "#00000040", theme);
		if (!rgba) continue;
		const paint = new ck.Paint();
		paint.setAntiAlias(true);
		paint.setColor(rgbaColor(ck, rgba));
		const blur = num(doc, effect.blur, theme, 0);
		if (blur > 0) paint.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, blur / 2, true));
		canvas.save();
		canvas.translate(num(doc, effect.offset?.x, theme, 0), num(doc, effect.offset?.y, theme, 0));
		draw(paint);
		canvas.restore();
		paint.delete();
	}
}

// --- text --------------------------------------------------------------------------------------

function paintText(canvas: Canvas, ctx: PaintContext, node: PenNode, theme: ThemeState, placed: Placed, pad: number, fallbackColor?: string): void {
	const { ck, doc, fonts } = ctx;
	if (ctx.mute?.has(node.id)) return;
	const content = String(resolve(doc, node.content, withTheme(theme, node)) ?? "");
	if (!content) return;
	const style = textStyleOf(doc, node, theme);
	// A text's `fill` is its colour; a card's is its paper, so its words take the default.
	const textFill = node.type === "text" ? fillsOf(node.fill).map((f) => (typeof f === "string" ? f : f && f.type === "color" ? (f as { color: string }).color : undefined)).find(Boolean) : undefined;
	const rgba = (textFill ? color(doc, textFill, theme) : undefined) ?? color(doc, fallbackColor ?? (ctx.scheme === "dark" ? "#e6e6e6" : "#1f2328"), theme)!;
	const { x, y, w, h } = placed.box;
	const width = Math.max(1, w - pad * 2);
	const paragraph = fonts.paragraph(content, style, {
		color: rgbaColor(ck, rgba),
		align: node.textAlign ?? "left",
		// One more pixel than measured, so a line measured to fit does not wrap on rounding.
		width: node.type === "text" && (node.textGrowth ?? "auto") === "auto" ? width + 1 : width,
		underline: bool(doc, node.underline, theme, false),
		strike: bool(doc, node.strikethrough, theme, false),
		// A text's outer shadows are the glyphs' own (a card's are its card's, drawn above).
		shadows: node.type === "text" ? textShadows(ctx, node, theme) : [],
	});
	const inner = h - pad * 2;
	const vertical = node.textAlignVertical ?? "top";
	const offset = vertical === "middle" ? (inner - paragraph.getHeight()) / 2 : vertical === "bottom" ? inner - paragraph.getHeight() : 0;
	canvas.drawParagraph(paragraph, x + pad, y + pad + Math.max(0, offset));
	paragraph.delete();
}

/** A text's outer `shadow` effects, as the paragraph's own text shadows. */
function textShadows(ctx: PaintContext, node: PenNode, theme: ThemeState): Array<{ color: Float32Array; offset: [number, number]; blurRadius: number }> {
	const { ck, doc } = ctx;
	const effects = node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect];
	const out: Array<{ color: Float32Array; offset: [number, number]; blurRadius: number }> = [];
	for (const effect of effects) {
		if (!effect || effect.type !== "shadow" || effect.shadowType === "inner" || !bool(doc, effect.enabled, theme, true)) continue;
		const rgba = color(doc, effect.color ?? "#00000040", theme);
		if (!rgba) continue;
		out.push({ color: rgbaColor(ck, rgba), offset: [num(doc, effect.offset?.x, theme, 0), num(doc, effect.offset?.y, theme, 0)], blurRadius: num(doc, effect.blur, theme, 0) / 2 });
	}
	return out;
}

/** A markdown card's words, set as markdown inside its padding (`fonts.markdown`). */
/** A card's paper: the app's two-layer shadow for the scheme, then the panel colour, as a note card has. */
function paintCardPaper(canvas: Canvas, ctx: PaintContext, rrect: Float32Array, colour: string): void {
	const { ck } = ctx;
	for (const layer of SHADOWS[ctx.scheme]) {
		const shadow = new ck.Paint();
		shadow.setAntiAlias(true);
		shadow.setColor(ck.Color4f(0, 0, 0, layer.alpha));
		shadow.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, layer.blur / 2, true));
		canvas.save();
		canvas.translate(0, layer.y);
		canvas.drawRRect(rrect, shadow);
		canvas.restore();
		shadow.delete();
	}
	const paint = new ck.Paint();
	paint.setAntiAlias(true);
	paint.setColor(colorOf(ck, colour));
	canvas.drawRRect(rrect, paint);
	paint.delete();
}

/** A card's hairline edge, outside its box as a CSS outline is. */
function paintCardEdge(canvas: Canvas, ctx: PaintContext, placed: Placed, radius: number): void {
	const { ck } = ctx;
	const { x, y, w, h } = placed.box;
	const edge = new ck.Paint();
	edge.setAntiAlias(true);
	edge.setStyle(ck.PaintStyle.Stroke);
	edge.setStrokeWidth(1);
	edge.setColor(ctx.scheme === "dark" ? ck.Color4f(1, 1, 1, 0.12) : ck.Color4f(0, 0, 0, 0.1));
	canvas.drawRRect(ck.RRectXY(ck.LTRBRect(x - 0.5, y - 0.5, x + w + 0.5, y + h + 0.5), radius + 0.5, radius + 0.5), edge);
	edge.delete();
}

function paintMarkdown(canvas: Canvas, ctx: PaintContext, node: PenNode, theme: ThemeState, placed: Placed, pad = NOTE_PAD): void {
	if (ctx.mute?.has(node.id)) return;
	const content = String(resolve(ctx.doc, node.content, withTheme(theme, node)) ?? "");
	if (!content) return;
	const style = textStyleOf(ctx.doc, node, theme);
	const { x, y, w, h } = placed.box;
	/*
	 * Inside the card, always. A card is as tall as its words until someone drags its top or bottom
	 * handle, and from then on it is a height they chose: words past it are cut off at the paper's
	 * own corner rather than running on over the canvas.
	 */
	const { ck } = ctx;
	canvas.save();
	if (pad) canvas.clipRRect(ck.RRectXY(ck.LTRBRect(x, y, x + w, y + h), NOTE_RADIUS, NOTE_RADIUS), ck.ClipOp.Intersect, true);
	ctx.fonts.markdown(content, style, { width: w - pad * 2, align: node.textAlign ?? "left" }).draw(canvas, x + pad, y + pad, (index) => ctx.scroll?.(node.id, index) ?? 0);
	canvas.restore();
}

// --- icons -------------------------------------------------------------------------------------

function paintIcon(canvas: Canvas, ctx: PaintContext, node: PenNode, theme: ThemeState, placed: Placed): void {
	const { ck, doc } = ctx;
	const library = String(resolve(doc, node.type === "icon_font" ? node.iconFontFamily : node.library, theme) ?? "lucide");
	const name = String(resolve(doc, node.type === "icon_font" ? node.iconFontName : node.icon, theme) ?? "");
	const weight = num(doc, node.weight, theme, 400);
	const shape = name ? ctx.icon(library, name, weight) : undefined;
	if (!shape) return;
	const first = fillsOf(node.fill).map((f) => (typeof f === "string" ? f : f && f.type === "color" ? (f as { color: string }).color : undefined)).find(Boolean);
	const rgba = (first ? color(doc, first, theme) : undefined) ?? color(doc, ctx.scheme === "dark" ? "#e6e6e6" : "#1f2328", theme)!;
	const { x, y, w, h } = placed.box;
	const [vx, vy, vw, vh] = shape.viewBox;
	const scale = Math.min(w / vw, h / vh);
	canvas.save();
	canvas.translate(x + (w - vw * scale) / 2, y + (h - vh * scale) / 2);
	canvas.scale(scale, scale);
	canvas.translate(-vx, -vy);
	for (const part of shape.parts) {
		const path = ck.Path.MakeFromSVGString(part.d);
		if (!path) continue;
		if (part.evenOdd) path.setFillType(ck.FillType.EvenOdd);
		const paint = new ck.Paint();
		paint.setAntiAlias(true);
		paint.setColor(rgbaColor(ck, rgba));
		if (part.fill) canvas.drawPath(path, paint);
		if (part.stroke) {
			paint.setStyle(ck.PaintStyle.Stroke);
			paint.setStrokeWidth(part.strokeWidth);
			paint.setStrokeCap(part.cap === "round" ? ck.StrokeCap.Round : part.cap === "square" ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
			paint.setStrokeJoin(part.join === "round" ? ck.StrokeJoin.Round : part.join === "bevel" ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter);
			canvas.drawPath(path, paint);
		}
		paint.delete();
		path.delete();
	}
	canvas.restore();
}

// --- what is not drawn yet ---------------------------------------------------------------------

/**
 * A film or a sound, at rest: what it looks like before it is pressed, and what the one live
 * player laid over it (`MediaPlayer.tsx`) looks like once it is, from the same layout
 * (`media-look.ts`) so the press moves nothing.
 *
 * A film is its still (the item's fill) with a play button in the middle and its running time in
 * a pill in the corner, as a video is shown anywhere. A sound has no still: it is a card in the
 * notes' paper, with a play button, its name, its running time and its waveform, which is what
 * tells one sound from another without playing them.
 */
function paintMedia(canvas: Canvas, ctx: PaintContext, node: PenNode, placed: Placed): void {
	const media = mediaOf(node);
	if (!media) return;
	const { ck } = ctx;
	const { box } = placed;
	const fill = (colour: Float32Array) => {
		const paint = new ck.Paint();
		paint.setAntiAlias(true);
		paint.setColor(colour);
		return paint;
	};
	const triangle = (cx: number, cy: number, r: number, paint: InstanceType<typeof ck.Paint>) => {
		const builder = new ck.PathBuilder();
		builder.addPolygon(playTriangle(cx, cy, r), true);
		const path = builder.detachAndDelete();
		canvas.drawPath(path, paint);
		path.delete();
	};

	if (media.kind === "audio") {
		const ink = SOUND_INK[ctx.scheme];
		const look = soundLayout(box);
		const disc = fill(colorOf(ck, ink.disc));
		canvas.drawCircle(look.disc.cx, look.disc.cy, look.disc.r, disc);
		disc.delete();
		const glyph = fill(colorOf(ck, ink.glyph));
		triangle(look.disc.cx, look.disc.cy, look.disc.r * 0.62, glyph);
		glyph.delete();

		const label = (text: string, size: number, weight: number, colour: string, width: number, align?: string) =>
			ctx.fonts.paragraph(text, { fontFamily: "Inter", fontSize: size, fontWeight: weight, fontStyle: "normal", letterSpacing: 0, lineHeight: undefined }, { color: colorOf(ck, colour), width, oneLine: true, ...(align ? { align } : {}) });
		const name = label(String(node.name ?? media.file.split("/").pop() ?? "Sound"), look.name.size, 600, ink.fg, look.name.w);
		canvas.drawParagraph(name, look.name.x, look.name.y);
		name.delete();
		if (media.seconds !== undefined) {
			const time = label(clockOf(Math.round(media.seconds)), look.time.size, 500, ink.muted, 120, "right");
			canvas.drawParagraph(time, look.time.right - 120, look.time.y);
			time.delete();
		}

		const bars = waveBars(look.wave, media.peaks);
		const bar = fill(colorOf(ck, ink.bar));
		if (bars.length) for (const one of bars) canvas.drawRRect(ck.RRectXY(ck.XYWHRect(one.x, one.y, one.w, one.h), one.w / 2, one.w / 2), bar);
		else {
			const thick = Math.max(2, 3 * look.k);
			canvas.drawRRect(ck.RRectXY(ck.XYWHRect(look.wave.x, look.wave.y + look.wave.h / 2 - thick / 2, look.wave.w, thick), thick / 2, thick / 2), bar);
		}
		bar.delete();
		return;
	}

	// A film: a dark glass disc in the middle, the triangle in white.
	const look = filmLayout(box);
	const { cx, cy, r } = look.disc;
	const disc = fill(ck.Color4f(0, 0, 0, 0.5));
	canvas.drawCircle(cx, cy, r, disc);
	disc.delete();
	const glyph = fill(ck.Color4f(1, 1, 1, 0.96));
	triangle(cx, cy, r * 0.62, glyph);
	glyph.delete();

	if (media.seconds === undefined || box.h < 60) return;
	const { pill } = look;
	const words = ctx.fonts.paragraph(clockOf(Math.round(media.seconds)), { fontFamily: "Inter", fontSize: pill.size, fontWeight: 600, fontStyle: "normal", letterSpacing: 0, lineHeight: undefined }, { color: ck.Color4f(1, 1, 1, 0.96), width: 200 });
	const tw = Math.ceil(words.getMaxIntrinsicWidth());
	const th = words.getHeight();
	const pw = tw + pill.padX * 2;
	const ph = th + pill.padY * 2;
	const back = fill(ck.Color4f(0, 0, 0, 0.62));
	canvas.drawRRect(ck.RRectXY(ck.XYWHRect(pill.right - pw, pill.bottom - ph, pw, ph), ph / 2.6, ph / 2.6), back);
	back.delete();
	canvas.drawParagraph(words, pill.right - pw + pill.padX, pill.bottom - ph + pill.padY);
	words.delete();
}

function paintPlaceholder(canvas: Canvas, ctx: PaintContext, node: PenNode, placed: Placed): void {
	const { ck, fonts } = ctx;
	const { x, y, w, h } = placed.box;
	const missing = node.type === MISSING;
	const paint = new ck.Paint();
	paint.setAntiAlias(true);
	paint.setStyle(ck.PaintStyle.Stroke);
	paint.setStrokeWidth(1.5);
	paint.setColor(missing ? ck.Color4f(0.86, 0.2, 0.2, 0.9) : ck.Color4f(0.5, 0.5, 0.55, 0.8));
	const dash = ck.PathEffect.MakeDash([6, 4], 0);
	paint.setPathEffect(dash);
	canvas.drawRRect(ck.RRectXY(ck.LTRBRect(x, y, x + w, y + h), 6, 6), paint);
	paint.delete();
	dash.delete();
	const label = missing ? `missing: ${String(node.why ?? node.id)}` : node.type === "browser" ? String(node.url ?? "web page") : `${node.type}${node.name ? `: ${String(node.name)}` : ""}`;
	const paragraph = fonts.paragraph(label, { fontFamily: "Inter", fontSize: 13, fontWeight: 400, fontStyle: "normal", letterSpacing: 0, lineHeight: undefined }, { color: ctx.scheme === "dark" ? ck.Color4f(0.75, 0.75, 0.78, 1) : ck.Color4f(0.4, 0.4, 0.45, 1), width: Math.max(20, w - 16) });
	canvas.drawParagraph(paragraph, x + 8, y + 8);
	paragraph.delete();
}
