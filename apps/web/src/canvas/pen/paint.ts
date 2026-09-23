import type { Canvas, CanvasKit, Image, Paint, Path, Shader } from "canvaskit-wasm";
import { bool, color, fillsOf, isArrow, MISSING, NOTE_PAD, num, pathBounds, radiiOf, resolve, strokeOf, textStyleOf, withTheme, type Fill, type PenDocument, type PenNode, type Placed, type Rgba, type ThemeState } from "@decks/pen";
import type { PenFonts } from "./fonts.ts";

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
 * icons, scripts, and web pages other than the deck's own boards.
 */

export interface PaintContext {
	ck: CanvasKit;
	fonts: PenFonts;
	doc: PenDocument;
	placed: ReadonlyMap<string, Placed>;
	scheme: "light" | "dark";
	/** An image fill's picture, once loaded; undefined asks for it and draws nothing this time. */
	image(url: string): Image | undefined;
}

const NOTE_COLORS: Record<string, string> = { note: "#fde68a", prompt: "#ddd6fe", context: "#bfdbfe" };

export function paintDocument(canvas: Canvas, nodes: readonly PenNode[], ctx: PaintContext): void {
	for (const node of nodes) paintNode(canvas, node, ctx);
}

function paintNode(canvas: Canvas, node: PenNode, ctx: PaintContext): void {
	const placed = ctx.placed.get(node.id);
	if (!placed) return;
	const { ck, doc } = ctx;
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
			paintShadows(canvas, ctx, node, theme, (paint) => canvas.drawRRect(rrect, paint));
			paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawRRect(rrect, paint));
			if (node.type === "frame" && Array.isArray(node.children) && node.children.length) {
				const clip = bool(doc, node.clip, theme, false);
				canvas.save();
				if (clip) canvas.clipRRect(rrect, ck.ClipOp.Intersect, true);
				for (const child of node.children) paintNode(canvas, child, ctx);
				canvas.restore();
			}
			paintStroke(canvas, ctx, node, theme, placed, (paint) => canvas.drawRRect(rrect, paint), (op) => canvas.clipRRect(rrect, op, true));
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
			const path = polygonPath(ck, placed, Math.max(3, Math.round(num(doc, node.polygonCount, theme, 3))));
			paintShadows(canvas, ctx, node, theme, (paint) => canvas.drawPath(path, paint));
			paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawPath(path, paint));
			paintStroke(canvas, ctx, node, theme, placed, (paint) => canvas.drawPath(path, paint), (op) => canvas.clipPath(path, op, true));
			path.delete();
			break;
		}
		case "path": {
			const path = geometryPath(ck, node, placed);
			if (!path) break;
			paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawPath(path, paint));
			// An arrow is a line: its stroke is centred however it was aligned, or its head would be clipped away.
			const stroke = strokeOf(doc, node, theme);
			if (stroke) {
				const paint = strokePaint(ctx, stroke.fills, theme, placed.box, stroke.widths[0], stroke);
				if (paint) {
					if (isArrow(node) || stroke.align === "center") canvas.drawPath(path, paint);
					else paintAligned(canvas, ck, stroke.align, paint, stroke.widths[0], (p) => canvas.drawPath(path, p), (op) => canvas.clipPath(path, op, true));
					paint.delete();
				}
			}
			path.delete();
			break;
		}
		case "text":
			paintText(canvas, ctx, node, theme, placed, 0);
			break;
		case "note":
		case "prompt":
		case "context": {
			const fills = fillsOf(node.fill);
			const rrect = ck.RRectXY(ck.LTRBRect(x, y, x + w, y + h), 6, 6);
			const shadow = new ck.Paint();
			shadow.setAntiAlias(true);
			shadow.setColor(ck.Color4f(0, 0, 0, ctx.scheme === "dark" ? 0.45 : 0.14));
			shadow.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, 4, true));
			canvas.save();
			canvas.translate(0, 2);
			canvas.drawRRect(rrect, shadow);
			canvas.restore();
			shadow.delete();
			if (fills.length) paintFills(canvas, ctx, node.fill, theme, placed.box, (paint) => canvas.drawRRect(rrect, paint));
			else {
				const paint = new ck.Paint();
				paint.setAntiAlias(true);
				paint.setColor(colorOf(ck, NOTE_COLORS[node.type] ?? NOTE_COLORS.note!));
				canvas.drawRRect(rrect, paint);
				paint.delete();
			}
			// A card's words are dark on its light colour, whatever the stage's scheme.
			paintText(canvas, ctx, node, theme, placed, NOTE_PAD, "#1f2328");
			break;
		}
		case "group":
			for (const child of node.children ?? []) paintNode(canvas, child, ctx);
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

function polygonPath(ck: CanvasKit, placed: Placed, sides: number): Path {
	const { x, y, w, h } = placed.box;
	const points: number[] = [];
	for (let i = 0; i < sides; i++) {
		// The first corner at the top, as pen.dev draws a triangle point-up.
		const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
		points.push(x + w / 2 + (w / 2) * Math.cos(angle), y + h / 2 + (h / 2) * Math.sin(angle));
	}
	const builder = new ck.PathBuilder();
	builder.addPolygon(points, true);
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
		const shader = image.makeShaderOptions(ck.TileMode.Decal, ck.TileMode.Decal, ck.FilterMode.Linear, ck.MipmapMode.Linear, matrix);
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

function strokePaint(ctx: PaintContext, fills: Fill[], theme: ThemeState, box: Placed["box"], width: number, spec: { cap: string; join: string }): Paint | undefined {
	const { ck } = ctx;
	// A stroke takes its first fill that draws; several stroke fills are rare enough to take one.
	for (const fill of fills) {
		const paint = fillPaint(ctx, fill, theme, box);
		if (!paint) continue;
		paint.setStyle(ck.PaintStyle.Stroke);
		paint.setStrokeWidth(width);
		paint.setStrokeCap(spec.cap === "round" ? ck.StrokeCap.Round : spec.cap === "square" ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
		paint.setStrokeJoin(spec.join === "round" ? ck.StrokeJoin.Round : spec.join === "bevel" ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter);
		return paint;
	}
	return undefined;
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
		const paint = strokePaint(ctx, stroke.fills, theme, placed.box, top, stroke);
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
	});
	const inner = h - pad * 2;
	const vertical = node.textAlignVertical ?? "top";
	const offset = vertical === "middle" ? (inner - paragraph.getHeight()) / 2 : vertical === "bottom" ? inner - paragraph.getHeight() : 0;
	canvas.drawParagraph(paragraph, x + pad, y + pad + Math.max(0, offset));
	paragraph.delete();
}

// --- what is not drawn yet ---------------------------------------------------------------------

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
