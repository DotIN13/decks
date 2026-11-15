import type { Fill, PenNode } from "./types.ts";
import type { Frame } from "./layout.ts";
import { bool, fillsOf, isVariable, num, radiiOf, strokeOf, type ThemeState } from "./values.ts";
import { escapeAttr, styleAttr, itemBox, toColour, cssLength, px, r2, type Decl, type Writer } from "./html-writer.ts";

/** A fill as a CSS background layer: a colour, or an image with its size. */
export interface Layer {
	colour?: string;
	image?: string;
	size?: string;
}

/**
 * An angular gradient as CSS's `conic-gradient`. pen starts counter-clockwise from up, runs clockwise,
 * and takes its angles on the gradient's ellipse where CSS takes a circle: each stop is put at the
 * circle's angle of the ellipse's, so only the blend of a stretched gradient differs a little.
 */
function conic(stops: Array<{ at: number; colour: string }>, cx: number, cy: number, sw: number, sh: number, turn: number): string {
	const start = (turn * Math.PI) / 180;
	const [rx, ry] = [Math.max(1, sw / 2), Math.max(1, sh / 2)];
	// The clockwise angle from up, on the page, of the ellipse's angle `e`.
	const page = (e: number) => Math.atan2(rx * Math.sin(e), ry * Math.cos(e));
	const from = page(-start);
	const turnOf = (t: number) => {
		if (t >= 1) return 1;
		if (t <= 0) return 0;
		const d = (page(2 * Math.PI * t - start) - from) / (2 * Math.PI);
		return d - Math.floor(d);
	};
	const fromDeg = ((((from * 180) / Math.PI) % 360) + 360) % 360;
	return `conic-gradient(from ${r2(fromDeg)}deg at ${r2(cx * 100)}% ${r2(cy * 100)}%, ${stops.map((s) => `${s.colour} ${r2(turnOf(s.at) * 100)}%`).join(", ")})`;
}

/** Fills, corners and shadows (outer, and inner ones inset) on a box. */
export function paintBox(w: Writer, node: PenNode, theme: ThemeState, css: Decl[], round = false): void {
	const box = itemBox(w, node);
	const layers = fillsOf(node.fill)
		.map((fill) => toLayer(w, fill, theme, box))
		.filter((layer): layer is Layer => !!layer);
	if (layers.length === 1 && layers[0]!.colour) css.push(["background-color", layers[0]!.colour]);
	else if (layers.length > 0) {
		// CSS lists its backgrounds top first; pen paints its fills in order, the last on top.
		const top = [...layers].reverse();
		css.push(["background-image", top.map((layer) => layer.image ?? `linear-gradient(${layer.colour}, ${layer.colour})`).join(", ")]);
		css.push(["background-size", top.map((layer) => layer.size ?? "100% 100%").join(", ")]);
		css.push(["background-position", top.map(() => "center").join(", ")]);
		css.push(["background-repeat", "no-repeat"]);
	}
	const radius = cornerRadius(w, node, theme, round);
	if (radius) css.push(["border-radius", radius]);
	const shadows = shadowsOf(w, node, theme);
	if (shadows) css.push(["box-shadow", shadows]);
}

export function cornerRadius(w: Writer, node: PenNode, theme: ThemeState, round: boolean): string | undefined {
	if (round) return "50%";
	const radii = radiiOf(w.doc, node, theme);
	if (radii.every((r) => r <= 0)) return undefined;
	if (!Array.isArray(node.cornerRadius) && isVariable(node.cornerRadius)) return cssLength(w, node.cornerRadius, theme);
	return radii.every((r) => r === radii[0]) ? px(radii[0]!) : radii.map(px).join(" ");
}

/** An item's blur: its enabled blur effects' radii, added up. */
export function blurRadius(w: Writer, node: PenNode, theme: ThemeState): number {
	const effects = node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect];
	let radius = 0;
	for (const effect of effects) if (effect?.type === "blur" && bool(w.doc, effect.enabled, theme, true)) radius += Math.max(0, num(w.doc, effect.radius, theme, 0));
	return radius;
}

export function shadowsOf(w: Writer, node: PenNode, theme: ThemeState): string | undefined {
	const effects = node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect];
	const out: string[] = [];
	for (const effect of effects) {
		if (!effect || effect.type !== "shadow" || !bool(w.doc, effect.enabled, theme, true)) continue;
		const colour = toColour(w, effect.color ?? "#00000040", theme) ?? "#00000040";
		out.push(`${effect.shadowType === "inner" ? "inset " : ""}${px(num(w.doc, effect.offset?.x, theme, 0))} ${px(num(w.doc, effect.offset?.y, theme, 0))} ${px(num(w.doc, effect.blur, theme, 0))} ${px(num(w.doc, effect.spread, theme, 0))} ${colour}`);
	}
	return out.length ? out.join(", ") : undefined;
}

/** A fill as a CSS background layer; undefined for one that draws nothing. */
export function toLayer(w: Writer, fill: Fill, theme: ThemeState, box: Frame): Layer | undefined {
	if (typeof fill === "string") {
		const colour = toColour(w, fill, theme);
		return colour ? { colour } : undefined;
	}
	if (!fill || typeof fill !== "object" || !bool(w.doc, fill.enabled, theme, true)) return undefined;
	const alpha = num(w.doc, (fill as { opacity?: unknown }).opacity, theme, 1);
	if (fill.type === "color") {
		const colour = toColour(w, (fill as { color?: unknown }).color, theme);
		return colour ? { colour } : undefined;
	}
	if (fill.type === "gradient") {
		const g = fill as Extract<Fill, { type: "gradient" }>;
		const stops = (g.colors ?? [])
			.map((stop) => ({ at: num(w.doc, stop.position, theme, 0), colour: toColour(w, stop.color, theme, alpha) }))
			.filter((stop): stop is { at: number; colour: string } => !!stop.colour)
			.sort((a, b) => a.at - b.at);
		if (stops.length === 0) return undefined;
		const cx = num(w.doc, g.center?.x, theme, 0.5);
		const cy = num(w.doc, g.center?.y, theme, 0.5);
		const sw = box.w * num(w.doc, g.size?.width, theme, 1);
		const sh = box.h * num(w.doc, g.size?.height, theme, 1);
		if ((g.gradientType ?? "linear") === "linear") {
			// 0° points up and pen turns counter-clockwise; CSS's 0deg is up too and turns clockwise.
			// pen's line is the size's height long through the centre; CSS's runs corner to corner.
			const turn = num(w.doc, g.rotation, theme, 0);
			const rad = (-turn * Math.PI) / 180;
			const span = Math.abs(box.w * Math.sin(rad)) + Math.abs(box.h * Math.cos(rad)) || 1;
			// Off centre, the line moves along itself by the centre's offset in its direction.
			const shift = (cx - 0.5) * box.w * Math.sin(rad) - (cy - 0.5) * box.h * Math.cos(rad);
			const at = (p: number) => `${r2(((span / 2 + shift + (p - 0.5) * sh) / span) * 100)}%`;
			return { image: `linear-gradient(${r2(((-turn % 360) + 360) % 360)}deg, ${stops.map((s) => `${s.colour} ${at(s.at)}`).join(", ")})` };
		}
		if (g.gradientType === "angular") return { image: conic(stops, cx, cy, sw, sh, num(w.doc, g.rotation, theme, 0)) };
		return { image: `radial-gradient(${px(Math.max(1, sw / 2))} ${px(Math.max(1, sh / 2))} at ${r2(cx * 100)}% ${r2(cy * 100)}%, ${stops.map((s) => `${s.colour} ${r2(s.at * 100)}%`).join(", ")})` };
	}
	if (fill.type === "image") {
		const url = typeof (fill as { url?: unknown }).url === "string" ? ((fill as { url: string }).url) : undefined;
		if (!url) return undefined;
		const address = w.options.url ? w.options.url(url) : url;
		const mode = (fill as { mode?: string }).mode;
		return { image: `url("${address.replace(/"/g, "%22")}")`, size: mode === "stretch" ? "100% 100%" : mode === "fit" ? "contain" : "cover" };
	}
	return undefined;
}

/** An item's stroke, drawn over what is in it on the side pen strokes, with its corners. */
export function strokeOutline(w: Writer, node: PenNode, theme: ThemeState, round = false): string {
	const stroke = strokeOf(w.doc, node, theme);
	if (!stroke) return "";
	const box = itemBox(w, node);
	const colour = stroke.fills.map((fill) => (typeof fill === "string" ? toColour(w, fill, theme) : fill?.type === "color" ? toColour(w, (fill as { color?: unknown }).color, theme) : undefined)).find(Boolean);
	if (!colour) return "";
	const [t, r, b, l] = stroke.widths;
	const uniform = t === r && r === b && b === l;
	// Centred strokes reach half their width outside; outer ones all of it.
	const out = (w: number) => (stroke.align === "outer" ? w : stroke.align === "center" ? w / 2 : 0);
	const css: Decl[] = [
		["position", "absolute"],
		["pointer-events", "none"],
		["top", px(-out(t))],
		["right", px(-out(r))],
		["bottom", px(-out(b))],
		["left", px(-out(l))],
		["border-style", node.strokeDash === "dashed" ? "dashed" : node.strokeDash === "dotted" ? "dotted" : "solid"],
		["border-color", colour],
		["border-width", uniform && !(isVariable(node.strokeWidth) && w.doc.variables?.[String(node.strokeWidth).slice(1)]?.type === "number") ? px(t) : uniform ? cssLength(w, node.strokeWidth, theme, 1) : [t, r, b, l].map(px).join(" ")],
	];
	if (round) css.push(["border-radius", "50%"]);
	else {
		const radii = radiiOf(w.doc, node, theme);
		const most = Math.min(box.w, box.h) / 2;
		const corners = radii.map((one) => px(Math.max(0, Math.min(one, most)) + out(t)));
		if (radii.some((one) => one > 0)) css.push(["border-radius", corners.every((one) => one === corners[0]) ? corners[0]! : corners.join(" ")]);
	}
	return `<div aria-hidden="true"${styleAttr(w, css)}></div>`;
}

/** A fill as an SVG paint: a colour, or a gradient defined in `defs`. */
export function svgPaint(w: Writer, fills: Fill[], theme: ThemeState, box: Frame, defs: string[]): string | undefined {
	for (const fill of fills) {
		if (typeof fill === "string" || fill?.type === "color") {
			const colour = toColour(w, typeof fill === "string" ? fill : (fill as { color?: unknown }).color, theme);
			if (colour) return colour;
			continue;
		}
		if (fill?.type !== "gradient" || !bool(w.doc, fill.enabled, theme, true)) continue;
		const g = fill as Extract<Fill, { type: "gradient" }>;
		const alpha = num(w.doc, g.opacity, theme, 1);
		const stops = (g.colors ?? []).map((stop) => ({ at: num(w.doc, stop.position, theme, 0), colour: toColour(w, stop.color, theme, alpha) })).filter((stop) => stop.colour);
		if (!stops.length) continue;
		const id = `g${++w.gradients}`;
		const cx = box.w * num(w.doc, g.center?.x, theme, 0.5);
		const cy = box.h * num(w.doc, g.center?.y, theme, 0.5);
		const sw = box.w * num(w.doc, g.size?.width, theme, 1);
		const sh = box.h * num(w.doc, g.size?.height, theme, 1);
		const list = stops.map((s) => `<stop offset="${r2(s.at)}" stop-color="${escapeAttr(s.colour!)}"/>`).join("");
		if ((g.gradientType ?? "linear") === "linear") {
			const rad = (num(w.doc, g.rotation, theme, 0) * Math.PI) / 180;
			const [dx, dy] = [-Math.sin(rad), -Math.cos(rad)];
			defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r2(cx - (dx * sh) / 2)}" y1="${r2(cy - (dy * sh) / 2)}" x2="${r2(cx + (dx * sh) / 2)}" y2="${r2(cy + (dy * sh) / 2)}">${list}</linearGradient>`);
		} else defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(Math.max(1, sw / 2))}" gradientTransform="translate(${r2(cx)} ${r2(cy)}) scale(1 ${r2(sh / Math.max(1, sw))}) translate(${r2(-cx)} ${r2(-cy)})">${list}</radialGradient>`);
		return `url(#${id})`;
	}
	return undefined;
}
