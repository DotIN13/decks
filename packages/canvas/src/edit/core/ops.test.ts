import assert from "node:assert/strict";
import { test } from "node:test";
import { ARROW, makeShape, MARKDOWN, shapeKind, type PenNode } from "@decks/pen";
import { fakeScene, type FakeItem } from "./fake-scene.ts";
import { arrowInsertOp, pageMoves, copyOps, deleteOps, drawnOp, duplicateOps, FRAME_RADIUS, idMaker, madeNode, madeSize, makeAtOp, movedBy, moveOps, type MakeOptions } from "./ops.ts";

/** Ids as a counter hands them out: the same call writes the same ops. */
const counter = (prefix = "n") => {
	let n = 0;
	return () => `${prefix}${++n}`;
};

/**
 * `a` and `b` on the stage, a column frame `col` holding `c1 c2 c3`, a card `card` holding the
 * markdown text `md`, and an arrow `ar` from a point to `a`.
 */
const items: FakeItem[] = [
	{ id: "a", box: { x: 10, y: 20, w: 100, h: 50 }, extra: { x: 10, y: 20 } },
	{ id: "b", box: { x: 200, y: 20, w: 100, h: 50 }, extra: { x: 200, y: 20 } },
	{ id: "col", type: "frame", layout: "vertical", box: { x: 0, y: 200, w: 300, h: 300 }, extra: { x: 0, y: 200 } },
	{ id: "c1", parent: "col", box: { x: 18, y: 218, w: 264, h: 40 } },
	{ id: "c2", parent: "col", box: { x: 18, y: 270, w: 264, h: 40 } },
	{ id: "c3", parent: "col", box: { x: 18, y: 322, w: 264, h: 40 } },
	{ id: "card", type: "frame", layout: "vertical", box: { x: 400, y: 200, w: 320, h: 100 }, extra: { metadata: { type: "decks.card" } } },
	{ id: "md", type: "text", parent: "card", box: { x: 420, y: 220, w: 280, h: 24 }, extra: { metadata: { type: MARKDOWN } } },
	{ id: "ar", type: "path", box: { x: 0, y: 0, w: 10, h: 20 }, extra: { metadata: { type: ARROW, from: [0, 0], to: "a" } } },
];
const boards = [{ path: "boards/one.html", x: 1000, y: 0, w: 400, h: 300 }];
const scene = fakeScene(items, boards);

test("a nudge shifts each item's own x and y: 1 px, and 10 with Shift", () => {
	assert.deepEqual(moveOps(scene, ["a"], 1, 0), [{ op: "update", id: "a", set: { x: 11, y: 20 } }]);
	assert.deepEqual(moveOps(scene, ["a", "b"], 0, -10), [
		{ op: "update", id: "a", set: { x: 10, y: 10 } },
		{ op: "update", id: "b", set: { x: 200, y: 10 } },
	]);
	// No x or y of its own counts as 0; the result is rounded.
	assert.deepEqual(moveOps(scene, ["c1"], 2.6, 0), [{ op: "update", id: "c1", set: { x: 3, y: 0 } }]);
	// An item the document does not have writes nothing.
	assert.deepEqual(moveOps(scene, ["gone"], 1, 0), []);
});

test("an arrow moved with what it joins carries its point ends, and its joined end stays joined", () => {
	assert.deepEqual(moveOps(scene, ["ar", "a"], 10, 5)[0], { op: "update", id: "ar", set: { x: 10, y: 5, metadata: { type: ARROW, from: [10, 5], to: "a" } } });
	assert.deepEqual(movedBy({ id: "r", type: "rectangle", x: 1.2 } as PenNode, 0.4, 0), { x: 2, y: 0 });
});

test("a drag into a frame is a move with the stage box it ends at, and the slot it goes in", () => {
	assert.deepEqual(moveOps(scene, ["a"], 5.4, 200, "col", 1), [{ op: "move", id: "a", parent: "col", index: 1, box: { x1: 15, y1: 220, x2: 115, y2: 270 } }]);
	// Out onto the stage: parent null, no index.
	assert.deepEqual(moveOps(scene, ["c1"], 0, -300, null), [{ op: "move", id: "c1", parent: null, box: { x1: 18, y1: -82, x2: 282, y2: -42 } }]);
	// Into the frame it is in already, with no slot: the plain shift.
	assert.deepEqual(moveOps(scene, ["c1"], 1, 0, "col"), [{ op: "update", id: "c1", set: { x: 1, y: 0 } }]);
});

test("a reorder in a column counts down for an item above its new slot, and a second item goes after the first", () => {
	// c1 (index 0) to slot 3, past c3: it is taken out first, so it lands at 2.
	assert.deepEqual(moveOps(scene, ["c1"], 0, 104, "col", 3), [{ op: "move", id: "c1", parent: "col", index: 2, box: { x1: 18, y1: 322, x2: 282, y2: 362 } }]);
	// c3 (index 2) to slot 0: no correction.
	assert.deepEqual(moveOps(scene, ["c3"], 0, -104, "col", 0), [{ op: "move", id: "c3", parent: "col", index: 0, box: { x1: 18, y1: 218, x2: 282, y2: 258 } }]);
	// Two at once into slot 1: a from the stage at 1, b after it at 2.
	assert.deepEqual(
		moveOps(scene, ["a", "b"], 0, 0, "col", 1).map((op) => ("index" in op ? op.index : undefined)),
		[1, 2],
	);
});

test("markdown words dropped in a card are as wide as it", () => {
	const words = fakeScene([...items, { id: "w", type: "text", box: { x: 0, y: 600, w: 120, h: 24 }, extra: { metadata: { type: MARKDOWN } } }]);
	assert.deepEqual(moveOps(words, ["w"], 400, -360, "card", 1), [
		{ op: "move", id: "w", parent: "card", index: 1, box: { x1: 400, y1: 240, x2: 520, y2: 264 } },
		{ op: "update", id: "w", set: { width: "fill_container", textGrowth: "fixed-width" } },
	]);
	// Out of a card onto the stage they keep the width they had.
	assert.deepEqual(moveOps(scene, ["md"], 0, 200, null), [{ op: "move", id: "md", parent: null, box: { x1: 420, y1: 420, x2: 700, y2: 444 } }]);
});

test("an Alt-drag copies each item to where it was let go, and the copies are what is selected", () => {
	assert.deepEqual(copyOps(scene, ["a", "gone", "b"], 30, -5, counter()), {
		ops: [
			{ op: "copy", id: "a", as: "n1" },
			{ op: "update", id: "n1", set: { x: 40, y: 15 } },
			{ op: "copy", id: "b", as: "n2" },
			{ op: "update", id: "n2", set: { x: 230, y: 15 } },
		],
		made: ["n1", "n2"],
	});
});

test("a duplicate is a copy 24 down and right", () => {
	assert.deepEqual(duplicateOps(scene, ["a", "ar"], counter("d")), {
		ops: [
			{ op: "copy", id: "a", as: "d1" },
			{ op: "update", id: "d1", set: { x: 34, y: 44 } },
			{ op: "copy", id: "ar", as: "d2" },
			{ op: "update", id: "d2", set: { x: 24, y: 24, metadata: { type: ARROW, from: [24, 24], to: "a" } } },
		],
		made: ["d1", "d2"],
	});
});

test("delete is one op per item", () => {
	assert.deepEqual(deleteOps(["a", "b"]), [
		{ op: "delete", id: "a" },
		{ op: "delete", id: "b" },
	]);
	assert.deepEqual(deleteOps([]), []);
});

test("boards move to their own rounded corners; a board not on the stage is left out", () => {
	assert.deepEqual(pageMoves(boards, ["boards/one.html", "boards/gone.html"], 10.6, -1), [{ path: "boards/one.html", x: 1011, y: -1 }]);
});

test("new ids are none of the taken ones and none of each other", () => {
	const next = idMaker(["a", "b"]);
	const made = new Set(Array.from({ length: 50 }, () => next()));
	assert.equal(made.size, 50);
	assert.ok(!made.has("a") && !made.has("b"));
	for (const id of made) assert.match(id, /^[a-z0-9]{5}$/i);
});

const options = (fields: Partial<MakeOptions> = {}): MakeOptions => ({
	shape: "Rectangle",
	icon: { library: "lucide", name: "star" },
	nextId: counter("in"),
	card: (id, child) => ({ type: "frame", id, name: "Card", children: [{ type: "text", id: child }] }) as unknown as PenNode,
	...fields,
});

test("a click makes each tool's item at its own size, its corner at the point", () => {
	const point = { x: 10.4, y: 20.6 };
	assert.deepEqual(makeAtOp("rectangle", "r", point, options()), {
		op: { op: "insert", node: { type: "rectangle", fill: "$decks-fill-slate", cornerRadius: 8, id: "r" }, box: { x1: 10, y1: 21, x2: 170, y2: 121 } },
		node: { type: "rectangle", fill: "$decks-fill-slate", cornerRadius: 8, id: "r" },
		box: { x: 10, y: 21, w: 160, h: 100 },
	});
	assert.deepEqual(makeAtOp("ellipse", "e", point, options()).op, { op: "insert", node: { type: "ellipse", fill: "$decks-fill-sky", id: "e" }, box: { x1: 10, y1: 21, x2: 130, y2: 141 } });
	assert.equal(FRAME_RADIUS, 30);
	assert.deepEqual(makeAtOp("frame", "f", point, options()).op, {
		op: "insert",
		node: { type: "frame", name: "Frame", layout: "vertical", gap: 12, padding: 18, fill: "$decks-surface", stroke: "$decks-line-subtle", strokeWidth: 1, cornerRadius: 30, clip: true, id: "f" },
		box: { x1: 10, y1: 21, x2: 410, y2: 141 },
	});
	// A text's height is its words': its box has no bottom.
	assert.deepEqual(makeAtOp("text", "t", point, options()), {
		op: { op: "insert", node: { type: "text", content: "", fontSize: 24, textGrowth: "fixed-width", metadata: { type: MARKDOWN }, id: "t" }, box: { x1: 10, y1: 21, x2: 330 } },
		node: { type: "text", content: "", fontSize: 24, textGrowth: "fixed-width", metadata: { type: MARKDOWN }, id: "t" },
		box: { x: 10, y: 21, w: 320, h: 32 },
	});
	// A note's whole size is its words'.
	assert.deepEqual(makeAtOp("note", "no", point, options()), {
		op: { op: "insert", node: { type: "note", content: "", id: "no" }, box: { x1: 10, y1: 21 } },
		node: { type: "note", content: "", id: "no" },
		box: { x: 10, y: 21, w: 240, h: 80 },
	});
	// A card is the page's card (`newCard`) with a fresh block id; it opens 80 tall for typing.
	assert.deepEqual(makeAtOp("card", "k", point, options()), {
		op: { op: "insert", node: { type: "frame", id: "k", name: "Card", children: [{ type: "text", id: "in1" }] }, box: { x1: 10, y1: 21, x2: 330, y2: 69 } },
		node: { type: "frame", id: "k", name: "Card", children: [{ type: "text", id: "in1" }] },
		box: { x: 10, y: 21, w: 320, h: 80 },
	});
	assert.deepEqual(makeAtOp("icon", "i", point, options({ icon: { library: "phosphor", name: "heart" } })).op, {
		op: "insert",
		node: { type: "icon", id: "i", name: "heart", library: "phosphor", icon: "heart", fill: "$decks-text", weight: 400 },
		box: { x1: 10, y1: 21, x2: 58, y2: 69 },
	});
});

test("a shape is the library's, square for a star, 160×120 for a decision, else 160×100; its outline gets the next id", () => {
	assert.deepEqual(madeSize("shape", "Star"), { w: 120, h: 120 });
	assert.deepEqual(madeSize("shape", "Ellipse"), { w: 120, h: 120 });
	assert.deepEqual(madeSize("shape", "Decision"), { w: 160, h: 120 });
	assert.deepEqual(madeSize("shape", "Rectangle"), { w: 160, h: 100 });
	assert.deepEqual(madeSize("icon", "Star"), { w: 48, h: 48 });
	assert.deepEqual(madeSize("note", "Star"), { w: 240, h: 80 });
	for (const [shape, x2, y2] of [["Star", 130, 141], ["Decision", 170, 141], ["Rectangle", 170, 121]] as const) {
		const made = makeAtOp("shape", "s", { x: 10, y: 21 }, options({ shape }));
		const size = madeSize("shape", shape);
		assert.deepEqual(made.op, { op: "insert", node: makeShape(shapeKind(shape)!, { frame: "s", outline: "in1" }, size), box: { x1: 10, y1: 21, x2, y2 } });
		assert.equal((made.node.children ?? [])[0]?.id, "in1");
	}
	// A kind the library does not know is its first.
	assert.equal(madeNode("shape", "s", { w: 10, h: 10 }, options({ shape: "Nope" })).name, "Rectangle");
});

test("from the insert panel the item is put with its middle at the point", () => {
	assert.deepEqual(makeAtOp("rectangle", "r", { x: 100, y: 100 }, { ...options(), centred: true }).op, { op: "insert", node: { type: "rectangle", fill: "$decks-fill-slate", cornerRadius: 8, id: "r" }, box: { x1: 20, y1: 50, x2: 180, y2: 150 } });
	// Into the frame under the point.
	assert.deepEqual(makeAtOp("ellipse", "e", { x: 5, y: 5 }, { ...options(), parent: "col" }).op, { op: "insert", parent: "col", node: { type: "ellipse", fill: "$decks-fill-sky", id: "e" }, box: { x1: 5, y1: 5, x2: 125, y2: 125 } });
});

test("a drag makes the box between press and release, at least 8 each way", () => {
	assert.deepEqual(drawnOp("rectangle", "r", { x: 100, y: 100 }, { x: 40.4, y: 300.6 }, options()), {
		op: { op: "insert", node: { type: "rectangle", fill: "$decks-fill-slate", cornerRadius: 8, id: "r" }, box: { x1: 40, y1: 100, x2: 100, y2: 301 } },
		node: { type: "rectangle", fill: "$decks-fill-slate", cornerRadius: 8, id: "r" },
		box: { x: 40, y: 100, w: 60, h: 201 },
	});
	assert.deepEqual(drawnOp("frame", "f", { x: 0, y: 0 }, { x: 3, y: 2 }, { ...options(), parent: "col" }).op.box, { x1: 0, y1: 0, x2: 8, y2: 8 });
	// A text drawn keeps its width, not its height; a note drawn has both; a card opens 80 tall.
	assert.deepEqual(drawnOp("text", "t", { x: 0, y: 0 }, { x: 200, y: 60 }, options()).op.box, { x1: 0, y1: 0, x2: 200 });
	assert.deepEqual(drawnOp("note", "no", { x: 0, y: 0 }, { x: 200, y: 60 }, options()).op.box, { x1: 0, y1: 0, x2: 200, y2: 60 });
	assert.deepEqual(drawnOp("card", "k", { x: 0, y: 0 }, { x: 200, y: 60 }, options()).box, { x: 0, y: 0, w: 200, h: 80 });
	// A shape drawn is made at the size dragged.
	assert.deepEqual(drawnOp("shape", "s", { x: 0, y: 0 }, { x: 50, y: 70 }, options({ shape: "Star" })).op, { op: "insert", node: makeShape(shapeKind("Star")!, { frame: "s", outline: "in1" }, { w: 50, h: 70 }), box: { x1: 0, y1: 0, x2: 50, y2: 70 } });
});

test("an arrow is a curved grey path between its ends", () => {
	assert.deepEqual(arrowInsertOp("ar2", "a", [300, 40]), {
		op: "insert",
		node: { type: "path", id: "ar2", stroke: "$decks-line", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", metadata: { type: ARROW, from: "a", to: [300, 40], route: "curved" } },
	});
});

test("an arrow joined at both ends, carried on its own, gets no op: it cannot move, and goes back at once", () => {
	const joined: FakeItem[] = [
		...items,
		{ id: "j", type: "path", box: { x: 110, y: 40, w: 90, h: 10 }, extra: { x: 110, y: 40, metadata: { type: ARROW, from: "a", to: { item: "b", side: "left" } } } },
	];
	const s = fakeScene(joined, boards);
	assert.deepEqual(moveOps(s, ["j"], 30, 60), []);
	assert.deepEqual(moveOps(s, ["j"], 30, 60, null), []);
	// Carried with one item it joins while the other stays: no op of its own; it is drawn from its ends after the move.
	assert.deepEqual(moveOps(s, ["j", "a"], 30, 0), [{ op: "update", id: "a", set: movedBy(s.node("a")!, 30, 0) }]);
	// Carried with both: it moves with them.
	assert.deepEqual(moveOps(s, ["j", "a", "b"], 30, 0)[0], { op: "update", id: "j", set: movedBy(s.node("j")!, 30, 0) });
	// One end joined: it stays too, since dragging its line would only stretch it; its handles change its shape.
	assert.deepEqual(moveOps(s, ["ar"], 5, 5), []);
	// Carried with what it joins, it moves.
	assert.deepEqual(moveOps(s, ["ar", "a"], 5, 5)[0], { op: "update", id: "ar", set: movedBy(s.node("ar")!, 5, 5) });
});

test("an arrow whose joined items were deleted moves as a free one, from where it is drawn", () => {
	const orphan: FakeItem[] = [
		...items,
		{ id: "o", type: "path", box: { x: 110, y: 40, w: 90, h: 10 }, extra: { x: 110, y: 40, width: 90, height: 10, viewBox: [0, 0, 90, 10], geometry: "M2 5 L88 5 M80 9 L88 5 L80 1", metadata: { type: ARROW, from: "gone1", to: { item: "gone2", side: "left" } } } },
	];
	const s = fakeScene(orphan, boards);
	assert.deepEqual(moveOps(s, ["o"], 30, 60), [{ op: "update", id: "o", set: { x: 140, y: 100, metadata: { type: ARROW, from: [142, 105], to: [228, 105] } } }]);
});

test("deleting what an arrow joins lets that end go where it is drawn, so the arrow stays free", () => {
	const joined: FakeItem[] = [
		...items,
		{ id: "j", type: "path", box: { x: 110, y: 40, w: 90, h: 10 }, extra: { x: 110, y: 40, width: 90, height: 10, viewBox: [0, 0, 90, 10], geometry: "M2 5 L88 5 M80 9 L88 5 L80 1", metadata: { type: ARROW, from: "a", to: "b" } } },
	];
	const s = fakeScene(joined, boards);
	assert.deepEqual(deleteOps(["a"], s), [
		// `ar` has no line drawn yet, so it has no point to be let go at: it is left as it is.
		{ op: "update", id: "j", set: { metadata: { type: ARROW, from: [112, 45], to: "b" } } },
		{ op: "delete", id: "a" },
	]);
	// Without the scene, the plain deletes.
	assert.deepEqual(deleteOps(["a"]), [{ op: "delete", id: "a" }]);
});

test("nothing a tool makes stores a fixed colour: its colours are the drawing's light/dark Decks variables, or the scheme's own", async () => {
	const { newCard, fileItem } = await import("../../model/card-frame.ts");
	const fixed = /"#[0-9a-fA-F]{3,8}"/;
	for (const tool of ["rectangle", "ellipse", "frame", "text", "note", "card", "icon", "shape"] as const) {
		for (const shape of tool === "shape" ? ["Rectangle", "Decision", "Ellipse", "Arrow"] : ["Rectangle"]) {
			const node = makeAtOp(tool, "x", { x: 0, y: 0 }, options({ shape, card: newCard })).node;
			assert.doesNotMatch(JSON.stringify(node), fixed, `${tool} ${shape}`);
		}
	}
	const arrow = arrowInsertOp("a", "x", "y").node;
	assert.equal(arrow.stroke, "$decks-line");
	// A file's chip: a grey ground that reads on both, its icon and name Decks colours.
	const chip = fileItem("notes/plan.md", counter("f"));
	assert.deepEqual(chip.children!.map((child) => child.fill), ["$decks-text-muted", "$decks-text"]);
});
