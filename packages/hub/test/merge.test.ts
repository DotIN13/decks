import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, type PenDocument } from "@decks/pen";
import { merge } from "../src/merge.ts";

const base: PenDocument = { version: "2.14", children: [
	{ id: "a", type: "note", content: "A", x: 0, y: 0 },
	{ id: "b", type: "note", content: "B", x: 300, y: 0 },
] } as PenDocument;

const edit = (doc: PenDocument, f: (d: PenDocument) => void) => { const d = structuredClone(doc); f(d); return d; };

test("two copies changing different items both land", () => {
	const mine = edit(base, (d) => { (d.children[0] as any).content = "A2"; });
	const theirs = edit(base, (d) => { (d.children[1] as any).x = 500; });
	const once = merge(base, diff(base, theirs)).doc;
	const both = merge(once, diff(base, mine));
	assert.equal((both.doc.children[0] as any).content, "A2");
	assert.equal((both.doc.children[1] as any).x, 500);
	assert.equal(both.dropped.length, 0);
});

test("the same field takes the last push", () => {
	const mine = edit(base, (d) => { (d.children[0] as any).content = "mine"; });
	const theirs = edit(base, (d) => { (d.children[0] as any).content = "theirs"; });
	const r = merge(merge(base, diff(base, theirs)).doc, diff(base, mine));
	assert.equal((r.doc.children[0] as any).content, "mine");
});

test("an edit to an item someone removed is dropped, and the removal stands", () => {
	const theirs = edit(base, (d) => { d.children.splice(0, 1); });
	const mine = edit(base, (d) => { (d.children[0] as any).content = "late"; });
	const r = merge(merge(base, diff(base, theirs)).doc, diff(base, mine));
	assert.equal(r.doc.children.length, 1);
	assert.equal(r.dropped.length, 1);
});

test("an insert after a sibling someone removed goes to the end", () => {
	const theirs = edit(base, (d) => { d.children.splice(0, 1); });
	const mine = edit(base, (d) => { d.children.splice(1, 0, { id: "c", type: "note", content: "C" } as any); });
	const r = merge(merge(base, diff(base, theirs)).doc, diff(base, mine));
	assert.deepEqual(r.doc.children.map((n) => n.id), ["b", "c"]);
	assert.equal(r.adjusted, 1);
});

test("the edits merge reports, applied again to the same document, make what merge made", () => {
	const mine = edit(base, (d) => { (d.children[0] as any).x = 50; d.children.push({ id: "c", type: "note", content: "C", x: 0, y: 300 } as never); });
	const theirs = edit(base, (d) => { d.children.splice(0, 1); });
	const now = merge(base, diff(base, theirs)).doc;
	for (const from of [base, now]) {
		const r = merge(from, diff(base, mine));
		let replayed = from;
		for (const e of r.edits) replayed = merge(replayed, [e]).doc;
		assert.deepEqual(replayed, r.doc);
	}
	const slow = merge(now, diff(base, mine));
	assert.equal(slow.dropped.length, 1, "the move of the removed note");
	assert.equal(slow.edits.length, 1, "only the insert happened");
});

test("an insert of an item already there is dropped, never a second item with the same id", () => {
	const again = merge(base, [{ op: "insert", id: "a", parent: null, after: null, props: { type: "note", content: "again" }, list: false }]);
	assert.equal(again.doc.children.length, 2);
	assert.equal((again.doc.children[0] as any).content, "A");
	assert.equal(again.dropped.length, 1);
});
