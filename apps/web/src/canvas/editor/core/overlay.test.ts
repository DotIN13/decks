import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene } from "./fake-scene.ts";
import { anchorAt, arrowAnchors, arrowEnds, boardHandleList, boardHandles, deriveOverlay, draftBox, draftCurve, dropBox, gripBox, gripHidden, handleAt, hoverBox, insertBox, itemHandles, radiusHandle, radiusInset, radiusShown, selectionOutlines, type OutlineInput, type OverlayInput } from "./overlay.ts";

const boards = [
	{ path: "boards/one.html", x: 1000, y: 0, w: 400, h: 300 },
	{ path: "boards/deck.html", x: 1600, y: 0, w: 640, h: 360, slides: true },
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
const base = (fields: Partial<OutlineInput> = {}): OutlineInput => ({ selection: [], drag: none, boards, boardPicks: [], ...fields });

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
	assert.deepEqual(selectionOutlines(base({ boardPicks: ["boards/one.html"], boardDrag: drag, marquee: { x1: 50, y1: 60, x2: 10, y2: 20 } }), scene), [
		{ id: "board:boards/one.html", role: "board", x: 1010, y: 20, w: 400, h: 300 },
		{ id: "", role: "marquee", x: 10, y: 20, w: 40, h: 40 },
	]);
	assert.deepEqual(selectionOutlines(base({ selected: "boards/one.html", boardDrag: drag }), scene), [{ id: "board:boards/one.html", role: "board", x: 1010, y: 20, w: 400, h: 300 }]);
	assert.deepEqual(selectionOutlines(base({ selected: "boards/one.html", ownDrag: { path: "boards/one.html", x: 7, y: 8 } }), scene), [{ id: "board:boards/one.html", role: "board", x: 7, y: 8, w: 400, h: 300 }]);
	assert.deepEqual(selectionOutlines(base({ selected: "boards/one.html", boardResize: { path: "boards/one.html", x: 990, y: 0, w: 500, h: 310 } }), scene), [{ id: "board:boards/one.html", role: "board", x: 990, y: 0, w: 500, h: 310 }]);
	// Not in the focus view, and not twice when it is picked up as well.
	assert.deepEqual(selectionOutlines(base({ selected: "boards/one.html", focus: "boards/one.html" }), scene), []);
	assert.equal(selectionOutlines(base({ selected: "boards/one.html", boardPicks: ["boards/one.html"] }), scene).length, 1);
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

test("board handles: one board alone, resizable, not carried; a slide deck has no top or bottom", () => {
	const outlines = selectionOutlines(base({ selected: "boards/deck.html" }), scene);
	assert.deepEqual(boardHandles(outlines, { resizable: true, carrying: false, boards }), { id: "board:boards/deck.html", role: "board", x: 1600, y: 0, w: 640, h: 360, path: "boards/deck.html", slides: true });
	assert.equal(boardHandles(outlines, { resizable: false, carrying: false, boards }), undefined);
	assert.equal(boardHandles(outlines, { resizable: true, carrying: true, boards }), undefined);
	assert.deepEqual(boardHandleList(true), ["nw", "ne", "e", "se", "sw", "w"]);
	assert.equal(boardHandleList(false).length, 8);
});

test("an arrow alone selected has its ends' handles, moved by the drag", () => {
	const ends = arrowEnds({ selection: ["arrow"], boardPicks: [], drag: { dx: 5, dy: 5 } }, scene);
	assert.deepEqual([ends?.from, ends?.to], [{ x: 5, y: 5 }, { x: 105, y: 45 }]);
	assert.equal(arrowEnds({ selection: ["arrow"], boardPicks: ["boards/one.html"], drag: none }, scene), undefined);
	assert.equal(arrowEnds({ selection: ["a"], boardPicks: [], drag: none }, scene), undefined);
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
	// Browsing, nothing answers the pointer before a press: no grip either.
	assert.equal(gripBox({ block: "block", busy: false, editing: false }, scene, line), undefined);
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
	assert.equal(overlay.boardHandles, undefined);
	assert.equal(overlay.hover?.id, "b");
	assert.equal(overlay.drop?.id, "card");
	assert.deepEqual(overlay.insert, { x: 610, y: 100, w: 280, h: 0 });
	assert.equal(overlay.gripHidden, false);
	assert.equal(deriveOverlay({ ...input, boardDrag: { paths: [], dx: 0, dy: 0 }, hoverItem: undefined, hoverBoard: "boards/one.html" }, scene).hover, undefined);
});
