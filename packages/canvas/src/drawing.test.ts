import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, type PenDocument, type PenEdit } from "@decks/pen";
import { boardsOf, createDrawing } from "./drawing.ts";

const sample = (): PenDocument => ({
	version: "2.14",
	children: [
		{ type: "note", id: "a", content: "one", x: 0, y: 0, width: 200, height: 100 },
		{ type: "browser", id: "b", name: "Plan", url: "boards/plan.html", x: 400, y: 10, width: 600, height: 400, metadata: { type: "decks.board", path: "boards/plan.html" } },
	],
});

test("an edit is applied, and reported as the edits that make the last document into the new one", () => {
	const heard: PenEdit[][] = [];
	const drawing = createDrawing(sample(), { onEdits: (edits) => heard.push(edits) });
	const before = drawing.doc();
	assert.equal(drawing.edit([{ op: "update", id: "a", set: { content: "two" } }]), true);
	assert.equal(drawing.doc().children[0]?.content, "two");
	assert.deepEqual(heard, [[{ op: "set", id: "a", key: "content", value: "two" }]]);
	// The host can replay what it heard on its own copy and arrive at the same drawing.
	assert.deepEqual(applyEdits(before, heard[0]!), drawing.doc());
});

test("undo and redo are edits too, and an edit after an undo drops the redo", () => {
	const heard: PenEdit[][] = [];
	const drawing = createDrawing(sample(), { onEdits: (edits) => heard.push(edits) });
	drawing.edit([{ op: "update", id: "a", set: { x: 50 } }]);
	drawing.step("undo");
	assert.equal(drawing.doc().children[0]?.x, 0);
	drawing.step("redo");
	assert.equal(drawing.doc().children[0]?.x, 50);
	drawing.step("undo");
	drawing.edit([{ op: "update", id: "a", set: { y: 30 } }]);
	drawing.step("redo");
	assert.equal(drawing.doc().children[0]?.x, 0, "nothing to redo after a new edit");
	assert.deepEqual(
		heard.map((edits) => edits.map((edit) => (edit.op === "set" ? `${edit.key}=${String(edit.value)}` : edit.op))),
		[["x=50"], ["x=0"], ["x=50"], ["x=0"], ["y=30"]],
	);
});

test("a refused edit changes nothing and reports nothing", () => {
	let heard = 0;
	const drawing = createDrawing(sample(), { onEdits: () => heard++ });
	const warn = console.warn;
	console.warn = () => {};
	try {
		assert.equal(drawing.edit([{ op: "update", id: "nobody", set: { x: 1 } }]), false);
	} finally {
		console.warn = warn;
	}
	assert.equal(heard, 0);
	assert.equal(drawing.doc().children.length, 2);
});

test("read-only takes no edits", () => {
	const drawing = createDrawing(sample(), { readOnly: true });
	assert.equal(drawing.edit([{ op: "delete", id: "a" }]), false);
	assert.equal(drawing.doc().children.length, 2);
});

test("a drawing from elsewhere is shown, not reported, and undo starts again from it", () => {
	let heard = 0;
	const drawing = createDrawing(sample(), { onEdits: () => heard++ });
	drawing.edit([{ op: "update", id: "a", set: { x: 5 } }]);
	const elsewhere = sample();
	elsewhere.children[0]!.content = "from another device";
	drawing.set(JSON.stringify(elsewhere));
	assert.equal(heard, 1);
	assert.equal(drawing.doc().children[0]?.content, "from another device");
	drawing.step("undo");
	assert.equal(drawing.doc().children[0]?.content, "from another device");
});

test("boards are the drawing's decks.board items, and moving one moves its item", () => {
	const drawing = createDrawing(sample());
	assert.deepEqual(
		boardsOf(drawing.doc()).map(({ path, title, x, y, w, h }) => ({ path, title, x, y, w, h })),
		[{ path: "boards/plan.html", title: "Plan", x: 400, y: 10, w: 600, h: 400 }],
	);
	drawing.moveBoard("boards/plan.html", 420.4, -7.6);
	drawing.resizeBoard("boards/plan.html", { w: 640, h: 380 });
	const board = drawing.doc().children[1]!;
	assert.deepEqual([board.x, board.y, board.width, board.height], [420, -8, 640, 380]);
});
