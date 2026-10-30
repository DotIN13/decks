import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene, type FakeItem } from "./fake-scene.ts";
import { BOARD_HOLD_MS, initialState, landBoardDrag, landBoardResize, RADIUS_HOLD_MS, SETTLE_MS, step, withSelection, type Effect, type GestureContext, type Input, type PointerInput, type Step } from "./gesture.ts";
import type { EditorState, Mods } from "./model.ts";

/**
 * `a` and `b` side by side on the stage, `b` 290 to the right of `a`'s corner; a column frame `col`
 * holding `c1 c2`; a board to the right; and the window round all of it.
 */
const items: FakeItem[] = [
	{ id: "a", box: { x: 10, y: 20, w: 100, h: 50 }, extra: { x: 10, y: 20 } },
	{ id: "b", box: { x: 400, y: 20, w: 100, h: 50 }, extra: { x: 400, y: 20 } },
	{ id: "col", type: "frame", layout: "vertical", box: { x: 0, y: 300, w: 300, h: 300 }, extra: { x: 0, y: 300, height: 300 } },
	{ id: "c1", parent: "col", box: { x: 18, y: 318, w: 264, h: 40 } },
	{ id: "c2", parent: "col", box: { x: 18, y: 370, w: 264, h: 40 } },
	{ id: "media", type: "rectangle", box: { x: 700, y: 700, w: 80, h: 60 }, extra: { metadata: { type: "decks.media", kind: "video", file: "films/one.mp4" } } },
];
const boards = [{ path: "boards/one.html", x: 1000, y: 0, w: 400, h: 300 }];
const scene = fakeScene(items, boards);

const NONE: Mods = { shift: false, alt: false, meta: false, ctrl: false };
const ctx = (over: Partial<GestureContext> = {}): GestureContext => {
	let n = 0;
	return {
		zoom: 1,
		// A window that shows nothing to snap to, unless a test asks for the whole stage (`WIDE`).
		view: { x: -5000, y: -5000, w: 1, h: 1 },
		generation: 1,
		nextIds: () => () => `new${++n}`,
		boardRev: () => 7,
		linkAt: () => undefined,
		overComposer: () => false,
		...over,
	};
};
const WIDE = { view: { x: -2000, y: -2000, w: 6000, h: 6000 } };
/** A pointer at a stage point, the screen the same, with these keys, at this time. */
const at = (x: number, y: number, mods: Partial<Mods> = {}, time = 1000, pointer: PointerInput["pointer"] = "mouse"): PointerInput => ({ at: { x, y }, client: { x, y }, mods: { ...NONE, ...mods }, pointer, time });

/** Step a list of inputs from a state, the answers kept in order. */
function run(state: EditorState, inputs: Input[], context = ctx()): { state: EditorState; steps: Step[] } {
	const steps: Step[] = [];
	for (const input of inputs) {
		const result = step(state, input, scene, context);
		steps.push(result);
		state = result.state;
	}
	return { state, steps };
}
const kinds = (effects: Effect[]) => effects.map((one) => one.do);

test("a press on an item selects it, a drag carries it with the pointer, and the lift moves it and waits for the drawing", () => {
	const { state, steps } = run(initialState("edit"), [
		{ type: "press-canvas", ...at(50, 40) },
		{ type: "move", ...at(91, 140) },
		{ type: "release", ...at(91, 140, {}, 1500) },
	]);
	assert.deepEqual(steps[0]!.state.selection.items, ["a"]);
	assert.equal(steps[0]!.state.gesture?.kind, "press");
	assert.deepEqual(kinds(steps[0]!.effects), ["select-board", "ghost-take"]);
	// Moved by the pointer's 41 × 100, with nothing in the window to snap to.
	assert.deepEqual(steps[1]!.state.drag, { dx: 41, dy: 100 });
	assert.deepEqual([...steps[1]!.preview!], [["a", { dx: 41, dy: 100 }]]);
	assert.deepEqual(kinds(steps[1]!.effects), ["ghost-show", "composer", "panned"]);
	assert.deepEqual(steps[2]!.ops, [{ op: "update", id: "a", set: { x: 51, y: 120 } }]);
	assert.deepEqual(kinds(steps[2]!.effects), ["ghost-drop", "composer", "settle", "wake", "move-boards"]);
	assert.equal(steps[2]!.preview, undefined);
	// The offset is still on the item: what it waits for is the drawing that answers the move.
	assert.deepEqual(state.drag, { dx: 41, dy: 100 });
	assert.deepEqual(state.settling, [{ generation: 1, until: 1500 + SETTLE_MS }]);
	assert.equal(state.gesture, undefined);
});

test("the drawing that answers a move puts its offset down; with no answer, it goes when the wait comes due", () => {
	const moved = run(initialState("edit"), [
		{ type: "press-canvas", ...at(50, 40) },
		{ type: "move", ...at(91, 140) },
		{ type: "release", ...at(91, 140, {}, 1500) },
	]).state;
	const present = new Set(items.map((one) => one.id));
	// The same drawing laid out again is not the answer.
	assert.deepEqual(step(moved, { type: "drawn", fresh: false, current: true, present }, scene, ctx()).state.drag, { dx: 41, dy: 100 });
	assert.deepEqual(step(moved, { type: "drawn", fresh: true, current: true, present }, scene, ctx()).state.drag, { dx: 0, dy: 0 });
	// Two seconds on, at the same generation: the edit changed nothing, so the preview goes.
	const due = step(moved, { type: "tick", time: 1500 + SETTLE_MS }, scene, ctx());
	assert.deepEqual(due.state.drag, { dx: 0, dy: 0 });
	assert.equal(due.preview, null);
	assert.deepEqual(due.state.settling, []);
	// A new drawing came meanwhile (the generation moved on): it is not this wait's to put down.
	const later = step(moved, { type: "tick", time: 1500 + SETTLE_MS }, scene, ctx({ generation: 2 }));
	assert.deepEqual(later.state.drag, { dx: 41, dy: 100 });
	assert.equal(later.preview, undefined);
	// Not due yet: nothing.
	assert.equal(step(moved, { type: "tick", time: 1500 + SETTLE_MS - 1 }, scene, ctx()).state, moved);
});

test("a drag snaps the selection's edge to its neighbour, and ⌘ or Ctrl turns snapping off", () => {
	// Dragged 287 right: a's right edge at 397, 3 short of b's left edge at 400.
	const snapped = run(initialState("edit"), [{ type: "press-canvas", ...at(50, 40) }, { type: "move", ...at(337, 40) }], ctx(WIDE)).steps[1]!;
	assert.deepEqual(snapped.state.drag, { dx: 290, dy: 0 });
	assert.ok(snapped.state.guides.some((guide) => guide.kind === "line" && guide.x1 === 400 && guide.x2 === 400));
	const free = run(initialState("edit"), [{ type: "press-canvas", ...at(50, 40) }, { type: "move", ...at(337, 40, { meta: true }) }], ctx(WIDE)).steps[1]!;
	assert.deepEqual(free.state.drag, { dx: 287, dy: 0 });
	assert.deepEqual(free.state.guides, []);
	// ⌘ also keeps the parent: no frame is asked about.
	assert.equal(free.state.drop.into, undefined);
	const ctrl = run(initialState("edit"), [{ type: "press-canvas", ...at(50, 40) }, { type: "move", ...at(337, 40, { ctrl: true }) }], ctx(WIDE)).steps[1]!;
	assert.deepEqual(ctrl.state.drag, { dx: 287, dy: 0 });
});

test("Shift keeps a drag to one axis, the one it has gone further along", () => {
	const across = run(initialState("edit"), [{ type: "press-canvas", ...at(50, 40) }, { type: "move", ...at(91, 55, { shift: true }) }]).steps[1]!;
	assert.deepEqual(across.state.drag, { dx: 41, dy: 0 });
	const down = run(initialState("edit"), [{ type: "press-canvas", ...at(50, 40) }, { type: "move", ...at(60, 141, { shift: true }) }]).steps[1]!;
	assert.deepEqual(down.state.drag, { dx: 0, dy: 101 });
	// The axis held is not snapped off it: 287 across would snap 3 to b, and does, but never sideways.
	const snapped = run(initialState("edit"), [{ type: "press-canvas", ...at(50, 40) }, { type: "move", ...at(337, 42, { shift: true }) }], ctx(WIDE)).steps[1]!;
	assert.deepEqual(snapped.state.drag, { dx: 290, dy: 0 });
});

test("Alt lets go of copies, selected and awaited, and leaves the originals where they were", () => {
	const { state, steps } = run(initialState("edit"), [
		{ type: "press-canvas", ...at(50, 40) },
		{ type: "move", ...at(91, 140) },
		{ type: "release", ...at(91, 140, { alt: true }, 2000) },
	]);
	const lift = steps[2]!;
	assert.deepEqual(lift.ops, [
		{ op: "copy", id: "a", as: "new1" },
		{ op: "update", id: "new1", set: { x: 51, y: 120 } },
	]);
	assert.equal(lift.preview, null);
	assert.deepEqual(state.drag, { dx: 0, dy: 0 });
	assert.deepEqual(state.selection.items, ["new1"]);
	assert.deepEqual(state.selection.awaited, ["new1"]);
	// The copy is kept selected while the drawing does not have it yet, and is no longer awaited once it does.
	const without = step(state, { type: "drawn", fresh: true, current: true, present: new Set(["a", "b"]) }, scene, ctx()).state;
	assert.deepEqual(without.selection.items, ["new1"]);
	const withIt = step(state, { type: "drawn", fresh: true, current: true, present: new Set(["a", "b", "new1"]) }, scene, ctx()).state;
	assert.deepEqual(withIt.selection, { items: ["new1"], boards: [], awaited: [] });
});

test("over a frame that stacks its children, a drag aims at the slot between them and drops there", () => {
	// The pointer between c1 (318–358) and c2 (370–410).
	const { steps } = run(initialState("edit"), [
		{ type: "press-canvas", ...at(50, 40) },
		{ type: "move", ...at(150, 362) },
		{ type: "release", ...at(150, 362) },
	]);
	const over = steps[1]!.state.drop;
	assert.equal(over.into, "col");
	assert.deepEqual(over.slot, { index: 1, line: { x: 8, y: 364, w: 284, h: 0 } });
	// The column's other two slots are within 200 screen pixels of the pointer at 100%: dashed beside the solid one.
	assert.deepEqual(over.near?.slots, [
		{ x: 8, y: 313, w: 284, h: 0 },
		{ x: 8, y: 415, w: 284, h: 0 },
	]);
	// Zoomed in to 500%, 200 screen pixels is 40 on the stage, and the slots 49 and 53 away drop out.
	const close = run(initialState("edit"), [{ type: "press-canvas", ...at(50, 40) }, { type: "move", ...at(150, 362) }], ctx({ zoom: 5 }));
	assert.equal(close.steps[1]!.state.drop.near, undefined);
	assert.deepEqual(steps[2]!.ops, [{ op: "move", id: "a", parent: "col", index: 1, box: { x1: 110, y1: 342, x2: 210, y2: 392 } }]);
	assert.deepEqual(steps[2]!.state.drop, {});
	// The engine is told where it was let go and where the column's children are, to glide them from (`glide.ts`).
	const settled = steps[2]!.effects.find((one) => one.do === "settle");
	assert.deepEqual(settled && "landing" in settled ? [...settled.landing!] : undefined, [
		["c1", { x: 18, y: 318, w: 264, h: 40 }],
		["c2", { x: 18, y: 370, w: 264, h: 40 }],
		["a", { x: 110, y: 342, w: 100, h: 50 }],
	]);
});

test("let go on the composer, a drag mentions what it carried instead of moving it", () => {
	const { state, steps } = run(
		initialState("edit"),
		[
			{ type: "press-canvas", ...at(50, 40) },
			{ type: "move", ...at(91, 140) },
			{ type: "release", ...at(91, 140) },
		],
		ctx({ overComposer: () => true }),
	);
	assert.deepEqual(steps[2]!.ops, []);
	assert.equal(steps[2]!.preview, null);
	assert.deepEqual(steps[2]!.effects.at(-1), { do: "refer", ids: ["a"], boards: [] });
	assert.deepEqual(state.drag, { dx: 0, dy: 0 });
	assert.deepEqual(state.settling, []);
});

test("a click that does not move plays a film, or follows a link while browsing; Shift only adds to the selection", () => {
	const play = run(initialState("edit"), [{ type: "press-canvas", ...at(720, 720) }, { type: "release", ...at(720, 720) }]).steps[1]!;
	assert.deepEqual(play.effects.at(-1), { do: "media", id: "media", media: { kind: "video", file: "films/one.mp4" } });
	assert.deepEqual(play.ops, []);
	const link = ctx({ linkAt: () => "https://example.com" });
	const browsing = run(initialState("browse"), [{ type: "press-canvas", ...at(50, 40) }, { type: "release", ...at(50, 40) }], link).steps[1]!;
	assert.deepEqual(browsing.effects.at(-1), { do: "open-link", href: "https://example.com" });
	// Editing, a link wants ⌘ or Ctrl.
	const editing = run(initialState("edit"), [{ type: "press-canvas", ...at(50, 40) }, { type: "release", ...at(50, 40) }], link).steps[1]!;
	assert.deepEqual(kinds(editing.effects), ["ghost-drop", "composer"]);
	const shift = step(withSelection(initialState("edit"), { items: ["b"] }), { type: "press-canvas", ...at(50, 40, { shift: true }) }, scene, ctx());
	assert.deepEqual(shift.state.selection.items, ["b", "a"]);
	assert.equal(shift.state.gesture, undefined);
	assert.deepEqual(step(shift.state, { type: "press-canvas", ...at(50, 40, { shift: true }) }, scene, ctx()).state.selection.items, ["b"]);
});

test("a marquee picks what is wholly inside it as it goes, and Shift adds that to what was selected", () => {
	const start = withSelection(initialState("edit"), { items: ["c1"] });
	const { state, steps } = run(start, [
		{ type: "press-canvas", ...at(-50, -50, { shift: true }) },
		{ type: "move", ...at(200, 100) },
		{ type: "move", ...at(600, 100) },
		{ type: "release", ...at(600, 100) },
	]);
	assert.deepEqual(steps[0]!.state.marquee, { x1: -50, y1: -50, x2: -50, y2: -50 });
	assert.deepEqual(steps[1]!.state.selection.items, ["c1", "a"]);
	assert.deepEqual(steps[2]!.state.selection.items, ["c1", "a", "b"]);
	assert.deepEqual(kinds(steps[2]!.effects), ["panned"]);
	assert.equal(state.marquee, undefined);
	assert.deepEqual(state.selection.items, ["c1", "a", "b"]);
	// Without Shift the press lets go of what was selected first, boards too.
	const fresh = step(withSelection(start, { boards: ["boards/one.html"] }), { type: "press-canvas", ...at(-50, -50) }, scene, ctx()).state;
	assert.deepEqual(fresh.selection, { items: [], boards: [], awaited: [] });
	// A marquee round the board picks it up.
	const round = run(initialState("edit"), [{ type: "press-canvas", ...at(950, -10) }, { type: "move", ...at(1450, 350) }]).state;
	assert.deepEqual(round.selection.boards, ["boards/one.html"]);
});

test("a board pressed is the app's selected board, and a drag carries it, moves it on the lift, and holds it there until it lands", () => {
	const { state, steps } = run(withSelection(initialState("edit"), { items: ["a"] }), [
		{ type: "press-board", path: "boards/one.html", ...at(1100, 100) },
		{ type: "move", ...at(1150, 160) },
		{ type: "release", ...at(1150, 160) },
	]);
	assert.deepEqual(steps[0]!.state.selection, { items: [], boards: [], awaited: [] });
	assert.deepEqual(steps[0]!.effects, [{ do: "select-board", path: "boards/one.html" }, { do: "ghost-take", ids: [] }]);
	assert.deepEqual(steps[1]!.state.boardDrag, { paths: ["boards/one.html"], dx: 50, dy: 60 });
	// Boards alone: the drawn items' offset and preview are not touched.
	assert.deepEqual(steps[1]!.state.drag, { dx: 0, dy: 0 });
	assert.equal(steps[1]!.preview, undefined);
	assert.deepEqual(steps[2]!.effects.find((effect) => effect.do === "move-boards"), { do: "move-boards", moves: [{ path: "boards/one.html", x: 1050, y: 60 }] });
	assert.ok(!kinds(steps[2]!.effects).includes("settle"));
	// Still carried where it was dropped until the boards have it there, or the hold runs out.
	const until = steps[2]!.effects.find((effect) => effect.do === "wake");
	assert.deepEqual(state.boardDrag, { paths: ["boards/one.html"], dx: 50, dy: 60, released: { to: [{ path: "boards/one.html", x: 1050, y: 60 }], until: (until as { at: number }).at } });
	assert.equal(landBoardDrag(state, [{ path: "boards/one.html", x: 1000, y: 0, w: 400, h: 300 }]).boardDrag, state.boardDrag);
	assert.equal(landBoardDrag(state, [{ path: "boards/one.html", x: 1050, y: 60, w: 400, h: 300 }]).boardDrag, undefined);
	assert.equal(landBoardDrag(state, []).boardDrag, undefined);
	assert.equal(step(state, { type: "tick", time: (until as { at: number }).at }, scene, ctx()).state.boardDrag, undefined);
	// Shift takes the board into the picks, or out, and carries nothing.
	const shift = step(initialState("edit"), { type: "press-board", path: "boards/one.html", ...at(1100, 100, { shift: true }) }, scene, ctx());
	assert.deepEqual(shift.state.selection.boards, ["boards/one.html"]);
	assert.equal(shift.state.gesture, undefined);
});

test("a board dragged near another settles 160 from it, the reading gap, and says so", () => {
	const two = fakeScene([], [
		{ path: "boards/one.html", x: 0, y: 0, w: 400, h: 300 },
		{ path: "boards/two.html", x: 900, y: 0, w: 400, h: 300 },
	]);
	let state = initialState("edit");
	const go = (input: Input) => {
		const result = step(state, input, two, ctx(WIDE));
		state = result.state;
		return result;
	};
	go({ type: "press-board", path: "boards/two.html", ...at(1000, 100) });
	// Dragged 343 left puts its left edge at 557, 157 from the first board: it settles at 560.
	const moved = go({ type: "move", ...at(657, 140) });
	assert.deepEqual(moved.state.boardDrag, { paths: ["boards/two.html"], dx: -340, dy: 40 });
	assert.deepEqual(moved.state.guides.find((guide) => guide.label), { kind: "gap", x1: 400, y1: 170, x2: 560, y2: 170, label: "160" });
	// ⌘ lets it go anywhere.
	assert.deepEqual(go({ type: "move", ...at(657, 140, { meta: true }) }).state.boardDrag, { paths: ["boards/two.html"], dx: -343, dy: 40 });
});

test("a document's bottom handle writes the height dragged, a floor, and shows it no shorter than its content", () => {
	const doc = fakeScene([], [{ path: "boards/doc.html", x: 0, y: 0, w: 760, h: 642, least: 642 }]);
	let state = initialState("edit");
	const go = (input: Input) => {
		const result = step(state, input, doc, ctx());
		state = result.state;
		return result;
	};
	go({ type: "press-board-handle", handle: "s", box: { path: "boards/doc.html", x: 0, y: 0, w: 760, h: 642 }, ...at(380, 642) });
	assert.deepEqual(go({ type: "move", ...at(380, 342) }).state.boardResize, { path: "boards/doc.html", x: 0, y: 0, w: 760, h: 642 });
	const lifted = go({ type: "release", ...at(380, 342, {}, 2000) });
	assert.deepEqual(lifted.effects.find((one) => one.do === "board-size"), { do: "board-size", path: "boards/doc.html", size: { w: 760, h: 342 } });
	assert.equal(lifted.state.boardResize?.h, 642);
});

test("a corner handle with Shift keeps the shape; the lift writes the size and waits for the drawing", () => {
	const box = { id: "a", x: 10, y: 20, w: 100, h: 50 };
	const { state, steps } = run(withSelection(initialState("edit"), { items: ["a"] }), [
		{ type: "press-handle", handle: "se", box, ...at(110, 70) },
		{ type: "move", ...at(160, 73, { shift: true }) },
		{ type: "release", ...at(160, 73, { shift: true }, 3000) },
	]);
	assert.deepEqual(steps[1]!.state.resize, { id: "a", x: 10, y: 20, w: 150, h: 75, given: { x: 10, y: 20 } });
	assert.deepEqual([...steps[1]!.preview!], [["a", { dx: 0, dy: 0, w: 150, h: 75 }]]);
	assert.deepEqual(steps[1]!.effects, [{ do: "await-frame", resize: steps[1]!.state.resize }]);
	// The outline follows the sheet, a frame behind: nothing until the frame is painted.
	assert.equal(steps[1]!.state.shownResize, undefined);
	assert.deepEqual(step(steps[1]!.state, { type: "frame", resize: steps[1]!.state.resize! }, scene, ctx()).state.shownResize, steps[1]!.state.resize);
	assert.deepEqual(steps[2]!.ops, [{ op: "update", id: "a", box: { x1: 10, y1: 20, x2: 160, y2: 95 } }]);
	assert.deepEqual(kinds(steps[2]!.effects), ["settle", "wake"]);
	assert.deepEqual(state.resize, steps[1]!.state.resize);
	assert.deepEqual(step(state, { type: "drawn", fresh: true, current: true, present: new Set(["a"]) }, scene, ctx()).state.resize, undefined);
	// Without Shift the corner follows the pointer each way; with the stage in the window its bottom
	// edge snaps back to b's at 70, 3 away, and ⌘ keeps it where the pointer is.
	const free = run(withSelection(initialState("edit"), { items: ["a"] }), [{ type: "press-handle", handle: "se", box, ...at(110, 70) }, { type: "move", ...at(160, 73) }]).state;
	assert.deepEqual(free.resize, { id: "a", x: 10, y: 20, w: 150, h: 53, given: { x: 10, y: 20 } });
	const near = run(withSelection(initialState("edit"), { items: ["a"] }), [{ type: "press-handle", handle: "se", box, ...at(110, 70) }, { type: "move", ...at(160, 73) }], ctx(WIDE)).state;
	assert.deepEqual(near.resize, { id: "a", x: 10, y: 20, w: 150, h: 50, given: { x: 10, y: 20 } });
	const held = run(withSelection(initialState("edit"), { items: ["a"] }), [{ type: "press-handle", handle: "se", box, ...at(110, 70) }, { type: "move", ...at(160, 73, { meta: true }) }], ctx(WIDE)).state;
	assert.deepEqual(held.resize?.h, 53);
});

test("two presses on a frame's top handle hug it again; slower, or on another handle, they do not", () => {
	const box = { id: "col", x: 0, y: 300, w: 300, h: 300 };
	const twice = run(initialState("edit"), [
		{ type: "press-handle", handle: "n", box, ...at(150, 300, {}, 100) },
		{ type: "release", ...at(150, 300, {}, 120) },
		{ type: "press-handle", handle: "n", box, ...at(150, 300, {}, 300) },
		{ type: "release", ...at(150, 300, {}, 320) },
	]);
	assert.deepEqual(twice.steps[1]!.ops, []);
	assert.deepEqual(twice.steps[3]!.ops, [{ op: "update", id: "col", set: { height: "fit_content(120)" } }]);
	const slow = run(initialState("edit"), [
		{ type: "press-handle", handle: "n", box, ...at(150, 300, {}, 100) },
		{ type: "release", ...at(150, 300, {}, 120) },
		{ type: "press-handle", handle: "n", box, ...at(150, 300, {}, 600) },
		{ type: "release", ...at(150, 300, {}, 620) },
	]);
	assert.deepEqual(slow.steps[3]!.ops, []);
});

test("a board's handle sizes it with Shift keeping its shape; the box is held until the board is at it", () => {
	const box = { path: "boards/one.html", x: 1000, y: 0, w: 400, h: 300 };
	const { state, steps } = run(initialState("edit"), [
		{ type: "press-board-handle", handle: "se", box, ...at(1400, 300) },
		{ type: "move", ...at(1600, 310, { shift: true }) },
		{ type: "release", ...at(1600, 310, { shift: true }, 5000) },
	]);
	assert.deepEqual(steps[1]!.state.boardResize, { path: "boards/one.html", x: 1000, y: 0, w: 600, h: 450 });
	assert.deepEqual(steps[2]!.effects, [
		{ do: "board-size", path: "boards/one.html", size: { w: 600, h: 450 } },
		{ do: "wake", at: 5000 + BOARD_HOLD_MS },
	]);
	assert.deepEqual(state.boardResize, { path: "boards/one.html", x: 1000, y: 0, w: 600, h: 450, released: { rev: 7, until: 5000 + BOARD_HOLD_MS } });
	// The write has not come back (same revision): held. It has, at the size: let go.
	assert.equal(landBoardResize(state, { path: "boards/one.html", x: 1000, y: 0, w: 400, h: 300, rev: 7 }), state);
	assert.equal(landBoardResize(state, { path: "boards/one.html", x: 1000, y: 0, w: 600, h: 450, rev: 8 }).boardResize, undefined);
	// Its content made it taller than the box: that is the board at it too.
	assert.equal(landBoardResize(state, { path: "boards/one.html", x: 1000, y: 0, w: 600, h: 520, rev: 8 }).boardResize, undefined);
	assert.equal(step(state, { type: "tick", time: 5000 + BOARD_HOLD_MS }, scene, ctx()).state.boardResize, undefined);
});

test("a radius drag previews the radius and holds it after the lift until the drawing has it", () => {
	const handle = { id: "a", x: 10, y: 20, w: 100, h: 50, radius: 0, most: 25, shape: false };
	const { state, steps } = run(withSelection(initialState("edit"), { items: ["a"] }), [
		{ type: "press-radius", handle, ...at(14, 24) },
		{ type: "move", ...at(22, 40) },
		{ type: "release", ...at(22, 40, {}, 800) },
	]);
	assert.deepEqual([...steps[1]!.preview!], [["a", { dx: 0, dy: 0, radius: 12 }]]);
	assert.deepEqual(steps[2]!.ops, [{ op: "update", id: "a", set: { cornerRadius: 12 } }]);
	assert.deepEqual(state.radius, { id: "a", radius: 12, done: true, until: 800 + RADIUS_HOLD_MS });
	// The drawing does not have it yet (the fake has no corner radius on `a`): still held, until the time is up.
	assert.deepEqual(step(state, { type: "drawn", fresh: true, current: true, present: new Set(["a"]) }, scene, ctx()).state.radius, state.radius);
	assert.equal(step(state, { type: "tick", time: 800 + RADIUS_HOLD_MS }, scene, ctx()).state.radius, undefined);
	// Let go where it started: nothing written, and the preview goes at once.
	const back = run(withSelection(initialState("edit"), { items: ["a"] }), [{ type: "press-radius", handle, ...at(14, 24) }, { type: "release", ...at(14, 24) }]).steps[1]!;
	assert.deepEqual(back.ops, []);
	assert.equal(back.preview, null);
});

test("a finger carries the selection by as far as it has gone on the screen, and a pinch takes it back", () => {
	const start = withSelection(initialState("edit"), { items: ["a"] });
	const touch = (x: number, y: number) => at(x, y, {}, 1000, "touch");
	const carried = run(
		start,
		[
			{ type: "carry", from: { at: { x: 50, y: 40 }, client: { x: 500, y: 400 } }, ...touch(520, 450) },
			{ type: "move", at: { x: 60, y: 65 }, client: { x: 520, y: 450 }, mods: NONE, pointer: "touch", time: 1000 },
		],
		ctx({ zoom: 2 }),
	);
	// 20 × 50 screen pixels at 200%: 10 × 25 on the stage, unsnapped.
	assert.deepEqual(carried.state.drag, { dx: 10, dy: 25 });
	assert.deepEqual(carried.state.guides, []);
	assert.deepEqual(kinds(carried.steps[1]!.effects), ["ghost-show"]);
	const lift = step(carried.state, { type: "release", ...touch(520, 450) }, scene, ctx({ zoom: 2 }));
	assert.deepEqual(lift.ops, [{ op: "update", id: "a", set: { x: 20, y: 45 } }]);
	const pinch = step(carried.state, { type: "cancel" }, scene, ctx());
	assert.equal(pinch.preview, null);
	assert.deepEqual(pinch.state.drag, { dx: 0, dy: 0 });
	assert.deepEqual(pinch.ops, []);
});
