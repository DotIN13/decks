import assert from "node:assert/strict";
import { test } from "node:test";
import type { PenNode } from "@decks/pen";
import { PAGE_MIN, pageResizeEnd, pageResizeStep, givenFor, handleEdges, hugAgainOp, hugsWords, keepsWords, radiusAt, radiusOp, radiusStart, resizeOp, resizePreview, resizeStep, shownPageResize, sizeFloor, sizeNarrowest, CARD_MIN_W } from "./resize.ts";

const node = (fields: Record<string, unknown>) => ({ id: "n", type: "frame", ...fields }) as unknown as PenNode;
const card = (fields: Record<string, unknown> = {}) => node({ metadata: { type: "decks.card" }, ...fields });
const none = { targets: [], threshold: 6 };
const box = { x: 0, y: 0, w: 100, h: 50 };

test("a handle drags its own edges", () => {
	assert.deepEqual(handleEdges("nw"), ["x1", "y1"]);
	assert.deepEqual(handleEdges("se"), ["x2", "y2"]);
	assert.deepEqual(handleEdges("e"), ["x2"]);
	assert.deepEqual(handleEdges("n"), ["y1"]);
});

test("an edge drag moves that edge; past the other one the box flips", () => {
	assert.deepEqual(resizeStep(box, "e", { x: 50, y: 30 }, {}, none).box, { x: 0, y: 0, w: 150, h: 50 });
	assert.deepEqual(resizeStep(box, "s", { x: 50, y: 30 }, {}, none).box, { x: 0, y: 0, w: 100, h: 80 });
	assert.deepEqual(resizeStep(box, "w", { x: 150, y: 0 }, {}, none).box, { x: 100, y: 0, w: 50, h: 50 });
	// Rounded to whole pixels.
	assert.deepEqual(resizeStep(box, "se", { x: 10.4, y: 10.6 }, {}, none).box, { x: 0, y: 0, w: 110, h: 61 });
});

test("the dragged edge snaps within the threshold, and draws a guide; ⌘ turns it off", () => {
	const near = { targets: [{ x: 200, y: 300, w: 10, h: 10 }], threshold: 6 };
	const snapped = resizeStep(box, "e", { x: 97, y: 0 }, {}, near);
	assert.deepEqual(snapped.box, { x: 0, y: 0, w: 200, h: 50 });
	// With a ✕ at each point on the line that lines up: the box's right edge, top, middle and bottom, and the target's.
	assert.deepEqual(snapped.guides, [
		{ kind: "line", x1: 200, y1: 0, x2: 200, y2: 310, points: [{ x: 200, y: 0 }, { x: 200, y: 25 }, { x: 200, y: 50 }, { x: 200, y: 300 }, { x: 200, y: 305 }, { x: 200, y: 310 }] },
	]);
	const free = resizeStep(box, "e", { x: 97, y: 0 }, { free: true }, near);
	assert.deepEqual(free.box, { x: 0, y: 0, w: 197, h: 50 });
	assert.deepEqual(free.guides, []);
	// Only the dragged edges snap: the left one stays at 0 though a line is 3 away.
	assert.equal(resizeStep({ x: 197, y: 0, w: 10, h: 10 }, "e", { x: 50, y: 0 }, {}, near).box.x, 197);
});

test("Shift on a corner keeps the shape first and snaps after, so a snapped edge stays on its guide", () => {
	const near = { targets: [{ x: 300, y: 110, w: 10, h: 10 }], threshold: 6 };
	// The shape first (scale 2.14: 214 × 107), then the bottom snaps 107 → 110 and the right edge follows to 220.
	const kept = resizeStep(box, "se", { x: 20, y: 57 }, { shift: true }, near);
	assert.deepEqual(kept.box, { x: 0, y: 0, w: 220, h: 110 });
	assert.equal(kept.guides.length, 1);
	assert.equal(kept.guides[0]!.y1, 110);
	/*
	 * Snapping first used to lose this one: the bottom snapped 63 → 60, then the wider scale (1.6) took
	 * it to 80, off the line its guide was drawn on. Now the shape comes first (160 × 80), the bottom snaps
	 * 80 → 78, the right edge follows to 156, and the guide is where the edge is.
	 */
	const stays = resizeStep(box, "se", { x: 60, y: 13 }, { shift: true }, { targets: [{ x: 300, y: 60, w: 10, h: 18 }], threshold: 6 });
	assert.deepEqual(stays.box, { x: 0, y: 0, w: 156, h: 78 });
	assert.deepEqual(stays.guides.map((guide) => guide.y1), [78]);
	assert.equal(stays.box.y + stays.box.h, stays.guides[0]!.y1);
	// The right edge snaps 197 → 200 (scale 2); the bottom follows to 100.
	assert.deepEqual(resizeStep(box, "se", { x: 97, y: 10 }, { shift: true }, { targets: [{ x: 200, y: 300, w: 10, h: 10 }], threshold: 6 }).box, { x: 0, y: 0, w: 200, h: 100 });
	// The opposite corner stays put.
	assert.deepEqual(resizeStep({ x: 100, y: 100, w: 100, h: 50 }, "nw", { x: -10, y: -30 }, { shift: true }, none).box, { x: 40, y: 70, w: 160, h: 80 });
	// Not on an edge handle.
	assert.deepEqual(resizeStep(box, "e", { x: 100, y: 0 }, { shift: true }, none).box, { x: 0, y: 0, w: 200, h: 50 });
});

test("never under 4 wide, nor under the floor tall: a card's floor is its padding twice", () => {
	assert.deepEqual(resizeStep(box, "se", { x: -98, y: -48 }, {}, none).box, { x: 0, y: 0, w: 4, h: 4 });
	assert.deepEqual(resizeStep(box, "se", { x: -98, y: -48 }, {}, { ...none, floor: 32 }).box, { x: 0, y: 0, w: 4, h: 32 });
	assert.equal(sizeFloor(card()), 32);
	assert.equal(sizeFloor(node({ metadata: { type: "decks.markdown" } })), 32);
	assert.equal(sizeFloor(node({ type: "rectangle" })), 4);
	assert.equal(sizeFloor(undefined), 4);
});

test("a card as tall as its words keeps that on a side drag, and writes its width alone", () => {
	assert.equal(hugsWords(card()), true);
	assert.equal(hugsWords(card({ height: "fit_content(48)" })), true);
	assert.equal(hugsWords(card({ height: 200 })), false);
	assert.equal(hugsWords(node({})), false);
	assert.equal(keepsWords(card(), "e"), true);
	assert.equal(keepsWords(card(), "w"), true);
	assert.equal(keepsWords(card(), "s"), false);
	assert.equal(keepsWords(card(), "ne"), false);
	assert.deepEqual(resizePreview({ x: 0, y: 0, w: 100, h: 50 }, { x: 5, y: 0, w: 140, h: 50 }, true), { dx: 5, dy: 0, w: 140 });
	assert.deepEqual(resizePreview({ x: 0, y: 0, w: 100, h: 50 }, { x: 5, y: 0, w: 140, h: 60 }, false), { dx: 5, dy: 0, w: 140, h: 60 });
	assert.deepEqual(resizeOp("c", { x: 1.04, y: 2.06, w: 100.333, h: 50 }, true), { op: "update", id: "c", box: { x1: 1, y1: 2.1, x2: 101.4 } });
	assert.deepEqual(resizeOp("c", { x: 1.04, y: 2.06, w: 100.333, h: 50 }, false), { op: "update", id: "c", box: { x1: 1, y1: 2.1, x2: 101.4, y2: 52.1 } });
});

test("the given box is scaled about the same point as the drawn one", () => {
	assert.deepEqual(givenFor({ x: 10, y: 10, w: 100, h: 100 }, { x: 0, y: 0, w: 120, h: 120 }, { x: 10, y: 10, w: 200, h: 50 }), { x: -10, y: 5, w: 240, h: 60 });
	// Same box: the drawn box itself.
	assert.deepEqual(givenFor(box, box, { x: 3, y: 4, w: 50, h: 20 }), { x: 3, y: 4, w: 50, h: 20 });
});

test("two presses on a frame's top or bottom handle hug again, with the floor it had", () => {
	assert.deepEqual(hugAgainOp("f", node({ height: "fit_content(80)" }), "s"), { op: "update", id: "f", set: { height: "fit_content(80)" } });
	assert.deepEqual(hugAgainOp("f", node({ height: 300 }), "n"), { op: "update", id: "f", set: { height: "fit_content(120)" } });
	assert.deepEqual(hugAgainOp("c", card({ height: 300 }), "s"), { op: "update", id: "c", set: { height: "fit_content(48)" } });
	assert.equal(hugAgainOp("f", node({ height: 300 }), "e"), undefined);
	assert.equal(hugAgainOp("f", node({ height: 300 }), "se"), undefined);
	assert.equal(hugAgainOp("r", node({ type: "rectangle", height: 300 }), "s"), undefined);
	assert.equal(hugAgainOp("sh", node({ metadata: { type: "decks.shape", kind: "Rounded" } }), "s"), undefined);
	assert.equal(hugAgainOp("f", undefined, "s"), undefined);
});

test("a board stops at 320 × 200 at the edge being dragged; the other stays put", () => {
	assert.deepEqual(PAGE_MIN, { w: 320, h: 200 });
	const start = { x: 0, y: 0, w: 800, h: 600 };
	assert.deepEqual(pageResizeStep(start, "w", { x: 700, y: 0 }, {}, none).box, { x: 480, y: 0, w: 320, h: 600 });
	assert.deepEqual(pageResizeStep(start, "n", { x: 0, y: 500 }, {}, none).box, { x: 0, y: 400, w: 800, h: 200 });
	assert.deepEqual(pageResizeStep(start, "se", { x: -900, y: -900 }, {}, none).box, { x: 0, y: 0, w: 320, h: 200 });
	assert.deepEqual(pageResizeStep(start, "se", { x: 400, y: 0 }, { shift: true }, none).box, { x: 0, y: 0, w: 1200, h: 900 });
	const snapped = pageResizeStep(start, "e", { x: 97, y: 0 }, {}, { targets: [{ x: 900, y: 700, w: 100, h: 100 }], threshold: 6 });
	assert.deepEqual(snapped.box, { x: 0, y: 0, w: 900, h: 600 });
	assert.equal(snapped.guides.length, 1);
});

test("a board's lift moves it only when its corner moved, and sizes it only when its size changed", () => {
	const start = { x: 0, y: 0, w: 800, h: 600 };
	assert.deepEqual(pageResizeEnd(start, start), {});
	assert.deepEqual(pageResizeEnd(start, { x: 0, y: 0, w: 900, h: 600 }), { size: { w: 900, h: 600 } });
	assert.deepEqual(pageResizeEnd(start, { x: -100, y: 0, w: 900, h: 600 }), { move: { x: -100, y: 0 }, size: { w: 900, h: 600 } });
});

test("the radius follows the nearer reach along the diagonal, from 0 to half the shorter side", () => {
	const start = { x: 0, y: 0, most: 25.5 };
	assert.equal(radiusAt(start, { x: 10, y: 30 }), 10);
	assert.equal(radiusAt(start, { x: 10.6, y: 30 }), 11);
	assert.equal(radiusAt(start, { x: 100, y: 100 }), 25);
	assert.equal(radiusAt(start, { x: -5, y: 10 }), 0);
});

test("which items have a radius handle, and what it starts at", () => {
	const at = { x: 0, y: 0, w: 100, h: 40 };
	assert.deepEqual(radiusStart(node({ type: "rectangle", cornerRadius: 8 }), at), { ...at, radius: 8, most: 20, shape: false });
	assert.equal(radiusStart(node({ type: "rectangle", cornerRadius: 50 }), at)?.radius, 20);
	assert.equal(radiusStart(node({ cornerRadius: [6, 1, 1, 1] }), at)?.radius, 6);
	assert.equal(radiusStart(node({}), at)?.radius, 0);
	assert.equal(radiusStart(node({ type: "rectangle" }), { x: 0, y: 0, w: 3, h: 3 }), undefined);
	assert.equal(radiusStart(node({ type: "text" }), at), undefined);
	assert.deepEqual(radiusStart(node({ width: 100, height: 50, metadata: { type: "decks.shape", kind: "Rounded", radius: 9 } }), at), { ...at, radius: 9, most: 20, shape: true });
	assert.equal(radiusStart(node({ metadata: { type: "decks.shape", kind: "Ellipse" } }), at), undefined);
	// It keeps whatever else the box carries (the item's id).
	assert.equal(radiusStart(node({ type: "rectangle" }), { ...at, id: "r" })?.id, "r");
});

test("a radius is written as pen's cornerRadius, or a library shape's metadata.radius", () => {
	assert.deepEqual(radiusOp("r", 12, false, undefined), { op: "update", id: "r", set: { cornerRadius: 12 } });
	assert.deepEqual(radiusOp("r", 0, false, undefined), { op: "update", id: "r", set: { cornerRadius: null } });
	assert.deepEqual(radiusOp("s", 9, true, node({ metadata: { type: "decks.shape", kind: "Rounded" } })), { op: "update", id: "s", set: { metadata: { type: "decks.shape", kind: "Rounded", radius: 9 } } });
});

test("a document's resize shows it no shorter than its content, while the drag's own height is what is written", () => {
	assert.deepEqual(shownPageResize({ x: 0, y: 100, w: 760, h: 300 }, 642), { x: 0, y: 100, w: 760, h: 642 });
	assert.deepEqual(shownPageResize({ x: 0, y: 0, w: 760, h: 900 }, 642), { x: 0, y: 0, w: 760, h: 900 });
	assert.deepEqual(shownPageResize({ x: 0, y: 0, w: 760, h: 300 }, undefined), { x: 0, y: 0, w: 760, h: 300 });
});

test("a card is never narrower than 48, its least height, and the edge not dragged stays put", () => {
	assert.equal(CARD_MIN_W, 48);
	assert.equal(sizeNarrowest(card()), 48);
	assert.equal(sizeNarrowest(undefined), 4);
	// Dragged by its left edge to 10 wide: 48, the right edge still at 100.
	assert.deepEqual(resizeStep(box, "w", { x: 90, y: 0 }, {}, { ...none, narrowest: 48 }).box, { x: 52, y: 0, w: 48, h: 50 });
	// By its right edge, past its left: it does not flip.
	assert.deepEqual(resizeStep(box, "e", { x: -150, y: 0 }, {}, { ...none, narrowest: 48 }).box, { x: 0, y: 0, w: 48, h: 50 });
	// Anything else still flips.
	assert.deepEqual(resizeStep(box, "e", { x: -150, y: 0 }, {}, none).box, { x: -50, y: 0, w: 50, h: 50 });
});

test("Shift on a board with no size to keep does not divide by it", () => {
	const flat = { x: 0, y: 0, w: 0, h: 0 };
	const step = pageResizeStep(flat, "se", { x: 500, y: 300 }, { shift: true }, none);
	assert.deepEqual(step.box, { x: 0, y: 0, w: 500, h: 300 });
	assert.ok(Object.values(step.box).every(Number.isFinite));
});
