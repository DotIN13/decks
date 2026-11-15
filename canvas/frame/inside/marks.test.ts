import assert from "node:assert/strict";
import { test } from "node:test";
import { touchedBy, type ItemBox } from "./marks.ts";
import type { PenEdit } from "@decks/pen";

test("an agent's edit marks each item once, by what was done to it, and not what sits inside a marked item", () => {
	const after = new Map<string, ItemBox>([
		["plan", { x: 0, y: 0, w: 700, h: 400 }],
		["title", { x: 20, y: 20, w: 200, h: 30, parent: "plan" }],
		["n1", { x: 800, y: 0, w: 200, h: 50 }],
		["n2", { x: 800, y: 100, w: 200, h: 50 }],
		["t", { x: 0, y: 500, w: 100, h: 30 }],
	]);
	const before = new Map<string, ItemBox>([["gone", { x: 300, y: 300, w: 50, h: 50 }]]);
	const edits: PenEdit[] = [
		{ op: "insert", id: "plan", parent: null, after: null, props: { type: "frame" }, list: true },
		{ op: "insert", id: "title", parent: "plan", after: null, props: { type: "text" }, list: false },
		{ op: "set", id: "n1", key: "x", value: 800 },
		{ op: "set", id: "n1", key: "y", value: 0 },
		{ op: "set", id: "t", key: "content", value: "retitled" },
		{ op: "place", id: "n2", parent: null, after: "n1" },
		{ op: "remove", id: "gone" },
		{ op: "meta", key: "variables", value: {} },
	];
	const touched = touchedBy(edits, (id) => before.get(id), (id) => after.get(id));
	const byId = Object.fromEntries(touched.map((one) => [one.id, one]));
	assert.deepEqual(Object.keys(byId).sort(), ["gone", "n1", "n2", "plan", "t"], "the title inside the inserted frame is covered by the frame's mark");
	assert.equal(byId.plan!.kind, "insert");
	assert.equal(byId.n1!.kind, "move", "x and y alone are a move");
	assert.equal(byId.t!.kind, "update");
	assert.equal(byId.n2!.kind, "move", "a new place among the siblings is a move");
	assert.equal(byId.gone!.kind, "delete");
	assert.deepEqual(byId.gone!.box, { x: 300, y: 300, w: 50, h: 50 }, "a deleted item's mark is where it was");
	// An insert then moved in the same edit stays an insert.
	const again = touchedBy([{ op: "insert", id: "n3", parent: null, after: null, props: {}, list: false }, { op: "set", id: "n3", key: "x", value: 1 }], () => undefined, () => ({ x: 1, y: 0, w: 1, h: 1 }));
	assert.equal(again[0]!.kind, "insert");
});
