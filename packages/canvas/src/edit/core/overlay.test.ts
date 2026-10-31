import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene } from "./fake-scene.ts";
import { hitReach, anchorAt, arrowAnchors, distances, measure, arrowEnds, pageHandleList, pageHandles, deriveOverlay, draftBox, draftCurve, dropBox, glideShift, gripBox, gripHidden, handleAt, hoverBox, insertBox, itemHandles, kinOutlines, radiusHandle, radiusInset, radiusShown, selectionFrame, selectionOutlines, sizeLabel, type OutlineInput, type OverlayInput } from "./overlay.ts";

const boards = [
	{ path: "boards/one.html", x: 1000, y: 0, w: 400, h: 300 },
	{ path: "boards/deck.html", x: 1600, y: 0, w: 640, h: 360 },
];
const scene = fakeScene(
	[
		{ id: "a", box: { x: 10, y: 20, w: 100, h: 50 } },
		{ id: "b", box: { x: 200, y: 20, w: 100, h: 50 }, drawn: { x: 198, y: 18, w: 104, h: 54 } },
		{ id: "note", type: "note", box: { x: 400, y: 20, w: 120, h: 120 } },
		{ id: "arrow", type: "path", box: { x: 0, y: 0, w: 10, h: 10 }, extra: { metadata: { type: "decks.arrow", from: [0, 0], to: [100, 40] } } },
		{ id: "group", type: "group", box: { x: 0, y: 200, w: 50, h: 50 } },
		{ id: "words", type: "text", box: { x: 0, y: 300, w: 80, h: 20 } },
		{ id: "late", box: { x: 0, y: 400, w: 10, h: 10 }, undrawn: true },
		{ id: "card", type: "frame", box: { x: 600, y: 0, w: 300, h: 200 } },
		{ id: "block", type: "text", parent: "card", box: { x: 620, y: 40, w: 260, h: 30 }, extra: { content: "# Title" } },
	],
	boards,
);
const none = { dx: 0, dy: 0 };
const base = (fields: Partial<OutlineInput> = {}): OutlineInput => ({ selection: [], drag: none, boards, pagePicks: [], ...fields });

test("a selected item is outlined where it is drawn, moved by the drag; a note's outline is round", () => {
	assert.deepEqual(selectionOutlines(base({ selection: ["a", "b", "note"], drag: { dx: 5, dy: -5 } }), scene), [
		{ id: "a", role: "item", x: 15, y: 15, w: 100, h: 50 },
		{ id: "b", role: "item", x: 203, y: 13, w: 104, h: 54 },
		{ id: "note", role: "item", x: 405, y: 15, w: 120, h: 120, round: true },
	]);
});

test("no outline round an arrow, the item typed into, or one not yet drawn; a resize outlines its own box", () => {
	assert.deepEqual(selectionOutlines(base({ selection: ["arrow", "note", "late"], typing: "note" }), scene), []);
	assert.deepEqual(selectionOutlines(base({ selection: ["a"], drag: { dx: 9, dy: 9 }, resize: { id: "a", x: 10, y: 20, w: 140, h: 60 } }), scene), [{ id: "a", role: "item", x: 10, y: 20, w: 140, h: 60 }]);
});

test("boards picked up move with a board drag; the app's selected board follows a finger or its resize; the marquee is last", () => {
	const drag = { paths: ["boards/one.html"], dx: 10, dy: 20 };
	assert.deepEqual(selectionOutlines(base({ pagePicks: ["boards/one.html"], pageDrag: drag, marquee: { x1: 50, y1: 60, x2: 10, y2: 20 } }), scene), [
		{ id: "board:boards/one.html", role: "board", x: 1010, y: 20, w: 400, h: 300 },
		{ id: "", role: "marquee", x: 10, y: 20, w: 40, h: 40 },
	]);
	assert.deepEqual(selectionOutlines(base({ selected: "boards/one.html", pageDrag: drag }), scene), [{ id: "board:boards/one.html", role: "board", x: 1010, y: 20, w: 400, h: 300 }]);
	assert.deepEqual(selectionOutlines(base({ selected: "boards/one.html", ownDrag: { path: "boards/one.html", x: 7, y: 8 } }), scene), [{ id: "board:boards/one.html", role: "board", x: 7, y: 8, w: 400, h: 300 }]);
	assert.deepEqual(selectionOutlines(base({ selected: "boards/one.html", pageResize: { path: "boards/one.html", x: 990, y: 0, w: 500, h: 310 } }), scene), [{ id: "board:boards/one.html", role: "board", x: 990, y: 0, w: 500, h: 310 }]);
	// Not twice when it is picked up as well.
	assert.equal(selectionOutlines(base({ selected: "boards/one.html", pagePicks: ["boards/one.html"] }), scene).length, 1);
});

test("one item gets handles; a group, an arrow, two items, a board or a marquee do not", () => {
	const one = selectionOutlines(base({ selection: ["a"] }), scene);
	assert.equal(itemHandles(one, scene), one[0]);
	assert.equal(itemHandles(selectionOutlines(base({ selection: ["group"] }), scene), scene), undefined);
	assert.equal(itemHandles(selectionOutlines(base({ selection: ["a", "b"] }), scene), scene), undefined);
	assert.equal(itemHandles(selectionOutlines(base({ selected: "boards/one.html" }), scene), scene), undefined);
	assert.equal(itemHandles(selectionOutlines(base({ marquee: { x1: 0, y1: 0, x2: 5, y2: 5 } }), scene), scene), undefined);
});

test("arrow anchors: an editable item, not words, nothing drawn or sized", () => {
	const handles = itemHandles(selectionOutlines(base({ selection: ["a"] }), scene), scene);
	const free = { editable: true, drafting: false, resizing: false };
	assert.equal(arrowAnchors(handles, free, scene), handles);
	assert.equal(arrowAnchors(handles, { ...free, editable: false }, scene), undefined);
	assert.equal(arrowAnchors(handles, { ...free, drafting: true }, scene), undefined);
	assert.equal(arrowAnchors(handles, { ...free, resizing: true }, scene), undefined);
	const words = itemHandles(selectionOutlines(base({ selection: ["words"] }), scene), scene);
	assert.equal(arrowAnchors(words, free, scene), undefined);
});

test("the radius handle: a rectangle's corners, gone while the item is carried or sized", () => {
	const handles = itemHandles(selectionOutlines(base({ selection: ["a"] }), scene), scene);
	const free = { editable: true, resizing: false, drag: none };
	assert.deepEqual(radiusHandle(handles, free, scene), { id: "a", role: "item", x: 10, y: 20, w: 100, h: 50, radius: 0, most: 25, shape: false });
	assert.equal(radiusHandle(handles, { ...free, drag: { dx: 1, dy: 0 } }, scene), undefined);
	assert.equal(radiusHandle(handles, { ...free, resizing: true }, scene), undefined);
	assert.equal(radiusHandle(handles, { ...free, editable: false }, scene), undefined);
	assert.equal(radiusShown({ id: "a", radius: 0 }, { id: "a", radius: 12 }), 12);
	assert.equal(radiusShown({ id: "a", radius: 4 }, { id: "b", radius: 12 }), 4);
	// Clear of the 9 px corner handle, never past the middle.
	assert.equal(radiusInset(0, 9, 25), 9);
	assert.equal(radiusInset(18, 9, 25), 18);
	assert.equal(radiusInset(40, 9, 25), 25);
});

test("board handles: one board alone, resizable, not carried; all eight", () => {
	const outlines = selectionOutlines(base({ selected: "boards/deck.html" }), scene);
	assert.deepEqual(pageHandles(outlines, { resizable: true, carrying: false, boards }), { id: "board:boards/deck.html", role: "board", x: 1600, y: 0, w: 640, h: 360, path: "boards/deck.html" });
	assert.equal(pageHandles(outlines, { resizable: false, carrying: false, boards }), undefined);
	assert.equal(pageHandles(outlines, { resizable: true, carrying: true, boards }), undefined);
	assert.deepEqual(pageHandleList(), ["nw", "n", "ne", "e", "se", "s", "sw", "w"]);
	// Under 10 screen pixels both ways the handles would cover the board: at 1%, 640 × 360 is 6.4 × 3.6.
	assert.equal(pageHandles(outlines, { resizable: true, carrying: false, boards, zoom: 0.01 }), undefined);
	assert.ok(pageHandles(outlines, { resizable: true, carrying: false, boards, zoom: 0.02 }));
});

test("an item's handles hide when its box is under 10 screen pixels both ways, and stay when either way is not", () => {
	const tiny = fakeScene([{ id: "dot", box: { x: 0, y: 0, w: 8, h: 6 } }, { id: "bar", box: { x: 0, y: 20, w: 40, h: 2 } }]);
	const outlined = (id: string) => selectionOutlines(base({ selection: [id] }), tiny);
	assert.equal(itemHandles(outlined("dot"), tiny, 1), undefined);
	assert.ok(itemHandles(outlined("dot"), tiny, 2), "16 × 12 on the screen at 200%");
	assert.ok(itemHandles(outlined("bar"), tiny, 1), "40 wide, though 2 tall");
});

test("a resize handle answers a press 15 screen pixels across: its hit zone reaches past what is drawn", () => {
	// A 9 px handle at 100% reaches 3 px past each side; at 50% one drawn 18 stage px wide hits 30, so 6.
	assert.equal(hitReach(9, 1), 3);
	assert.equal(hitReach(18, 0.5), 6);
	// A finger's 16 px handle already covers it.
	assert.equal(hitReach(16, 1), 0);
});

test("an arrow alone selected has its ends' handles, moved by the drag", () => {
	const ends = arrowEnds({ selection: ["arrow"], pagePicks: [], drag: { dx: 5, dy: 5 } }, scene);
	assert.deepEqual([ends?.from, ends?.to], [{ x: 5, y: 5 }, { x: 105, y: 45 }]);
	assert.equal(arrowEnds({ selection: ["arrow"], pagePicks: ["boards/one.html"], drag: none }, scene), undefined);
	assert.equal(arrowEnds({ selection: ["a"], pagePicks: [], drag: none }, scene), undefined);
});

test("hover: the drawn box of an item in edit mode, else the board under the pointer unless selected or busy", () => {
	const hover = { editing: true, busy: false, boards };
	assert.deepEqual(hoverBox({ ...hover, item: "b" }, scene), { x: 198, y: 18, w: 104, h: 54, id: "b" });
	assert.deepEqual(hoverBox({ ...hover, item: "note" }, scene), { x: 400, y: 20, w: 120, h: 120, id: "note", round: true });
	assert.equal(hoverBox({ ...hover, item: "b", editing: false }, scene), undefined);
	assert.equal(hoverBox({ ...hover, item: "arrow" }, scene), undefined);
	assert.equal(hoverBox({ ...hover, item: "b", typing: "b" }, scene), undefined);
	assert.deepEqual(hoverBox({ ...hover, board: "boards/one.html" }, scene), { x: 1000, y: 0, w: 400, h: 300, board: true });
	assert.equal(hoverBox({ ...hover, board: "boards/one.html", selected: "boards/one.html" }, scene), undefined);
	assert.equal(hoverBox({ ...hover, board: "boards/one.html", busy: true }, scene), undefined);
});

test("the grip sits level with the middle of the block's first line; the drop box is the frame's", () => {
	const line = () => ({ top: 4, height: 24 });
	assert.deepEqual(gripBox({ block: "block", busy: false, editing: true }, scene, line), { id: "block", x: 620, y: 56 });
	assert.equal(gripBox({ block: "block", busy: true, editing: true }, scene, line), undefined);
	assert.equal(gripBox({ busy: false, editing: true }, scene, line), undefined);
	// Browsing, the grip still shows: a card's blocks drag in both modes.
	assert.deepEqual(gripBox({ block: "block", busy: false, editing: false }, scene, line), { id: "block", x: 620, y: 56 });
	assert.equal(gripHidden(none, false), false);
	assert.equal(gripHidden({ dx: 0, dy: 2 }, false), true);
	assert.equal(gripHidden(none, true), true);
	assert.deepEqual(dropBox("card", scene), { x: 600, y: 0, w: 300, h: 200, id: "card" });
	assert.equal(dropBox(null, scene), undefined);
});

test("handles, anchors and the insert line in stage pixels, at a screen size", () => {
	const box = { x: 100, y: 50, w: 200, h: 80 };
	assert.deepEqual(handleAt(box, "nw", 9), { x: 95.5, y: 45.5 });
	assert.deepEqual(handleAt(box, "e", 9), { x: 295.5, y: 85.5 });
	assert.deepEqual(handleAt(box, "s", 18), { x: 191, y: 121 });
	assert.deepEqual(anchorAt(box, "top", 14), { x: 200, y: 36 });
	assert.deepEqual(anchorAt(box, "left", 28), { x: 72, y: 90 });
	assert.deepEqual(insertBox({ x: 10, y: 40, w: 120, h: 0 }, 3), { x: 10, y: 38.5, w: 120, h: 3 });
	assert.deepEqual(insertBox({ x: 40, y: 10, w: 0, h: 60 }, 6), { x: 37, y: 10, w: 6, h: 60 });
	assert.deepEqual(draftBox({ x1: 50, y1: 10, x2: 20, y2: 40 }), { x: 20, y: 10, w: 30, h: 30 });
	assert.match(draftCurve({ x1: 0, y1: 0, x2: 100, y2: 50 }), /^M0 0[CL]/);
});

test("deriveOverlay puts the parts together", () => {
	const input: OverlayInput = {
		...base({ selection: ["a"] }),
		editable: true,
		drafting: false,
		resizing: false,
		editing: true,
		hoverItem: "b",
		panning: false,
		pointerDrag: none,
		resizable: true,
		lineOf: () => ({ top: 0, height: 20 }),
		dropInto: "card",
		dropAt: { line: { x: 610, y: 100, w: 280, h: 0 } },
		joins: [],
		sides: [],
		guides: [],
	};
	const overlay = deriveOverlay(input, scene);
	assert.equal(overlay.outlines.length, 1);
	assert.equal(overlay.handles, overlay.outlines[0]);
	assert.equal(overlay.anchors, overlay.outlines[0]);
	assert.equal(overlay.radius?.most, 25);
	assert.equal(overlay.pageHandles, undefined);
	assert.equal(overlay.hover?.id, "b");
	assert.equal(overlay.drop?.id, "card");
	assert.deepEqual(overlay.insert, { x: 610, y: 100, w: 280, h: 0 });
	assert.equal(overlay.gripHidden, false);
	assert.deepEqual(overlay.kin, []);
	assert.deepEqual(overlay.selectionFrame, { x: 10, y: 20, w: 100, h: 50, many: false, label: "100 × 50" });
	assert.equal(deriveOverlay({ ...input, pageDrag: { paths: [], dx: 0, dy: 0 }, hoverItem: undefined, hoverPage: "boards/one.html" }, scene).hover, undefined);
});

/** A frame in a group, holding two items; a note beside them in the group; a shape with a part. */
const nested = fakeScene([
	{ id: "g", type: "group", box: { x: 0, y: 0, w: 400, h: 200 } },
	{ id: "f", type: "frame", parent: "g", box: { x: 0, y: 0, w: 200, h: 200 } },
	{ id: "f1", parent: "f", box: { x: 10, y: 10, w: 80, h: 40 } },
	{ id: "f2", parent: "f", box: { x: 100, y: 10, w: 80, h: 40 } },
	{ id: "n", type: "note", parent: "g", box: { x: 300, y: 0, w: 100, h: 100 } },
	{ id: "sh", type: "frame", box: { x: 500, y: 0, w: 100, h: 100 }, extra: { metadata: { type: "decks.shape" } } },
	{ id: "sh-words", type: "text", parent: "sh", box: { x: 520, y: 40, w: 60, h: 20 } },
]);
const kin = (fields: Partial<Parameters<typeof kinOutlines>[0]> = {}) => kinOutlines({ selection: [], drag: none, resizing: false, editing: true, busy: false, ...fields }, nested);
const brief = (boxes: ReturnType<typeof kinOutlines>) => boxes.map((one) => `${one.of}:${one.kin}:${one.id}`);

test("a selected item's parents are outlined light and solid, all the way up; a selected container's children light and dashed", () => {
	assert.deepEqual(brief(kin({ selection: ["f1"] })), ["selection:parent:f", "selection:parent:g"]);
	assert.deepEqual(kin({ selection: ["f1"] })[0], { id: "f", kin: "parent", of: "selection", x: 0, y: 0, w: 200, h: 200 });
	assert.deepEqual(brief(kin({ selection: ["f"] })), ["selection:parent:g", "selection:child:f1", "selection:child:f2"]);
	assert.deepEqual(brief(kin({ selection: ["g"] })), ["selection:child:f", "selection:child:n"]);
	assert.deepEqual(kin({ selection: ["g"] })[1], { id: "n", kin: "child", of: "selection", x: 300, y: 0, w: 100, h: 100, round: true });
	// Two selected: the parents of both, once each, and no children; what is selected is never its own kin.
	assert.deepEqual(brief(kin({ selection: ["f1", "n"] })), ["selection:parent:f", "selection:parent:g"]);
	assert.deepEqual(brief(kin({ selection: ["f1", "f"] })), ["selection:parent:g"]);
	// The children wait out a move and a resize; the parents stay.
	assert.deepEqual(brief(kin({ selection: ["f"], drag: { dx: 4, dy: 0 } })), ["selection:parent:g"]);
	assert.deepEqual(brief(kin({ selection: ["f"], resizing: true })), ["selection:parent:g"]);
	// A shape is one thing: no children; and nothing while words are typed.
	assert.deepEqual(kin({ selection: ["sh"] }), []);
	assert.deepEqual(kin({ selection: ["f1"], typing: "f1" }), []);
});

test("in edit mode the hovered item's parent is outlined solid and its children dashed; browsing, nothing", () => {
	assert.deepEqual(brief(kin({ hover: "f1" })), ["hover:parent:f"]);
	assert.deepEqual(brief(kin({ hover: "f" })), ["hover:parent:g", "hover:child:f1", "hover:child:f2"]);
	assert.deepEqual(kin({ hover: "f", editing: false }), []);
	assert.deepEqual(kin({ hover: "f", busy: true }), []);
	// What the selection already outlines is not outlined again for the hover.
	assert.deepEqual(brief(kin({ selection: ["f1"], hover: "f2" })), ["selection:parent:f", "selection:parent:g"]);
	assert.deepEqual(brief(kin({ selection: ["f1"], hover: "f1" })), ["selection:parent:f", "selection:parent:g"]);
});

test("one box round everything selected, with its size in rounded pixels; none for the marquee alone", () => {
	assert.equal(sizeLabel({ w: 120.4, h: 35.6 }), "120 × 36");
	assert.deepEqual(selectionFrame([{ id: "a", role: "item", x: 10, y: 20, w: 100, h: 50 }]), { x: 10, y: 20, w: 100, h: 50, many: false, label: "100 × 50" });
	assert.deepEqual(
		selectionFrame([
			{ id: "a", role: "item", x: 10, y: 20, w: 100, h: 50 },
			{ id: "board:b", role: "board", x: 300, y: 0, w: 400, h: 300 },
			{ id: "", role: "marquee", x: -50, y: -50, w: 1000, h: 1000 },
		]),
		{ x: 10, y: 0, w: 690, h: 300, many: true, label: "690 × 300" },
	);
	assert.equal(selectionFrame([{ id: "", role: "marquee", x: 0, y: 0, w: 10, h: 10 }]), undefined);
	assert.equal(selectionFrame([]), undefined);
});

test("Alt's distances: the gap between two boxes apart, level with the selection's middle, with the far edge carried out dashed", () => {
	// Side by side, level: one line across the 40 px gap, at the selection's middle.
	assert.deepEqual(measure({ x: 0, y: 0, w: 100, h: 50 }, { x: 140, y: 0, w: 60, h: 50 }), [{ x1: 100, y1: 25, x2: 140, y2: 25, label: "40" }]);
	// The other side round.
	assert.deepEqual(measure({ x: 140, y: 0, w: 60, h: 50 }, { x: 0, y: 0, w: 100, h: 50 }), [{ x1: 100, y1: 25, x2: 140, y2: 25, label: "40" }]);
	// Apart both ways: across and down, and each far edge carried out to meet the line.
	assert.deepEqual(measure({ x: 0, y: 0, w: 100, h: 50 }, { x: 130, y: 90, w: 50, h: 50 }), [
		{ x1: 100, y1: 25, x2: 130, y2: 25, label: "30" },
		{ x1: 130, y1: 25, x2: 130, y2: 90, dashed: true },
		{ x1: 50, y1: 50, x2: 50, y2: 90, label: "40" },
		{ x1: 50, y1: 90, x2: 130, y2: 90, dashed: true },
	]);
	// Inside: the four gaps to the edges round it, rounded to whole pixels.
	assert.deepEqual(measure({ x: 20.4, y: 30, w: 60, h: 40 }, { x: 0, y: 0, w: 200, h: 100 }), [
		{ x1: 0, y1: 50, x2: 20.4, y2: 50, label: "20" },
		{ x1: 80.4, y1: 50, x2: 200, y2: 50, label: "120" },
		{ x1: 50.4, y1: 0, x2: 50.4, y2: 30, label: "30" },
		{ x1: 50.4, y1: 70, x2: 50.4, y2: 100, label: "30" },
	]);
	// Overlapping without one holding the other: nothing along either axis.
	assert.deepEqual(measure({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 }), []);
});

test("Alt's distances show in edit mode only, with a selection, Alt held and something else under the pointer, and no press in hand", () => {
	const selection = { x: 0, y: 0, w: 100, h: 50, many: false, label: "100 × 50" };
	const over = { x: 140, y: 0, w: 60, h: 50, id: "b" };
	const on = { editing: true, alt: true, busy: false, selection, over };
	assert.deepEqual(distances(on), { from: { x: 0, y: 0, w: 100, h: 50 }, to: { x: 140, y: 0, w: 60, h: 50 }, lines: [{ x1: 100, y1: 25, x2: 140, y2: 25, label: "40" }] });
	assert.equal(distances({ ...on, editing: false }), undefined);
	assert.equal(distances({ ...on, alt: false }), undefined);
	assert.equal(distances({ ...on, busy: true }), undefined);
	assert.equal(distances({ ...on, selection: undefined }), undefined);
	assert.equal(distances({ ...on, over: undefined }), undefined);
	// deriveOverlay measures from the box round the selection to the hovered item's drawn box.
	const input: OverlayInput = { ...base({ selection: ["a"] }), editable: true, drafting: false, resizing: false, editing: true, hoverItem: "b", panning: false, pointerDrag: none, resizable: true, lineOf: () => ({ top: 0, height: 20 }), joins: [], sides: [], guides: [] };
	assert.equal(deriveOverlay(input, scene).distances, undefined);
	// b is drawn 2 px taller either side, so a sits inside it top to bottom: the two 2 px gaps too, as the mock-up has them.
	assert.deepEqual(deriveOverlay({ ...input, alt: true }, scene).distances?.lines, [
		{ x1: 110, y1: 45, x2: 198, y2: 45, label: "88" },
		{ x1: 60, y1: 18, x2: 60, y2: 20, label: "2" },
		{ x1: 60, y1: 70, x2: 60, y2: 72, label: "2" },
	]);
	assert.equal(deriveOverlay({ ...input, alt: true, editing: false }, scene).distances, undefined);
});

test("during a drop's glide, outlines ride with what glides: the item, the box round many, a parent's children, the hovered item", () => {
	const column = fakeScene([
		{ id: "col", type: "frame", layout: "vertical", box: { x: 0, y: 0, w: 200, h: 300 } },
		{ id: "r1", parent: "col", box: { x: 10, y: 10, w: 180, h: 50 } },
		{ id: "dropped", parent: "col", box: { x: 10, y: 70, w: 180, h: 50 } },
		{ id: "r2", parent: "col", box: { x: 10, y: 130, w: 180, h: 50 } },
		{ id: "group", type: "group", box: { x: 400, y: 0, w: 100, h: 100 } },
		{ id: "inner", parent: "group", box: { x: 410, y: 10, w: 40, h: 40 } },
	]);
	// The engine's glide: only the outermost of what moved, an item carrying its children.
	const glide = new Map([
		["dropped", { dx: 9, dy: -28 }],
		["r2", { dx: 0, dy: -60 }],
		["group", { dx: 5, dy: 5 }],
	]);
	assert.deepEqual(glideShift(glide, column, "dropped"), { dx: 9, dy: -28 });
	assert.deepEqual(glideShift(glide, column, "inner"), { dx: 5, dy: 5 });
	assert.deepEqual(glideShift(glide, column, "r1"), { dx: 0, dy: 0 });
	assert.deepEqual(glideShift(undefined, column, "dropped"), { dx: 0, dy: 0 });

	const one = selectionOutlines({ selection: ["dropped"], drag: none, glide, boards: [], pagePicks: [] }, column);
	assert.deepEqual(one, [{ id: "dropped", role: "item", x: 19, y: 42, w: 180, h: 50 }]);
	// Its handles sit on that outline, and so does the box round the selection and its size.
	assert.deepEqual(itemHandles(one, column), one[0]);
	assert.deepEqual(selectionFrame(one), { x: 19, y: 42, w: 180, h: 50, many: false, label: "180 × 50" });

	const many = selectionOutlines({ selection: ["dropped", "r2"], drag: none, glide, boards: [], pagePicks: [] }, column);
	assert.deepEqual(many.map((o) => [o.id, o.x, o.y]), [["dropped", 19, 42], ["r2", 10, 70]]);
	assert.deepEqual(selectionFrame(many), { x: 10, y: 42, w: 189, h: 78, many: true, label: "189 × 78" });

	// The column selected: its children are outlined where the glide draws them.
	const kin = kinOutlines({ selection: ["col"], drag: none, glide, resizing: false, editing: true, busy: false }, column);
	assert.deepEqual(kin.map((k) => [k.id, k.x, k.y]), [["r1", 10, 10], ["dropped", 19, 42], ["r2", 10, 70]]);
	// A group's child is carried by the group's glide.
	const inGroup = kinOutlines({ selection: ["group"], drag: none, glide, resizing: false, editing: true, busy: false }, column);
	assert.deepEqual(inGroup.map((k) => [k.id, k.x, k.y]), [["inner", 415, 15]]);

	assert.deepEqual(hoverBox({ editing: true, item: "r2", busy: false, boards: [], glide }, column), { x: 10, y: 70, w: 180, h: 50, id: "r2" });
	// With no glide, nothing moves: the drag path is as it was.
	assert.deepEqual(selectionOutlines({ selection: ["dropped"], drag: { dx: 3, dy: 4 }, boards: [], pagePicks: [] }, column), [{ id: "dropped", role: "item", x: 13, y: 74, w: 180, h: 50 }]);
});
