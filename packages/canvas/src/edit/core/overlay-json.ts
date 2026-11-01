import { ARROW_SIDES, sidePoint } from "@decks/pen";
import { HANDLES } from "./resize.ts";
import { anchorAt, draftBox, draftCurve, handleAt, pageHandleList, radiusInset, radiusShown, type Overlay } from "./overlay.ts";

/**
 * The overlay as the engine paints it (`stage_paint::overlay`): every outline, handle, guide, slot
 * and draft of `Overlay` as boxes, lines, paths and dots in canvas units, with the sizes the screen
 * needs in pixels (a handle is as big at 5% as at 400%). Written whenever the overlay or the zoom
 * changes, and handed to the engine as one JSON string (`StageEngine.setOverlay`); the DOM keeps
 * only the hit areas (`dom/OverlayLayer.tsx`, invisible under `[data-engine-overlays]`).
 */
export type OverlayStyle = {
	/** The main pointer is a finger: round corner handles, bigger arrow ends, no edge handles or anchors. */
	coarse: boolean;
	/** Colours as red, green, blue from 0 to 1. */
	accent: [number, number, number];
	guide: [number, number, number];
	panel: [number, number, number];
	handlePx: number;
	anchorPx: number;
	anchorOut: number;
};

type Box = { x: number; y: number; w: number; h: number; r?: number; kind: string };
type Line = { x1: number; y1: number; x2: number; y2: number; kind: string };
type Path = { x: number; y: number; d: string; kind: string };
type Dot = { x: number; y: number; px: number; kind: string };

const ROUND = 12;
const SQUARE = 4;

export function overlayJson(o: Overlay, zoom: number, style: OverlayStyle): string {
	const boxes: Box[] = [];
	const lines: Line[] = [];
	const paths: Path[] = [];
	const dots: Dot[] = [];
	const z = Math.max(zoom, 1e-6);
	const many = !!o.selectionFrame?.many;
	for (const k of o.kin) boxes.push({ x: k.x, y: k.y, w: k.w, h: k.h, r: k.round ? ROUND : SQUARE, kind: k.kin === "child" ? "kin-child" : "kin" });
	for (const b of o.outlines) boxes.push({ x: b.x, y: b.y, w: b.w, h: b.h, r: b.round || b.role === "page" ? ROUND : SQUARE, kind: many && b.role !== "marquee" ? "selection-thin" : "selection" });
	if (o.selectionFrame?.many) boxes.push({ x: o.selectionFrame.x, y: o.selectionFrame.y, w: o.selectionFrame.w, h: o.selectionFrame.h, r: SQUARE, kind: "selection-box" });
	if (o.hover) boxes.push({ x: o.hover.x, y: o.hover.y, w: o.hover.w, h: o.hover.h, r: o.hover.board || o.hover.round ? ROUND : SQUARE, kind: "hover" });
	for (const j of o.joins) boxes.push({ x: j.x, y: j.y, w: j.w, h: j.h, r: SQUARE, kind: "join" });
	if (o.drop) boxes.push({ x: o.drop.x, y: o.drop.y, w: o.drop.w, h: o.drop.h, r: SQUARE, kind: "join" });
	for (const f of o.slotFrames) boxes.push({ x: f.x, y: f.y, w: f.w, h: f.h, r: SQUARE, kind: "slot-frame" });
	for (const l of o.slots) lines.push({ x1: l.x, y1: l.y, x2: l.x + l.w, y2: l.y + l.h, kind: "slot" });
	if (o.insert) lines.push({ x1: o.insert.x, y1: o.insert.y, x2: o.insert.x + o.insert.w, y2: o.insert.y + o.insert.h, kind: "insert" });
	for (const hint of o.sides) {
		for (const side of ARROW_SIDES) {
			const [x, y] = sidePoint(hint.box, side);
			dots.push({ x, y, px: hint.side === side ? 12 : 8, kind: hint.side === side ? "side-on" : "side" });
		}
	}
	if (o.anchors && !style.coarse) {
		for (const side of ARROW_SIDES) {
			const at = anchorAt(o.anchors, side, style.anchorOut / z);
			dots.push({ x: at.x, y: at.y, px: style.anchorPx, kind: "anchor" });
		}
	}
	for (const g of o.guides) {
		lines.push({ x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, kind: "guide" });
		if (g.kind === "gap") {
			const tick = 4 / z;
			const across = g.y1 === g.y2;
			for (const [x, y] of [[g.x1, g.y1], [g.x2, g.y2]] as const) {
				lines.push(across ? { x1: x, y1: y - tick, x2: x, y2: y + tick, kind: "guide" } : { x1: x - tick, y1: y, x2: x + tick, y2: y, kind: "guide" });
			}
		}
		for (const p of g.points ?? []) {
			const arm = 2.5 / z;
			lines.push({ x1: p.x - arm, y1: p.y - arm, x2: p.x + arm, y2: p.y + arm, kind: "guide" }, { x1: p.x + arm, y1: p.y - arm, x2: p.x - arm, y2: p.y + arm, kind: "guide" });
		}
	}
	if (o.distances) {
		for (const b of [o.distances.from, o.distances.to]) boxes.push({ x: b.x, y: b.y, w: b.w, h: b.h, r: 0, kind: "measure" });
		for (const l of o.distances.lines) lines.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, kind: l.dashed ? "measure-dashed" : "measure" });
	}
	if (o.arrow) {
		const px = style.coarse ? 18 : 11;
		dots.push({ x: o.arrow.from.x, y: o.arrow.from.y, px, kind: o.arrow.fromJoin ? "diamond" : "end" });
		dots.push({ x: o.arrow.to.x, y: o.arrow.to.y, px, kind: o.arrow.toJoin ? "diamond" : "end" });
		if (o.arrow.middle) dots.push({ x: o.arrow.middle.x, y: o.arrow.middle.y, px: style.coarse ? 18 : 12, kind: o.arrow.bent ? "bend-bent" : "bend" });
	}
	if (o.route) paths.push({ x: o.route.x, y: o.route.y, d: o.route.d, kind: "route" });
	if (o.endDraft) lines.push({ x1: o.endDraft.x1, y1: o.endDraft.y1, x2: o.endDraft.x2, y2: o.endDraft.y2, kind: "draft" });
	const handleDots = (box: { x: number; y: number; w: number; h: number }) => {
		const size = style.handlePx / z;
		for (const handle of HANDLES) {
			// A finger gets the four corners only (`canvas.css`, `pointer: coarse`): the edges still answer, unseen.
			if (style.coarse && handle.length === 1) continue;
			const at = handleAt(box, handle, size);
			dots.push({ x: at.x + size / 2, y: at.y + size / 2, px: style.handlePx, kind: style.coarse ? "handle-round" : "handle" });
		}
	};
	if (o.handles) handleDots(o.handles);
	if (o.pageHandles) {
		const size = style.handlePx / z;
		for (const handle of pageHandleList()) {
			if (style.coarse && handle.length === 1) continue;
			const at = handleAt(o.pageHandles, handle, size);
			dots.push({ x: at.x + size / 2, y: at.y + size / 2, px: style.handlePx, kind: style.coarse ? "handle-round" : "handle" });
		}
	}
	if (o.radius) {
		const size = style.handlePx / z;
		const inset = radiusInset(radiusShown(o.radius, o.radiusDrag), size, o.radius.most);
		dots.push({ x: o.radius.x + inset, y: o.radius.y + inset, px: style.handlePx, kind: "radius" });
	}
	if (o.draft) {
		if (o.draft.tool === "arrow") paths.push({ x: 0, y: 0, d: draftCurve(o.draft), kind: "route" });
		else {
			const b = draftBox(o.draft);
			boxes.push({ x: b.x, y: b.y, w: b.w, h: b.h, r: 0, kind: o.draft.tool === "ellipse" ? "draft-ellipse" : "draft" });
		}
	}
	if (!boxes.length && !lines.length && !paths.length && !dots.length) return "";
	return JSON.stringify({ accent: style.accent, guide: style.guide, panel: style.panel, boxes, lines, paths, dots });
}
