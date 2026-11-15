import assert from "node:assert/strict";
import { test } from "node:test";
import type { Caller } from "../../protocol/index.ts";
import { PenCanvas } from "./doc.ts";
import { Kinds } from "./kinds.ts";

const person: Caller = { kind: "person", id: "person", name: "Ada" };
const agent: Caller = { kind: "agent", id: "a1", name: "Easel" };
const START = JSON.stringify({ version: "2.14", children: [{ type: "note", id: "n1", content: "One", x: 0, y: 0, width: 200, height: 100 }] }, null, 2) + "\n";

function make() {
	const files: string[] = [];
	const doc = new PenCanvas("plan", START, new Kinds(), (text) => files.push(text), () => 1);
	return { doc, files };
}

test("a batch with one bad op changes nothing, and says which op and why", () => {
	const { doc, files } = make();
	assert.throws(() => doc.apply([{ op: "insert", item: { type: "note", content: "Two" } }, { op: "delete", id: "nope" }], agent), (e: Error & { code?: string }) => {
		assert.equal(e.code, "not_found");
		assert.match(e.message, /^Op 2 \(delete\) failed, so nothing changed: Nothing called nope/);
		return true;
	});
	assert.equal(doc.read().length, 1);
	assert.equal(doc.rev, 0);
	assert.equal(files.length, 0);
});

test("two callers' edits get rising revisions, each with its author", () => {
	const { doc } = make();
	assert.equal(doc.apply([{ op: "update", id: "n1", set: { content: "Uno" } }], agent).rev, 1);
	assert.equal(doc.apply([{ op: "update", id: "n1", set: { content: "Eins" } }], person).rev, 2);
	assert.deepEqual(doc.since(0).map((c) => [c.rev, c.by]), [[1, "a1"], [2, "person"]]);
	assert.deepEqual(doc.since(1).map((c) => c.rev), [2]);
});

test("beside puts an item 160 px right of another, tops aligned; a later op may be beside an earlier one", () => {
	const { doc } = make();
	const { items } = doc.apply([
		{ op: "insert", item: { type: "note", id: "n2", content: "Two", width: 100, height: 50 }, beside: "n1" },
		{ op: "insert", item: { type: "note", id: "n3", content: "Three", width: 100, height: 50 }, below: "n2" },
	], agent);
	assert.deepEqual(items.map((i) => [i.id, i.box!.x1, i.box!.y1]), [["n2", 360, 0], ["n3", 360, 210]]);
	assert.deepEqual(doc.since(0)[0]!.ops[0], { op: "insert", item: { type: "note", id: "n2", content: "Two", width: 100, height: 50 }, at: { x: 360, y: 0 } });
});

test("two places at once are refused", () => {
	const { doc } = make();
	assert.throws(() => doc.apply([{ op: "insert", item: { type: "note" }, beside: "n1", below: "n1" }], agent), /Say one place/);
});

test("undo takes back the person's last edit, and redo puts it back", () => {
	const { doc } = make();
	doc.apply([{ op: "update", id: "n1", set: { content: "Changed" } }], person);
	doc.undo(person);
	assert.equal(doc.read()[0]!.content, "One");
	assert.equal(doc.rev, 2);
	doc.undo(person, true);
	assert.equal(doc.read()[0]!.content, "Changed");
});

test("undo refuses, saying who, when someone else changed the drawing since", () => {
	const { doc } = make();
	doc.apply([{ op: "update", id: "n1", set: { content: "Mine" } }], person);
	doc.apply([{ op: "update", id: "n1", set: { x: 40 } }], agent);
	assert.throws(() => doc.undo(person), (e: Error & { code?: string }) => e.code === "conflict" && /a1 changed the drawing since/.test(e.message));
	assert.equal(doc.read()[0]!.content, "Mine");
});

test("an item you did not touch keeps its bytes in the file", () => {
	const { doc, files } = make();
	doc.apply([{ op: "insert", item: { type: "text", id: "t", content: "Hi" }, at: { x: 0, y: 400 } }], agent);
	assert.ok(files[0]!.includes(START.split("\n").slice(3, 11).join("\n")));
});

test("a change from outside the server is one change by whoever wrote it", () => {
	const { doc } = make();
	doc.reload(START.replace('"One"', '"Outside"'), "pen.dev");
	assert.equal(doc.read()[0]!.content, "Outside");
	assert.deepEqual(doc.since(0).map((c) => [c.by, c.ops[0]!.op]), [["pen.dev", "replace"]]);
});

test("after a change, a joined arrow is routed again between its ends, in the same revision", () => {
	const { doc, files } = make();
	const arrow = { type: "path", id: "ar", geometry: "M2 2 L100 50", width: 102, height: 52, metadata: { type: "decks.arrow", from: { item: "n1" }, to: { item: "n2" } } };
	doc.apply([{ op: "insert", item: { type: "note", id: "n2", content: "Two", width: 200, height: 100 }, at: { x: 600, y: 0 } }, { op: "insert", item: arrow, at: { x: 0, y: 0 } }], agent);
	const routed = doc.read({ ids: ["ar"] })[0]!;
	assert.ok(routed.box!.x1 >= 190 && routed.box!.x2 <= 610 && routed.box!.y2 < 100, JSON.stringify(routed.box));
	const { rev } = doc.apply([{ op: "move", id: "n2", at: { x: 600, y: 600 } }], agent);
	const bent = doc.read({ ids: ["ar"] })[0]!;
	assert.ok(bent.box!.y2 > 500, JSON.stringify(bent.box));
	assert.deepEqual(doc.since(rev - 1).map((c) => c.rev), [rev]);
	assert.match(files.at(-1)!, /"ar"/);
});

test("an item moved out of a frame that lays it out keeps the width it was drawn at", () => {
	const col = { type: "frame", id: "col", layout: "vertical", width: 300, children: [{ type: "text", id: "w", content: "Words", width: "fill_container", textGrowth: "fixed-width" }] };
	const doc = new PenCanvas("plan", JSON.stringify({ version: "2.14", children: [col] }), new Kinds(), () => undefined);
	doc.apply([{ op: "move", id: "w", parent: null, at: { x: 600, y: 0 } }], agent);
	const moved = doc.pen().children.find((n) => n.id === "w")!;
	assert.equal(moved.width, 300);
});

test("a variables op keeps the theme axes it is given, so a dark value is drawn", () => {
	let file = "";
	const doc = new PenCanvas("p", JSON.stringify({ version: "2.14", children: [] }), new Kinds(), (t) => { file = t; });
	const set = { slate: { type: "color", value: [{ value: "#dbe4f0" }, { value: "#34404f", theme: { mode: "dark" } }] } };
	doc.apply([{ op: "variables", set, themes: { mode: ["light", "dark"] } }], person);
	assert.deepEqual(JSON.parse(file).themes, { mode: ["light", "dark"] });
});
