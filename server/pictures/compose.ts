import { baseTheme, parse, placements, toHtml, type PenDocument, type PenNode } from "@decks/pen";
import type * as S from "./shapes.ts";
import { layout, Refused } from "../../protocol/index.ts";
import { marks, type Writer } from "./marks.ts";

// The page a screenshot is taken of (rules 7 and 8): the items asked for, in a
// frame with no layout at their canvas places, and each card as its page.

export type Of = string | string[] | { x1?: number; y1?: number; x2?: number; y2?: number } | undefined;
export type Composed = { html: string; box: S.Box; w: number; h: number; factor: number };

const LONG = 1600;
const SHOT = "decks-shot";

const boxOfNode = (b: { x: number; y: number; w: number; h: number }): S.Box => ({ x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h });
const touches = (a: S.Box, b: S.Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** How much a picture of w by h is shrunk or grown: long side 1600 at most, times scale. */
export function factorFor(w: number, h: number, scale = 1): number {
	return Math.min(1, LONG / Math.max(w, h, 1)) * scale;
}

/** Every id inside a node made new, so the copy and the original never share one. */
function renamed(node: PenNode): PenNode {
	const copy: PenNode = { ...node, ...(node.id ? { id: `${SHOT}-${node.id}` } : {}) };
	if (Array.isArray(node.children)) copy.children = (node.children as PenNode[]).map(renamed);
	return copy;
}

/** The top-level items to show and the box round them. */
function chosen(doc: PenDocument, boxes: Map<string, S.Box>, of: Of): { nodes: PenNode[]; box: S.Box; clip: boolean } {
	const tops = doc.children.filter((node) => node.id && boxes.has(node.id));
	let nodes: PenNode[];
	let box: S.Box | undefined;
	if (of === undefined) nodes = tops;
	else if (typeof of === "string" || Array.isArray(of)) {
		const ids = typeof of === "string" ? [of] : of;
		nodes = ids.map((id) => {
			const found = tops.find((node) => node.id === id);
			if (!found) throw new Refused("not_found", `There is no item ${id} at the top of the canvas.`, "item.list");
			return found;
		});
	} else {
		const all = round(tops.map((n) => boxes.get(n.id!)!));
		box = { x1: of.x1 ?? all.x1, y1: of.y1 ?? all.y1, x2: of.x2 ?? all.x2, y2: of.y2 ?? all.y2 };
		nodes = tops.filter((node) => touches(boxes.get(node.id!)!, box!));
	}
	if (nodes.length === 0 && !box) throw new Refused("invalid", "The canvas has nothing on it to picture.", "item.insert");
	return { nodes, box: box ?? framed(round(nodes.map((n) => boxes.get(n.id!)!))), clip: box !== undefined };
}

/** Items are framed with 24 px of paper round them, out to whole units; a box is taken as given. */
export const MARGIN = 24;
const framed = (b: S.Box): S.Box => ({ x1: Math.floor(b.x1 - MARGIN), y1: Math.floor(b.y1 - MARGIN), x2: Math.ceil(b.x2 + MARGIN), y2: Math.ceil(b.y2 + MARGIN) });

function round(boxes: S.Box[]): S.Box {
	if (!boxes.length) return { x1: 0, y1: 0, x2: 1, y2: 1 };
	return { x1: Math.min(...boxes.map((b) => b.x1)), y1: Math.min(...boxes.map((b) => b.y1)), x2: Math.max(...boxes.map((b) => b.x2)), y2: Math.max(...boxes.map((b) => b.y2)) };
}

/** The composed page of a drawing's file, cards addressed by cardUrl. */
export function compose(text: string, canvas: string, of: Of, options: { scale?: number; scheme?: "light" | "dark"; writer?: Writer; cardUrl: (path: string) => string | undefined }): Composed {
	const doc = parse(text);
	const scheme = options.scheme ?? "light";
	const placed = placements(doc, { theme: baseTheme(doc, scheme) });
	const boxes = new Map<string, S.Box>();
	for (const node of doc.children) if (node.id && placed.get(node.id)) boxes.set(node.id, boxOfNode(placed.get(node.id)!.box));
	const { nodes, box, clip } = chosen(doc, boxes, of);
	const w = Math.max(1, Math.round(box.x2 - box.x1));
	const h = Math.max(1, Math.round(box.y2 - box.y1));
	const children = nodes.map((node) => {
		const b = boxes.get(node.id!)!;
		return { ...renamed(node), x: b.x1 - box.x1, y: b.y1 - box.y1 };
	});
	const ground = scheme === "dark" ? "#1c1c1e" : "#f6f6f4";
	const wrapper: PenNode = { type: "frame", id: SHOT, x: box.x1, y: box.y1, width: w, height: h, layout: "none", clip, fill: ground, children };
	const html = toHtml({ ...doc, children: [...doc.children, wrapper] }, [SHOT], {
		format: "html",
		theme: baseTheme(doc, scheme),
		board: (node) => {
			const written = (node.metadata as { path?: unknown } | undefined)?.path;
			if (typeof written !== "string") return undefined;
			const got = layout.resolveReference(canvas, written);
			return "path" in got ? options.cardUrl(got.path) : undefined;
		},
	}).replace("</head>", `<style>body { padding: 0 !important; gap: 0 !important; background: ${ground} !important; }\n${marks(children, options.writer)}</style>\n</head>`);
	return { html, box, w, h, factor: factorFor(w, h, options.scale) };
}
