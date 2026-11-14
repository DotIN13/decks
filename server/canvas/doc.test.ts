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
