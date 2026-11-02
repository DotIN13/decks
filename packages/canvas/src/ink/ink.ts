import { strokeShape, type InkColor, type InkStroke } from "@decks/board-kit";
import type { PenDocument, PenNode, Placed } from "@decks/pen";

/**
 * Ink on the stage: a stroke drawn with the pen or the marker, kept in the stage's `.pen` file.
 *
 * pen has no ink type, so a stroke is pen's own `path`, which pen.dev draws as it is: `geometry`
 * is the stroke's shape — a filled outline when the pen's pressure changed its width, a round-capped
 * line when it did not — in a `viewBox` the size of the stroke. What was actually drawn rides in
 * pen's extension field, so the eraser and the lasso can work from it and an agent can read it:
 *
 *     { "type": "path", "metadata": { "type": "decks.ink", "tool": "pen", "color": "red",
 *       "size": 4, "points": [x, y, pressure, …] } }
 *
 * The points are in the path's own box, from its top-left corner, so moving the path moves the
 * stroke with it. The `ink` colour follows the stage's light or dark look through a pen variable.
 */

export const INK = "decks.ink";
/** The pen variable the `ink` colour is written as: dark on a light stage, light on a dark one. */
export const INK_VARIABLE = "decks-ink";

const PAINT: Record<InkColor, string> = {
	ink: `$${INK_VARIABLE}`,
	red: "#e5484d",
	blue: "#3b82f6",
	green: "#2f9e62",
	yellow: "#f2b200",
};

export function isInk(node: PenNode): boolean {
	return node.type === "path" && node.metadata?.type === INK;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A stroke drawn on the stage, as the pen item that keeps it. `points` are in stage pixels. */
export function inkItem(stroke: Omit<InkStroke, "id">, id: string): PenNode {
	const pad = stroke.size;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i + 2 < stroke.points.length; i += 3) {
		minX = Math.min(minX, stroke.points[i]!);
		minY = Math.min(minY, stroke.points[i + 1]!);
		maxX = Math.max(maxX, stroke.points[i]!);
		maxY = Math.max(maxY, stroke.points[i + 1]!);
	}
	const x = Math.floor(minX - pad);
	const y = Math.floor(minY - pad);
	const width = Math.ceil(maxX + pad) - x;
	const height = Math.ceil(maxY + pad) - y;
	// Positions to a tenth of a pixel and pressure to a hundredth: a pen reports float32 noise past that.
	const local = stroke.points.map((n, i) => (i % 3 === 0 ? round1(n - x) : i % 3 === 1 ? round1(n - y) : Math.round(n * 100) / 100));
	const shape = strokeShape({ id, ...stroke, points: local });
	const paint = PAINT[stroke.color];
	return {
		type: "path",
		id,
		name: stroke.tool === "marker" ? "Marker" : "Ink",
		x,
		y,
		width,
		height,
		viewBox: [0, 0, width, height],
		geometry: shape.d,
		...(shape.filled ? { fill: paint } : { stroke: paint, strokeWidth: stroke.size, strokeLinecap: "round", strokeLinejoin: "round" }),
		...(stroke.tool === "marker" ? { opacity: 0.4 } : {}),
		metadata: { type: INK, tool: stroke.tool, color: stroke.color, size: stroke.size, points: local },
	};
}

/** The stroke an ink item holds, in stage pixels: where it is drawn now, moved or scaled. */
export function strokeOf(placed: Placed): InkStroke | undefined {
	const { node, box } = placed;
	if (!isInk(node)) return undefined;
	const meta = node.metadata as { tool?: unknown; color?: unknown; size?: unknown; points?: unknown };
	if (!Array.isArray(meta.points)) return undefined;
	const vb = node.viewBox ?? [0, 0, box.w || 1, box.h || 1];
	const sx = vb[2] > 0 ? box.w / vb[2] : 1;
	const sy = vb[3] > 0 ? box.h / vb[3] : 1;
	const points = (meta.points as number[]).map((n, i) => (i % 3 === 0 ? box.x + (n - vb[0]) * sx : i % 3 === 1 ? box.y + (n - vb[1]) * sy : n));
	return {
		id: node.id,
		tool: meta.tool === "marker" ? "marker" : "pen",
		color: (typeof meta.color === "string" && meta.color in PAINT ? meta.color : "ink") as InkColor,
		size: typeof meta.size === "number" ? meta.size : 4,
		points,
	};
}

/**
 * The edit that defines the `ink` colour, when the document does not have it yet.
 *
 * Themed by light and dark when the document has no themes of its own, which is the usual stage;
 * a document with its own theme axes gets one colour rather than a new axis beside them.
 */
export function inkVariableEdit(doc: PenDocument | undefined): unknown | undefined {
	if (doc?.variables?.[INK_VARIABLE]) return undefined;
	const light = "#1f2328";
	const dark = "#e6e6e6";
	if (!doc?.themes) {
		return {
			op: "variables",
			themes: { Mode: ["Light", "Dark"] },
			set: { [INK_VARIABLE]: { type: "color", value: [{ value: light, theme: { Mode: "Light" } }, { value: dark, theme: { Mode: "Dark" } }] } },
		};
	}
	const axis = Object.entries(doc.themes).find(([, values]) => values.some((v) => v.toLowerCase() === "light") && values.some((v) => v.toLowerCase() === "dark"));
	if (axis) {
		const [name, values] = axis;
		const named = (mode: string) => values.find((v) => v.toLowerCase() === mode)!;
		return { op: "variables", set: { [INK_VARIABLE]: { type: "color", value: [{ value: light, theme: { [name]: named("light") } }, { value: dark, theme: { [name]: named("dark") } }] } } };
	}
	return { op: "variables", set: { [INK_VARIABLE]: { type: "color", value: light } } };
}
