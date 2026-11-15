import { walk } from "./doc.ts";
import { PenError } from "./doc.ts";
import { estimateText, isMarkdown, layout, MEDIA, NOTE_PAD, textStyleOf, type Frame, type MeasureText, type Placed } from "./layout.ts";
import { outlineOf } from "./outline.ts";
import { expand, MISSING } from "./refs.ts";
import type { Fill, PenDocument, PenNode, SizeValue } from "./types.ts";
import { baseTheme, bool, fillsOf, isVariable, num, paddingOf, parseColor, radiiOf, resolve, strokeOf, variable, withTheme, type Rgba, type ThemeState } from "./values.ts";

/**
 * Frames as one HTML page (`decks.canvas.export`): the items asked for, each with what is in it,
 * written the way a person would write them by hand rather than as boxes at fixed places.
 *
 * - a frame with a layout is a flexbox: `layout` the direction, `gap`, `padding`, `justifyContent`
 *   and `alignItems` as CSS has them; `fill_container` is `flex: 1` along the row or column and
 *   `align-self: stretch` across it, `fit_content` is the size the content gives, a number is px;
 * - a frame with no layout, a group, and an item placed `absolute` hold their children at the
 *   places pen lays them out at, relative to themselves;
 * - text is set in its family, size, weight, line height, letter spacing and colour, on one line
 *   (`auto`), wrapping at its width (`fixed-width`), or in its box (`fixed-width-height`);
 * - fills are a colour, a linear, radial or angular (conic) gradient, or a picture (its address as
 *   `url` gives it);
 *   strokes are an outline over the children on the side pen strokes (inside, centred, outside),
 *   with the item's corners; shadows (inner ones inset), blurs, opacity and turns are CSS's own;
 * - icons are inline SVG of the icon sets the stage draws them from, as `icons` hands them over;
 *   paths, polygons and arcs are inline SVG of the outline the stage draws;
 * - variables are CSS custom properties, with the dark theme's values in a `prefers-color-scheme:
 *   dark` block (and under `data-theme="dark"`), and an item with a theme of its own sets its own.
 *
 * `format: "tailwind"` writes the same page with Tailwind classes (arbitrary values where Tailwind
 * has no name for one) and Tailwind's browser build from its CDN in place of inline styles.
 *
 * What the stage keeps but does not draw (shader and mesh fills, background blurs, inner shadows off
 * boxes, scripts) is left out here too. A note is its paper with its words; a markdown card's words
 * are written as they are.
 */

/** An icon's shapes, as the stage reads them (`icons.ts` in `@decks/canvas`). */
export interface HtmlIcon {
	viewBox: [number, number, number, number];
	parts: Array<{ d: string; fill: boolean; stroke: boolean; strokeWidth: number; cap: string; join: string; evenOdd: boolean }>;
}

export interface HtmlOptions {
	format: "html" | "tailwind";
	/** The light theme's starting state; the document's own light theme when left out. */
	theme?: ThemeState;
	/** Text is laid out by this where pen's layout needs a size (absolute children's places). */
	measure?: MeasureText;
	/** An icon's shapes by library, name and weight, fetched beforehand (`iconsIn`); none: the icon is left out. */
	icons?: (library: string, name: string, weight: number) => HtmlIcon | undefined;
	/** An image fill's address as the page reads it: relative to where the page is written. Left as it is when absent. */
	url?: (url: string) => string;
	/** A board's address (a `browser` item's), shown in an iframe; none: a grey box with its name. */
	board?: (node: PenNode) => string | undefined;
	/** The page's title. */
	title?: string;
}

/** The icons the items asked for use, to fetch before writing the page. */
export function iconsIn(doc: PenDocument, ids: readonly string[]): Array<{ library: string; name: string; weight: number }> {
	const theme = baseTheme(doc, "light");
	const out = new Map<string, { library: string; name: string; weight: number }>();
	for (const root of rootsOf(doc, expand(doc), ids)) {
		for (const node of walk([root])) {
			const icon = iconOf(doc, node, theme);
			if (icon) out.set(`${icon.library}|${icon.name}|${icon.weight}`, icon);
		}
	}
	return [...out.values()];
}

/** The page, whole: one HTML document of the items `ids` names, in that order. */
export function toHtml(doc: PenDocument, ids: readonly string[], options: HtmlOptions): string {
	const theme = options.theme ?? baseTheme(doc, "light");
	const nodes = expand(doc);
	const placed = layout(doc, nodes, { theme, measure: options.measure ?? estimateText });
	const roots = rootsOf(doc, nodes, ids);
	const writer = new Writer(doc, placed, theme, options);
	const body = roots.map((root) => writer.element(root, undefined)).join("\n");
	const tailwind = options.format === "tailwind";
	const head = [
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${escapeText(options.title ?? roots.map((root) => root.name ?? root.id).join(", "))}</title>`,
		...(tailwind ? ['<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>'] : []),
		`<style>\n${[writer.fontFaces(), writer.variables(), BASE].filter(Boolean).join("\n")}\n</style>`,
	];
	const page = tailwind ? ' class="m-0 flex flex-col items-start gap-[48px] p-[24px]"' : "";
	return `<!doctype html>\n<html lang="en">\n<head>\n${head.join("\n")}\n</head>\n<body${page}>\n${body}\n</body>\n</html>\n`;
}

/** What every page starts from: no margins, sizes include padding, the stage's paper and ink. */
const BASE = `*, *::before, *::after { box-sizing: border-box; margin: 0; }
body { margin: 0; padding: 24px; display: flex; flex-direction: column; align-items: flex-start; gap: 48px; background: #f1f1f3; color: #1f2328; font-family: Inter, sans-serif; -webkit-font-smoothing: antialiased; }
@media (prefers-color-scheme: dark) { body { background: #101010; color: #e6e6e6; } }
svg { display: block; overflow: visible; }`;

function rootsOf(doc: PenDocument, nodes: readonly PenNode[], ids: readonly string[]): PenNode[] {
	if (ids.length === 0) throw new PenError("Say what to export: an item's id, or a list of them.");
	const all = [...walk(nodes)];
	return ids.map((id) => {
		const found = all.find((node) => node.id === id);
		if (!found) throw new PenError(`There is no item ${id} to export: read the canvas for the ids there are.`);
		return found;
	});
}

function iconOf(doc: PenDocument, node: PenNode, theme: ThemeState): { library: string; name: string; weight: number } | undefined {
	if (node.type !== "icon" && node.type !== "icon_font") return undefined;
	const font = node.type === "icon_font";
	const library = String(resolve(doc, font ? node.iconFontFamily : node.library, theme) ?? "lucide") || "lucide";
	const name = String(resolve(doc, font ? node.iconFontName : node.icon, theme) ?? "");
	if (!name) return undefined;
	return { library, name, weight: num(doc, node.weight, theme, 400) };
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");
const r2 = (n: number) => {
	const v = Math.round(n * 100) / 100;
	return Object.is(v, -0) ? "0" : String(v);
};
const px = (n: number) => `${r2(n)}px`;

/**
 * An angular gradient as CSS's `conic-gradient`. pen turns its start counter-clockwise from up and
 * runs clockwise; the stage takes its angles on the ellipse of the gradient's size, CSS on a circle.
 * Each stop is put at the circle's angle of the ellipse's, so the stops sit where the stage draws
 * them and only the blend between two stops of a stretched gradient differs a little.
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

/** A variable's CSS name: `$--card` and `$card` are both `--card`. */
export function cssName(name: string): string {
	const bare = name.replace(/^\$/, "").replace(/^--/, "");
	return `--${bare.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

type Decl = [string, string];

const DEFAULT_INK = "#1f2328";
const NOTE_PAPER: Record<string, string> = { note: "#fde68a", prompt: "#ddd6fe", context: "#bfdbfe" };
const FONT_CDN = "https://cdn.jsdelivr.net/fontsource/fonts";

type Sizing = { kind: "fixed"; value: number } | { kind: "hug" } | { kind: "fill" };

class Writer {
	private readonly families = new Map<string, Set<string>>();
	private readonly tailwind: boolean;
	private gradients = 0;

	constructor(
		private readonly doc: PenDocument,
		private readonly placed: Map<string, Placed>,
		private readonly theme: ThemeState,
		private readonly options: HtmlOptions,
	) {
		this.tailwind = options.format === "tailwind";
	}

	/** `:root` custom properties for every colour and number variable, the dark theme's where they differ. */
	variables(): string {
		const vars = Object.entries(this.doc.variables ?? {}).filter(([, def]) => def.type === "color" || def.type === "number");
		if (vars.length === 0) return "";
		const dark = baseTheme(this.doc, "dark");
		const line = (state: ThemeState, only?: (name: string, value: string) => boolean) =>
			vars
				.map(([name]) => {
					const value = this.literal(name, state);
					return value === undefined || (only && !only(name, value)) ? "" : `  ${cssName(name)}: ${value};`;
				})
				.filter(Boolean)
				.join("\n");
		const light = line(this.theme);
		const darker = line(dark, (name, value) => value !== this.literal(name, this.theme));
		return [`:root {\n${light}\n}`, ...(darker ? [`@media (prefers-color-scheme: dark) {\n:root {\n${darker}\n}\n}`, `:root[data-theme="dark"] {\n${darker}\n}`] : [])].join("\n");
	}

	/** A variable's value in a theme, as CSS writes it: a colour as it is, a number as a plain number. */
	private literal(name: string, state: ThemeState): string | undefined {
		const value = variable(this.doc, `$${name.replace(/^\$/, "")}`, state);
		if (value === undefined) return undefined;
		return typeof value === "number" ? r2(value) : String(value);
	}

	/** `@font-face` rules for each family and weight the page's words are set in, from the files the stage uses. */
	fontFaces(): string {
		const rules: string[] = [];
		for (const [family, faces] of this.families) {
			const id = family.trim().toLowerCase().replace(/\s+/g, "-");
			for (const face of faces) {
				const [weight, style] = face.split(" ");
				rules.push(`@font-face { font-family: "${family}"; font-weight: ${weight}; font-style: ${style}; font-display: block; src: url("${FONT_CDN}/${id}@latest/latin-${weight}-${style}.woff2") format("woff2"), url("${FONT_CDN}/${id}@latest/latin-${weight}-${style}.ttf") format("truetype"); }`);
			}
		}
		return rules.join("\n");
	}

	private box(node: PenNode): Frame {
		return this.placed.get(node.id)?.box ?? { x: 0, y: 0, w: 0, h: 0 };
	}

	private themeOf(node: PenNode): ThemeState {
		return this.placed.get(node.id)?.theme ?? withTheme(this.theme, node);
	}

	/** A colour as CSS: a variable is its custom property, a literal its own spelling; undefined when it is no colour. */
	private colour(value: unknown, theme: ThemeState, alpha = 1): string | undefined {
		if (isVariable(value)) {
			if (!parseColor(resolve(this.doc, value, theme))) return undefined;
			const name = cssName(value);
			return alpha >= 1 ? `var(${name})` : `color-mix(in srgb, var(${name}) ${r2(alpha * 100)}%, transparent)`;
		}
		const rgba = parseColor(value);
		if (!rgba) return undefined;
		if (alpha >= 1 && typeof value === "string") return value.trim();
		return rgbaText(rgba, alpha);
	}

	/** A number in px: a variable's custom property times 1px. */
	private length(value: unknown, theme: ThemeState, fallback = 0): string {
		if (isVariable(value) && this.doc.variables?.[value.slice(1)]?.type === "number") return `calc(var(${cssName(value)}) * 1px)`;
		return px(num(this.doc, value, theme, fallback));
	}

	/** One item as an element, with what is in it. */
	element(node: PenNode, parent: PenNode | undefined): string {
		const theme = this.themeOf(node);
		if (!bool(this.doc, node.enabled, theme, true)) return "";
		const css: Decl[] = [];
		this.place(node, parent, css);
		this.themeVars(node, parent, css);
		const opacity = num(this.doc, node.opacity, theme, 1);
		if (opacity < 1) css.push(["opacity", r2(Math.max(0, opacity))]);
		// pen's blur radius is two of the Gaussian's sigmas, as the stage draws it; CSS's is one.
		const blur = this.blurRadius(node, theme);
		if (blur > 0) css.push(["filter", `blur(${px(blur / 2)})`]);
		const turn = num(this.doc, node.rotation, theme, 0);
		if (turn) css.push(["transform", `rotate(${r2(-turn)}deg)`], ["transform-origin", "0 0"]);
		const flipX = bool(this.doc, node.flipX, theme, false);
		const flipY = bool(this.doc, node.flipY, theme, false);
		if (flipX || flipY) css.push(["scale", `${flipX ? -1 : 1} ${flipY ? -1 : 1}`]);
		const attrs = `data-pen-id="${escapeAttr(node.id)}"`;
		switch (node.type) {
			case "frame":
			case "group":
				return this.frame(node, theme, css, attrs);
			case "rectangle":
				return this.shape(node, theme, css, attrs);
			case "ellipse": {
				const inner = num(this.doc, node.innerRadius, theme, 0);
				const sweep = num(this.doc, node.sweepAngle, theme, 360);
				if (inner <= 0 && Math.abs(sweep) >= 360) return this.shape(node, theme, css, attrs, true);
				return this.svgShape(node, theme, css, attrs);
			}
			case "polygon":
			case "path":
				return this.svgShape(node, theme, css, attrs);
			case "text":
				return this.text(node, theme, css, attrs);
			case "note":
			case "prompt":
			case "context":
				return this.note(node, theme, css, attrs);
			case "icon":
			case "icon_font":
				return this.icon(node, theme, css, attrs);
			case "browser":
				return this.browser(node, theme, css, attrs);
			default: {
				// What the stage cannot draw either: a dashed box saying what it is.
				css.push(["border", `1.5px dashed ${node.type === MISSING ? "#dc3333" : "#8c8c94"}`], ["border-radius", "6px"], ["color", "#666670"], ["font-size", "13px"], ["padding", "8px"]);
				return `<div ${attrs}${this.attr(css)}>${escapeText(node.type === MISSING ? `missing: ${String(node.why ?? node.id)}` : node.type)}</div>`;
			}
		}
	}

	/** Where an item sits and how big it is: in its parent's flow, or at its place in a parent with no layout. */
	private place(node: PenNode, parent: PenNode | undefined, css: Decl[]): void {
		const box = this.box(node);
		const theme = this.themeOf(node);
		const inFlow = parent !== undefined && parent.type === "frame" && layoutOf(parent) !== "none" && node.layoutPosition !== "absolute";
		const frameHugs = (axis: "width" | "height") => node.type === "frame" && layoutOf(node) !== "none" && this.sizing(node[axis], theme, node).kind === "hug";
		if (!inFlow) {
			if (parent) {
				const at = this.box(parent);
				css.push(["position", "absolute"], ["left", px(box.x - at.x)], ["top", px(box.y - at.y)]);
			} else css.push(["position", "relative"]);
			// Hugging frames size to what they hold; anything else is the size pen gives it.
			for (const axis of ["width", "height"] as const) {
				if (frameHugs(axis)) {
					if (axis === "width") css.push(["width", "max-content"]);
				} else if (!this.textSizes(node, axis)) css.push([axis, px(axis === "width" ? box.w : box.h)]);
			}
			return;
		}
		const row = layoutOf(parent!) === "horizontal";
		const parentTheme = this.themeOf(parent!);
		const parentMain = this.sizing(row ? parent!.width : parent!.height, parentTheme, parent!);
		const parentCross = this.sizing(row ? parent!.height : parent!.width, parentTheme, parent!);
		for (const axis of ["width", "height"] as const) {
			const main = (axis === "width") === row;
			const sizing = this.sizing(node[axis], theme, node, axis);
			const size = axis === "width" ? box.w : box.h;
			if (sizing.kind === "fill" && main && parentMain.kind !== "hug") {
				css.push(["flex", "1 1 0px"], [axis === "width" ? "min-width" : "min-height", "0"]);
			} else if (sizing.kind === "fill" && !main && parentCross.kind !== "hug") {
				css.push(["align-self", "stretch"]);
			} else if (sizing.kind === "hug" && (node.type === "frame" || node.type === "group" || TEXTY.has(node.type))) {
				if (main) css.push(["flex-shrink", "0"]);
			} else {
				// A fixed size, or a fill with nothing to fill: the size pen gives it.
				if (!this.textSizes(node, axis)) css.push([axis, px(size)]);
				if (main) css.push(["flex-shrink", "0"]);
			}
		}
	}

	/** Whether a text's own growth sizes it along an axis, so no size is written. */
	private textSizes(node: PenNode, axis: "width" | "height"): boolean {
		if (node.type === "text") {
			const growth = node.textGrowth ?? "auto";
			return growth === "auto" || (growth === "fixed-width" && axis === "height");
		}
		return TEXTY.has(node.type) && axis === "height" && this.sizing(node.height, this.themeOf(node), node).kind === "hug";
	}

	private sizing(value: SizeValue | undefined, theme: ThemeState, node: PenNode, axis?: "width" | "height"): Sizing {
		if (value === undefined || value === null) {
			// A note is as wide as pen makes it (240) unless told, and as tall as its words.
			if (TEXTY.has(node.type) && node.type !== "text" && axis === "width") return { kind: "fixed", value: 0 };
			return node.type === "frame" || node.type === "group" || TEXTY.has(node.type) ? { kind: "hug" } : { kind: "fixed", value: 0 };
		}
		if (typeof value === "number") return { kind: "fixed", value };
		const text = String(value).trim();
		if (/^fill_container/.test(text)) return { kind: "fill" };
		if (/^(fit_content|hug_content)/.test(text)) return { kind: "hug" };
		return { kind: "fixed", value: num(this.doc, text, theme, 0) };
	}

	/** An item with a theme of its own sets the variables that differ under it. */
	private themeVars(node: PenNode, parent: PenNode | undefined, css: Decl[]): void {
		if (!node.theme || typeof node.theme !== "object") return;
		const mine = this.themeOf(node);
		const theirs = parent ? this.themeOf(parent) : this.theme;
		for (const [name, def] of Object.entries(this.doc.variables ?? {})) {
			if (def.type !== "color" && def.type !== "number") continue;
			const value = this.literal(name, mine);
			if (value !== undefined && value !== this.literal(name, theirs)) css.push([cssName(name), value]);
		}
	}

	/** A frame or a group: its paint, its layout, its children, and its outline over them. */
	private frame(node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
		const mode = node.type === "frame" ? layoutOf(node) : "none";
		if (!css.some(([k]) => k === "position")) css.push(["position", "relative"]);
		if (mode !== "none") {
			const [pt, pr, pb, pl] = paddingOf(this.doc, node, theme);
			css.push(["display", "flex"], ["flex-direction", mode === "horizontal" ? "row" : "column"]);
			if (node.gap !== undefined) css.push(["gap", this.length(node.gap, theme)]);
			if (pt || pr || pb || pl) css.push(["padding", Array.isArray(node.padding) || isVariable(node.padding) ? [pt, pr, pb, pl].map(px).join(" ") : px(pt)]);
			const justify = { start: "flex-start", center: "center", end: "flex-end", space_between: "space-between", space_around: "space-around" }[node.justifyContent ?? "start"] ?? "flex-start";
			const align = { start: "flex-start", center: "center", end: "flex-end" }[node.alignItems ?? "start"] ?? "flex-start";
			css.push(["justify-content", justify], ["align-items", align]);
		}
		if (node.type === "frame") this.paint(node, theme, css);
		if (node.type === "frame" && bool(this.doc, node.clip, theme, false)) css.push(["overflow", "hidden"]);
		const kids = (node.children ?? []).map((child) => this.element(child, node)).filter(Boolean);
		const outline = node.type === "frame" ? this.outline(node, theme) : "";
		return `<div ${attrs}${this.attr(css)}>${kids.length || outline ? "\n" : ""}${kids.join("\n")}${outline ? `\n${outline}` : ""}${kids.length || outline ? "\n" : ""}</div>`;
	}

	/** A rectangle, or a whole ellipse: a box with its paint and its outline. */
	private shape(node: PenNode, theme: ThemeState, css: Decl[], attrs: string, round = false): string {
		if (!css.some(([k]) => k === "position")) css.push(["position", "relative"]);
		this.paint(node, theme, css, round);
		const outline = this.outline(node, theme, round);
		return `<div ${attrs}${this.attr(css)}>${outline}</div>`;
	}

	/** Fills, corners and shadows (outer, and inner ones inset) on a box. */
	private paint(node: PenNode, theme: ThemeState, css: Decl[], round = false): void {
		const box = this.box(node);
		const layers = fillsOf(node.fill)
			.map((fill) => this.layer(fill, theme, box))
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
		const radius = this.radius(node, theme, round);
		if (radius) css.push(["border-radius", radius]);
		const shadows = this.shadows(node, theme);
		if (shadows) css.push(["box-shadow", shadows]);
	}

	private radius(node: PenNode, theme: ThemeState, round: boolean): string | undefined {
		if (round) return "50%";
		const radii = radiiOf(this.doc, node, theme);
		if (radii.every((r) => r <= 0)) return undefined;
		if (!Array.isArray(node.cornerRadius) && isVariable(node.cornerRadius)) return this.length(node.cornerRadius, theme);
		return radii.every((r) => r === radii[0]) ? px(radii[0]!) : radii.map(px).join(" ");
	}

	/** An item's blur: its enabled blur effects' radii, added up. */
	private blurRadius(node: PenNode, theme: ThemeState): number {
		const effects = node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect];
		let radius = 0;
		for (const effect of effects) if (effect?.type === "blur" && bool(this.doc, effect.enabled, theme, true)) radius += Math.max(0, num(this.doc, effect.radius, theme, 0));
		return radius;
	}

	private shadows(node: PenNode, theme: ThemeState): string | undefined {
		const effects = node.effect === undefined ? [] : Array.isArray(node.effect) ? node.effect : [node.effect];
		const out: string[] = [];
		for (const effect of effects) {
			if (!effect || effect.type !== "shadow" || !bool(this.doc, effect.enabled, theme, true)) continue;
			const colour = this.colour(effect.color ?? "#00000040", theme) ?? "#00000040";
			out.push(`${effect.shadowType === "inner" ? "inset " : ""}${px(num(this.doc, effect.offset?.x, theme, 0))} ${px(num(this.doc, effect.offset?.y, theme, 0))} ${px(num(this.doc, effect.blur, theme, 0))} ${px(num(this.doc, effect.spread, theme, 0))} ${colour}`);
		}
		return out.length ? out.join(", ") : undefined;
	}

	/** A fill as a CSS background layer; undefined for one that draws nothing. */
	private layer(fill: Fill, theme: ThemeState, box: Frame): Layer | undefined {
		if (typeof fill === "string") {
			const colour = this.colour(fill, theme);
			return colour ? { colour } : undefined;
		}
		if (!fill || typeof fill !== "object" || !bool(this.doc, fill.enabled, theme, true)) return undefined;
		const alpha = num(this.doc, (fill as { opacity?: unknown }).opacity, theme, 1);
		if (fill.type === "color") {
			const colour = this.colour((fill as { color?: unknown }).color, theme);
			return colour ? { colour } : undefined;
		}
		if (fill.type === "gradient") {
			const g = fill as Extract<Fill, { type: "gradient" }>;
			const stops = (g.colors ?? [])
				.map((stop) => ({ at: num(this.doc, stop.position, theme, 0), colour: this.colour(stop.color, theme, alpha) }))
				.filter((stop): stop is { at: number; colour: string } => !!stop.colour)
				.sort((a, b) => a.at - b.at);
			if (stops.length === 0) return undefined;
			const cx = num(this.doc, g.center?.x, theme, 0.5);
			const cy = num(this.doc, g.center?.y, theme, 0.5);
			const sw = box.w * num(this.doc, g.size?.width, theme, 1);
			const sh = box.h * num(this.doc, g.size?.height, theme, 1);
			if ((g.gradientType ?? "linear") === "linear") {
				// 0° points up and pen turns counter-clockwise; CSS's 0deg is up too and turns clockwise.
				// pen's line is the size's height long through the centre; CSS's runs corner to corner.
				const turn = num(this.doc, g.rotation, theme, 0);
				const rad = (-turn * Math.PI) / 180;
				const span = Math.abs(box.w * Math.sin(rad)) + Math.abs(box.h * Math.cos(rad)) || 1;
				// Off centre, the line moves along itself by the centre's offset in its direction.
				const shift = (cx - 0.5) * box.w * Math.sin(rad) - (cy - 0.5) * box.h * Math.cos(rad);
				const at = (p: number) => `${r2(((span / 2 + shift + (p - 0.5) * sh) / span) * 100)}%`;
				return { image: `linear-gradient(${r2(((-turn % 360) + 360) % 360)}deg, ${stops.map((s) => `${s.colour} ${at(s.at)}`).join(", ")})` };
			}
			if (g.gradientType === "angular") return { image: conic(stops, cx, cy, sw, sh, num(this.doc, g.rotation, theme, 0)) };
			return { image: `radial-gradient(${px(Math.max(1, sw / 2))} ${px(Math.max(1, sh / 2))} at ${r2(cx * 100)}% ${r2(cy * 100)}%, ${stops.map((s) => `${s.colour} ${r2(s.at * 100)}%`).join(", ")})` };
		}
		if (fill.type === "image") {
			const url = typeof (fill as { url?: unknown }).url === "string" ? ((fill as { url: string }).url) : undefined;
			if (!url) return undefined;
			const address = this.options.url ? this.options.url(url) : url;
			const mode = (fill as { mode?: string }).mode;
			return { image: `url("${address.replace(/"/g, "%22")}")`, size: mode === "stretch" ? "100% 100%" : mode === "fit" ? "contain" : "cover" };
		}
		return undefined;
	}

	/** An item's stroke, drawn over what is in it on the side pen strokes, with its corners. */
	private outline(node: PenNode, theme: ThemeState, round = false): string {
		const stroke = strokeOf(this.doc, node, theme);
		if (!stroke) return "";
		const box = this.box(node);
		const colour = stroke.fills.map((fill) => (typeof fill === "string" ? this.colour(fill, theme) : fill?.type === "color" ? this.colour((fill as { color?: unknown }).color, theme) : undefined)).find(Boolean);
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
			["border-width", uniform && !(isVariable(node.strokeWidth) && this.doc.variables?.[String(node.strokeWidth).slice(1)]?.type === "number") ? px(t) : uniform ? this.length(node.strokeWidth, theme, 1) : [t, r, b, l].map(px).join(" ")],
		];
		if (round) css.push(["border-radius", "50%"]);
		else {
			const radii = radiiOf(this.doc, node, theme);
			const most = Math.min(box.w, box.h) / 2;
			const corners = radii.map((one) => px(Math.max(0, Math.min(one, most)) + out(t)));
			if (radii.some((one) => one > 0)) css.push(["border-radius", corners.every((one) => one === corners[0]) ? corners[0]! : corners.join(" ")]);
		}
		return `<div aria-hidden="true"${this.attr(css)}></div>`;
	}

	/** A path, a polygon, or an arc or ring: inline SVG of the outline the stage draws. */
	private svgShape(node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
		const box = this.box(node);
		const d = outlineOf(this.doc, node, box.w, box.h, theme);
		if (!d) return `<div ${attrs}${this.attr(css)}></div>`;
		const even = node.fillRule === "evenodd" || (node.type === "ellipse" && num(this.doc, node.innerRadius, theme, 0) > 0);
		const defs: string[] = [];
		const fill = this.svgPaint(fillsOf(node.fill), theme, box, defs);
		const stroke = strokeOf(this.doc, node, theme);
		const line = stroke ? this.svgPaint(stroke.fills, theme, box, defs) : undefined;
		const dash = node.strokeDash === "dashed" ? ` stroke-dasharray="${r2(stroke!.widths[0] * 4)} ${r2(stroke!.widths[0] * 3)}"` : node.strokeDash === "dotted" ? ` stroke-dasharray="0.01 ${r2(stroke!.widths[0] * 2.5)}" stroke-linecap="round"` : "";
		const strokeAttrs = line && stroke ? ` stroke="${escapeAttr(line)}" stroke-width="${r2(stroke.widths[0])}" stroke-linecap="${stroke.cap}" stroke-linejoin="${stroke.join}"${dash}` : "";
		const svg = `<svg ${attrs} xmlns="http://www.w3.org/2000/svg" width="${r2(box.w)}" height="${r2(box.h)}" viewBox="0 0 ${r2(box.w)} ${r2(box.h)}"${this.attr(css)}>${defs.length ? `<defs>${defs.join("")}</defs>` : ""}<path d="${escapeAttr(d)}" fill="${escapeAttr(fill ?? "none")}"${even ? ' fill-rule="evenodd"' : ""}${strokeAttrs}/></svg>`;
		return svg;
	}

	/** A fill as an SVG paint: a colour, or a gradient defined in `defs`. */
	private svgPaint(fills: Fill[], theme: ThemeState, box: Frame, defs: string[]): string | undefined {
		for (const fill of fills) {
			if (typeof fill === "string" || fill?.type === "color") {
				const colour = this.colour(typeof fill === "string" ? fill : (fill as { color?: unknown }).color, theme);
				if (colour) return colour;
				continue;
			}
			if (fill?.type !== "gradient" || !bool(this.doc, fill.enabled, theme, true)) continue;
			const g = fill as Extract<Fill, { type: "gradient" }>;
			const alpha = num(this.doc, g.opacity, theme, 1);
			const stops = (g.colors ?? []).map((stop) => ({ at: num(this.doc, stop.position, theme, 0), colour: this.colour(stop.color, theme, alpha) })).filter((stop) => stop.colour);
			if (!stops.length) continue;
			const id = `g${++this.gradients}`;
			const cx = box.w * num(this.doc, g.center?.x, theme, 0.5);
			const cy = box.h * num(this.doc, g.center?.y, theme, 0.5);
			const sw = box.w * num(this.doc, g.size?.width, theme, 1);
			const sh = box.h * num(this.doc, g.size?.height, theme, 1);
			const list = stops.map((s) => `<stop offset="${r2(s.at)}" stop-color="${escapeAttr(s.colour!)}"/>`).join("");
			if ((g.gradientType ?? "linear") === "linear") {
				const rad = (num(this.doc, g.rotation, theme, 0) * Math.PI) / 180;
				const [dx, dy] = [-Math.sin(rad), -Math.cos(rad)];
				defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r2(cx - (dx * sh) / 2)}" y1="${r2(cy - (dy * sh) / 2)}" x2="${r2(cx + (dx * sh) / 2)}" y2="${r2(cy + (dy * sh) / 2)}">${list}</linearGradient>`);
			} else defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(Math.max(1, sw / 2))}" gradientTransform="translate(${r2(cx)} ${r2(cy)}) scale(1 ${r2(sh / Math.max(1, sw))}) translate(${r2(-cx)} ${r2(-cy)})">${list}</radialGradient>`);
			return `url(#${id})`;
		}
		return undefined;
	}

	/** The words' font, as CSS sets it, and the face asked for, so the page loads it. */
	private font(node: PenNode, theme: ThemeState, css: Decl[]): void {
		const style = textStyleOf(this.doc, node, theme);
		const italic = style.fontStyle.toLowerCase() === "italic";
		const faces = this.families.get(style.fontFamily) ?? new Set<string>();
		faces.add(`${style.fontWeight} ${italic ? "italic" : "normal"}`);
		this.families.set(style.fontFamily, faces);
		const family = style.fontFamily.replace(/["\\]/g, "");
		css.push(["font-family", `${/^[A-Za-z][\w-]*$/.test(family) ? family : `"${family}"`}, Inter, sans-serif`]);
		css.push(["font-size", isVariable(node.fontSize) ? this.length(node.fontSize, theme, 14) : px(style.fontSize)]);
		css.push(["font-weight", String(style.fontWeight)]);
		if (italic) css.push(["font-style", "italic"]);
		css.push(["line-height", style.lineHeight === undefined ? "normal" : r2(style.lineHeight)]);
		if (style.letterSpacing) css.push(["letter-spacing", isVariable(node.letterSpacing) ? this.length(node.letterSpacing, theme) : px(style.letterSpacing)]);
	}

	private ink(node: PenNode, theme: ThemeState): string {
		for (const fill of fillsOf(node.fill)) {
			const colour = typeof fill === "string" ? this.colour(fill, theme) : fill?.type === "color" ? this.colour((fill as { color?: unknown }).color, theme) : undefined;
			if (colour) return colour;
		}
		return DEFAULT_INK;
	}

	private text(node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
		const content = String(resolve(this.doc, node.content, theme) ?? "");
		this.font(node, theme, css);
		css.push(["color", this.ink(node, theme)]);
		const growth = node.textGrowth ?? "auto";
		css.push(["white-space", growth === "auto" ? "pre" : "pre-wrap"]);
		if (growth !== "auto") css.push(["overflow-wrap", "break-word"]);
		const align = node.textAlign ?? "left";
		if (align !== "left") css.push(["text-align", align]);
		const lines = [bool(this.doc, node.underline, theme, false) ? "underline" : "", bool(this.doc, node.strikethrough, theme, false) ? "line-through" : ""].filter(Boolean);
		if (lines.length) css.push(["text-decoration", lines.join(" ")]);
		const words = escapeText(content);
		const href = typeof node.href === "string" && node.href ? node.href : undefined;
		const inner = href ? `<a href="${escapeAttr(href)}" style="color: inherit">${words}</a>` : words;
		if (growth === "fixed-width-height" && node.textAlignVertical && node.textAlignVertical !== "top") {
			css.push(["display", "flex"], ["flex-direction", "column"], ["justify-content", node.textAlignVertical === "middle" ? "center" : "flex-end"]);
			return `<div ${attrs}${this.attr(css)}><span>${inner}</span></div>`;
		}
		return `<div ${attrs}${this.attr(css)}>${inner}</div>`;
	}

	/** A note, prompt or context: its paper and its words, as the stage draws one. */
	private note(node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
		const content = String(resolve(this.doc, node.content, theme) ?? "");
		const paper = isMarkdown(node) ? "#ffffff" : (NOTE_PAPER[node.type] ?? "#fde68a");
		css.push(["background-color", paper], ["border-radius", "12px"], ["padding", px(NOTE_PAD)], ["box-shadow", "0 1px 2px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.1)"]);
		this.font(node, theme, css);
		css.push(["color", "#1f2328"], ["white-space", "pre-wrap"], ["overflow-wrap", "break-word"]);
		return `<div ${attrs}${this.attr(css)}>${escapeText(content)}</div>`;
	}

	private icon(node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
		const box = this.box(node);
		const asked = iconOf(this.doc, node, theme);
		const shape = asked ? this.options.icons?.(asked.library, asked.name, asked.weight) : undefined;
		if (!shape) return `<div ${attrs}${this.attr(css)}></div>`;
		const ink = this.ink(node, theme);
		const parts = shape.parts
			.map((part) => {
				const fill = part.fill ? ink : "none";
				const stroke = part.stroke ? ` stroke="${escapeAttr(ink)}" stroke-width="${r2(part.strokeWidth)}" stroke-linecap="${part.cap}" stroke-linejoin="${part.join}"` : "";
				return `<path d="${escapeAttr(part.d)}" fill="${escapeAttr(fill)}"${part.evenOdd ? ' fill-rule="evenodd"' : ""}${stroke}/>`;
			})
			.join("");
		return `<svg ${attrs} xmlns="http://www.w3.org/2000/svg" width="${r2(box.w)}" height="${r2(box.h)}" viewBox="${shape.viewBox.map(r2).join(" ")}"${this.attr(css)}>${parts}</svg>`;
	}

	/** A board: its page in a frame, as the canvas shows it; a grey box with its name when there is no address. */
	private browser(node: PenNode, theme: ThemeState, css: Decl[], attrs: string): string {
		const address = this.options.board?.(node);
		const radius = this.radius(node, theme, false) ?? "12px";
		css.push(["border", "0"], ["border-radius", radius], ["background-color", "#ffffff"], ["box-shadow", "0 0 0 1px rgba(0, 0, 0, 0.1)"]);
		if (node.metadata?.type === MEDIA) return `<div ${attrs}${this.attr(css)}></div>`;
		if (address) return `<iframe ${attrs} src="${escapeAttr(address)}" title="${escapeAttr(node.name ?? node.id)}" loading="lazy"${this.attr(css)}></iframe>`;
		return `<div ${attrs}${this.attr(css)}>${escapeText(node.name ?? node.id)}</div>`;
	}

	/** Declarations as the page writes them: a `style` attribute, or Tailwind classes. */
	private attr(css: Decl[]): string {
		if (css.length === 0) return "";
		if (!this.tailwind) return ` style="${escapeAttr(css.map(([k, v]) => `${k}: ${v}`).join("; "))}"`;
		return ` class="${escapeAttr(css.map(([k, v]) => tailwindClass(k, v)).join(" "))}"`;
	}
}

interface Layer {
	colour?: string;
	image?: string;
	size?: string;
}

const TEXTY = new Set(["text", "note", "prompt", "context"]);

const layoutOf = (node: PenNode): "none" | "vertical" | "horizontal" => (node.layout === "vertical" || node.layout === "horizontal" || node.layout === "none" ? node.layout : node.type === "frame" ? "horizontal" : "none");

function rgbaText([r, g, b, a]: Rgba, alpha = 1): string {
	const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
	return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${r2(a * alpha)})`;
}

/** Spaces in an arbitrary value are underscores to Tailwind; an underscore of its own is escaped. */
const arbitrary = (value: string) => value.replace(/_/g, "\\_").replace(/\s*,\s*/g, ",").replace(/\s+/g, "_");
const simple = (value: string) => !/[\s(),"']/.test(value);

/** One declaration as a Tailwind class: its own utility where Tailwind has one, an arbitrary property otherwise. */
export function tailwindClass(property: string, value: string): string {
	const named: Record<string, Record<string, string>> = {
		display: { flex: "flex", block: "block" },
		"flex-direction": { row: "flex-row", column: "flex-col" },
		position: { relative: "relative", absolute: "absolute" },
		"justify-content": { "flex-start": "justify-start", center: "justify-center", "flex-end": "justify-end", "space-between": "justify-between", "space-around": "justify-around" },
		"align-items": { "flex-start": "items-start", center: "items-center", "flex-end": "items-end" },
		"align-self": { stretch: "self-stretch" },
		"flex-shrink": { "0": "shrink-0" },
		overflow: { hidden: "overflow-hidden" },
		"white-space": { pre: "whitespace-pre", "pre-wrap": "whitespace-pre-wrap" },
		"text-align": { center: "text-center", right: "text-right", justify: "text-justify", left: "text-left" },
		"font-style": { italic: "italic" },
		"pointer-events": { none: "pointer-events-none" },
		"border-style": { solid: "border-solid", dashed: "border-dashed", dotted: "border-dotted" },
		"min-width": { "0": "min-w-0" },
		"min-height": { "0": "min-h-0" },
	};
	const word = named[property]?.[value];
	if (word) return word;
	const prefixed: Record<string, string> = { width: "w", height: "h", gap: "gap", left: "left", top: "top", right: "right", bottom: "bottom", padding: "p", opacity: "opacity", "background-color": "bg", "border-radius": "rounded", "font-size": "text", "border-color": "border", "letter-spacing": "tracking", "line-height": "leading" };
	const prefix = prefixed[property];
	if (prefix && simple(value) && !property.startsWith("--")) {
		// A colour or a length can read as either to Tailwind: say which.
		const hint = property === "background-color" || property === "border-color" ? "color:" : property === "font-size" ? "length:" : "";
		return `${prefix}-[${hint}${arbitrary(value)}]`;
	}
	return `[${property}:${arbitrary(value)}]`;
}
