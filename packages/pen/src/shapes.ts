import { walk } from "./doc.ts";
import type { PenDocument, PenNode } from "./types.ts";

/**
 * Shapes beyond a rectangle and an ellipse: a diamond, a cylinder, a speech bubble, from a library.
 *
 * pen has no such types, so a shape is made of pen's own items, which pen.dev draws as they are:
 *
 *     { "type": "frame", "id": "check", "width": 160, "height": 120,
 *       "layout": "vertical", "justifyContent": "center", "alignItems": "center", "padding": 10,
 *       "metadata": { "type": "decks.shape", "kind": "Decision" },
 *       "children": [
 *         { "type": "path", "id": "check-o", "layoutPosition": "absolute", "x": 0, "y": 0,
 *           "width": 160, "height": 120, "viewBox": [0, 0, 100, 100],
 *           "geometry": "M50 0L100 50L50 100L0 50Z", "fill": "#fde68a", "stroke": "#1f2328" },
 *         { "type": "text", "id": "check-t", "content": "Signed in?", "width": "fill_container", … }
 *       ] }
 *
 * The frame is the shape: it is what is selected, moved and sized. Its first `path` child is the
 * outline, drawn in a 100 by 100 box and stretched to the frame's (pen draws a path with a viewBox
 * that way), and carries the fill and the line. A `text` child, when there is one, is the words in
 * the shape, centred by the frame's layout. `kind` names the shape in `SHAPES`, so it can be swapped
 * for another; pen.dev, knowing nothing of it, shows the outline as the path it is.
 *
 * `fitShapes` keeps the outline the frame's size, and runs after every edit (`apply`), so a shape
 * sized by a drag, a field or an agent's box is redrawn whole.
 */
export const SHAPE = "decks.shape";

export type ShapeGroup = "Basic" | "Flowchart" | "Arrows and callouts";

export interface ShapeKind {
	name: string;
	group: ShapeGroup;
	/** In a 100 by 100 box. */
	geometry: string;
	/** Drawn as a line alone, with no fill: a brace. */
	line?: boolean;
	fillRule?: "evenodd";
	/**
	 * Corners the person can round, given as a radius in the 100 by 100 box for a new shape. Such a
	 * shape is not drawn by stretching its geometry: `fitShapes` rebuilds it in the frame's own
	 * pixels, so a corner stays a circle however wide the shape is pulled (`roundedGeometry`).
	 */
	rounded?: number;
}

export const SHAPES: readonly ShapeKind[] = [
	{ group: "Basic", name: "Rectangle", geometry: "M0 0H100V100H0Z" },
	{ group: "Basic", name: "Rounded", geometry: "M14 0H86Q100 0 100 14V86Q100 100 86 100H14Q0 100 0 86V14Q0 0 14 0Z", rounded: 14 },
	{ group: "Basic", name: "Ellipse", geometry: "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z" },
	{ group: "Basic", name: "Triangle", geometry: "M50 0L100 100H0Z" },
	{ group: "Basic", name: "Diamond", geometry: "M50 0L100 50L50 100L0 50Z" },
	{ group: "Basic", name: "Pentagon", geometry: "M50 0L100 38L81 100H19L0 38Z" },
	{ group: "Basic", name: "Hexagon", geometry: "M25 0H75L100 50L75 100H25L0 50Z" },
	{ group: "Basic", name: "Octagon", geometry: "M30 0H70L100 30V70L70 100H30L0 70V30Z" },
	{ group: "Basic", name: "Star", geometry: "M50 0L61 35H98L68 57L79 91L50 70L21 91L32 57L2 35H39Z" },
	{ group: "Basic", name: "Parallelogram", geometry: "M22 0H100L78 100H0Z" },
	{ group: "Basic", name: "Trapezoid", geometry: "M20 0H80L100 100H0Z" },
	{ group: "Basic", name: "Plus", geometry: "M35 0H65V35H100V65H65V100H35V65H0V35H35Z" },
	{ group: "Basic", name: "Ring", geometry: "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0ZM50 28A22 22 0 1 0 50 72A22 22 0 1 0 50 28Z", fillRule: "evenodd" },
	{ group: "Basic", name: "Heart", geometry: "M50 96C20 74 0 56 0 30C0 12 13 0 28 0C38 0 46 6 50 14C54 6 62 0 72 0C87 0 100 12 100 30C100 56 80 74 50 96Z" },
	{ group: "Flowchart", name: "Process", geometry: "M0 0H100V100H0Z" },
	{ group: "Flowchart", name: "Decision", geometry: "M50 0L100 50L50 100L0 50Z" },
	{ group: "Flowchart", name: "Terminator", geometry: "M22 0H78A22 50 0 0 1 78 100H22A22 50 0 0 1 22 0Z" },
	{ group: "Flowchart", name: "Document", geometry: "M0 0H100V82C75 66 25 100 0 82Z" },
	{ group: "Flowchart", name: "Data", geometry: "M22 0H100L78 100H0Z" },
	/*
	 * The cylinder. Both subpaths wind the same way, clockwise: the silhouette's arc runs left to
	 * right over the top, and the cap's front arc runs right to left under it. Written the other way
	 * round, the cap wound against the silhouette and a nonzero fill cancelled the two, which is
	 * what left the top of the cylinder see-through.
	 */
	{ group: "Flowchart", name: "Database", geometry: "M0 14A50 14 0 0 1 100 14V86A50 14 0 0 1 0 86ZM100 14A50 14 0 0 1 0 14" },
	{ group: "Flowchart", name: "Manual input", geometry: "M0 28L100 0V100H0Z" },
	{ group: "Flowchart", name: "Predefined", geometry: "M0 0H100V100H0ZM12 0V100M88 0V100" },
	{ group: "Flowchart", name: "Delay", geometry: "M0 0H58A42 50 0 0 1 58 100H0Z" },
	{ group: "Flowchart", name: "Off-page", geometry: "M0 0H100V68L50 100L0 68Z" },
	{ group: "Flowchart", name: "Preparation", geometry: "M22 0H78L100 50L78 100H22L0 50Z" },
	{ group: "Flowchart", name: "Card", geometry: "M24 0H100V100H0V24Z" },
	{ group: "Arrows and callouts", name: "Arrow right", geometry: "M0 30H60V6L100 50L60 94V70H0Z" },
	{ group: "Arrows and callouts", name: "Arrow both", geometry: "M0 50L26 14V34H74V14L100 50L74 86V66H26V86Z" },
	{ group: "Arrows and callouts", name: "Chevron", geometry: "M0 0H74L100 50L74 100H0L26 50Z" },
	{ group: "Arrows and callouts", name: "Speech", geometry: "M8 0H92Q100 0 100 8V64Q100 72 92 72H42L20 98L26 72H8Q0 72 0 64V8Q0 0 8 0Z" },
	{ group: "Arrows and callouts", name: "Cloud", geometry: "M26 88C6 88 0 66 12 56C4 36 24 22 38 30C46 8 76 8 82 30C100 28 106 56 90 66C98 84 78 94 64 88Z" },
	{ group: "Arrows and callouts", name: "Brace", geometry: "M34 0Q18 0 18 16V40Q18 50 2 50Q18 50 18 60V84Q18 100 34 100", line: true },
];

export const SHAPE_GROUPS: readonly ShapeGroup[] = ["Basic", "Flowchart", "Arrows and callouts"];

export function shapeKind(name: unknown): ShapeKind | undefined {
	return typeof name === "string" ? SHAPES.find((one) => one.name.toLowerCase() === name.toLowerCase()) : undefined;
}

/** Whether an item is a shape from the library: the frame that holds its outline and its words. */
export function isShape(node: PenNode | undefined): boolean {
	return !!node && node.type === "frame" && node.metadata?.type === SHAPE;
}

/** A shape's outline: its first path, which carries the fill and the line. */
export function shapeOutline(node: PenNode): PenNode | undefined {
	return node.children?.find((child) => child.type === "path");
}

/** A shape's words, when it has any. */
export function shapeLabel(node: PenNode): PenNode | undefined {
	return node.children?.find((child) => child.type === "text");
}

/** The most a corner can be rounded in a box: any more and the straight sides are gone. */
export function maxRadius(w: number, h: number): number {
	return Math.max(0, Math.min(w, h) / 2);
}

/**
 * How round a shape's corners are, in pixels, or `undefined` for a shape that has no such corners.
 * It is the frame's own `metadata.radius` when it has one, and otherwise the kind's own radius
 * scaled to this frame, which is what a shape dropped before this existed falls back to.
 */
export function shapeRadius(node: PenNode): number | undefined {
	const kind = isShape(node) ? shapeKind(node.metadata?.kind) : undefined;
	if (!kind?.rounded) return undefined;
	const w = typeof node.width === "number" ? node.width : 0;
	const h = typeof node.height === "number" ? node.height : 0;
	const saved = node.metadata?.radius;
	const want = typeof saved === "number" && Number.isFinite(saved) ? saved : (kind.rounded / 100) * Math.min(w, h);
	return Math.max(0, Math.min(want, maxRadius(w, h)));
}

/** A rounded rectangle of a size, in its own pixels, so every corner is a circle of radius `r`. */
export function roundedGeometry(w: number, h: number, r: number): string {
	const k = Math.max(0, Math.min(r, maxRadius(w, h)));
	const n = (value: number) => Math.round(value * 100) / 100;
	if (k <= 0) return `M0 0H${n(w)}V${n(h)}H0Z`;
	return [
		`M${n(k)} 0H${n(w - k)}`,
		`A${n(k)} ${n(k)} 0 0 1 ${n(w)} ${n(k)}`,
		`V${n(h - k)}`,
		`A${n(k)} ${n(k)} 0 0 1 ${n(w - k)} ${n(h)}`,
		`H${n(k)}`,
		`A${n(k)} ${n(k)} 0 0 1 0 ${n(h - k)}`,
		`V${n(k)}`,
		`A${n(k)} ${n(k)} 0 0 1 ${n(k)} 0`,
		"Z",
	].join("");
}

/**
 * A new shape of a kind, at a size, ready to insert. `ids` are the frame's and the outline's, fresh
 * in the document. White with a dark line, except a line-only shape, which has no fill.
 */
export function makeShape(kind: ShapeKind, ids: { frame: string; outline: string }, size: { w: number; h: number }): PenNode {
	const w = Math.max(8, Math.round(size.w));
	const h = Math.max(8, Math.round(size.h));
	// A shape with corners to round starts at the kind's own radius, in this shape's pixels.
	const radius = kind.rounded ? Math.round(Math.min((kind.rounded / 100) * Math.min(w, h), maxRadius(w, h))) : undefined;
	return {
		type: "frame",
		id: ids.frame,
		name: kind.name,
		width: w,
		height: h,
		layout: "vertical",
		justifyContent: "center",
		alignItems: "center",
		padding: 10,
		clip: false,
		metadata: { type: SHAPE, kind: kind.name, ...(radius === undefined ? {} : { radius }) },
		children: [
			{
				type: "path",
				id: ids.outline,
				layoutPosition: "absolute",
				x: 0,
				y: 0,
				width: w,
				height: h,
				viewBox: radius === undefined ? [0, 0, 100, 100] : [0, 0, w, h],
				geometry: radius === undefined ? kind.geometry : roundedGeometry(w, h, radius),
				...(kind.fillRule ? { fillRule: kind.fillRule } : {}),
				...(kind.line ? {} : { fill: "#ffffff" }),
				stroke: "#1f2328",
				strokeWidth: 1.5,
				strokeAlignment: "center",
				strokeLinejoin: "round",
			},
		],
	};
}

/** The words a new label starts with: centred, as wide as the shape allows, wrapping inside it. */
export function makeLabel(id: string, content = ""): PenNode {
	return { type: "text", id, content, fontSize: 14, fontWeight: 500, textAlign: "center", textGrowth: "fixed-width", width: "fill_container", fill: "#1f2328" };
}

/**
 * Every shape's outline set to its frame's size, at its corner. Returns whether anything changed.
 * A frame whose size is not a number (one hugging its words) is left alone.
 *
 * A shape with corners the person can round is also redrawn here, in the frame's own pixels rather
 * than stretched from a 100 by 100 box: stretched, a wide rounded rectangle had wide flat corners
 * instead of round ones.
 */
export function fitShapes(doc: PenDocument): boolean {
	let changed = false;
	for (const node of walk(doc.children)) {
		if (!isShape(node)) continue;
		const outline = shapeOutline(node);
		if (!outline || typeof node.width !== "number" || typeof node.height !== "number") continue;
		const want = { x: 0, y: 0, width: node.width, height: node.height };
		const fitted = outline.x === want.x && outline.y === want.y && outline.width === want.width && outline.height === want.height && outline.layoutPosition === "absolute";
		if (!fitted) {
			Object.assign(outline, want, { layoutPosition: "absolute" });
			changed = true;
		}
		const radius = shapeRadius(node);
		if (radius === undefined) continue;
		const geometry = roundedGeometry(node.width, node.height, radius);
		const viewBox: [number, number, number, number] = [0, 0, node.width, node.height];
		if (outline.geometry === geometry && Array.isArray(outline.viewBox) && outline.viewBox.every((v, i) => v === viewBox[i])) continue;
		Object.assign(outline, { geometry, viewBox });
		changed = true;
	}
	return changed;
}
