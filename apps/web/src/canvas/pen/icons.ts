/**
 * pen's `icon` items: an icon from a named library, drawn as vectors.
 *
 * The libraries pen.dev names — lucide, feather, Material Symbols (outlined, rounded, sharp) and
 * phosphor — all publish one SVG file per icon on npm, so each icon is fetched from the CDN the
 * first time a drawing uses it, its shapes turned into path strings, and kept. Older files write an
 * icon as `icon_font` with `iconFontFamily` and `iconFontName`; that is read the same way.
 *
 * `weight` (100–700) chooses the Material Symbols weight and the phosphor style, and thickens
 * lucide's and feather's strokes; the icon is drawn in the item's first colour fill.
 */

export interface IconPart {
	d: string;
	fill: boolean;
	stroke: boolean;
	strokeWidth: number;
	cap: "butt" | "round" | "square";
	join: "miter" | "round" | "bevel";
	evenOdd: boolean;
}

export interface IconShape {
	viewBox: [number, number, number, number];
	parts: IconPart[];
}

const CDN = "https://cdn.jsdelivr.net/npm";

/** Where an icon's SVG is, or undefined for a library this build does not know. */
export function iconUrl(library: string, name: string, weight: number): string | undefined {
	const lib = library.trim().toLowerCase();
	const icon = encodeURIComponent(name.trim());
	if (!icon) return undefined;
	if (lib === "lucide") return `${CDN}/lucide-static@latest/icons/${icon}.svg`;
	if (lib === "feather") return `${CDN}/feather-icons@latest/dist/icons/${icon}.svg`;
	if (lib.startsWith("material symbols")) {
		const style = lib.includes("rounded") ? "rounded" : lib.includes("sharp") ? "sharp" : "outlined";
		const w = Math.min(700, Math.max(100, Math.round(weight / 100) * 100));
		return `${CDN}/@material-symbols/svg-${w}@latest/${style}/${icon}.svg`;
	}
	if (lib === "phosphor") {
		const style = weight <= 200 ? "thin" : weight <= 300 ? "light" : weight >= 600 ? "bold" : "regular";
		return `${CDN}/@phosphor-icons/core@latest/assets/${style}/${icon}${style === "regular" ? "" : `-${style}`}.svg`;
	}
	return undefined;
}

/** Turn an SVG's drawable elements into path parts, with the fill and stroke each inherits. */
export function parseIcon(svgText: string, weight: number): IconShape | undefined {
	const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
	const root = doc.documentElement;
	if (!root || root.nodeName.toLowerCase() !== "svg") return undefined;
	const box = (root.getAttribute("viewBox") ?? "0 0 24 24").trim().split(/[\s,]+/).map(Number);
	const viewBox: [number, number, number, number] = [box[0] ?? 0, box[1] ?? 0, box[2] || 24, box[3] || 24];
	const parts: IconPart[] = [];
	// lucide and feather draw at stroke 2 for weight 400; heavier weights thicken it.
	const strokeScale = Math.max(0.5, weight / 400);
	const walk = (el: Element, inherited: { fill: string; stroke: string; width: number; cap: string; join: string; rule: string }) => {
		const read = (name: string, fallback: string) => el.getAttribute(name) ?? fallback;
		const style = { fill: read("fill", inherited.fill), stroke: read("stroke", inherited.stroke), width: Number(read("stroke-width", String(inherited.width))), cap: read("stroke-linecap", inherited.cap), join: read("stroke-linejoin", inherited.join), rule: read("fill-rule", inherited.rule) };
		const d = toPath(el);
		if (d) {
			parts.push({
				d,
				fill: style.fill !== "none",
				stroke: style.stroke !== "none",
				strokeWidth: style.width * strokeScale,
				cap: style.cap === "round" || style.cap === "square" ? style.cap : "butt",
				join: style.join === "round" || style.join === "bevel" ? style.join : "miter",
				evenOdd: style.rule === "evenodd",
			});
		}
		for (const child of Array.from(el.children)) walk(child, style);
	};
	walk(root, { fill: "black", stroke: "none", width: 1, cap: "butt", join: "miter", rule: "nonzero" });
	return parts.length ? { viewBox, parts } : undefined;
}

const num = (el: Element, name: string) => Number(el.getAttribute(name) ?? 0);

/** An SVG shape element as a path string; undefined for anything that draws nothing. */
function toPath(el: Element): string | undefined {
	switch (el.nodeName.toLowerCase()) {
		case "path":
			return el.getAttribute("d") ?? undefined;
		case "line":
			return `M${num(el, "x1")} ${num(el, "y1")}L${num(el, "x2")} ${num(el, "y2")}`;
		case "polyline":
		case "polygon": {
			const points = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
			if (points.length < 4) return undefined;
			let d = `M${points[0]} ${points[1]}`;
			for (let i = 2; i + 1 < points.length; i += 2) d += `L${points[i]} ${points[i + 1]}`;
			return el.nodeName.toLowerCase() === "polygon" ? `${d}Z` : d;
		}
		case "circle": {
			const [cx, cy, r] = [num(el, "cx"), num(el, "cy"), num(el, "r")];
			return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
		}
		case "ellipse": {
			const [cx, cy, rx, ry] = [num(el, "cx"), num(el, "cy"), num(el, "rx"), num(el, "ry")];
			return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
		}
		case "rect": {
			const [x, y, w, h] = [num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height")];
			const r = Math.min(Number(el.getAttribute("rx") ?? el.getAttribute("ry") ?? 0), w / 2, h / 2);
			if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
			return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
		}
		default:
			return undefined;
	}
}

/** Icons fetched once each; `changed` is called when one lands, so the drawing is redone. */
export class PenIcons {
	private readonly known = new Map<string, IconShape | "loading" | "failed">();

	constructor(private readonly changed: () => void) {}

	get(library: string, name: string, weight: number): IconShape | undefined {
		const url = iconUrl(library, name, weight);
		if (!url) return undefined;
		const known = this.known.get(url);
		if (known && known !== "loading" && known !== "failed") return known;
		if (known) return undefined;
		this.known.set(url, "loading");
		void fetch(url)
			.then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
			.then((text) => {
				this.known.set(url, parseIcon(text, weight) ?? "failed");
				this.changed();
			})
			.catch(() => this.known.set(url, "failed"));
		return undefined;
	}
}
