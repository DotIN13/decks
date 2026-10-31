import assert from "node:assert/strict";
import { test } from "node:test";
import { ARROW } from "@decks/pen";
import { arrowHandles, arrowLine, arrowOp, bendAt, bendStart, pageAt, droppedEnd, endOf, joinAt, nearSide, newArrowEnds, onSide, pointEnd, resetBendOp, resetEndOp, routeDraft, sideNear, slideAt, slideJoin } from "./arrows.ts";
import { fakeScene, type FakeItem } from "./fake-scene.ts";

const board = { path: "boards/x.html", x: 0, y: 200, w: 400, h: 300 };
const box = { x: 0, y: 0, w: 100, h: 50 };
/** Two boxes side by side, a board under them, and an arrow `ar` with the given metadata. */
const scene = (meta: Record<string, unknown> = { from: "a", to: "b" }) => {
	const items: FakeItem[] = [
		{ id: "a", box },
		{ id: "b", box: { x: 300, y: 0, w: 100, h: 50 } },
		{ id: "ar", type: "path", box: { x: 0, y: 0, w: 400, h: 50 }, line: true, extra: { strokeWidth: 2, metadata: { type: ARROW, ...meta } } },
	];
	return fakeScene(items, [board]);
};

test("an end near a side's middle keeps to that side; the reach is 14 screen px, or a quarter of a small box", () => {
	assert.equal(sideNear(box, { x: 99, y: 26 }, 1), "right");
	assert.equal(sideNear(box, { x: 50, y: 12 }, 1), "top");
	// A quarter of this box is 12.5, under 14.
	assert.equal(sideNear(box, { x: 50, y: 13 }, 1), undefined);
	assert.equal(sideNear(box, { x: 50, y: 25 }, 1), undefined);
	// At zoom 2 the reach is 7 stage px.
	assert.equal(sideNear(box, { x: 50, y: 10 }, 1), "top");
	assert.equal(sideNear(box, { x: 50, y: 10 }, 2), undefined);
	// A 20 px box: a quarter is 5, but never under 6.
	const small = { x: 0, y: 0, w: 20, h: 20 };
	assert.equal(sideNear(small, { x: 10, y: 6 }, 1), "top");
	assert.equal(sideNear(small, { x: 10, y: 7 }, 1), undefined);
});

test("a point on a box's edge is on the nearest side, top first on a tie", () => {
	assert.equal(onSide(box, { x: 100, y: 25 }), "right");
	assert.equal(onSide(box, { x: 50, y: 50 }), "bottom");
	assert.equal(onSide(box, { x: 0, y: 0 }), "top");
});

test("an end joins the item picked there, else the board, never an arrow or the arrow itself", () => {
	const s = scene();
	assert.deepEqual(joinAt(s, { x: 99, y: 26 }, { zoom: 1 }), { name: "a", box, side: "right" });
	assert.deepEqual(joinAt(s, { x: 40, y: 30 }, { zoom: 1 }), { name: "a", box });
	// The arrow's own line is looked through, to the board under it and then nothing.
	assert.deepEqual(joinAt(s, { x: 200, y: 25 }, { zoom: 1 }), undefined);
	assert.deepEqual(joinAt(s, { x: 50, y: 300 }, { zoom: 1 }), { name: "boards/x.html", box: { x: 0, y: 200, w: 400, h: 300 } });
	assert.deepEqual(joinAt(s, { x: 200, y: 200 }, { zoom: 1 }), { name: "boards/x.html", box: { x: 0, y: 200, w: 400, h: 300 }, side: "top" });
	assert.equal(pageAt(s, { x: 50, y: 1000 }), undefined);
});

test("a join is written as an item, or an item and its side; a point to a tenth", () => {
	assert.equal(endOf({ name: "a" }), "a");
	assert.deepEqual(endOf({ name: "a", side: "top" }), { item: "a", side: "top" });
	assert.deepEqual(pointEnd({ x: 10.04, y: 3.06 }), [10, 3.1]);
});

test("a selected arrow's handles: its ends, their sides, its middle, moved by the drag", () => {
	assert.deepEqual(arrowHandles(scene(), "ar"), {
		id: "ar",
		route: "straight",
		from: { x: 100, y: 25 },
		to: { x: 300, y: 25 },
		fromJoin: { item: "a", box, side: "right", at: undefined },
		toJoin: { item: "b", box: { x: 300, y: 0, w: 100, h: 50 }, side: "left", at: undefined },
		middle: { x: 200, y: 25 },
		bent: false,
	});
	const moved = arrowHandles(scene(), "ar", { dx: 10, dy: -5 })!;
	assert.deepEqual([moved.from, moved.to, moved.middle], [{ x: 110, y: 20 }, { x: 310, y: 20 }, { x: 210, y: 20 }]);
	// An elbow with no middle segment has no middle handle; sides named stay, `at` is read.
	assert.equal(arrowHandles(scene({ from: "a", to: "b", route: "elbow" }), "ar")!.middle, undefined);
	const sided = arrowHandles(scene({ from: { item: "a", side: "bottom", at: 0.25 }, to: { item: "b", side: "top" }, route: "elbow", bend: 0.5 }), "ar")!;
	assert.deepEqual([sided.fromJoin!.side, sided.fromJoin!.at, sided.toJoin!.side, sided.bent], ["bottom", 0.25, "top", true]);
	assert.ok(sided.middle);
	// Not an arrow, or an end that cannot be found.
	assert.equal(arrowHandles(scene(), "a"), undefined);
	assert.equal(arrowHandles(scene({ from: "a", to: "gone" }), "ar"), undefined);
	// A board end is found by its path.
	assert.deepEqual(arrowLine(scene(), { from: "a", to: "boards/x.html" }), [[50, 50], [50, 200]]);
});

test("a handle's dashed draft is the arrow's shape on the new route", () => {
	const s = scene();
	assert.deepEqual(routeDraft(s, { type: ARROW, from: "a", to: [350, 300] }, s.node("ar")!), { d: "M2 2 L252 277 M240.8 273.6 L252 277 L249.7 265.6", x: 98, y: 23 });
	assert.equal(routeDraft(s, { type: ARROW, from: "a", to: "gone" }, s.node("ar")!), undefined);
});

test("a join slides along its side to a thousandth, clicking to the ends and middle within 8 screen px unless free", () => {
	assert.equal(slideAt(box, "top", { x: 30, y: 0 }, { zoom: 1 }), 0.3);
	assert.equal(slideAt(box, "top", { x: 45, y: 0 }, { zoom: 1 }), 0.5);
	assert.equal(slideAt(box, "top", { x: 45, y: 0 }, { zoom: 1, free: true }), 0.45);
	// At zoom 0.5 the click is 16 stage px.
	assert.equal(slideAt(box, "top", { x: 36, y: 0 }, { zoom: 0.5 }), 0.5);
	assert.equal(slideAt(box, "left", { x: 0, y: 10 }, { zoom: 1 }), 0.2);
	assert.equal(slideAt(box, "left", { x: 0, y: 20 }, { zoom: 1 }), 0.5);
	assert.equal(slideAt(box, "right", { x: 100, y: 99 }, { zoom: 1 }), 1);
	// A side of no length has one place on it, its middle: not the last stop every stop was in reach of.
	assert.equal(slideAt({ x: 0, y: 0, w: 0, h: 0 }, "top", { x: 5, y: 0 }, { zoom: 1 }), 0.5);
	assert.equal(slideAt({ x: 0, y: 0, w: 40, h: 0 }, "left", { x: 0, y: -3 }, { zoom: 1 }), 0.5);
	assert.equal(slideAt({ x: 0, y: 0, w: 0, h: 0 }, "top", { x: 5, y: 0 }, { zoom: 1, free: true }), 0.5);
});

test("the drag slides the join within 18 screen px of its side, past its ends too", () => {
	assert.equal(nearSide(box, "top", { x: 50, y: -18 }, 1), true);
	assert.equal(nearSide(box, "top", { x: 50, y: -19 }, 1), false);
	assert.equal(nearSide(box, "top", { x: 118, y: 5 }, 1), true);
	assert.equal(nearSide(box, "top", { x: 119, y: 5 }, 1), false);
	assert.equal(nearSide(box, "right", { x: 110, y: 25 }, 2), false);
	const own = { item: "a", box, side: "top" as const };
	assert.deepEqual(slideJoin(own, { x: 30, y: 4 }, { zoom: 1 }), { item: "a", side: "top", at: 0.3 });
	assert.equal(slideJoin(own, { x: 30, y: 40 }, { zoom: 1 }), undefined);
	assert.equal(slideJoin(undefined, { x: 30, y: 4 }, { zoom: 1 }), undefined);
});

test("an end let go joins what is there, or is a point; never the thing the other end joins", () => {
	const s = scene();
	const meta = { type: ARROW, from: "a", to: "b" };
	assert.deepEqual(droppedEnd(s, "ar", meta, "to", { x: 50, y: 300 }, 1), "boards/x.html");
	assert.deepEqual(droppedEnd(s, "ar", meta, "to", { x: 50, y: 1.54 }, 1), [50, 1.5]);
	assert.deepEqual(droppedEnd(s, "ar", meta, "from", { x: 300, y: 25 }, 1), [300, 25]);
	assert.deepEqual(droppedEnd(s, "ar", meta, "from", { x: 600.04, y: 25 }, 1), [600, 25]);
	assert.deepEqual(droppedEnd(s, "ar", { ...meta, to: [0, 0] }, "from", { x: 300, y: 25 }, 1), { item: "b", side: "left" });
	assert.deepEqual(arrowOp("ar", { from: "a" }), { op: "update", id: "ar", set: { metadata: { from: "a" } } });
});

test("a double-click on an end takes its `at` away; on the middle, its bend", () => {
	const meta = { type: ARROW, from: { item: "a", side: "top", at: 0.3 }, to: "b", bend: 0.4 };
	assert.deepEqual(resetEndOp("ar", meta, "from"), { op: "update", id: "ar", set: { metadata: { type: ARROW, from: { item: "a", side: "top" }, to: "b", bend: 0.4 } } });
	assert.equal(resetEndOp("ar", meta, "to"), undefined);
	assert.equal(resetEndOp("ar", undefined, "from"), undefined);
	assert.deepEqual(resetBendOp("ar", meta), { op: "update", id: "ar", set: { metadata: { type: ARROW, from: { item: "a", side: "top", at: 0.3 }, to: "b" } } });
	assert.equal(resetBendOp("ar", { from: "a", to: "b" }), undefined);
});

test("the middle handle slides an elbow's turn, and pulls a line into a curve", () => {
	const elbow = { type: ARROW, from: { item: "a", side: "bottom" }, to: { item: "b", side: "top" }, route: "elbow", bend: 0.2 };
	const start = bendStart(scene(), elbow)!;
	assert.deepEqual(start.auto, [[50, 50], [50, 25], [350, 25], [350, 0]]);
	assert.equal("bend" in start.unbent, false);
	assert.deepEqual(bendAt(start, "elbow", { x: 200, y: 40 }), { ...start.unbent, bend: 0.2 });
	assert.deepEqual(bendAt(start, "elbow", { x: 200, y: -100 }), { ...start.unbent, bend: 1 });
	const line = bendStart(scene(), { type: ARROW, from: "a", to: "b" })!;
	assert.deepEqual(bendAt(line, "straight", { x: 200, y: 80.6 }), { type: ARROW, from: "a", to: "b", route: "curved", bend: [0, 56] });
	assert.equal(bendStart(scene(), { from: "a", to: "gone" }), undefined);
});

test("a new arrow joins what each end was on; a click makes one only between two things", () => {
	const a = { name: "a", box }, b = { name: "b", box, side: "left" as const };
	assert.deepEqual(newArrowEnds(a, b, { x: 1, y: 2 }, { x: 3, y: 4 }, false), { from: "a", to: { item: "b", side: "left" } });
	assert.equal(newArrowEnds(a, a, { x: 1, y: 2 }, { x: 3, y: 4 }, false), undefined);
	assert.equal(newArrowEnds(undefined, b, { x: 1, y: 2 }, { x: 3, y: 4 }, false), undefined);
	assert.deepEqual(newArrowEnds(a, a, { x: 1, y: 2 }, { x: 3.25, y: 4 }, true), { from: "a", to: [3.3, 4] });
	assert.deepEqual(newArrowEnds(undefined, undefined, { x: 1, y: 2 }, { x: 3, y: 4 }, true), { from: [1, 2], to: [3, 4] });
});
