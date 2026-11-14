import assert from "node:assert/strict";
import { test } from "node:test";
import { diff, type PenDocument } from "@decks/pen";
import { changesNothing, merge } from "./merge.ts";

const base = (): PenDocument =>
	({ version: "2.14", children: [{ id: "a", type: "note", content: "A", x: 0, y: 0 }, { id: "b", type: "note", content: "B", x: 300, y: 0 }] }) as unknown as PenDocument;
const changed = (f: (d: any) => void): PenDocument => {
	const d = structuredClone(base());
	f(d);
	return d;
};
const onto = (theirs: PenDocument, mine: PenDocument) => merge(merge(base(), diff(base(), theirs)).doc, diff(base(), mine));

test("a merge keeps both sides' items: changes to different items both land", () => {
	const r = onto(changed((d) => (d.children[1].x = 500)), changed((d) => (d.children[0].content = "A2")));
	assert.equal((r.doc.children[0] as any).content, "A2");
	assert.equal((r.doc.children[1] as any).x, 500);
	assert.equal(r.dropped.length, 0);
});

test("a field set by both takes the last push", () => {
	const r = onto(changed((d) => (d.children[0].content = "theirs")), changed((d) => (d.children[0].content = "mine")));
	assert.equal((r.doc.children[0] as any).content, "mine");
});

test("an edit to an item someone removed is dropped, and the removal stands", () => {
	const r = onto(changed((d) => d.children.splice(0, 1)), changed((d) => (d.children[0].content = "late")));
	assert.equal(r.doc.children.length, 1);
	assert.equal(r.dropped.length, 1);
});

test("an insert whose sibling went goes to the end of its list", () => {
	const r = onto(changed((d) => d.children.splice(0, 1)), changed((d) => d.children.splice(1, 0, { id: "c", type: "note", content: "C" })));
	assert.deepEqual(r.doc.children.map((n) => n.id), ["b", "c"]);
	assert.equal(r.adjusted, 1);
});

test("the edits a merge reports, replayed, make the same drawing", () => {
	const mine = changed((d) => ((d.children[0].x = 50), d.children.push({ id: "c", type: "note", content: "C", x: 0, y: 300 })));
	const now = merge(base(), diff(base(), changed((d) => d.children.splice(0, 1)))).doc;
	const r = merge(now, diff(base(), mine));
	assert.deepEqual(r.edits.reduce((doc, e) => merge(doc, [e]).doc, now), r.doc);
	assert.equal(r.dropped.length, 1, "the move of the removed note");
});

test("an item already there is never inserted twice", () => {
	const r = merge(base(), [{ op: "insert", id: "a", parent: null, after: null, props: { type: "note", content: "again" }, list: false }]);
	assert.equal(r.doc.children.length, 2);
	assert.equal(r.dropped.length, 1);
});

test("edits that set what is already there change nothing", () => {
	assert.ok(changesNothing(base(), [{ op: "set", id: "a", key: "x", value: 0 }]));
	assert.ok(!changesNothing(base(), [{ op: "set", id: "a", key: "x", value: 9 }]));
});
